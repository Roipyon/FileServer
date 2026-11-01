// 通用工具 — 响应、格式化、路径安全
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

// ==================== MIME====================

var mimeTypes = map[string]string{
	".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8",
	".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
	".cjs": "text/javascript; charset=utf-8", ".ts": "text/javascript; charset=utf-8",
	".mts": "text/javascript; charset=utf-8", ".ctx": "text/javascript; charset=utf-8",
	".jsx": "text/javascript; charset=utf-8", ".tsx": "text/javascript; charset=utf-8",
	".py": "text/x-python; charset=utf-8", ".c": "text/x-c; charset=utf-8",
	".cpp": "text/x-c++src; charset=utf-8", ".h": "text/x-c; charset=utf-8",
	".java": "text/x-java; charset=utf-8", ".go": "text/x-go; charset=utf-8",
	".rs": "text/x-rust; charset=utf-8", ".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8", ".scss": "text/x-scss; charset=utf-8",
	".json": "application/json; charset=utf-8", ".xml": "application/xml; charset=utf-8",
	".yaml": "text/x-yaml; charset=utf-8", ".yml": "text/x-yaml; charset=utf-8",
	".toml": "text/plain; charset=utf-8", ".sh": "text/x-sh; charset=utf-8",
	".bat": "text/plain; charset=utf-8", ".ini": "text/plain; charset=utf-8",
	".cfg": "text/plain; charset=utf-8", ".log": "text/plain; charset=utf-8",
	".csv": "text/csv; charset=utf-8", ".vue": "text/html; charset=utf-8",
	".svg": "image/svg+xml", ".pdf": "application/pdf",
	".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
	".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
	".ico": "image/x-icon", ".mp4": "video/mp4", ".webm": "video/webm",
	".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".wav": "audio/wav",
	".flac": "audio/flac", ".aac": "audio/aac", ".m4a": "audio/mp4",
	".mov": "video/quicktime", ".mkv": "video/x-matroska",
	".avi": "video/x-msvideo", ".wmv": "video/x-ms-wmv",
	".doc": "application/msword",
	".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
	".xls": "application/vnd.ms-excel",
	".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
	".ppt": "application/vnd.ms-powerpoint",
	".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
	".zip": "application/zip", ".rar": "application/vnd.rar",
	".7z": "application/x-7z-compressed", ".tar": "application/x-tar",
	".gz": "application/gzip",
}

var textPreviewExts = map[string]bool{
	"txt": true, "md": true, "js": true, "ts": true, "jsx": true, "tsx": true,
	"py": true, "c": true, "cpp": true, "h": true, "java": true, "go": true,
	"rs": true, "html": true, "css": true, "scss": true, "json": true,
	"xml": true, "yaml": true, "yml": true, "toml": true, "sh": true,
	"bat": true, "ini": true, "cfg": true, "log": true, "vue": true,
	"csv": true, "rb": true, "php": true, "swift": true, "kt": true,
	"lua": true, "r": true, "sql": true, "env": true, "gitignore": true,
	"dockerfile": true, "cmake": true, "makefile": true, "gradle": true,
	"mjs": true, "cjs": true, "mts": true, "ctx": true,
}

var imageExts = map[string]bool{"jpg": true, "jpeg": true, "png": true, "gif": true, "webp": true, "bmp": true, "svg": true, "ico": true}
var videoExts = map[string]bool{"mp4": true, "webm": true, "mov": true, "avi": true, "mkv": true, "flv": true, "wmv": true}
var audioExts = map[string]bool{"mp3": true, "wav": true, "flac": true, "aac": true, "ogg": true, "wma": true, "m4a": true}
var archiveExts = map[string]bool{"zip": true, "rar": true, "7z": true, "tar": true, "gz": true, "bz2": true, "xz": true}

var inlineTypePrefixes = []string{"text/", "image/", "video/", "audio/", "application/pdf"}

func getExt(filename string) string {
	if i := strings.LastIndex(filename, "."); i >= 0 {
		return strings.ToLower(filename[i+1:])
	}
	return strings.ToLower(filename)
}

func getMimeType(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	if m, ok := mimeTypes[ext]; ok {
		return m
	}
	return "application/octet-stream"
}

func isInlineType(mime string) bool {
	for _, p := range inlineTypePrefixes {
		if strings.HasPrefix(mime, p) {
			return true
		}
	}
	return false
}

// ==================== 响应工具====================

func sendError(w http.ResponseWriter, code int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]any{"error": message})
}

func sendJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

// parseJSONBody — parseJsonBody（默认 10MB，merge-chunks 用 1MB 上限）
func parseJSONBody(r *http.Request, maxSize int64) (map[string]any, error) {
	body, err := io.ReadAll(io.LimitReader(r.Body, maxSize+1))
	if err != nil {
		return nil, fmt.Errorf("请求体过大")
	}
	if int64(len(body)) > maxSize {
		return nil, fmt.Errorf("请求体过大")
	}
	var m map[string]any
	if err := json.Unmarshal(body, &m); err != nil {
		return nil, fmt.Errorf("JSON 格式错误")
	}
	return m, nil
}

// formatFileSize — 逐行formatFileSize（parseFloat 会去掉尾随 0）
func formatFileSize(bytes int64) string {
	if bytes == 0 {
		return "0 B"
	}
	const k = 1024.0
	sizes := []string{"B", "KB", "MB", "GB"}
	i := 0
	b := float64(bytes)
	for b >= k && i < len(sizes)-1 {
		b /= k
		i++
	}
	// parseFloat((b).toFixed(2)) — 去掉尾随 0
	return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.2f", b), "0"), ".") + " " + sizes[i]
}

// decodeRoutePath — URL 解码，失败回退原始值
func decodeRoutePath(pathname, prefix string) string {
	raw := strings.Replace(pathname, prefix, "", 1)
	if s, err := url.PathUnescape(raw); err == nil {
		return s
	}
	return raw
}

// isPathSafe — 路径包含检查（filepath.Rel 严格防穿越，避免前缀匹配误判兄弟目录）
func isPathSafe(target, base string) bool {
	absBase, err := filepath.Abs(base)
	if err != nil {
		return false
	}
	absTarget, err := filepath.Abs(target)
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(absBase, absTarget)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}

// getUniquePath — getUniquePath：name(1).ext 递增去重
func getUniquePath(dir, fileName string) string {
	target := filepath.Join(dir, fileName)
	if _, err := os.Stat(target); os.IsNotExist(err) {
		return target
	}
	ext := filepath.Ext(fileName)
	baseName := strings.TrimSuffix(filepath.Base(fileName), ext)
	for i := 1; ; i++ {
		p := filepath.Join(dir, fmt.Sprintf("%s(%d)%s", baseName, i, ext))
		if _, err := os.Stat(p); os.IsNotExist(err) {
			return p
		}
	}
}

// isFileLocked — 重命名探测
func isFileLocked(filePath string) bool {
	if _, err := os.Stat(filePath); err != nil {
		return false
	}
	tmp := filePath + ".locktest"
	if err := os.Rename(filePath, tmp); err != nil {
		return isLockErrno(err)
	}
	os.Rename(tmp, filePath)
	return false
}

// isLockErrno — EPERM/EBUSY/EACCES 等价判定（Windows: 5/32/33）
func isLockErrno(err error) bool {
	if os.IsPermission(err) {
		return true
	}
	if errno, ok := err.(syscall.Errno); ok {
		return errno == 5 || errno == 32 || errno == 33
	}
	return false
}

func execCmdTimeout(d time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), d)
}

func jsonMarshal(v any) ([]byte, error) { return json.Marshal(v) }

func logDebug(msg string) { log.Println("[Debug] " + msg) }

// checkDiskSpace — 剩余 <500MB 拒绝上传
func checkDiskSpace() (ok bool, msg string) {
	free, _, err := diskUsage(sharedFolder)
	if err != nil {
		return true, ""
	}
	freeMB := free / (1024 * 1024)
	if freeMB < 500 {
		freeGB := float64(free) / (1024 * 1024 * 1024)
		return false, fmt.Sprintf("磁盘剩余空间不足 (%.2f GB)", freeGB)
	}
	return true, ""
}

// remoteIP — req.socket.remoteAddress
func remoteIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// zhTime — Date.toLocaleString('zh-CN')：2025/9/20 12:31:05
func zhTime(t time.Time) string {
	return t.Format("2006/1/2 15:04:05")
}
