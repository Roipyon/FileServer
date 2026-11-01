// 缩略图 / 摘要生成
package main

import (
	"archive/tar"
	"archive/zip"
	"compress/bzip2"
	"compress/gzip"
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf16"

	"github.com/bodgit/sevenzip"
	"github.com/dhowden/tag"
	"github.com/klauspost/compress/zstd"
	"github.com/ulikunitz/xz"
)

const libarchiveMaxSize = 2 * 1024 * 1024 * 1024 // 2GiB 守卫

// getArchiveType — 识别压缩包具体类型
func getArchiveType(filename string) string {
	lower := strings.ToLower(filename)
	switch {
	case strings.HasSuffix(lower, ".tar.gz") || strings.HasSuffix(lower, ".tgz"):
		return "targz"
	case strings.HasSuffix(lower, ".tar.bz2") || strings.HasSuffix(lower, ".tbz2") || strings.HasSuffix(lower, ".tbz"):
		return "tarbz2"
	case strings.HasSuffix(lower, ".tar.xz") || strings.HasSuffix(lower, ".txz"):
		return "tarxz"
	case strings.HasSuffix(lower, ".tar.zst") || strings.HasSuffix(lower, ".tzst"):
		return "tarzst"
	case strings.HasSuffix(lower, ".tar"):
		return "tar"
	case strings.HasSuffix(lower, ".rar"):
		return "rar"
	case strings.HasSuffix(lower, ".7z"):
		return "7z"
	case strings.HasSuffix(lower, ".zip"):
		return "zip"
	}
	return ""
}

func isArchiveFile(filename string) bool { return getArchiveType(filename) != "" }

// ==================== 缩略图服务 ====================

func handleThumbnail(w http.ResponseWriter, r *http.Request, pathname string) {
	filename := decodeRoutePath(pathname, "/api/thumbnail/")
	filename = strings.TrimLeft(filename, "/")

	filePath := filepath.Join(sharedFolder, filename)
	if !isPathSafe(filePath, sharedFolder) {
		sendError(w, 403, "禁止访问")
		return
	}
	info, err := os.Stat(filePath)
	if os.IsNotExist(err) {
		sendError(w, 404, "文件不存在")
		return
	}

	cacheKey := fmt.Sprintf("%s_%v", filename, float64(info.ModTime().UnixNano())/1e6)
	safeKey := sanitizeCacheKey(cacheKey)
	cachePath := filepath.Join(thumbnailCacheDir, safeKey)

	if data, err := os.ReadFile(cachePath); err == nil {
		w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(200)
		w.Write(data)
		return
	}

	ext := getExt(filename)
	result := buildThumbnail(filePath, filename, ext, info.Size(), safeKey)

	out, _ := jsonMarshal(result)
	os.WriteFile(cachePath, out, 0644)

	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(200)
	w.Write(out)
}

func sanitizeCacheKey(s string) string {
	b := []byte(s)
	for i, c := range b {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '.' || c == '-') {
			b[i] = '_'
		}
	}
	return string(b)
}

func buildThumbnail(filePath, filename, ext string, size int64, safeKey string) map[string]any {
	switch {
	case imageExts[ext]:
		if data, err := os.ReadFile(filePath); err == nil {
			mime := getMimeType(filename)
			return map[string]any{"type": "image", "data": "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)}
		}
	case textPreviewExts[ext]:
		if data, err := os.ReadFile(filePath); err == nil {
			// 截断按 UTF-16 代码单元计数（与前端历史行为一致，代理对不拆开）
			u16 := utf16.Encode([]rune(string(data)))
			if len(u16) > 200 {
				u16 = u16[:200]
			}
			return map[string]any{"type": "text", "data": string(utf16.Decode(u16))}
		}
	case videoExts[ext]:
		return videoThumb(filePath, filename, safeKey)
	case audioExts[ext]:
		return audioThumb(filePath)
	case archiveExts[ext] || isArchiveFile(filename):
		return archiveThumb(filePath, filename, size)
	}
	return map[string]any{"type": "fallback", "data": "file"}
}

func videoThumb(filePath, filename, safeKey string) map[string]any {
	framePath := filepath.Join(thumbnailCacheDir, safeKey+"_frame.jpg")
	if _, err := os.Stat(framePath); os.IsNotExist(err) {
		ctx, cancel := execCmdTimeout(10 * time.Second)
		defer cancel()
		cmd := exec.CommandContext(ctx, FFMPEG_BIN, "-i", filePath, "-ss", "3", "-vframes", "1", "-q:v", "2", framePath, "-y")
		cmd.Stdout = nil
		cmd.Stderr = nil
		if err := cmd.Run(); err != nil {
			log.Printf("[Debug] 视频截帧失败 %s: %v", filename, err)
		}
	}
	if data, err := os.ReadFile(framePath); err == nil {
		return map[string]any{"type": "image", "data": "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(data)}
	}
	return map[string]any{"type": "fallback", "data": "video"}
}

func audioThumb(filePath string) map[string]any {
	f, err := os.Open(filePath)
	if err == nil {
		defer f.Close()
		if m, err := tag.ReadFrom(f); err == nil {
			if pic := m.Picture(); pic != nil && len(pic.Data) > 0 {
				return map[string]any{"type": "image", "data": "data:" + pic.MIMEType + ";base64," + base64.StdEncoding.EncodeToString(pic.Data)}
			}
		}
	}
	return map[string]any{"type": "fallback", "data": "audio"}
}

func archiveThumb(filePath, filename string, size int64) map[string]any {
	archiveType := getArchiveType(filename)
	if archiveType == "" {
		return map[string]any{"type": "fallback", "data": "archive"}
	}
	if archiveType == "zip" {
		if entries, total, err := listZip(filePath, 50); err == nil {
			return map[string]any{"type": "archive", "data": entries, "total": total, "format": "zip"}
		}
		log.Printf("[Debug] ZIP 读取失败 %s", filename)
		return map[string]any{"type": "fallback", "data": "archive"}
	}
	// RAR / 7z / Tar 家族
	if size >= libarchiveMaxSize {
		return map[string]any{"type": "fallback", "data": "archive"}
	}
	if archiveType == "rar" {
		// 纯 Go 无成熟 RAR 解码 — 降级为图标（计划内差距）
		return map[string]any{"type": "fallback", "data": "archive"}
	}
	if archiveType == "7z" {
		if entries, total, err := list7z(filePath, 50); err == nil && len(entries) > 0 {
			return map[string]any{"type": "archive", "data": entries, "total": total, "format": archiveType}
		}
		return map[string]any{"type": "fallback", "data": "archive"}
	}
	// tar 家族
	if entries, total, err := listTarFamily(filePath, archiveType, 50); err == nil && len(entries) > 0 {
		return map[string]any{"type": "archive", "data": entries, "total": total, "format": archiveType}
	}
	return map[string]any{"type": "fallback", "data": "archive"}
}

type archiveEntry struct {
	Name        string `json:"name"`
	Size        int64  `json:"size"`
	IsDirectory bool   `json:"isDirectory"`
}

// listZip — 中央目录前 50 条 + EOCD 真实总数；目录=尾部斜杠
func listZip(filePath string, maxEntries int) ([]archiveEntry, int, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return nil, 0, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return nil, 0, err
	}
	zr, err := zip.NewReader(f, info.Size())
	if err != nil {
		return nil, 0, err
	}

	total := len(zr.File)
	entries := []archiveEntry{}
	for _, fh := range zr.File {
		if len(entries) >= maxEntries {
			break
		}
		last := fh.Name[len(fh.Name)-1:]
		entries = append(entries, archiveEntry{
			Name:        fh.Name,
			Size:        int64(fh.UncompressedSize64),
			IsDirectory: last == "/" || last == "\\",
		})
	}
	return entries, total, nil
}

// list7z — bodgit/sevenzip 中央目录列表
func list7z(filePath string, maxEntries int) ([]archiveEntry, int, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return nil, 0, err
	}
	defer f.Close()
	sr, err := sevenzip.NewReader(f, fileSizeOf(filePath))
	if err != nil {
		return nil, 0, err
	}
	entries := []archiveEntry{}
	for _, fh := range sr.File {
		if len(entries) >= maxEntries {
			break
		}
		info := fh.FileInfo()
		entries = append(entries, archiveEntry{
			Name:        fh.Name,
			Size:        int64(fh.FileHeader.UncompressedSize),
			IsDirectory: info.IsDir(),
		})
	}
	return entries, len(sr.File), nil
}

func fileSizeOf(p string) int64 {
	info, err := os.Stat(p)
	if err != nil {
		return 0
	}
	return info.Size()
}

// listTarFamily — tar / tar.gz / tar.bz2 / tar.xz / tar.zst
func listTarFamily(filePath, archiveType string, maxEntries int) ([]archiveEntry, int, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return nil, 0, err
	}
	defer f.Close()

	var src io.Reader = f
	switch archiveType {
	case "targz":
		gz, err := gzip.NewReader(f)
		if err != nil {
			return nil, 0, err
		}
		defer gz.Close()
		src = gz
	case "tarbz2":
		src = bzip2.NewReader(f)
	case "tarxz":
		xr, err := xz.NewReader(f)
		if err != nil {
			return nil, 0, err
		}
		src = xr
	case "tarzst":
		zr, err := zstd.NewReader(f)
		if err != nil {
			return nil, 0, err
		}
		defer zr.Close()
		src = zr.IOReadCloser()
	}

	tr := tar.NewReader(src)
	entries := []archiveEntry{}
	total := 0
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return entries, total, err
		}
		if hdr.Name == "." || hdr.Name == "" {
			continue
		}
		total++
		if len(entries) < maxEntries {
			entries = append(entries, archiveEntry{
				Name:        hdr.Name,
				Size:        hdr.Size,
				IsDirectory: hdr.Typeflag == tar.TypeDir,
			})
		}
	}
	return entries, total, nil
}
