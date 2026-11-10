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
// 更新源：GitHub Releases 最新发布（在线拉取，按资产命名约定映射，
// 校验值取自 release 内的 checksums.txt）。
package main

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"crypto/sha256"
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
	"strconv"
	"strings"
	"syscall"
	"time"
)

const updateMaxPayload = 512 << 20 // 单包上限，防误传超大文件拖垮内存

type updateSection struct {
	Version string `json:"version"`
	URL     string `json:"url"`
	SHA256  string `json:"sha256"`
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

// GET /api/update/manifest — 当前版本 + 可用更新（来源：GitHub Releases 最新发布）。
func handleUpdateManifest(w http.ResponseWriter, r *http.Request) {
	current := map[string]any{
		"web":    map[string]any{"version": currentWebVersion(), "override": webDistActive()},
		"server": map[string]any{"version": appVersion},
	}
	var available *updateManifest
	notice := ""

	if gh, err := fetchGitHubManifest(); err == nil {
		available = gh
	} else {
		log.Printf("[Debug] [Update] GitHub Releases 不可达: %v", err)
		notice = "Github 在线检查更新连接失败。"
	}
	// 只展示比当前更新的段，避免误降级
	if available != nil {
		available.Web = newerOnly(available.Web, currentWebVersion())
		available.Server = newerOnly(available.Server, appVersion)
		available.Android = newerOnly(available.Android, appVersion)
		if available.Web == nil && available.Server == nil && available.Android == nil {
			available = nil
		}
	}

	sendJSON(w, 200, map[string]any{"current": current, "available": available, "notice": notice})
}

// POST /api/update/apply/web — 方案 B：校验 → 解压暂存 → 原子换装 web-dist
// 请求体直接携带检查结果中的所选段，载荷下载后做 sha256 强校验
func handleApplyWebUpdate(w http.ResponseWriter, r *http.Request) {
	sec := decodeApplySection(w, r)
	if sec == nil {
		return
	}

	payload, err := fetchUpdatePayload(sec)
	if err != nil {
		sendError(w, 400, "获取更新包失败: "+err.Error())
		return
	}
	if sha256Hex(payload) != sec.SHA256 {
		sendError(w, 400, "sha256 校验不符，更新包可能已损坏")
		return
	}
	if err := stageWebDist(payload, sec); err != nil {
		sendError(w, 500, "前端换装失败: "+err.Error())
		return
	}
	invalidateFileCache()
	sendJSON(w, 200, map[string]any{"success": true, "version": sec.Version})
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
	sec := decodeApplySection(w, r)
	if sec == nil {
		return
	}
	exe, err := os.Executable()
	if err != nil {
		sendError(w, 500, "无法定位当前可执行文件")
		return
	}

	payload, err := fetchUpdatePayload(sec)
	if err != nil {
		sendError(w, 400, "获取更新包失败: "+err.Error())
		return
	}
	if sha256Hex(payload) != sec.SHA256 {
		sendError(w, 400, "sha256 校验不符，更新包可能已损坏")
		return
	}
	// GitHub 发布产物是压缩包（zip / tar.gz，内含单个二进制），本地 /download/ 直传二进制则原样
	if payload, err = extractBinaryFromArchive(payload); err != nil {
		sendError(w, 400, "更新包解压失败: "+err.Error())
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
	go selfReplace(exe, sec.Version)
}

// decodeApplySection — apply 端点公共入参：请求体携带所选段 {version,url,sha256}
func decodeApplySection(w http.ResponseWriter, r *http.Request) *updateSection {
	body, err := parseJSONBody(r, 4096)
	if err != nil {
		sendError(w, 400, "请求体格式错误")
		return nil
	}
	sec := &updateSection{
		Version: bodyString(body, "version"),
		URL:     bodyString(body, "url"),
		SHA256:  bodyString(body, "sha256"),
	}
	if sec.URL == "" || len(sec.SHA256) != 64 {
		sendError(w, 400, "缺少 url 或 sha256")
		return nil
	}
	return sec
}

func bodyString(m map[string]any, key string) string {
	s, _ := m[key].(string)
	return s
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

// fetchUpdatePayload — 段 url → 载荷字节（GitHub Releases 外链）。
func fetchUpdatePayload(sec *updateSection) ([]byte, error) {
	if sec.URL == "" {
		return nil, fmt.Errorf("url 为空")
	}
	if !strings.HasPrefix(sec.URL, "https://") {
		return nil, fmt.Errorf("url 需为 https 外链")
	}
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

func sha256Hex(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}

// ==================== 版本比较 ====================

// newerOnly — 段版本不高于 current 时丢弃（检查更新只报新版，不做降级）
func newerOnly(sec *updateSection, current string) *updateSection {
	if sec == nil {
		return nil
	}
	if versionCompare(sec.Version, current) > 0 {
		return sec
	}
	return nil
}

// versionCompare — 语义化版本比较（忽略前缀 v 与非数字后缀），a>b 返回 1
func versionCompare(a, b string) int {
	pa, pb := versionParts(a), versionParts(b)
	for i := 0; i < len(pa) || i < len(pb); i++ {
		var x, y int
		if i < len(pa) {
			x = pa[i]
		}
		if i < len(pb) {
			y = pb[i]
		}
		if x != y {
			if x > y {
				return 1
			}
			return -1
		}
	}
	return 0
}

func versionParts(v string) []int {
	v = strings.TrimPrefix(strings.TrimPrefix(v, "v"), "V")
	if i := strings.IndexAny(v, "-+"); i >= 0 {
		v = v[:i]
	}
	var parts []int
	for _, s := range strings.Split(v, ".") {
		n, err := strconv.Atoi(strings.TrimSpace(s))
		if err != nil {
			break
		}
		parts = append(parts, n)
	}
	return parts
}

// ==================== GitHub Releases 直连 ====================

const defaultReleasesAPI = "https://api.github.com/repos/Roipyon/FileServer/releases/latest"

type ghRelease struct {
	TagName string    `json:"tag_name"`
	Assets  []ghAsset `json:"assets"`
}

type ghAsset struct {
	Name               string `json:"name"`
	BrowserDownloadURL string `json:"browser_download_url"`
}

func releasesAPIURL() string {
	if v := os.Getenv("FS_RELEASES_API"); v != "" {
		return v
	}
	return defaultReleasesAPI
}

// fetchGitHubManifest — 拉取最新 release，按资产命名约定映射为更新清单。
// 约定（与发布打包一致）：FileServer_<版本>_Web.zip / _Android.apk /
// _Windows_x86_64.zip / _Linux_*.tar.gz / _macOS_*.tar.gz，校验值取自 checksums.txt。
func fetchGitHubManifest() (*updateManifest, error) {
	client := &http.Client{Timeout: 6 * time.Second}
	req, err := http.NewRequest("GET", releasesAPIURL(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	var rel ghRelease
	if err := json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(&rel); err != nil {
		return nil, err
	}
	ver := strings.TrimPrefix(rel.TagName, "v")
	if ver == "" || len(rel.Assets) == 0 {
		return nil, fmt.Errorf("release 无资产")
	}

	sums, err := fetchChecksums(client, rel.Assets)
	if err != nil {
		return nil, err
	}
	section := func(name string) *updateSection {
		for _, a := range rel.Assets {
			if a.Name != name {
				continue
			}
			sha := sums[name]
			if sha == "" {
				return nil
			}
			return &updateSection{Version: ver, URL: a.BrowserDownloadURL, SHA256: sha}
		}
		return nil
	}

	m := &updateManifest{
		Web:     section(fmt.Sprintf("FileServer_%s_Web.zip", ver)),
		Android: section(fmt.Sprintf("FileServer_%s_Android.apk", ver)),
		Server:  section(platformServerAssetName(ver)),
	}
	if m.Web == nil && m.Server == nil && m.Android == nil {
		return nil, fmt.Errorf("release 无可识别资产")
	}
	return m, nil
}

// fetchChecksums — 下载并解析 checksums.txt（sha256sum 格式：`hash *文件名`）
func fetchChecksums(client *http.Client, assets []ghAsset) (map[string]string, error) {
	var raw string
	for _, a := range assets {
		if a.Name == "checksums.txt" {
			resp, err := client.Get(a.BrowserDownloadURL)
			if err != nil {
				return nil, err
			}
			data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
			resp.Body.Close()
			if err != nil {
				return nil, err
			}
			if resp.StatusCode != 200 {
				return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
			}
			raw = string(data)
			break
		}
	}
	if raw == "" {
		return nil, fmt.Errorf("release 缺少 checksums.txt")
	}
	sums := map[string]string{}
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if len(line) < 66 {
			continue
		}
		hash, name := strings.ToLower(line[:64]), strings.TrimPrefix(strings.TrimSpace(line[64:]), "*")
		if name != "" {
			sums[name] = hash
		}
	}
	if len(sums) == 0 {
		return nil, fmt.Errorf("checksums.txt 解析为空")
	}
	return sums, nil
}

// platformServerAssetName — 当前平台对应的服务端发布资产名
func platformServerAssetName(ver string) string {
	arch := map[string]string{"amd64": "x86_64", "arm64": "arm64"}[runtime.GOARCH]
	if arch == "" {
		return ""
	}
	switch runtime.GOOS {
	case "windows":
		return fmt.Sprintf("FileServer_%s_Windows_%s.zip", ver, arch)
	case "darwin":
		return fmt.Sprintf("FileServer_%s_macOS_%s.tar.gz", ver, arch)
	case "linux":
		return fmt.Sprintf("FileServer_%s_Linux_%s.tar.gz", ver, arch)
	}
	return ""
}

// extractBinaryFromArchive — 服务端更新包若是 zip / tar.gz（GitHub 发布形态，内含单个
// 二进制），解出该文件；原始二进制（离线 /download/ 直传）原样返回。
func extractBinaryFromArchive(payload []byte) ([]byte, error) {
	switch {
	case len(payload) > 4 && bytes.Equal(payload[:4], []byte("PK\x03\x04")):
		zr, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
		if err != nil {
			return nil, err
		}
		for _, f := range zr.File {
			if f.FileInfo().IsDir() {
				continue
			}
			rc, err := f.Open()
			if err != nil {
				return nil, err
			}
			data, err := io.ReadAll(io.LimitReader(rc, updateMaxPayload+1))
			rc.Close()
			if err != nil {
				return nil, err
			}
			return data, nil
		}
		return nil, fmt.Errorf("压缩包内没有文件")
	case len(payload) > 2 && payload[0] == 0x1f && payload[1] == 0x8b:
		gz, err := gzip.NewReader(bytes.NewReader(payload))
		if err != nil {
			return nil, err
		}
		tr := tar.NewReader(gz)
		for {
			hdr, err := tr.Next()
			if err == io.EOF {
				return nil, fmt.Errorf("tar 内没有文件")
			}
			if err != nil {
				return nil, err
			}
			if hdr.Typeflag == tar.TypeReg {
				data, err := io.ReadAll(io.LimitReader(tr, updateMaxPayload+1))
				if err != nil {
					return nil, err
				}
				return data, nil
			}
		}
	default:
		return payload, nil
	}
}
