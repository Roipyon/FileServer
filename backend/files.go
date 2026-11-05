// 文件路由 — 文件 CRUD、上传（整传/分片）、Range 服务
package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

// ==================== 文件列表（带 mtime 和缓存）====================

func handleFileList(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		sendError(w, 405, "方法不允许")
		return
	}

	if _, err := os.Stat(sharedFolder); os.IsNotExist(err) {
		sendJSON(w, 200, []any{})
		return
	}

	if cached := getCachedFileList(); cached != nil {
		sendJSON(w, 200, cached)
		return
	}

	entries, err := os.ReadDir(sharedFolder)
	if err != nil {
		sendError(w, 500, "无法读取文件夹")
		return
	}

	files := []map[string]any{}
	for _, e := range entries {
		if e.IsDir() || strings.HasPrefix(e.Name(), ".") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if !info.Mode().IsRegular() {
			continue
		}
		files = append(files, map[string]any{
			"name":         e.Name(),
			"size":         formatFileSize(info.Size()),
			"sizeInBytes":  info.Size(),
			"modified":     zhTime(info.ModTime()),
			"mtimeMs":      float64(info.ModTime().UnixNano()) / 1e6,
			"downloadUrl":  "/download/" + url.PathEscape(e.Name()),
		})
	}

	setFileListCache(files)
	sendJSON(w, 200, files)
}

// ==================== 下载文件（无 Range，强附件）====================

func handleDownload(w http.ResponseWriter, r *http.Request, pathname string) {
	filename := decodeRoutePath(pathname, "/download/")
	filePath := filepath.Join(sharedFolder, filename)

	if !isPathSafe(filePath, sharedFolder) {
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(403)
		w.Write([]byte("禁止访问"))
		return
	}

	info, err := os.Stat(filePath)
	if os.IsNotExist(err) {
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(404)
		w.Write([]byte("文件不存在: " + filename))
		return
	}
	if !info.Mode().IsRegular() {
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(400)
		w.Write([]byte("请求的路径不是文件"))
		return
	}

	f, err := os.Open(filePath)
	if err != nil {
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(500)
		w.Write([]byte("服务器错误"))
		return
	}
	defer f.Close()

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", `attachment; filename="`+encodeURIComponent(filename)+`"`)
	w.Header().Set("Content-Length", strconv.FormatInt(info.Size(), 10))
	w.WriteHeader(200)
	io.Copy(w, f)
}

// encodeURIComponent — JS encodeURIComponent：不转义 A-Za-z0-9-_.!~*'()
func encodeURIComponent(s string) string {
	var b strings.Builder
	for _, c := range []byte(s) {
		if (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
			c == '-' || c == '_' || c == '.' || c == '!' || c == '~' || c == '*' || c == '\'' || c == '(' || c == ')' {
			b.WriteByte(c)
		} else {
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

func encodeURIComponentPath(s string) string {
	return encodeURIComponent(s)
}

// ==================== multipart 流式解析====================

type uploadedPart struct {
	FormName   string
	FileName   string
	TempPath   string
	Size       int64
}

// parseMultipartAll 逐 part 流式落盘（uploadDir 随机临时名），返回字段与文件部件。
// maxFileSize 为单个文件上限；上传失败时不清理临时文件，由调用方负责。
func parseMultipartAll(r *http.Request, tempDir string, maxFileSize int64) (map[string]string, []uploadedPart, error) {
	mediaType, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if err != nil || !strings.HasPrefix(mediaType, "multipart/") {
		return nil, nil, fmt.Errorf("请求不是 multipart 格式")
	}
	mr := multipart.NewReader(r.Body, params["boundary"])

	fields := map[string]string{}
	var files []uploadedPart
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fields, files, err
		}

		formName := part.FormName()
		if part.FileName() == "" {
			// 普通字段
			val, err := io.ReadAll(io.LimitReader(part, 1<<20))
			if err != nil {
				return fields, files, err
			}
			fields[formName] = string(val)
			part.Close()
			continue
		}

		// 文件部件 → 流式写临时文件
		tmpPath := filepath.Join(tempDir, "upload_"+randHex(16))
		dst, err := os.Create(tmpPath)
		if err != nil {
			return fields, files, err
		}
		written, copyErr := io.Copy(dst, io.LimitReader(part, maxFileSize+1))
		closeErr := dst.Close()
		if copyErr != nil {
			os.Remove(tmpPath)
			return fields, files, copyErr
		}
		if closeErr != nil {
			os.Remove(tmpPath)
			return fields, files, closeErr
		}
		if written > maxFileSize {
			os.Remove(tmpPath)
			return fields, files, fmt.Errorf("File size limit exceeded: %s", part.FileName())
		}
		files = append(files, uploadedPart{
			FormName: formName,
			FileName: filepath.Base(part.FileName()),
			TempPath: tmpPath,
			Size:     written,
		})
		part.Close()
	}
	return fields, files, nil
}

func randHex(n int) string {
	b := make([]byte, n)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// selectUploadFiles — 优先 form 字段名 files，其次 file，否则全部
func selectUploadFiles(files []uploadedPart) []uploadedPart {
	var byName []uploadedPart
	for _, f := range files {
		if f.FormName == "files" {
			byName = append(byName, f)
		}
	}
	if len(byName) > 0 {
		return byName
	}
	for _, f := range files {
		if f.FormName == "file" {
			byName = append(byName, f)
		}
	}
	if len(byName) > 0 {
		return byName
	}
	return files
}

// ==================== 整文件上传 ====================

func handleUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		sendError(w, 405, "方法不允许")
		return
	}

	if ok, msg := checkDiskSpace(); !ok {
		sendJSON(w, 507, map[string]string{"error": msg})
		return
	}

	fields, files, err := parseMultipartAll(r, sharedFolder, getConfig().MaxUploadSize)
	// overwrite=true 时覆盖同名旧文件（保留新文件），否则自动改名共存（name(1).ext）
	overwrite := fields["overwrite"] == "true" || fields["overwrite"] == "1"
	if err != nil {
		cleanupTemps(files)
		sendError(w, 500, "文件解析失败: "+err.Error())
		return
	}

	uploaded := selectUploadFiles(files)
	if len(uploaded) == 0 {
		cleanupTemps(files)
		sendError(w, 400, "没有接收到文件")
		return
	}

	results := []map[string]any{}
	for _, f := range uploaded {
		var target string
		if overwrite {
			target = filepath.Join(sharedFolder, f.FileName)
		} else {
			target = getUniquePath(sharedFolder, f.FileName)
		}
		if err := os.Rename(f.TempPath, target); err != nil {
			os.Remove(f.TempPath)
			errMsg := "文件保存失败: " + err.Error()
			if overwrite && isFileLocked(target) {
				errMsg = "目标文件正在被使用（预览/编辑中），无法覆盖"
			}
			results = append(results, map[string]any{
				"name": f.FileName, "success": false,
				"error": errMsg,
			})
			continue
		}
		results = append(results, map[string]any{
			"name": filepath.Base(target), "success": true, "message": "文件上传成功",
		})
	}

	invalidateFileCache()

	allSuccess := true
	for _, res := range results {
		if res["success"] != true {
			allSuccess = false
		}
	}
	code := 200
	msg := fmt.Sprintf("成功上传 %d 个文件", len(results))
	if !allSuccess {
		code = 207
		msg = "部分文件上传失败"
	}
	sendJSON(w, code, map[string]any{"message": msg, "results": results})
}

func cleanupTemps(files []uploadedPart) {
	for _, f := range files {
		os.Remove(f.TempPath)
	}
}

// ==================== 分片上传（可选 token）====================

func handleUploadChunk(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		sendError(w, 405, "方法不允许")
		return
	}

	if token := r.URL.Query().Get("token"); token != "" {
		if !validateUploadToken(w, token) {
			return
		}
	}

	fields, files, err := parseMultipartAll(r, chunkTempDir, 100*1024*1024)
	if err != nil {
		cleanupTemps(files)
		sendError(w, 500, "分片解析失败")
		return
	}
	defer cleanupTemps(files)

	fileId := fields["fileId"]
	chunkIndex := fields["chunkIndex"]
	fileName := fields["fileName"]
	totalChunks := fields["totalChunks"]

	var chunkFile *uploadedPart
	for i := range files {
		if files[i].FormName == "chunk" {
			chunkFile = &files[i]
			break
		}
	}

	if fileId == "" || chunkIndex == "" || fileName == "" || totalChunks == "" || chunkFile == nil {
		sendError(w, 400, "缺少必要参数")
		return
	}

	chunkPath := filepath.Join(chunkTempDir, fileId+"_"+chunkIndex)
	if err := os.Rename(chunkFile.TempPath, chunkPath); err != nil {
		sendError(w, 500, "分片保存失败")
		return
	}
	sendJSON(w, 200, map[string]any{"success": true})
}

// ==================== 合并分片 ====================

func handleMergeChunks(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		sendError(w, 405, "方法不允许")
		return
	}

	body, err := parseJSONBody(r, 1024*1024)
	if err != nil {
		sendError(w, 400, "合并分片失败: "+err.Error())
		return
	}

	fileId, _ := body["fileId"].(string)
	fileName, _ := body["fileName"].(string)
	token, _ := body["token"].(string)
	overwrite, _ := body["overwrite"].(bool)
	if fileId == "" || fileName == "" || body["totalChunks"] == nil {
		sendError(w, 400, "缺少必要参数")
		return
	}
	if token != "" {
		if !validateUploadToken(w, token) {
			return
		}
	}

	chunkCountF, ok := body["totalChunks"].(float64)
	chunkCount := int(chunkCountF)
	if !ok || chunkCount < 1 || chunkCount > 20000 || float64(chunkCount) != chunkCountF {
		sendError(w, 400, "totalChunks 参数无效（范围 1-20000）")
		return
	}

	// overwrite=true 时直接写原名（os.Create 截断覆盖旧文件），否则自动改名共存
	var finalPath string
	if overwrite && token == "" {
		finalPath = filepath.Join(sharedFolder, fileName)
	} else {
		finalPath = getUniquePath(sharedFolder, fileName)
	}
	out, err := os.Create(finalPath)
	if err != nil {
		sendError(w, 500, "写入文件失败")
		return
	}

	for i := 0; i < chunkCount; i++ {
		chunkPath := filepath.Join(chunkTempDir, fmt.Sprintf("%s_%d", fileId, i))
		cf, err := os.Open(chunkPath)
		if err != nil {
			out.Close()
			os.Remove(finalPath)
			sendError(w, 400, fmt.Sprintf("缺少分片 %d", i))
			return
		}
		_, cerr := io.Copy(out, cf)
		cf.Close()
		os.Remove(chunkPath)
		if cerr != nil {
			out.Close()
			os.Remove(finalPath)
			sendError(w, 500, fmt.Sprintf("读取分片 %d 失败", i))
			return
		}
	}
	out.Close()

	if token != "" {
		markUploadTokenUsed(token)
	}
	invalidateFileCache()
	sendJSON(w, 200, map[string]any{
		"success": true,
		"name":    filepath.Base(finalPath),
		"message": "文件合并成功",
	})
}

// ==================== 删除文件（带锁检测）====================

func handleDelete(w http.ResponseWriter, r *http.Request, pathname string) {
	if r.Method != http.MethodDelete {
		sendError(w, 405, "方法不允许")
		return
	}

	filename := decodeRoutePath(pathname, "/api/delete/")
	filePath := filepath.Join(sharedFolder, filename)

	if !isPathSafe(filePath, sharedFolder) {
		sendError(w, 403, "禁止访问")
		return
	}
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		sendError(w, 404, "文件不存在")
		return
	}
	if isFileLocked(filePath) {
		sendError(w, 409, "文件正在被使用（预览/编辑中），无法删除")
		return
	}

	if err := os.Remove(filePath); err != nil {
		sendError(w, 500, "文件删除失败: "+err.Error())
		return
	}
	invalidateFileCache()
	sendJSON(w, 200, map[string]string{"message": "文件删除成功"})
}

// ==================== 原始文件服务（Range/ETag/HEAD/If-Range）====================

var previewableExts = func() map[string]bool {
	m := map[string]bool{}
	for k := range textPreviewExts {
		m[k] = true
	}
	for k := range imageExts {
		m[k] = true
	}
	for k := range videoExts {
		m[k] = true
	}
	for k := range audioExts {
		m[k] = true
	}
	for k := range map[string]bool{"zip": true, "rar": true, "7z": true, "tar": true, "gz": true, "bz2": true, "xz": true} {
		m[k] = true
	}
	return m
}()

func isPreviewableFile(filename string) bool {
	return previewableExts[getExt(filename)]
}

func cacheControlFor(filename string) string {
	if isPreviewableFile(filename) {
		return "no-cache, must-revalidate"
	}
	return "public, max-age=86400"
}

func contentDispositionFor(mimeType, filename string) string {
	if isInlineType(mimeType) {
		return `inline; filename="` + encodeURIComponentPath(filename) + `"`
	}
	return `attachment; filename="` + encodeURIComponentPath(filename) + `"`
}

func handleRawFile(w http.ResponseWriter, r *http.Request, pathname string) {
	filename := decodeRoutePath(pathname, "/api/raw/")
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
	if !info.Mode().IsRegular() {
		sendError(w, 400, "请求的路径不是文件")
		return
	}

	totalSize := info.Size()
	mimeType := getMimeType(filename)
	etag := fmt.Sprintf(`W/"%v-%d"`, float64(info.ModTime().UnixNano())/1e6, totalSize)
	isHead := r.Method == http.MethodHead

	// HEAD：只返回头
	if isHead {
		w.Header().Set("Content-Type", mimeType)
		w.Header().Set("Content-Length", strconv.FormatInt(totalSize, 10))
		w.Header().Set("Accept-Ranges", "bytes")
		w.Header().Set("ETag", etag)
		w.Header().Set("Cache-Control", cacheControlFor(filename))
		w.WriteHeader(200)
		return
	}

	// If-None-Match → 304
	if r.Header.Get("If-None-Match") == etag {
		w.Header().Set("ETag", etag)
		w.Header().Set("Cache-Control", cacheControlFor(filename))
		w.WriteHeader(304)
		return
	}

	rangeHeader := r.Header.Get("Range")
	if rangeHeader != "" {
		re := regexp.MustCompile(`bytes=(\d*)-(\d*)`)
		m := re.FindStringSubmatch(rangeHeader)
		if m != nil {
			var start, end int64
			hasStart := m[1] != ""
			hasEnd := m[2] != ""
			if hasStart {
				start, _ = strconv.ParseInt(m[1], 10, 64)
			}
			if hasEnd {
				end, _ = strconv.ParseInt(m[2], 10, 64)
			}

			switch {
			case !hasStart && hasEnd: // bytes=-suffix
				start = totalSize - end
				if start < 0 {
					start = 0
				}
				end = totalSize - 1
			case hasStart && !hasEnd: // bytes=start-
				end = totalSize - 1
			case hasStart && hasEnd: // bytes=start-end
			default: // 格式错误 → 完整文件
				sendFullRawFile(w, filePath, mimeType, totalSize, filename, etag, info)
				return
			}

			if start < 0 {
				start = 0
			}
			if end >= totalSize {
				end = totalSize - 1
			}
			if start > end || start >= totalSize {
				w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", totalSize))
				w.Header().Set("Content-Type", mimeType)
				w.WriteHeader(416)
				return
			}

			// If-Range：仅日期比较，文件比请求新 → 完整文件
			if ifRange := r.Header.Get("If-Range"); ifRange != "" {
				if ifDate, err := http.ParseTime(ifRange); err == nil {
					if info.ModTime().After(ifDate) {
						sendFullRawFile(w, filePath, mimeType, totalSize, filename, etag, info)
						return
					}
				}
			}

			chunkSize := end - start + 1
			f, err := os.Open(filePath)
			if err != nil {
				sendError(w, 500, "文件读取失败")
				return
			}
			defer f.Close()
			if _, err := f.Seek(start, io.SeekStart); err != nil {
				sendError(w, 500, "文件读取失败")
				return
			}

			w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, totalSize))
			w.Header().Set("Accept-Ranges", "bytes")
			w.Header().Set("Content-Length", strconv.FormatInt(chunkSize, 10))
			w.Header().Set("Content-Type", mimeType)
			w.Header().Set("Cache-Control", cacheControlFor(filename))
			w.Header().Set("ETag", etag)
			w.Header().Set("Content-Disposition", contentDispositionFor(mimeType, filename))
			w.WriteHeader(206)
			io.CopyN(w, f, chunkSize)
			return
		}
	}

	sendFullRawFile(w, filePath, mimeType, totalSize, filename, etag, info)
}

func sendFullRawFile(w http.ResponseWriter, filePath, mimeType string, totalSize int64, filename, etag string, info os.FileInfo) {
	f, err := os.Open(filePath)
	if err != nil {
		sendError(w, 500, "文件读取失败")
		return
	}
	defer f.Close()

	w.Header().Set("Content-Type", mimeType)
	w.Header().Set("Content-Length", strconv.FormatInt(totalSize, 10))
	w.Header().Set("Accept-Ranges", "bytes")
	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", cacheControlFor(filename))
	w.Header().Set("Content-Disposition", contentDispositionFor(mimeType, filename))
	w.WriteHeader(200)
	io.Copy(w, f)
}

// ==================== 重命名 ====================

var illegalChars = regexp.MustCompile(`[/\\:*?"<>|]`)

func handleRename(w http.ResponseWriter, r *http.Request, pathname string) {
	if r.Method != http.MethodPatch {
		sendError(w, 405, "方法不允许")
		return
	}

	filename := decodeRoutePath(pathname, "/api/files/")
	oldPath := filepath.Join(sharedFolder, filename)

	if !isPathSafe(oldPath, sharedFolder) {
		sendError(w, 403, "禁止访问")
		return
	}
	if _, err := os.Stat(oldPath); os.IsNotExist(err) {
		sendError(w, 404, "文件不存在")
		return
	}

	body, err := parseJSONBody(r, 10*1024*1024)
	if err != nil {
		sendError(w, 400, "文件重命名失败: "+err.Error())
		return
	}
	newName, _ := body["newName"].(string)
	if strings.TrimSpace(newName) == "" {
		sendError(w, 400, "新文件名不能为空")
		return
	}
	cleaned := strings.TrimSpace(newName)
	if illegalChars.MatchString(cleaned) {
		sendError(w, 400, `文件名包含非法字符（/ \ : * ? " < > |）`)
		return
	}

	newPath := filepath.Join(sharedFolder, cleaned)
	if !isPathSafe(newPath, sharedFolder) {
		sendError(w, 403, "禁止访问")
		return
	}
	if _, err := os.Stat(newPath); err == nil {
		sendError(w, 409, fmt.Sprintf("文件 \"%s\" 已存在", cleaned))
		return
	}

	if err := os.Rename(oldPath, newPath); err != nil {
		sendError(w, 400, "文件重命名失败: "+err.Error())
		return
	}
	invalidateFileCache()
	sendJSON(w, 200, map[string]any{"success": true, "oldName": filename, "newName": cleaned})
}

// ==================== 保存文本内容 ====================

func handleSaveContent(w http.ResponseWriter, r *http.Request, pathname string) {
	if r.Method != http.MethodPut {
		sendError(w, 405, "方法不允许")
		return
	}

	filename := decodeRoutePath(pathname, "/api/files/")
	filePath := filepath.Join(sharedFolder, filename)

	if !isPathSafe(filePath, sharedFolder) {
		sendError(w, 403, "禁止访问")
		return
	}

	body, err := parseJSONBody(r, 10*1024*1024)
	if err != nil {
		sendError(w, 400, "文件保存失败: "+err.Error())
		return
	}
	content, ok := body["content"]
	if !ok {
		sendError(w, 400, "缺少 content 字段")
		return
	}
	str, ok := content.(string)
	if !ok {
		str = fmt.Sprintf("%v", content)
	}

	if err := os.WriteFile(filePath, []byte(str), 0644); err != nil {
		sendError(w, 400, "文件保存失败: "+err.Error())
		return
	}
	invalidateFileCache()
	sendJSON(w, 200, map[string]any{"success": true, "name": filename})
}
