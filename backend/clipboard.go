// 剪贴板同步
package main

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

const clipboardMaxItems = 100

type clipEntry struct {
	ID         string `json:"id"`
	Content    string `json:"content"`
	DeviceName string `json:"deviceName"`
	Timestamp  int64  `json:"timestamp"`
	Size       int64  `json:"size"`
}

func handleGetClipboard(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		sendError(w, 405, "方法不允许")
		return
	}

	if _, err := os.Stat(clipboardDir); os.IsNotExist(err) {
		os.MkdirAll(clipboardDir, 0755)
		sendJSON(w, 200, []any{})
		return
	}

	entries, err := os.ReadDir(clipboardDir)
	if err != nil {
		sendError(w, 500, "无法读取剪贴板")
		return
	}

	clips := []clipEntry{}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".txt") {
			continue
		}
		filePath := filepath.Join(clipboardDir, e.Name())
		info, err := e.Info()
		if err != nil {
			continue
		}
		data, err := os.ReadFile(filePath)
		if err != nil {
			continue
		}

		baseName := strings.TrimSuffix(e.Name(), ".txt")
		var timestamp int64
		var deviceName string
		if idx := strings.Index(baseName, "_"); idx > 0 {
			ts, err := strconv.ParseInt(baseName[:idx], 10, 64)
			if err == nil {
				timestamp = ts
			} else {
				timestamp = info.ModTime().UnixMilli()
			}
			deviceName = baseName[idx+1:]
		} else {
			timestamp = info.ModTime().UnixMilli()
			deviceName = "未知设备"
		}

		clips = append(clips, clipEntry{
			ID: e.Name(), Content: string(data),
			DeviceName: deviceName, Timestamp: timestamp, Size: info.Size(),
		})
	}

	sort.Slice(clips, func(i, j int) bool { return clips[i].Timestamp > clips[j].Timestamp })
	sendJSON(w, 200, clips)
}

var deviceNameSanitizer = regexp.MustCompile(`[/\\:*?"<>|]`)

func handleSendClipboard(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		sendError(w, 405, "方法不允许")
		return
	}

	body, err := parseJSONBody(r, 10*1024*1024)
	if err != nil {
		sendError(w, 500, "保存剪贴板失败: "+err.Error())
		return
	}
	content, _ := body["content"].(string)
	deviceName, _ := body["deviceName"].(string)

	if strings.TrimSpace(content) == "" {
		sendError(w, 400, "剪贴板内容不能为空")
		return
	}

	safeName := deviceNameSanitizer.ReplaceAllString(deviceName, "_")
	if len([]rune(safeName)) > 50 {
		safeName = string([]rune(safeName)[:50])
	}
	if deviceName == "" {
		safeName = "未知设备"
	}

	timestamp := nowMillis()
	fileName := fmt.Sprintf("%d_%s.txt", timestamp, safeName)
	if err := os.WriteFile(filepath.Join(clipboardDir, fileName), []byte(content), 0644); err != nil {
		sendError(w, 500, "保存剪贴板失败: "+err.Error())
		return
	}
	pruneClipboard()
	sendJSON(w, 200, map[string]any{"success": true, "id": fileName})
}

func handleDeleteClipItem(w http.ResponseWriter, r *http.Request, pathname string) {
	if r.Method != http.MethodDelete {
		sendError(w, 405, "方法不允许")
		return
	}

	filename := decodeRoutePath(pathname, "/api/clipboard/")
	filePath := filepath.Join(clipboardDir, filename)

	if !isPathSafe(filePath, clipboardDir) {
		sendError(w, 403, "禁止访问")
		return
	}
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		sendError(w, 404, "剪贴板条目不存在")
		return
	}

	if err := os.Remove(filePath); err != nil {
		sendError(w, 500, "删除失败: "+err.Error())
		return
	}
	sendJSON(w, 200, map[string]any{"success": true})
}

func handleClearClipboard(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		sendError(w, 405, "方法不允许")
		return
	}

	if _, err := os.Stat(clipboardDir); os.IsNotExist(err) {
		sendJSON(w, 200, map[string]any{"success": true, "deletedCount": 0})
		return
	}

	entries, err := os.ReadDir(clipboardDir)
	if err != nil {
		sendError(w, 500, "清空失败: "+err.Error())
		return
	}
	deletedCount := 0
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".txt") {
			if os.Remove(filepath.Join(clipboardDir, e.Name())) == nil {
				deletedCount++
			}
		}
	}
	sendJSON(w, 200, map[string]any{"success": true, "deletedCount": deletedCount})
}

// pruneClipboard — 超过 100 条按 mtime 倒序裁剪
func pruneClipboard() {
	entries, err := os.ReadDir(clipboardDir)
	if err != nil {
		return
	}
	type item struct {
		name string
		time int64
	}
	items := []item{}
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".txt") {
			continue
		}
		if info, err := e.Info(); err == nil {
			items = append(items, item{e.Name(), info.ModTime().UnixMilli()})
		}
	}
	sort.Slice(items, func(i, j int) bool { return items[i].time > items[j].time })
	if len(items) > clipboardMaxItems {
		for _, it := range items[clipboardMaxItems:] {
			os.Remove(filepath.Join(clipboardDir, it.name))
		}
	}
}
