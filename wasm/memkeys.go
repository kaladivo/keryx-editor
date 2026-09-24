package main

import (
	"context"
	"encoding/hex"
	"fmt"
	"sort"

	"github.com/v1b3coder/keryx/sdk/keys"
)

// keyFile is one pasted `pub` keystore file.
type keyFile struct {
	Name    string    `json:"name"`
	Role    keys.Role `json:"role"`
	SeedHex string    `json:"seed_hex"`
}

// memStore is a keys.Store over pasted key files with DirStore's resolution
// semantics: Get is by keyid only, Find needs a unique role (+name) match.
type memStore struct{ keys []*keys.Key }

func newMemStore(files []keyFile) (*memStore, error) {
	s := &memStore{}
	for _, kf := range files {
		if kf.SeedHex == "" {
			return nil, fmt.Errorf("key %q: seed_hex missing (encrypted key files are not supported)", kf.Name)
		}
		seed, err := hex.DecodeString(kf.SeedHex)
		if err != nil {
			return nil, fmt.Errorf("key %q: seed: %w", kf.Name, err)
		}
		k, err := keys.FromSeed(kf.Role, kf.Name, seed)
		if err != nil {
			return nil, err
		}
		s.keys = append(s.keys, k)
	}
	s.sort()
	return s, nil
}

func (s *memStore) sort() {
	sort.Slice(s.keys, func(i, j int) bool { return s.keys[i].KeyID() < s.keys[j].KeyID() })
}

func (s *memStore) List(context.Context) ([]keys.Info, error) {
	out := make([]keys.Info, 0, len(s.keys))
	for _, k := range s.keys {
		out = append(out, keys.Info{Name: k.Name, Role: k.Role, KeyID: k.KeyID()})
	}
	return out, nil
}

func (s *memStore) Get(_ context.Context, keyid string) (*keys.Key, error) {
	for _, k := range s.keys {
		if k.KeyID() == keyid {
			return k, nil
		}
	}
	return nil, &keys.ErrMissingKey{Role: "any", KeyID: keyid, Hint: fmt.Sprintf("key %q not in the loaded keys", keyid)}
}

func (s *memStore) Find(_ context.Context, role keys.Role, name string) (*keys.Key, error) {
	var matches []*keys.Key
	for _, k := range s.keys {
		if k.Role != "" && k.Role != role {
			continue
		}
		if name != "" && k.Name != name {
			continue
		}
		matches = append(matches, k)
	}
	switch len(matches) {
	case 0:
		hint := fmt.Sprintf("%s key", role)
		if name != "" {
			hint = fmt.Sprintf("%s key %q", role, name)
		}
		return nil, &keys.ErrMissingKey{Role: string(role), Hint: hint + " — load its key file"}
	case 1:
		return matches[0], nil
	default:
		keyids := make([]string, 0, len(matches))
		for _, k := range matches {
			keyids = append(keyids, k.KeyID())
		}
		return nil, &keys.ErrAmbiguousKey{Role: string(role), Name: name, Candidates: keyids}
	}
}

func (s *memStore) FindAll(_ context.Context, role keys.Role) ([]*keys.Key, error) {
	var out []*keys.Key
	for _, k := range s.keys {
		if k.Role == role {
			out = append(out, k)
		}
	}
	return out, nil
}

func (s *memStore) Add(_ context.Context, k *keys.Key) error {
	s.keys = append(s.keys, k)
	s.sort()
	return nil
}

func (s *memStore) Remove(ctx context.Context, keyid string) error {
	k, err := s.Get(ctx, keyid)
	if err != nil {
		return err
	}
	for i := range s.keys {
		if s.keys[i] == k {
			s.keys = append(s.keys[:i], s.keys[i+1:]...)
			return nil
		}
	}
	return nil
}
