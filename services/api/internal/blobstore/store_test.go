package blobstore

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestLocalPutOpenDelete(t *testing.T) {
	dir := t.TempDir()
	store := NewLocal(dir)
	ctx := context.Background()
  key := "acme/u1/file/hello.txt"
	body := []byte("hello qchat")
	if err := store.Put(ctx, key, bytes.NewReader(body), int64(len(body)), "text/plain"); err != nil {
		t.Fatal(err)
	}
	full := filepath.Join(dir, "uploads", filepath.FromSlash(key))
	if _, err := os.Stat(full); err != nil {
		t.Fatal(err)
	}
	rc, _, size, err := store.Open(ctx, key)
	if err != nil {
		t.Fatal(err)
	}
	defer rc.Close()
	got, _ := io.ReadAll(rc)
	if string(got) != string(body) || size != int64(len(body)) {
		t.Fatalf("got %q size=%d", got, size)
	}
	if err := store.Delete(ctx, key); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(full); !os.IsNotExist(err) {
		t.Fatalf("expected deleted, err=%v", err)
	}
}

func TestLocalRejectsTraversal(t *testing.T) {
	store := NewLocal(t.TempDir())
	err := store.Put(context.Background(), "../escape.txt", bytes.NewReader([]byte("x")), 1, "text/plain")
	if err == nil {
		t.Fatal("expected invalid key")
	}
}
