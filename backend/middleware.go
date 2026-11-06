// 中间件 — 请求频率限制、文件列表内存缓存
package main

import (
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"
)

var rateMap sync.Map // key: "ip:type" -> []int64 (timestamps)

var typeLimits = map[string]int{
	"upload":    2000,
	"download":  2000,
	"list":      300,
	"thumbnail": 500,
	"share":     120,
	"update":    60,
	"other":     300,
}

func getRateLimitType(url string) string {
	switch {
	case strings.HasPrefix(url, "/api/upload"), strings.HasPrefix(url, "/api/merge-chunks"),
		strings.HasPrefix(url, "/api/upload-with-token"), strings.HasPrefix(url, "/api/upload-token"):
		return "upload"
	case strings.HasPrefix(url, "/download/"), strings.HasPrefix(url, "/api/zip-download/"):
		return "download"
	case strings.HasPrefix(url, "/api/files"), strings.HasPrefix(url, "/api/server-info"):
		return "list"
	case strings.HasPrefix(url, "/api/thumbnail/"):
		return "thumbnail"
	case strings.HasPrefix(url, "/api/share/"):
		return "share"
	case strings.HasPrefix(url, "/api/update"):
		return "update"
	}
	return "other"
}

func rateLimitMiddleware(r *http.Request) (ok bool) {
	cfg := getConfig()
	if cfg.RateLimit <= 0 {
		return true
	}

	ip := remoteIP(r)
	typ := getRateLimitType(r.URL.Path)
	limit := typeLimits[typ]
	if limit == 0 {
		limit = cfg.RateLimit
	}
	key := ip + ":" + typ
	now := time.Now().UnixMilli()
	windowStart := now - cfg.RateLimitWindow

	v, _ := rateMap.LoadOrStore(key, &[]int64{})
	entries := v.(*[]int64)
	filtered := (*entries)[:0]
	for _, t := range *entries {
		if t > windowStart {
			filtered = append(filtered, t)
		}
	}
	filtered = append(filtered, now)
	*entries = filtered

	if len(filtered) > limit {
		return false
	}
	return true
}

func rateLimitJanitor() {
	for range time.Tick(30 * time.Second) {
		windowStart := time.Now().UnixMilli() - 60000
		rateMap.Range(func(key, v any) bool {
			entries := v.(*[]int64)
			filtered := (*entries)[:0]
			for _, t := range *entries {
				if t > windowStart {
					filtered = append(filtered, t)
				}
			}
			if len(filtered) == 0 {
				rateMap.Delete(key)
			} else {
				*entries = filtered
			}
			return true
		})
	}
}

// ==================== 文件列表缓存 ====================

var fileListCache struct {
	mu        sync.Mutex
	data      []map[string]any
	timestamp int64
}

func invalidateFileCache() {
	fileListCache.mu.Lock()
	fileListCache.data = nil
	fileListCache.timestamp = 0
	fileListCache.mu.Unlock()
}

func getCachedFileList() []map[string]any {
	fileListCache.mu.Lock()
	defer fileListCache.mu.Unlock()
	cfg := getConfig()
	if fileListCache.data != nil && time.Now().UnixMilli()-fileListCache.timestamp < int64(cfg.CacheTTL)*1000 {
		return fileListCache.data
	}
	return nil
}

func setFileListCache(data []map[string]any) {
	fileListCache.mu.Lock()
	fileListCache.data = data
	fileListCache.timestamp = time.Now().UnixMilli()
	fileListCache.mu.Unlock()
}

func write429(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(429)
	json.NewEncoder(w).Encode(map[string]string{"error": "请求过于频繁，请稍后重试"})
}
