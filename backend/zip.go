// ZIP 批量打包任务系统
package main

import (
	"archive/zip"
	"compress/flate"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"
)

const maxFilesPerZip = 1000
const taskCleanupMs = 30 * 60 * 1000 // 打包产物保留 30 分钟：中转链路下载大包耗时可观，且用户可能中途取消后再下

type zipTask struct {
	mu            sync.Mutex
	id            string
	state         string // pending | processing | completed | error | cancelled
	percent       int
	totalFiles    int
	processedFiles int
	skippedFiles  int
	currentFile   string
	zipName       string
	outputPath    string
	createdAt     int64
	err           string
	cancelled     bool
}

var zipTasks struct {
	mu    sync.Mutex
	tasks map[string]*zipTask
}

func init() {
	zipTasks.tasks = map[string]*zipTask{}
}

func formatTimestampName() string {
	return time.Now().Format("FileServer_20060102_150405.zip")
}

var zipNameSanitizer = regexp.MustCompile(`[/\\:*?"<>|]`)

func sanitizeZipName(name string) string {
	safe := strings.TrimSpace(name)
	if safe == "" {
		safe = formatTimestampName()
	}
	if !strings.HasSuffix(strings.ToLower(safe), ".zip") {
		safe += ".zip"
	}
	safe = zipNameSanitizer.ReplaceAllString(safe, "_")
	if len(safe) > 200 {
		safe = safe[:196] + ".zip"
	}
	if safe == "" || safe == ".zip" {
		safe = formatTimestampName()
	}
	return safe
}

func cleanupTask(taskID string) {
	zipTasks.mu.Lock()
	task, ok := zipTasks.tasks[taskID]
	if ok {
		delete(zipTasks.tasks, taskID)
	}
	zipTasks.mu.Unlock()
	if ok {
		os.Remove(task.outputPath)
	}
}

// startZipPack — 后台打包协程（archiver level 6 ≈ Go flate 默认级别）
func startZipPack(task *zipTask, files []string) {
	task.mu.Lock()
	task.state = "processing"
	task.mu.Unlock()

	outFile, err := os.Create(task.outputPath)
	if err != nil {
		task.mu.Lock()
		task.state, task.err = "error", "ZIP 写入失败: "+err.Error()
		task.mu.Unlock()
		go func() { time.Sleep(taskCleanupMs); cleanupTask(task.id) }()
		return
	}
	defer outFile.Close()

	zw := zip.NewWriter(outFile)
	zw.RegisterCompressor(zip.Deflate, func(w io.Writer) (io.WriteCloser, error) {
		return flate.NewWriter(w, 1)
	})
	defer zw.Close()

	validCount := 0
	for _, fileName := range files {
		filePath := filepath.Join(sharedFolder, fileName)
		if !isPathSafe(filePath, sharedFolder) {
			task.mu.Lock()
			task.skippedFiles++
			task.mu.Unlock()
			continue
		}
		info, err := os.Stat(filePath)
		if os.IsNotExist(err) || !info.Mode().IsRegular() {
			task.mu.Lock()
			task.skippedFiles++
			task.mu.Unlock()
			continue
		}

		src, err := os.Open(filePath)
		if err != nil {
			task.mu.Lock()
			task.skippedFiles++
			task.mu.Unlock()
			continue
		}

		// 扁平条目，名称 = 原文件名；媒体/已压缩格式直接 STORE，文本用轻量压缩提速
		hdr := &zip.FileHeader{Name: fileName, Method: storeMethod(fileName)}
		hdr.Modified = info.ModTime()
		hdr.SetMode(info.Mode())
		dst, err := zw.CreateHeader(hdr)
		if err == nil {
			_, err = io.Copy(dst, src)
		}
		src.Close()
		if err != nil {
			task.mu.Lock()
			task.state, task.err = "error", "ZIP 压缩失败: "+err.Error()
			task.mu.Unlock()
			go func() { time.Sleep(taskCleanupMs); cleanupTask(task.id) }()
			return
		}

		validCount++
		task.mu.Lock()
		task.processedFiles = validCount
		task.currentFile = fileName
		if validCount > 0 {
			p := validCount * 100 / len(files)
			if p > 99 {
				p = 99
			}
			task.percent = p
		}
		task.mu.Unlock()
	}

	// 空任务 → 追加 (empty).txt
	if validCount == 0 {
		if dst, err := zw.Create("(empty).txt"); err == nil {
			dst.Write([]byte{})
		}
	}
	zw.Close()

	task.mu.Lock()
	if !task.cancelled {
		task.state = "completed"
		task.percent = 100
		task.processedFiles = validCount
		if info, err := os.Stat(task.outputPath); err == nil {
			log.Printf("[Info] [ZIP] 打包完成: %q (%d 文件, 共 %.1f MB)", task.zipName, validCount, float64(info.Size())/(1024*1024))
		}
		task.mu.Unlock()
		scheduleTaskCleanup(task.id)
		return
	}
	task.mu.Unlock()
}

func scheduleTaskCleanup(taskID string) {
	time.AfterFunc(time.Duration(taskCleanupMs)*time.Millisecond, func() {
		cleanupTask(taskID)
	})
}

// ==================== HTTP 端点 ====================

func handleDownloadZip(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		sendError(w, 405, "方法不允许")
		return
	}

	body, err := parseJSONBody(r, 10*1024*1024)
	if err != nil {
		sendError(w, 400, "请求格式错误")
		return
	}

	rawFiles, _ := body["files"].([]any)
	files := make([]string, 0, len(rawFiles))
	for _, f := range rawFiles {
		if s, ok := f.(string); ok {
			files = append(files, s)
		}
	}
	if len(files) == 0 {
		sendError(w, 400, "请选择至少一个文件")
		return
	}
	if len(files) > maxFilesPerZip {
		sendJSON(w, 400, map[string]any{"error": fmt.Sprintf("一次最多打包 %d 个文件", maxFilesPerZip), "maxFiles": maxFilesPerZip})
		return
	}

	zipName, _ := body["zipName"].(string)
	taskID := newUUID()
	task := &zipTask{
		id:        taskID,
		state:     "pending",
		totalFiles: len(files),
		zipName:   sanitizeZipName(zipName),
		outputPath: filepath.Join(zipTempDir, taskID+".zip"),
		createdAt: nowMillis(),
	}
	zipTasks.mu.Lock()
	zipTasks.tasks[taskID] = task
	zipTasks.mu.Unlock()

	go startZipPack(task, files)

	sendJSON(w, 200, map[string]any{
		"taskId": task.id, "zipName": task.zipName, "totalFiles": len(files),
	})
}

func handleZipProgress(w http.ResponseWriter, taskID string) {
	zipTasks.mu.Lock()
	task, ok := zipTasks.tasks[taskID]
	zipTasks.mu.Unlock()
	if !ok {
		sendError(w, 404, "任务不存在或已过期")
		return
	}

	task.mu.Lock()
	defer task.mu.Unlock()
	sendJSON(w, 200, map[string]any{
		"taskId": task.id, "state": task.state, "percent": task.percent,
		"totalFiles": task.totalFiles, "processedFiles": task.processedFiles,
		"skippedFiles": task.skippedFiles, "currentFile": task.currentFile,
		"zipName": task.zipName, "error": nilIfEmpty(task.err),
	})
}

func nilIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func handleZipDownload(w http.ResponseWriter, taskID string) {
	zipTasks.mu.Lock()
	task, ok := zipTasks.tasks[taskID]
	zipTasks.mu.Unlock()
	if !ok {
		sendError(w, 404, "ZIP 文件未就绪或任务不存在")
		return
	}

	task.mu.Lock()
	state, percent := task.state, task.percent
	task.mu.Unlock()

	if state != "completed" {
		sendJSON(w, 409, map[string]any{"error": "ZIP 尚未打包完成", "state": state, "percent": percent})
		return
	}

	info, err := os.Stat(task.outputPath)
	if os.IsNotExist(err) {
		sendError(w, 410, "ZIP 文件已过期，请重新打包")
		return
	}

	f, err := os.Open(task.outputPath)
	if err != nil {
		sendError(w, 500, "读取 ZIP 文件失败")
		return
	}
	defer f.Close()

	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="`+encodeURIComponent(task.zipName)+`"`)
	w.Header().Set("Content-Length", fmt.Sprintf("%d", info.Size()))
	w.WriteHeader(200)
	io.Copy(w, f)
}

func handleZipCancel(w http.ResponseWriter, r *http.Request, taskID string) {
	if r.Method != http.MethodDelete {
		sendError(w, 405, "方法不允许")
		return
	}

	zipTasks.mu.Lock()
	task, ok := zipTasks.tasks[taskID]
	if ok {
		delete(zipTasks.tasks, taskID)
	}
	zipTasks.mu.Unlock()
	if !ok {
		sendError(w, 404, "任务不存在或已过期")
		return
	}

	task.mu.Lock()
	task.cancelled = true
	task.state = "cancelled"
	task.mu.Unlock()

	os.Remove(task.outputPath)
	sendJSON(w, 200, map[string]any{"success": true, "taskId": taskID})
}

// storeMethod — 已压缩媒体再压无收益且烧 CPU，直接 STORE；
// 其余（文本/文档类）用 deflate 级别 1，速度约为默认级别 6 的三倍，打包小文件不再拖后腿
func storeMethod(name string) uint16 {
	switch strings.ToLower(filepath.Ext(name)) {
	case ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic", ".avif",
		".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv", ".wmv",
		".mp3", ".flac", ".ogg", ".wav", ".aac", ".m4a", ".opus",
		".zip", ".7z", ".rar", ".gz", ".bz2", ".xz", ".zst", ".apk", ".iso",
		".pdf", ".docx", ".xlsx", ".pptx", ".epub":
		return zip.Store
	}
	return zip.Deflate
}
