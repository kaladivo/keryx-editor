//go:build js && wasm

package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"syscall/js"

	"github.com/v1b3coder/keryx/sdk/feed"
)

var (
	ed     *editor
	global = js.Global()
)

func main() {
	api := global.Get("Object").New()
	api.Set("load", export(load))
	api.Set("company", loaded(func(e *editor, _ []js.Value) (js.Value, error) { return toJS(e.company()) }))
	api.Set("publish", loaded(publish))
	api.Set("unpublish", loaded(func(e *editor, a []js.Value) (js.Value, error) {
		return changeToJS(e.unpublish(a[0].String(), a[1].String()))
	}))
	api.Set("refreshTimestamp", loaded(func(e *editor, _ []js.Value) (js.Value, error) { return changeToJS(e.refreshTimestamp()) }))
	api.Set("validate", loaded(func(e *editor, _ []js.Value) (js.Value, error) {
		s, err := e.validate()
		return js.ValueOf(s), err
	}))
	api.Set("versions", loaded(func(e *editor, a []js.Value) (js.Value, error) { return toJS(e.versions(a[0].String())) }))
	api.Set("signWakeup", loaded(func(e *editor, a []js.Value) (js.Value, error) {
		return toJS(e.signWakeup(a[0].String(), a[1].String(), int64(a[2].Float())))
	}))
	global.Set("keryx", api)
	select {}
}

var errNotLoaded = errors.New("no repo loaded: call load() first")

// export wraps an operation as a JS function returning {value} or {error};
// panics become errors so the Go runtime never dies.
func export(fn func(args []js.Value) (js.Value, error)) js.Func {
	return js.FuncOf(func(_ js.Value, args []js.Value) (result any) {
		defer func() {
			if r := recover(); r != nil {
				result = envelope(js.Undefined(), fmt.Errorf("%v", r))
			}
		}()
		for len(args) < maxArity {
			args = append(args, js.Undefined())
		}
		return envelope(fn(args))
	})
}

const maxArity = 3

func loaded(fn func(e *editor, args []js.Value) (js.Value, error)) js.Func {
	return export(func(args []js.Value) (js.Value, error) {
		if ed == nil {
			return js.Undefined(), errNotLoaded
		}
		return fn(ed, args)
	})
}

func envelope(v js.Value, err error) js.Value {
	out := global.Get("Object").New()
	if err != nil {
		out.Set("error", err.Error())
	} else {
		out.Set("value", v)
	}
	return out
}

func load(args []js.Value) (js.Value, error) {
	opts := args[0]
	files := map[string][]byte{}
	jsFiles := opts.Get("files")
	names := global.Get("Object").Call("keys", jsFiles)
	for i := 0; i < names.Length(); i++ {
		name := names.Index(i).String()
		v := jsFiles.Get(name)
		data := make([]byte, v.Get("byteLength").Int())
		js.CopyBytesToGo(data, v)
		files[name] = data
	}
	var kfs []keyFile
	if err := json.Unmarshal([]byte(stringify(opts.Get("keys"))), &kfs); err != nil {
		return js.Undefined(), fmt.Errorf("keys: %w", err)
	}
	e, err := newEditor(files, opts.Get("repoDir").String(), opts.Get("anchorDir").String(), kfs)
	if err != nil {
		return js.Undefined(), err
	}
	ed = e
	return toJS(e.company())
}

func publish(e *editor, args []js.Value) (js.Value, error) {
	draft, err := feed.Decode([]byte(stringify(args[1])))
	if err != nil {
		return js.Undefined(), fmt.Errorf("draft: %w", err)
	}
	return changeToJS(e.publish(args[0].String(), draft))
}

func stringify(v js.Value) string { return global.Get("JSON").Call("stringify", v).String() }

// toJS converts a Go value through JSON so nested structs and maps become
// plain JS objects.
func toJS(v any, err error) (js.Value, error) {
	if err != nil {
		return js.Undefined(), err
	}
	data, err := json.Marshal(v)
	if err != nil {
		return js.Undefined(), err
	}
	return global.Get("JSON").Call("parse", string(data)), nil
}

func changeToJS(c *Change, err error) (js.Value, error) {
	if err != nil {
		return js.Undefined(), err
	}
	write := global.Get("Object").New()
	for p, data := range c.Write {
		arr := global.Get("Uint8Array").New(len(data))
		js.CopyBytesToJS(arr, data)
		write.Set(p, arr)
	}
	remove := global.Get("Array").New(len(c.Remove))
	for i, p := range c.Remove {
		remove.SetIndex(i, p)
	}
	out := global.Get("Object").New()
	out.Set("write", write)
	out.Set("remove", remove)
	return out, nil
}
