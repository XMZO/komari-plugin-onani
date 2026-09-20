package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func fixture(t *testing.T, shift uint8) []byte {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, 900, 600))
	for y := 0; y < 600; y++ {
		for x := 0; x < 900; x++ {
			img.SetNRGBA(x, y, color.NRGBA{uint8(x) + shift, uint8(y), uint8((x + y) / 4), 255})
		}
	}
	var b bytes.Buffer
	encoder := png.Encoder{CompressionLevel: png.NoCompression}
	if err := encoder.Encode(&b, img); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestPreviewKeepsExactOriginal(t *testing.T) {
	root := t.TempDir()
	original := fixture(t, 0)
	now := time.Now()
	m, err := storeImage(root, original, true, 70, now)
	if err != nil {
		t.Fatal(err)
	}
	saved, err := os.ReadFile(filepath.Join(root, m.ID, "original"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(saved, original) {
		t.Fatal("original changed")
	}
	preview, err := os.ReadFile(filepath.Join(root, m.ID, "preview"))
	if err != nil {
		t.Fatal(err)
	}
	if !m.WebP || m.PreviewMime != "image/webp" || len(preview) >= len(original) {
		t.Fatalf("no savings: %+v", m)
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(preview))
	if err != nil {
		t.Fatal(err)
	}
	if format != "webp" || cfg.Width != 900 || cfg.Height != 600 {
		t.Fatalf("unexpected preview %s %+v", format, cfg)
	}
	second, err := storeImage(root, fixture(t, 75), true, 70, now)
	if err != nil {
		t.Fatal(err)
	}
	if second.ID == m.ID {
		t.Fatal("random images share identity")
	}
	saved, _ = os.ReadFile(filepath.Join(root, m.ID, "original"))
	if !bytes.Equal(saved, original) {
		t.Fatal("a new random image replaced an earlier download")
	}
	reused, err := storeImage(root, original, true, 70, now.Add(time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if reused.ID != m.ID || reused.ExpiresAt != m.ExpiresAt {
		t.Fatal("immutable entry changed")
	}
}

func TestProxyOnlyAndUnsupportedData(t *testing.T) {
	original := fixture(t, 0)
	root := t.TempDir()
	m, err := storeImage(root, original, false, 78, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	preview, _ := os.ReadFile(filepath.Join(root, m.ID, "preview"))
	if !bytes.Equal(original, preview) || m.WebP {
		t.Fatal("proxy-only mode modified bytes")
	}
	for _, raw := range [][]byte{[]byte("<html>blocked</html>"), nil, make([]byte, maxImageBytes+1)} {
		if _, err := storeImage(root, raw, true, 78, time.Now()); err == nil {
			t.Fatal("accepted invalid image")
		}
	}
}

func TestSourceAndRedirectBoundaries(t *testing.T) {
	for _, source := range []string{"http://t.alcy.cc/a", "https://user@t.alcy.cc/a", "https://127.0.0.1/a", "https://t.alcy.cc:444/a", "https://t.alcy.cc/a#x"} {
		if validateSource(source) == nil {
			t.Fatalf("accepted %s", source)
		}
	}
	for _, source := range []string{"https://random.example.test/a", "https://cdn.other.example.test/picture.webp", "https://t.alcy.cc:443/a"} {
		if err := validateSource(source); err != nil {
			t.Fatalf("rejected public HTTPS source %s: %v", source, err)
		}
	}
	client := imageClient()
	req, _ := http.NewRequest("GET", "https://127.0.0.1/private", nil)
	if client.CheckRedirect(req, nil) == nil {
		t.Fatal("accepted redirect to private host")
	}
	for _, address := range []string{"127.0.0.1", "::1", "10.1.2.3", "169.254.169.254", "100.64.0.1", "::ffff:192.168.1.1"} {
		if publicIP(netip.MustParseAddr(address)) {
			t.Fatalf("accepted non-public IP %s", address)
		}
	}
	if !publicIP(netip.MustParseAddr("1.1.1.1")) {
		t.Fatal("rejected public IP")
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestFetchRejectsErrorsAndHugeResponses(t *testing.T) {
	for _, status := range []int{403, 502} {
		c := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader("no")), Header: make(http.Header)}, nil
		})}
		if _, err := fetchImage(context.Background(), c, "https://t.alcy.cc/ycy/"); err == nil {
			t.Fatal("accepted HTTP error")
		}
	}
	c := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, ContentLength: maxImageBytes + 1, Body: io.NopCloser(strings.NewReader("no")), Header: make(http.Header)}, nil
	})}
	if _, err := fetchImage(context.Background(), c, "https://t.alcy.cc/ycy/"); err == nil {
		t.Fatal("accepted oversized response")
	}
}

func TestCacheExpiresAndEvictsOldest(t *testing.T) {
	root := t.TempDir()
	now := time.Now()
	for i := 0; i < 130; i++ {
		id := fmt.Sprintf("%064x", i)
		dir := filepath.Join(root, id)
		os.Mkdir(dir, 0700)
		m := metadata{ID: id, OriginalBytes: 1, PreviewBytes: 1, ExpiresAt: now.Add(time.Duration(i+1) * time.Second).UnixMilli()}
		raw, _ := json.Marshal(m)
		os.WriteFile(filepath.Join(dir, "meta.json"), raw, 0600)
	}
	if err := cleanCache(root, now); err != nil {
		t.Fatal(err)
	}
	entries, _ := os.ReadDir(root)
	if len(entries) != 128 {
		t.Fatalf("cache entries=%d", len(entries))
	}
	if _, err := os.Stat(filepath.Join(root, fmt.Sprintf("%064x", 0))); !os.IsNotExist(err) {
		t.Fatal("oldest retained")
	}
	if err := cleanCache(root, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	entries, _ = os.ReadDir(root)
	if len(entries) != 0 {
		t.Fatal("expired cache retained")
	}
}

func TestFetchFollowsDifferentPublicDomains(t *testing.T) {
	original := fixture(t, 3)
	seen := []string{}
	c := imageClient()
	c.Transport = roundTripFunc(func(r *http.Request) (*http.Response, error) {
		seen = append(seen, r.URL.Host)
		h := make(http.Header)
		switch r.URL.Host {
		case "random.example.test":
			h.Set("Location", "https://redirect.other.example.test/pick")
		case "redirect.other.example.test":
			h.Set("Location", "https://images.third.example.test/original.png")
		case "images.third.example.test":
			return &http.Response{StatusCode: 200, Header: h, Body: io.NopCloser(bytes.NewReader(original)), Request: r}, nil
		default:
			t.Fatalf("unexpected host %s", r.URL.Host)
		}
		return &http.Response{StatusCode: 302, Header: h, Body: io.NopCloser(strings.NewReader("")), Request: r}, nil
	})
	got, err := fetchImage(context.Background(), c, "https://random.example.test/pick")
	if err != nil {
		t.Fatal(err)
	}
	if len(seen) != 3 || !bytes.Equal(got, original) {
		t.Fatal("cross-domain redirect lost original image")
	}
}
