// onani-background runs one bounded image job. It has no listener or shell commands.
package main

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/gen2brain/webp"
)

const (
	maxImageBytes   = 16 << 20
	maxPixels       = 24_000_000
	maxCacheBytes   = 256 << 20
	maxCacheEntries = 128
	cacheLifetime   = 24 * time.Hour
)

type metadata struct {
	ID            string `json:"id"`
	OriginalMime  string `json:"originalMime"`
	PreviewMime   string `json:"previewMime"`
	Extension     string `json:"extension"`
	OriginalBytes int    `json:"originalBytes"`
	PreviewBytes  int    `json:"previewBytes"`
	ExpiresAt     int64  `json:"expiresAt"`
	WebP          bool   `json:"webp"`
}

func main() {
	root := flag.String("cache", "", "plugin background cache directory")
	source := flag.String("source", "https://t.alcy.cc/ycy/", "allowed image source")
	preview := flag.Bool("webp", false, "generate a smaller WebP preview")
	quality := flag.Int("quality", 78, "WebP quality (40-90)")
	flag.Parse()
	if *root == "" || *quality < 40 || *quality > 90 {
		fail(errors.New("invalid image job options"))
	}
	if err := os.MkdirAll(*root, 0700); err != nil {
		fail(err)
	}
	if err := cleanCache(*root, time.Now()); err != nil {
		fail(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	data, err := fetchImage(ctx, imageClient(), *source)
	if err != nil {
		fail(err)
	}
	m, err := storeImage(*root, data, *preview, *quality, time.Now())
	if err != nil {
		fail(err)
	}
	if err := cleanCache(*root, time.Now()); err != nil {
		fail(err)
	}
	if err := json.NewEncoder(os.Stdout).Encode(m); err != nil {
		fail(err)
	}
}

func fail(err error) { fmt.Fprintln(os.Stderr, err); os.Exit(1) }

// Source is administrator-configured, never taken from a visitor's query string.
// Redirects may change domains; every destination must still be public HTTPS.
func validateSource(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return errors.New("invalid image source URL")
	}
	if u.Scheme != "https" || u.Hostname() == "" || u.User != nil || (u.Port() != "" && u.Port() != "443") || u.Fragment != "" || strings.ContainsAny(raw, "\\\r\n\t ") {
		return errors.New("image sources must use public HTTPS without credentials or a nonstandard port")
	}
	if ip, err := netip.ParseAddr(u.Hostname()); err == nil && !publicIP(ip) {
		return errors.New("image source points to a non-public address")
	}
	return nil
}

func publicIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	if ip.Is6() && !netip.MustParsePrefix("2000::/3").Contains(ip) {
		return false
	}
	for _, block := range []string{"0.0.0.0/8", "100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "240.0.0.0/4", "2001:db8::/32"} {
		if netip.MustParsePrefix(block).Contains(ip) {
			return false
		}
	}
	return true
}

func imageClient() *http.Client {
	dialer := &net.Dialer{Timeout: 5 * time.Second}
	transport := &http.Transport{
		TLSHandshakeTimeout:   5 * time.Second,
		ResponseHeaderTimeout: 8 * time.Second,
		DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
			host, port, err := net.SplitHostPort(address)
			if err != nil {
				return nil, err
			}
			ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
			if err != nil {
				return nil, err
			}
			if len(ips) == 0 {
				return nil, errors.New("image source DNS returned no addresses")
			}
			for _, ip := range ips {
				if !publicIP(ip) {
					return nil, errors.New("image source resolved to a non-public address")
				}
			}
			var last error
			for _, ip := range ips {
				conn, err := dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
				if err == nil {
					return conn, nil
				}
				last = err
			}
			return nil, last
		},
	}
	return &http.Client{Transport: transport, Timeout: 15 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 {
			return errors.New("too many image redirects")
		}
		return validateSource(req.URL.String())
	}}
}

func fetchImage(ctx context.Context, client *http.Client, source string) ([]byte, error) {
	if err := validateSource(source); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, source, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "image/webp,image/png,image/jpeg,image/gif")
	req.Header.Set("User-Agent", "Onani-Background/1.0")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("image source returned HTTP %d", resp.StatusCode)
	}
	if resp.ContentLength > maxImageBytes {
		return nil, errors.New("image exceeds 16 MiB limit")
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxImageBytes+1))
	if err != nil {
		return nil, err
	}
	if len(data) == 0 || len(data) > maxImageBytes {
		return nil, errors.New("empty or oversized image")
	}
	return data, nil
}

func storeImage(root string, original []byte, useWebP bool, quality int, now time.Time) (metadata, error) {
	var m metadata
	if len(original) == 0 || len(original) > maxImageBytes {
		return m, errors.New("empty or oversized image")
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(original))
	if err != nil {
		return m, fmt.Errorf("unsupported image: %w", err)
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || int64(cfg.Width)*int64(cfg.Height) > maxPixels {
		return m, errors.New("image exceeds 24 megapixel limit")
	}
	ext := map[string]string{"jpeg": "jpg", "png": "png", "gif": "gif", "webp": "webp"}[format]
	if ext == "" {
		return m, errors.New("unsupported image format")
	}
	digest := sha256.New()
	digest.Write(original)
	fmt.Fprintf(digest, "\x00webp=%t;quality=%d;original-dimensions;v=2", useWebP, quality)
	m = metadata{ID: hex.EncodeToString(digest.Sum(nil)), OriginalMime: "image/" + format, PreviewMime: "image/" + format,
		Extension: ext, OriginalBytes: len(original), ExpiresAt: now.Add(cacheLifetime).UnixMilli()}
	// Repeated source images reuse the prepared bytes before expensive decoding/encoding.
	dest := filepath.Join(root, m.ID)
	if existing, err := os.ReadFile(filepath.Join(dest, "meta.json")); err == nil {
		var previous metadata
		if json.Unmarshal(existing, &previous) == nil && previous.ExpiresAt > now.UnixMilli() {
			_, originalErr := os.Stat(filepath.Join(dest, "original"))
			_, previewErr := os.Stat(filepath.Join(dest, "preview"))
			if originalErr == nil && previewErr == nil {
				return previous, nil
			}
		}
	}
	preview := original
	// Preserve GIF animation; JPEG EXIF orientation remains correct by avoiding conversion when present.
	// A failed or larger conversion never damages the original or increases visitor traffic.
	if useWebP && format != "gif" && !(format == "jpeg" && bytes.Contains(original, []byte("Exif\x00\x00"))) &&
		!(format == "png" && bytes.Contains(original, []byte("acTL"))) &&
		!(format == "webp" && (bytes.Contains(original, []byte("ANIM")) || bytes.Contains(original, []byte("EXIF")))) {
		if converted, err := makePreview(original, quality); err == nil && len(converted) < len(original) {
			preview = converted
			m.PreviewMime = "image/webp"
			m.WebP = true
		}
	}
	m.PreviewBytes = len(preview)
	// Each job runs in its own temporary directory. An interrupted process leaves no published partial image.
	tmp, err := os.MkdirTemp(root, ".pending-")
	if err != nil {
		return m, err
	}
	defer os.RemoveAll(tmp)
	for name, data := range map[string][]byte{"original": original, "preview": preview} {
		if err := os.WriteFile(filepath.Join(tmp, name), data, 0600); err != nil {
			return m, err
		}
	}
	encoded, err := json.Marshal(m)
	if err != nil {
		return m, err
	}
	if err := os.WriteFile(filepath.Join(tmp, "meta.json"), encoded, 0600); err != nil {
		return m, err
	}
	// Reuse identical immutable entries. Retain their original expiration time.
	if existing, err := os.ReadFile(filepath.Join(dest, "meta.json")); err == nil {
		var previous metadata
		if json.Unmarshal(existing, &previous) == nil && previous.ExpiresAt > now.UnixMilli() {
			return previous, nil
		}
	}
	if err := os.Rename(tmp, dest); err != nil {
		return m, err
	}
	return m, nil
}

func makePreview(data []byte, quality int) ([]byte, error) {
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	var output bytes.Buffer
	err = webp.Encode(&output, img, webp.Options{Quality: quality, Method: 3})
	return output.Bytes(), err
}

func cleanCache(root string, now time.Time) error {
	entries, err := os.ReadDir(root)
	if err != nil {
		return err
	}
	type item struct {
		path    string
		size    int64
		expires int64
	}
	var kept []item
	var total int64
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		p := filepath.Join(root, name)
		if strings.HasPrefix(name, ".pending-") {
			info, err := entry.Info()
			if err == nil && now.Sub(info.ModTime()) > time.Minute {
				if err := os.RemoveAll(p); err != nil {
					return err
				}
			}
			continue
		}
		if len(name) != 64 {
			continue
		}
		if _, err := hex.DecodeString(name); err != nil {
			continue
		}
		var m metadata
		raw, err := os.ReadFile(filepath.Join(p, "meta.json"))
		if err != nil || json.Unmarshal(raw, &m) != nil || m.ExpiresAt <= now.UnixMilli() {
			if err := os.RemoveAll(p); err != nil {
				return err
			}
			continue
		}
		size := int64(m.OriginalBytes) + int64(m.PreviewBytes)
		kept = append(kept, item{p, size, m.ExpiresAt})
		total += size
	}
	sort.Slice(kept, func(i, j int) bool { return kept[i].expires < kept[j].expires })
	for len(kept) > maxCacheEntries || total > maxCacheBytes {
		if err := os.RemoveAll(kept[0].path); err != nil {
			return err
		}
		total -= kept[0].size
		kept = kept[1:]
	}
	return nil
}
