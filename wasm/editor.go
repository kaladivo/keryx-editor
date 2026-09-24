package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"maps"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/v1b3coder/keryx/sdk/feed"
	"github.com/v1b3coder/keryx/sdk/keys"
	"github.com/v1b3coder/keryx/sdk/notify"
	"github.com/v1b3coder/keryx/sdk/publisher"
	"github.com/v1b3coder/keryx/sdk/tufrepo"
)

// editor is one loaded repo + keystore; it drives the SDK publisher exactly
// like the pub CLI does, over in-memory files.
type editor struct {
	files map[string][]byte
	store *memStore
	pub   *publisher.Publisher
}

type Company struct {
	Name       string      `json:"name"`
	Logo       string      `json:"logo,omitempty"`
	LogoSHA256 string      `json:"logoSHA256,omitempty"`
	RepoBase   string      `json:"repoBase,omitempty"`
	Channels   []Channel   `json:"channels"`
	Keys       []keys.Info `json:"keys"`
	Expires    Expires     `json:"expires"`
}

type Channel struct {
	Name        string           `json:"name"`
	DisplayName string           `json:"displayName,omitempty"`
	Description string           `json:"description,omitempty"`
	Mode        string           `json:"mode"`
	Version     int64            `json:"version"`
	Expires     string           `json:"expires"`
	Items       []map[string]any `json:"items"`
}

type Expires struct {
	Root      string `json:"root"`
	Targets   string `json:"targets"`
	Snapshot  string `json:"snapshot"`
	Timestamp string `json:"timestamp"`
}

type Change struct {
	Write  map[string][]byte
	Remove []string
}

type Versions struct {
	Timestamp int64 `json:"timestamp"`
	Snapshot  int64 `json:"snapshot"`
	Targets   int64 `json:"targets"`
	Channel   int64 `json:"channel"`
}

var ctx = context.Background()

func newEditor(files map[string][]byte, repoDir, anchorDir string, kfs []keyFile) (*editor, error) {
	store, err := newMemStore(kfs)
	if err != nil {
		return nil, err
	}
	base := &memRepo{files: files, dir: repoDir}
	anchor := &memRepo{files: files, dir: anchorDir}
	return &editor{files: files, store: store, pub: publisher.New(base, anchor, store)}, nil
}

func (e *editor) state() (*tufrepo.State, error) {
	return tufrepo.Load(ctx, e.pub.Base, e.pub.Anchor)
}

func (e *editor) company() (*Company, error) {
	st, err := e.state()
	if err != nil {
		return nil, err
	}
	infos, _ := e.store.List(ctx)
	c := &Company{
		Name:     st.CompanyName(),
		Logo:     st.Logo(),
		RepoBase: st.RepoBase(),
		Channels: []Channel{},
		Keys:     infos,
		Expires: Expires{
			Root:      rfc3339(st.Root.Signed.Expires),
			Targets:   rfc3339(st.Targets.Signed.Expires),
			Snapshot:  rfc3339(st.Snapshot.Signed.Expires),
			Timestamp: rfc3339(st.Timestamp.Signed.Expires),
		},
	}
	c.LogoSHA256, _ = st.Custom()["logo_sha256"].(string)
	for _, name := range st.ChannelNames() {
		meta := st.Channels[name]
		display := st.ChannelDisplay(name)
		ch := Channel{Name: name, Mode: "simple", Version: meta.Signed.Version, Expires: rfc3339(meta.Signed.Expires), Items: []map[string]any{}}
		ch.DisplayName, _ = display["display_name"].(string)
		ch.Description, _ = display["description"].(string)
		if st.HasAuthors(name) {
			ch.Mode = "authored"
		}
		for path := range meta.Signed.Targets {
			item, err := feed.Decode(st.Items[path])
			if err != nil {
				return nil, fmt.Errorf("%s: %w", path, err)
			}
			ch.Items = append(ch.Items, item)
		}
		sortNewestFirst(ch.Items)
		c.Channels = append(c.Channels, ch)
	}
	return c, nil
}

func sortNewestFirst(items []map[string]any) {
	published := func(it map[string]any) time.Time {
		s, _ := it["date_published"].(string)
		t, _ := time.Parse(time.RFC3339, s)
		return t
	}
	sort.SliceStable(items, func(i, j int) bool {
		ti, tj := published(items[i]), published(items[j])
		if ti.Equal(tj) {
			return feed.IDOf(items[i]) < feed.IDOf(items[j])
		}
		return ti.After(tj)
	})
}

func rfc3339(t time.Time) string { return t.UTC().Format(time.RFC3339) }

// publish is `pub item sign` (with the keys the channel mode needs) followed
// by `pub publish`.
func (e *editor) publish(channel string, draft map[string]any) (*Change, error) {
	if err := feed.ValidateItem(draft); err != nil {
		return nil, err
	}
	st, err := e.state()
	if err != nil {
		return nil, err
	}
	signers, err := e.signers(st, channel)
	if err != nil {
		return nil, err
	}
	delete(draft, "sig")
	for _, k := range signers {
		if err := feed.SignItem(draft, k); err != nil {
			return nil, err
		}
	}
	return e.mutate(func() error {
		_, err := e.pub.Publish(ctx, publisher.PublishParams{Channel: channel, Item: draft})
		return err
	})
}

// signers are the keys `pub item sign` runs with: the channel key in simple
// mode (--keyid <channel keyid>), the delegated author keys up to the
// threshold in authored mode.
func (e *editor) signers(st *tufrepo.State, channel string) ([]*keys.Key, error) {
	role := st.Delegation("channels." + channel)
	if role == nil {
		return nil, fmt.Errorf("unknown channel %q", channel)
	}
	authors := st.Delegation("channels." + channel + ".authors")
	if authors == nil {
		k, err := e.store.Get(ctx, role.KeyIDs[0])
		if err != nil {
			return nil, err
		}
		return []*keys.Key{k}, nil
	}
	need := max(1, authors.Threshold)
	var out []*keys.Key
	for _, keyid := range authors.KeyIDs {
		if k, err := e.store.Get(ctx, keyid); err == nil {
			out = append(out, k)
		}
		if len(out) == need {
			return out, nil
		}
	}
	return nil, &keys.ErrMissingKey{Role: "author", Hint: fmt.Sprintf("channel %q needs %d author signature(s), the loaded keys hold %d", channel, need, len(out))}
}

func (e *editor) unpublish(channel, id string) (*Change, error) {
	return e.mutate(func() error {
		_, err := e.pub.Unpublish(ctx, channel, id)
		return err
	})
}

func (e *editor) refreshTimestamp() (*Change, error) {
	return e.mutate(func() error {
		_, err := e.pub.RefreshTimestamp(ctx)
		return err
	})
}

func (e *editor) validate() (string, error) {
	res, err := e.pub.Validate(ctx)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("OK: %s — %d channel(s), targets v%d", res.Company, len(res.Channels), res.Version), nil
}

// versions reads the same numbers as notify.LocalVersions.
func (e *editor) versions(channel string) (*Versions, error) {
	var v Versions
	for _, f := range []struct {
		name string
		out  *int64
	}{
		{"timestamp.json", &v.Timestamp},
		{"snapshot.json", &v.Snapshot},
		{"targets.json", &v.Targets},
		{"channels." + channel + ".json", &v.Channel},
	} {
		raw, err := e.pub.Base.Read(ctx, f.name)
		if err != nil {
			return nil, err
		}
		var doc struct {
			Signed struct {
				Version int64 `json:"version"`
			} `json:"signed"`
		}
		if err := json.Unmarshal(raw, &doc); err != nil {
			return nil, fmt.Errorf("%s: %w", f.name, err)
		}
		if doc.Signed.Version <= 0 {
			return nil, fmt.Errorf("%s: no version", f.name)
		}
		*f.out = doc.Signed.Version
	}
	return &v, nil
}

func (e *editor) signWakeup(company, channel string, seq int64) (*notify.Request, error) {
	id, err := canonicalCompany(company)
	if err != nil {
		return nil, err
	}
	st, err := e.state()
	if err != nil {
		return nil, err
	}
	role := st.Delegation("channels." + channel)
	if role == nil {
		return nil, fmt.Errorf("unknown channel %q", channel)
	}
	key, err := e.store.Get(ctx, role.KeyIDs[0])
	if err != nil {
		return nil, err
	}
	if seq <= 0 {
		seq = time.Now().Unix()
	}
	return notify.SignChannel(id, channel, key, seq)
}

// canonicalCompany mirrors the CLI: the lowercase host of a join origin, or a
// bare company_id as-is.
func canonicalCompany(origin string) (string, error) {
	if !strings.Contains(origin, "://") {
		if origin == "" || strings.ContainsAny(origin, "/: ") {
			return "", fmt.Errorf("company: %q is not a company_id or URL", origin)
		}
		return strings.ToLower(origin), nil
	}
	u, err := url.Parse(origin)
	if err != nil || u.Hostname() == "" {
		return "", fmt.Errorf("company: %q is not a URL", origin)
	}
	return u.Hostname(), nil
}

// mutate runs op and returns the files it changed; a failed op leaves the
// files as they were.
func (e *editor) mutate(op func() error) (*Change, error) {
	before := maps.Clone(e.files)
	if err := op(); err != nil {
		clear(e.files)
		maps.Copy(e.files, before)
		return nil, err
	}
	change := &Change{Write: map[string][]byte{}, Remove: []string{}}
	for p, data := range e.files {
		if old, ok := before[p]; !ok || !bytes.Equal(old, data) {
			change.Write[p] = data
		}
	}
	for p := range before {
		if _, ok := e.files[p]; !ok {
			change.Remove = append(change.Remove, p)
		}
	}
	sort.Strings(change.Remove)
	return change, nil
}
