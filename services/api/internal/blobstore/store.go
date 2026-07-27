package blobstore

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Store persists uploaded media objects (local disk or S3-compatible).
type Store interface {
	Name() string
	Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error
	Open(ctx context.Context, key string) (rc io.ReadCloser, contentType string, size int64, err error)
	Delete(ctx context.Context, key string) error
}

// Config selects local vs S3-compatible object storage.
type Config struct {
	Endpoint  string // e.g. http://localhost:9000; empty => local only
	Bucket    string
	AccessKey string
	SecretKey string
	DataDir   string // local root (…/uploads lives under this)
	Secure    bool   // unused; derived from Endpoint scheme
}

// Open builds a Store. Prefers S3 when Endpoint is set and reachable; otherwise local disk.
func Open(ctx context.Context, cfg Config) Store {
	local := NewLocal(cfg.DataDir)
	endpoint := strings.TrimSpace(cfg.Endpoint)
	if endpoint == "" {
		log.Printf("blobstore: using local disk (%s)", local.root)
		return local
	}
	s3, err := NewS3(ctx, cfg)
	if err != nil {
		log.Printf("blobstore: object storage unavailable (%v); using local disk", err)
		return local
	}
	log.Printf("blobstore: using object storage bucket=%s endpoint=%s", cfg.Bucket, endpoint)
	return s3
}

// Local stores objects under DataDir/uploads.
type Local struct {
	root string
}

func NewLocal(dataDir string) *Local {
	if dataDir == "" {
		dataDir = "data"
	}
	return &Local{root: filepath.Join(dataDir, "uploads")}
}

func (l *Local) Name() string { return "local" }

func (l *Local) path(key string) (string, error) {
	key = strings.TrimPrefix(filepath.ToSlash(key), "/")
	if key == "" || strings.Contains(key, "..") {
		return "", fmt.Errorf("invalid key")
	}
	return filepath.Join(l.root, filepath.FromSlash(key)), nil
}

func (l *Local) Put(_ context.Context, key string, r io.Reader, _ int64, _ string) error {
	full, err := l.path(key)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(full), 0o755); err != nil {
		return err
	}
	out, err := os.Create(full)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, r)
	closeErr := out.Close()
	if copyErr != nil {
		_ = os.Remove(full)
		return copyErr
	}
	if closeErr != nil {
		_ = os.Remove(full)
		return closeErr
	}
	return nil
}

func (l *Local) Open(_ context.Context, key string) (io.ReadCloser, string, int64, error) {
	full, err := l.path(key)
	if err != nil {
		return nil, "", 0, err
	}
	f, err := os.Open(full)
	if err != nil {
		return nil, "", 0, err
	}
	st, err := f.Stat()
	if err != nil {
		_ = f.Close()
		return nil, "", 0, err
	}
	return f, "", st.Size(), nil
}

func (l *Local) Delete(_ context.Context, key string) error {
	full, err := l.path(key)
	if err != nil {
		return err
	}
	return os.Remove(full)
}

// S3 is a minimal path-style S3/MinIO client (Put/Get/Delete + ensure bucket).
type S3 struct {
	baseURL   string
	bucket    string
	accessKey string
	secretKey string
	region    string
	client    *http.Client
}

func NewS3(ctx context.Context, cfg Config) (*S3, error) {
	endpoint := strings.TrimSpace(cfg.Endpoint)
	u, err := url.Parse(endpoint)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return nil, fmt.Errorf("invalid object storage endpoint %q", endpoint)
	}
	access := cfg.AccessKey
	secret := cfg.SecretKey
	if access == "" {
		access = "qchatminio"
	}
	if secret == "" {
		secret = "qchatminio123"
	}
	bucket := cfg.Bucket
	if bucket == "" {
		bucket = "qchat"
	}
	s := &S3{
		baseURL:   strings.TrimRight(u.String(), "/"),
		bucket:    bucket,
		accessKey: access,
		secretKey: secret,
		region:    "us-east-1",
		client:    &http.Client{Timeout: 60 * time.Second},
	}
	if err := s.ensureBucket(ctx); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *S3) Name() string { return "s3" }

func normalizeKey(key string) (string, error) {
	key = strings.TrimPrefix(filepath.ToSlash(key), "/")
	if key == "" || strings.Contains(key, "..") {
		return "", fmt.Errorf("invalid key")
	}
	return key, nil
}

func (s *S3) objectURL(key string) string {
	return s.baseURL + "/" + s.bucket + "/" + path.Clean("/" + key)[1:]
}

func (s *S3) bucketURL() string {
	return s.baseURL + "/" + s.bucket
}

func (s *S3) ensureBucket(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodHead, s.bucketURL(), nil)
	if err != nil {
		return err
	}
	if err := s.sign(req, nil); err != nil {
		return err
	}
	res, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusOK || res.StatusCode == http.StatusForbidden {
		// 403 often means bucket exists but Head is restricted; Put will still work.
		return nil
	}
	if res.StatusCode != http.StatusNotFound {
		b, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return fmt.Errorf("head bucket: %s %s", res.Status, string(b))
	}
	put, err := http.NewRequestWithContext(ctx, http.MethodPut, s.bucketURL(), nil)
	if err != nil {
		return err
	}
	if err := s.sign(put, nil); err != nil {
		return err
	}
	pres, err := s.client.Do(put)
	if err != nil {
		return err
	}
	defer pres.Body.Close()
	if pres.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(pres.Body, 512))
		return fmt.Errorf("create bucket: %s %s", pres.Status, string(b))
	}
	return nil
}

func (s *S3) Put(ctx context.Context, key string, r io.Reader, size int64, contentType string) error {
	key, err := normalizeKey(key)
	if err != nil {
		return err
	}
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, s.objectURL(key), r)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", contentType)
	if size >= 0 {
		req.ContentLength = size
	}
	bodyHash := "UNSIGNED-PAYLOAD"
	if err := s.signWithPayloadHash(req, bodyHash); err != nil {
		return err
	}
	res, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		b, _ := io.ReadAll(io.LimitReader(res.Body, 1024))
		return fmt.Errorf("put object: %s %s", res.Status, string(b))
	}
	return nil
}

func (s *S3) Open(ctx context.Context, key string) (io.ReadCloser, string, int64, error) {
	key, err := normalizeKey(key)
	if err != nil {
		return nil, "", 0, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, s.objectURL(key), nil)
	if err != nil {
		return nil, "", 0, err
	}
	if err := s.sign(req, nil); err != nil {
		return nil, "", 0, err
	}
	res, err := s.client.Do(req)
	if err != nil {
		return nil, "", 0, err
	}
	if res.StatusCode >= 300 {
		defer res.Body.Close()
		b, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return nil, "", 0, fmt.Errorf("get object: %s %s", res.Status, string(b))
	}
	return res.Body, res.Header.Get("Content-Type"), res.ContentLength, nil
}

func (s *S3) Delete(ctx context.Context, key string) error {
	key, err := normalizeKey(key)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, s.objectURL(key), nil)
	if err != nil {
		return err
	}
	if err := s.sign(req, nil); err != nil {
		return err
	}
	res, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 && res.StatusCode != http.StatusNotFound {
		b, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return fmt.Errorf("delete object: %s %s", res.Status, string(b))
	}
	return nil
}

func (s *S3) sign(req *http.Request, payload []byte) error {
	hash := sha256.Sum256(payload)
	return s.signWithPayloadHash(req, hex.EncodeToString(hash[:]))
}

func (s *S3) signWithPayloadHash(req *http.Request, payloadHash string) error {
	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	dateStamp := now.Format("20060102")
	req.Header.Set("X-Amz-Date", amzDate)
	req.Header.Set("X-Amz-Content-Sha256", payloadHash)
	if req.Header.Get("Host") == "" {
		req.Header.Set("Host", req.URL.Host)
	}

	signedHeaders, canonicalHeaders := canonicalHeaderBlock(req)
	canonicalRequest := strings.Join([]string{
		req.Method,
		req.URL.EscapedPath(),
		req.URL.RawQuery,
		canonicalHeaders,
		signedHeaders,
		payloadHash,
	}, "\n")

	creqHash := sha256.Sum256([]byte(canonicalRequest))
	credentialScope := dateStamp + "/" + s.region + "/s3/aws4_request"
	stringToSign := strings.Join([]string{
		"AWS4-HMAC-SHA256",
		amzDate,
		credentialScope,
		hex.EncodeToString(creqHash[:]),
	}, "\n")

	signingKey := aws4SigningKey(s.secretKey, dateStamp, s.region, "s3")
	sig := hex.EncodeToString(hmacSHA256(signingKey, stringToSign))
	auth := fmt.Sprintf(
		"AWS4-HMAC-SHA256 Credential=%s/%s, SignedHeaders=%s, Signature=%s",
		s.accessKey, credentialScope, signedHeaders, sig,
	)
	req.Header.Set("Authorization", auth)
	return nil
}

func canonicalHeaderBlock(req *http.Request) (signedHeaders, canonicalHeaders string) {
	type kv struct{ k, v string }
	var items []kv
	for k, vals := range req.Header {
		lk := strings.ToLower(k)
		items = append(items, kv{lk, strings.Join(vals, ",")})
	}
	if req.Host != "" {
		found := false
		for _, it := range items {
			if it.k == "host" {
				found = true
				break
			}
		}
		if !found {
			items = append(items, kv{"host", req.Host})
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].k < items[j].k })
	var names []string
	var b strings.Builder
	for _, it := range items {
		names = append(names, it.k)
		b.WriteString(it.k)
		b.WriteByte(':')
		b.WriteString(strings.TrimSpace(it.v))
		b.WriteByte('\n')
	}
	return strings.Join(names, ";"), b.String()
}

func hmacSHA256(key []byte, data string) []byte {
	m := hmac.New(sha256.New, key)
	_, _ = m.Write([]byte(data))
	return m.Sum(nil)
}

func aws4SigningKey(secret, dateStamp, region, service string) []byte {
	kDate := hmacSHA256([]byte("AWS4"+secret), dateStamp)
	kRegion := hmacSHA256(kDate, region)
	kService := hmacSHA256(kRegion, service)
	return hmacSHA256(kService, "aws4_request")
}
