package main

import (
	"context"
	"io/fs"
	"path"
	"sort"
	"strings"
)

// memRepo is a repo.Repo over the git repo's path→bytes map, rooted at dir
// (the CLI's --repo / --anchor directory).
type memRepo struct {
	files map[string][]byte
	dir   string
}

func (r *memRepo) abs(p string) string { return path.Join(r.dir, p) }

func (r *memRepo) rel(abs string) string {
	if r.dir == "" {
		return abs
	}
	return strings.TrimPrefix(abs, r.dir+"/")
}

func (r *memRepo) Read(_ context.Context, p string) ([]byte, error) {
	data, ok := r.files[r.abs(p)]
	if !ok {
		return nil, &fs.PathError{Op: "open", Path: r.abs(p), Err: fs.ErrNotExist}
	}
	return data, nil
}

func (r *memRepo) Write(_ context.Context, p string, data []byte) error {
	r.files[r.abs(p)] = data
	return nil
}

func (r *memRepo) List(_ context.Context, prefix string) ([]string, error) {
	root := r.abs(prefix)
	var out []string
	for p := range r.files {
		if p == root || strings.HasPrefix(p, root+"/") {
			out = append(out, r.rel(p))
		}
	}
	sort.Strings(out)
	return out, nil
}

func (r *memRepo) Remove(_ context.Context, p string) error {
	delete(r.files, r.abs(p))
	return nil
}
