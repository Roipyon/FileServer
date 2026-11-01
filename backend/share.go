// 分享链接 + 单向上传令牌
package main

import (
	"crypto/rand"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type shareEntry struct {
	Token     string
	File      string
	Mode      string // 'once' | 'persistent'
	Used      bool
	CreatedAt int64
}

type uploadTokenEntry struct {
	Token     string
	Used      bool
	CreatedAt int64
	ExpiresAt int64
}

var (
	shareMu      sync.Mutex
	shareTokens  = map[string]*shareEntry{}
	uploadTokens = map[string]*uploadTokenEntry{}
)

func newUUID() string {
	b := make([]byte, 16)
	rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func nowMillis() int64 { return time.Now().UnixMilli() }

// ==================== 生成分享链接 ====================

func handleGenerateShare(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		sendError(w, 405, "方法不允许")
		return
	}

	body, err := parseJSONBody(r, 10*1024*1024)
	if err != nil {
		sendError(w, 400, "请求格式错误")
		return
	}
	file, _ := body["file"].(string)
	if file == "" {
		sendError(w, 400, "缺少文件名")
		return
	}

	filePath := filepath.Join(sharedFolder, file)
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		sendError(w, 404, "文件不存在")
		return
	}

	mode := "once"
	if m, _ := body["mode"].(string); m == "persistent" {
		mode = "persistent"
	}

	token := newUUID()
	shareMu.Lock()
	shareTokens[token] = &shareEntry{Token: token, File: file, Mode: mode, CreatedAt: nowMillis()}
	shareMu.Unlock()

	sendJSON(w, 200, map[string]any{
		"token": token,
		"url":   "/api/share/" + token,
		"file":  file,
		"mode":  mode,
	})
}

// ==================== 分享下载 ====================

func handleShareDownload(w http.ResponseWriter, r *http.Request, pathname string) {
	token := strings.Replace(pathname, "/api/share/", "", 1)

	shareMu.Lock()
	entry, ok := shareTokens[token]
	if !ok {
		shareMu.Unlock()
		sendError(w, 404, "分享链接无效或已过期")
		return
	}
	if entry.Mode == "once" && entry.Used {
		delete(shareTokens, token)
		shareMu.Unlock()
		sendError(w, 410, "此分享链接已被使用（阅后即焚）")
		return
	}
	if entry.Mode == "once" {
		entry.Used = true
	}
	file := entry.File
	shareMu.Unlock()

	filePath := filepath.Join(sharedFolder, file)
	if !isPathSafe(filePath, sharedFolder) {
		shareMu.Lock()
		delete(shareTokens, token)
		shareMu.Unlock()
		sendError(w, 404, "分享文件不存在")
		return
	}
	info, err := os.Stat(filePath)
	if os.IsNotExist(err) {
		shareMu.Lock()
		delete(shareTokens, token)
		shareMu.Unlock()
		sendError(w, 404, "分享文件不存在")
		return
	}

	f, err := os.Open(filePath)
	if err != nil {
		sendError(w, 500, "文件读取失败")
		return
	}
	defer f.Close()

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", `attachment; filename="`+encodeURIComponent(file)+`"`)
	w.Header().Set("Content-Length", fmt.Sprintf("%d", info.Size()))
	w.WriteHeader(200)
	io.Copy(w, f)

	if entry.Mode == "once" {
		time.AfterFunc(time.Second, func() {
			shareMu.Lock()
			delete(shareTokens, token)
			shareMu.Unlock()
		})
	}
}

// ==================== 上传令牌 ====================

// validateUploadToken — 校验失败时直接写响应并返回 false
func validateUploadToken(w http.ResponseWriter, token string) bool {
	if token == "" {
		sendError(w, 400, "缺少上传令牌")
		return false
	}
	shareMu.Lock()
	entry, ok := uploadTokens[token]
	shareMu.Unlock()
	if !ok {
		sendError(w, 403, "上传令牌无效")
		return false
	}
	if entry.Used {
		sendError(w, 410, "此上传链接已被使用")
		return false
	}
	if nowMillis() > entry.ExpiresAt {
		shareMu.Lock()
		delete(uploadTokens, token)
		shareMu.Unlock()
		sendError(w, 410, "上传链接已过期")
		return false
	}
	return true
}

func markUploadTokenUsed(token string) {
	shareMu.Lock()
	if entry, ok := uploadTokens[token]; ok {
		entry.Used = true
	}
	shareMu.Unlock()
	time.AfterFunc(5*time.Second, func() {
		shareMu.Lock()
		delete(uploadTokens, token)
		shareMu.Unlock()
	})
}

func handleGenerateUploadToken(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		sendError(w, 405, "方法不允许")
		return
	}

	token := newUUID()
	shareMu.Lock()
	uploadTokens[token] = &uploadTokenEntry{
		Token: token, CreatedAt: nowMillis(),
		ExpiresAt: nowMillis() + 24*60*60*1000,
	}
	shareMu.Unlock()

	sendJSON(w, 200, map[string]any{
		"token":     token,
		"url":       "/upload?token=" + token,
		"expiresAt": nowMillis() + 24*60*60*1000,
	})
}

// handleTokenUpload — 单向令牌整文件上传（UI 不调用，保留兼容）
func handleTokenUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		sendError(w, 405, "方法不允许")
		return
	}

	token := r.URL.Query().Get("token")
	if !validateUploadToken(w, token) {
		return
	}

	if ok, msg := checkDiskSpace(); !ok {
		sendJSON(w, 507, map[string]string{"error": msg})
		return
	}

	fields, files, err := parseMultipartAll(r, incomingDir, 10*1024*1024*1024)
	_ = fields
	if err != nil {
		cleanupTemps(files)
		sendError(w, 500, "文件解析失败")
		return
	}

	uploaded := selectUploadFiles(files)
	if len(uploaded) > 10 {
		cleanupTemps(files)
		sendError(w, 400, "每次最多上传 10 个文件")
		return
	}

	results := []map[string]any{}
	for _, f := range uploaded {
		finalPath := getUniquePath(incomingDir, f.FileName)
		if err := os.Rename(f.TempPath, finalPath); err != nil {
			os.Remove(f.TempPath)
			results = append(results, map[string]any{"name": f.FileName, "success": false})
			continue
		}
		results = append(results, map[string]any{"name": filepath.Base(finalPath), "success": true})
	}

	markUploadTokenUsed(token)
	invalidateFileCache()

	successCount := 0
	for _, res := range results {
		if res["success"] == true {
			successCount++
		}
	}
	sendJSON(w, 200, map[string]any{
		"message": fmt.Sprintf("成功上传 %d 个文件", successCount),
		"results": results,
	})
}
