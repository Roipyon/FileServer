// 软件自更新 — 前端热更新（B）与桌面端自替换（D）的公共后端
//
// 分层更新模型：
//   B  前端热更新：dist.zip → BASE_DIR/web-dist 磁盘层；serveStatic 磁盘优先、embed 兜底，
//      按请求 stat 热生效、无需重启；设置页可一键「恢复内嵌版本」。
//   D  桌面自替换：下载新 exe → 校验 → Windows 旧改名 .old / 新就位 / 拉起新进程退出，
//      Unix rename 覆盖 + syscall.Exec 原位重启（Go 监听 FD 默认 CLOEXEC，exec 即释放端口）。
//   A  安卓整包：Go 层不做（W^X 禁止替换运行中的 nativeLibraryDir 二进制），
//      由壳层 DownloadListener 下载 APK → FileProvider 触发系统安装器。
//
// 更新源：共享目录根部的 update-manifest.json（当普通文件上传，完全离线闭环）。
// manifest 结构：{"web":{version,url,sha256,notes}, "server":{...}, "android":{version,versionCode,url,sha256}}
// url 支持本机 /download/<文件名> 相对路径与 http(s) 外链（GitHub Releases 等）。
package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
)

const updateMaxPayload = 512 << 20 // 单包上限，防误传超大文件拖垮内存

type updateSection struct {
	Version     string `json:"version"`
	URL         string `json:"url"`
	SHA256      string `json:"sha256"`
	VersionCode int    `json:"versionCode,omitempty"`
	Notes       string `json:"notes,omitempty"`
}

type updateManifest struct {
	Web     *updateSection `json:"web"`
	Server  *updateSection `json:"server"`
	Android *updateSection `json:"android"`
}

type updateMeta struct {
	Version   string `json:"version"`
	SHA256    string `json:"sha256"`
	AppliedAt int64  `json:"appliedAt"`
}

// ==================== 端点 ====================

// GET /api/update/manifest — 当前版本 + 可用更新（读共享目录根部清单，无则为 null）
func handleUpdateManifest(w http.ResponseWriter, r *http.Request) {
	current := map[string]any{
		"web":    map[string]any{"version": currentWebVersion(), "override": webDistActive()},
		"server": map[string]any{"version": appVersion},
	}
	var available *updateManifest
	data, err := os.ReadFile(filepath.Join(sharedFolder, "update-manifest.json"))
	if err == nil {
		var m updateManifest
		if json.Unmarshal(data, &m) == nil && (m.Web != nil || m.Server != nil || m.Android != nil) {
			available = &m
		}
	}
	sendJSON(w, 200, map[string]any{"current": current, "available": available})
}

// POST /api/update/apply/web — 方案 B：校验 → 解压暂存 → 原子换装 web-dist
// 请求体 {"sha256": "..."}：与 manifest.web.sha256 双重核对，防清单中途被改
func handleApplyWebUpdate(w http.ResponseWriter, r *http.Request) {
	body, err := parseJSONBody(r, 4096)
	if err != nil {
		sendError(w, 400, "请求体格式错误")
		return
	}
	claimedSHA, _ := body["sha256"].(string)
	m, err := readSharedManifest()
	if err != nil {
		sendError(w, 400, err.Error())
		return
	}
	if m.Web == nil {
		sendError(w, 400, "清单缺少 web 段")
		return
	}
	if subtle.ConstantTimeCompare([]byte(claimedSHA), []byte(m.Web.SHA256)) != 1 {
		sendError(w, 400, "sha256 与清单不符")
		return
	}

	payload, err := fetchUpdatePayload(m.Web)
	if err != nil {
		sendError(w, 400, "获取更新包失败: "+err.Error())
		return
	}
	if err := stageWebDist(payload, m.Web); err != nil {
		sendError(w, 500, "前端换装失败: "+err.Error())
		return
	}
	invalidateFileCache()
	sendJSON(w, 200, map[string]any{"success": true, "version": m.Web.Version})
}

// POST /api/update/rollback/web — 删除磁盘层，回到内嵌前端
func handleRollbackWebUpdate(w http.ResponseWriter, r *http.Request) {
	if !webDistActive() {
		sendError(w, 400, "当前已是内嵌版本")
		return
	}
	if err := os.RemoveAll(webDistDir()); err != nil {
		sendError(w, 500, "回退失败: "+err.Error())
		return
	}
	log.Printf("[Info] [Update] 已回退到内嵌前端 v%s", appVersion)
	sendJSON(w, 200, map[string]any{"success": true, "version": appVersion})
}

// POST /api/update/apply/server — 方案 D：桌面端自替换 + 重启
func handleApplyServerUpdate(w http.ResponseWriter, r *http.Request) {
	if runtime.GOOS == "android" {
		sendError(w, 400, "安卓端请使用整包更新（下载 APK 安装）")
		return
	}
	var body map[string]any
	body, err := parseJSONBody(r, 4096)
	if err != nil {
		sendError(w, 400, "请求体格式错误")
		return
	}
	claimedSHA, _ := body["sha256"].(string)
	m, err := readSharedManifest()
	if err != nil {
		sendError(w, 400, err.Error())
		return
	}
	if m.Server == nil {
		sendError(w, 400, "清单缺少 server 段")
		return
	}
	if subtle.ConstantTimeCompare([]byte(claimedSHA), []byte(m.Server.SHA256)) != 1 {
		sendError(w, 400, "sha256 与清单不符")
		return
	}
	exe, err := os.Executable()
	if err != nil {
		sendError(w, 500, "无法定位当前可执行文件")
		return
	}

	payload, err := fetchUpdatePayload(m.Server)
	if err != nil {
		sendError(w, 400, "获取更新包失败: "+err.Error())
		return
	}
	if err := os.WriteFile(exe+".new", payload, 0755); err != nil {
		sendError(w, 500, "暂存新版本失败: "+err.Error())
		return
	}
	// respond 后台执行：给响应留出写出窗口，再进行端口释放与进程替换
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(200)
	fmt.Fprint(w, `{"success":true,"message":"即将重启"}`)
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
	time.Sleep(500 * time.Millisecond)
	go selfReplace(exe, m.Server.Version)
}

// ==================== 自替换核心 ====================

// selfReplace — 调用方已把新二进制写到 exe+".new"。Windows：旧改名 .old、新就位、
// 拉起新进程后本进程退出；Unix：rename 原子覆盖 + exec 原位重启。
// 端口在旧进程退出（或 exec）时释放；新进程启动即清理 .old / .new 残留。
func selfReplace(exe, version string) {
	log.Printf("[Info] [Update] 开始自替换 → v%s", version)
	newBin := exe + ".new"
	cwd, _ := os.Getwd()

	if isWindows() {
		if err := os.Rename(exe, exe+".old"); err != nil {
			log.Printf("[Error] [Update] 旧版本改名失败: %v", err)
			os.Remove(newBin)
			return
		}
		if err := os.Rename(newBin, exe); err != nil {
			// 回滚：把旧版本名字改回去，服务不中断
			os.Rename(exe+".old", exe)
			log.Printf("[Error] [Update] 新版本就位失败: %v", err)
			return
		}
		if httpServer != nil {
			httpServer.Close() // 立即释放端口，避免新进程降级端口
		}
		attr := &os.ProcAttr{Dir: cwd, Env: os.Environ(), Files: []*os.File{os.Stdin, os.Stdout, os.Stderr}}
		proc, err := os.StartProcess(exe, os.Args, attr)
		if err != nil {
			log.Printf("[Error] [Update] 新进程启动失败: %v", err)
			startRecoveryListener()
			return
		}
		_ = proc.Release()
		log.Printf("[Info] [Update] 已移交 v%s，本进程退出", version)
		os.Exit(0)
	}

	// Unix：rename 覆盖运行中的 ELF + exec 原位重启（FD CLOEXEC，端口随之释放）
	if err := os.Chmod(newBin, 0755); err != nil {
		log.Printf("[Error] [Update] 新版本赋权失败: %v", err)
		os.Remove(newBin)
		return
	}
	if err := os.Rename(newBin, exe); err != nil {
		log.Printf("[Error] [Update] 新版本覆盖失败: %v", err)
		os.Remove(newBin)
		return
	}
	if err := syscall.Exec(exe, os.Args, os.Environ()); err != nil {
		log.Printf("[Error] [Update] exec 重启失败: %v", err)
		startRecoveryListener()
	}
}

// startRecoveryListener — 自替换中途失败时兜底重启 HTTP，服务不断线
func startRecoveryListener() {
	if httpServer != nil {
		return
	}
	ln := listenWithFallback(getConfig().Port, 10)
	if ln == nil {
		return
	}
	httpServer = &http.Server{Handler: createHandler()}
	go httpServer.Serve(ln)
}

// cleanupOldBinary — 启动时清理上一次自替换的残留（仅桌面）
func cleanupOldBinary() {
	if runtime.GOOS == "android" {
		return
	}
	exe, err := os.Executable()
	if err != nil {
		return
	}
	os.Remove(exe + ".old")
	os.Remove(exe + ".new")
}

// ==================== web-dist 磁盘层 ====================

func webDistDir() string { return filepath.Join(BASE_DIR, "web-dist") }

func webDistActive() bool {
	_, err := os.Stat(filepath.Join(webDistDir(), "index.html"))
	return err == nil
}

func currentWebVersion() string {
	data, err := os.ReadFile(filepath.Join(webDistDir(), "update-meta.json"))
	if err == nil {
		var meta updateMeta
		if json.Unmarshal(data, &meta) == nil && meta.Version != "" {
			return meta.Version
		}
	}
	return appVersion
}

// stageWebDist — 解压到暂存目录（zip-slip 防护 + index.html 校验），完成后原子换装
func stageWebDist(payload []byte, sec *updateSection) error {
	zr, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		return fmt.Errorf("不是有效的 zip 包")
	}

	staging := webDistDir() + ".staging"
	os.RemoveAll(staging)
	os.MkdirAll(staging, 0755)

	// 兼容两种包结构：index.html 在根，或整体嵌在唯一顶层 dist/ 目录内（按 zip 条目判定）
	prefix := ""
	hasRootIndex, hasDistIndex := false, false
	for _, f := range zr.File {
		switch f.Name {
		case "index.html":
			hasRootIndex = true
		case "dist/index.html":
			hasDistIndex = true
		}
	}
	if !hasRootIndex && hasDistIndex {
		prefix = "dist/"
	}

	var total int64
	var sawIndex bool
	for _, f := range zr.File {
		name := strings.TrimPrefix(f.Name, prefix)
		if name == "" || strings.HasSuffix(name, "/") {
			continue
		}
		clean := path.Clean("/" + name) // 斜杠域内收敛：剥 ../、盘符等，输出形如 /assets/x.js
		if strings.Contains(clean, "..") {
			os.RemoveAll(staging)
			return fmt.Errorf("zip 条目路径非法: %s", f.Name)
		}
		rel := strings.TrimPrefix(clean, "/")
		target := filepath.Join(staging, rel)
		if rel == "index.html" {
			sawIndex = true
		}
		os.MkdirAll(filepath.Dir(target), 0755)
		src, err := f.Open()
		if err != nil {
			os.RemoveAll(staging)
			return err
		}
		dst, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0644)
		if err != nil {
			src.Close()
			os.RemoveAll(staging)
			return err
		}
		n, err := io.Copy(dst, io.LimitReader(src, updateMaxPayload-total+1))
		dst.Close()
		src.Close()
		if err != nil {
			os.RemoveAll(staging)
			return err
		}
		total += n
		if total > updateMaxPayload {
			os.RemoveAll(staging)
			return fmt.Errorf("解包超出大小上限")
		}
	}
	if !sawIndex {
		os.RemoveAll(staging)
		return fmt.Errorf("包内缺少 index.html（应打包 dist 内容且 index.html 在根）")
	}

	meta, _ := json.MarshalIndent(updateMeta{Version: sec.Version, SHA256: sec.SHA256, AppliedAt: time.Now().Unix()}, "", "  ")
	os.WriteFile(filepath.Join(staging, "update-meta.json"), meta, 0644)

	os.RemoveAll(webDistDir())
	if err := os.Rename(staging, webDistDir()); err != nil {
		os.RemoveAll(staging)
		return err
	}
	log.Printf("[Info] [Update] 前端热更新完成 → v%s（磁盘层，可回退）", sec.Version)
	return nil
}

// ==================== 清单与载荷 ====================

func readSharedManifest() (*updateManifest, error) {
	data, err := os.ReadFile(filepath.Join(sharedFolder, "update-manifest.json"))
	if err != nil {
		return nil, fmt.Errorf("共享目录未找到 update-manifest.json")
	}
	var m updateManifest
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, fmt.Errorf("清单 JSON 解析失败: %v", err)
	}
	if m.Web == nil && m.Server == nil && m.Android == nil {
		return nil, fmt.Errorf("清单没有任何更新段")
	}
	return &m, nil
}

// fetchUpdatePayload — manifest.url → 载荷字节。本机路径限共享目录内，外链走 http(s)。
func fetchUpdatePayload(sec *updateSection) ([]byte, error) {
	if sec.URL == "" {
		return nil, fmt.Errorf("url 为空")
	}
	if strings.HasPrefix(sec.URL, "http://") || strings.HasPrefix(sec.URL, "https://") {
		client := &http.Client{Timeout: 15 * time.Minute}
		resp, err := client.Get(sec.URL)
		if err != nil {
			return nil, err
		}
		defer resp.Body.Close()
		if resp.StatusCode != 200 {
			return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
		}
		data, err := io.ReadAll(io.LimitReader(resp.Body, updateMaxPayload+1))
		if err != nil {
			return nil, err
		}
		if int64(len(data)) > updateMaxPayload {
			return nil, fmt.Errorf("超出大小上限")
		}
		return data, nil
	}

	if !strings.HasPrefix(sec.URL, "/download/") {
		return nil, fmt.Errorf("url 需为 /download/<文件名> 或 http(s) 外链")
	}
	name := decodeRoutePath(sec.URL, "/download/")
	path := filepath.Join(sharedFolder, name)
	if !isPathSafe(path, sharedFolder) {
		return nil, fmt.Errorf("路径越界")
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil, fmt.Errorf("文件不存在: %s", name)
	}
	if info.Size() > updateMaxPayload {
		return nil, fmt.Errorf("超出大小上限")
	}
	return os.ReadFile(path)
}

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
