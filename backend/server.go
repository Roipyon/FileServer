// HTTP 入口 — 路由分发、静态资源、系统端点
package main

import (
	"embed"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync/atomic"
	"time"
)

//go:embed all:dist
var distFS embed.FS

var actualPort atomic.Int64

var startedAt = time.Now()

// ==================== 本机 IP====================

var excludeNicKeywords = []string{
	"vethernet", "docker", "virtualbox", "vmware", "hyper-v", "wsl",
	"bluetooth", "tailscale", "zerotier", "virtual", "pseudo", "npcap", "loopback",
	"ppp", "adapter", "vmxnet", "cisco", "anyconnect", "teredo", "radmin",
}

var preferredPrefixes = []string{
	"10.", "192.168.", "172.16.", "172.17.", "172.18.", "172.19.",
	"172.20.", "172.21.", "172.22.", "172.23.", "172.24.", "172.25.",
	"172.26.", "172.27.", "172.28.", "172.29.", "172.30.", "172.31.",
}

// getLocalIPs 合并全部来源（单链回退在"热点无外网路由"等场景会全链失败）：
// 1. FS_LOCAL_IPS 环境变量（安卓端由壳进程枚举注入，覆盖热点接口 swlan0/ap0 等）
// 2. netlink 枚举 / UDP 路由探测（不发包）/ /proc 兜底
// 3. 仍为空时回退 hostname 解析
func getLocalIPs() []string {
	ips := getIPsFromEnv()
	ips = append(ips, getLocalIPsNetlink()...)
	ips = append(ips, getLocalIPsUDPDial()...)
	ips = append(ips, getLocalIPsProc()...)
	if len(ips) == 0 {
		if host, err := os.Hostname(); err == nil {
			if addrs, err := net.LookupHost(host); err == nil {
				for _, a := range addrs {
					ip := net.ParseIP(a)
					if ip != nil && ip.To4() != nil && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() {
						ips = append(ips, ip.String())
					}
				}
			}
		}
	}
	return dedupeAndSortIPs(ips)
}

// getIPsFromEnv — FS_LOCAL_IPS 环境变量（安卓端注入，逗号分隔 IPv4 列表）
func getIPsFromEnv() []string {
	raw := strings.TrimSpace(os.Getenv("FS_LOCAL_IPS"))
	if raw == "" {
		return nil
	}
	out := []string{}
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		ip := net.ParseIP(part)
		if ip != nil && ip.To4() != nil && !ip.IsLoopback() && !ip.IsLinkLocalUnicast() {
			out = append(out, ip.String())
		}
	}
	return out
}

// getLocalIPsUDPDial — 对公网地址发起 UDP connect（仅内核路由查询，不发包），
// 从 LocalAddr 读默认路由出口 IP。App 域可用，是安卓上最可靠的回退。
func getLocalIPsUDPDial() []string {
	conn, err := net.Dial("udp4", "8.8.8.8:80")
	if err != nil {
		return nil
	}
	defer conn.Close()
	if udp, ok := conn.LocalAddr().(*net.UDPAddr); ok && udp.IP != nil &&
		!udp.IP.IsLoopback() && udp.IP.To4() != nil {
		return []string{udp.IP.String()}
	}
	return nil
}

func getLocalIPsNetlink() []string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return nil
	}
	ips := []string{}
	for _, iface := range ifaces {
		name := strings.ToLower(iface.Name)
		excluded := false
		for _, k := range excludeNicKeywords {
			if strings.Contains(name, k) {
				excluded = true
				break
			}
		}
		if excluded {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			ipnet, ok := addr.(*net.IPNet)
			if !ok {
				continue
			}
			ip4 := ipnet.IP.To4()
			if ip4 == nil || ip4.IsLoopback() || ip4.IsLinkLocalUnicast() {
				continue
			}
			ips = append(ips, ip4.String())
		}
	}
	return dedupeAndSortIPs(ips)
}

// getLocalIPsProc — 从 /proc/net/fib_trie 提取本机 IPv4（形如 |--10.0.2.15 紧跟 /32 host LOCAL）
func getLocalIPsProc() []string {
	data, err := os.ReadFile("/proc/net/fib_trie")
	if err != nil {
		return nil
	}
	ips := []string{}
	lines := strings.Split(string(data), "\n")
	for i := 1; i < len(lines); i++ {
		if strings.Contains(lines[i], "32 host LOCAL") {
			prev := strings.TrimSpace(lines[i-1])
			prev = strings.TrimPrefix(prev, "|--")
			prev = strings.TrimSpace(prev)
			ip := net.ParseIP(prev)
			if ip == nil || ip.To4() == nil {
				continue
			}
			if ip.IsLoopback() || ip.IsLinkLocalUnicast() {
				continue
			}
			ips = append(ips, ip.To4().String())
		}
	}
	return dedupeAndSortIPs(ips)
}

func dedupeAndSortIPs(ips []string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, ip := range ips {
		if !seen[ip] {
			seen[ip] = true
			out = append(out, ip)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		aPref, bPref := 1, 1
		aP := strings.Join(strings.SplitN(out[i], ".", 3)[:2], ".")
		bP := strings.Join(strings.SplitN(out[j], ".", 3)[:2], ".")
		for _, p := range preferredPrefixes {
			if strings.HasPrefix(aP, p) {
				aPref = 0
			}
			if strings.HasPrefix(bP, p) {
				bPref = 0
			}
		}
		return aPref < bPref
	})
	return out
}

// ==================== 系统端点 ====================

func serveDiskStatus(w http.ResponseWriter, r *http.Request) {
	free, total, err := diskUsage(sharedFolder)
	if err != nil {
		sendJSON(w, 200, map[string]any{"error": "无法获取磁盘信息", "detail": err.Error()})
		return
	}
	used := total - free
	var usedPercent int
	if total > 0 {
		usedPercent = int(float64(used)/float64(total)*100 + 0.5)
	}
	sendJSON(w, 200, map[string]any{
		"free": formatFileSize(free), "total": formatFileSize(total),
		"freeBytes": free, "totalBytes": total, "usedPercent": usedPercent,
	})
}

func serveServerInfo(w http.ResponseWriter, r *http.Request) {
	cfg := getConfig()
	port := actualPort.Load()
	if port == 0 {
		port = int64(cfg.Port)
	}
	ips := getLocalIPs()
	urls := make([]string, 0, len(ips))
	for _, ip := range ips {
		urls = append(urls, fmt.Sprintf("http://%s:%d", ip, port))
	}
	publicUrl := any(nil)
	if cfg.PublicURL != "" {
		publicUrl = cfg.PublicURL
	}
	sendJSON(w, 200, map[string]any{
		"urls": urls, "publicUrl": publicUrl, "port": port,
		"uptime":       time.Since(startedAt).Seconds(),
		"version":      appVersion,
		"webOverride":  webDistActive(),
		"clientIsLAN":  clientIsLAN(r),
	})
}

// ==================== 连接来源判定 ====================

// 本机网卡子网（启动时枚举一次）：客户端来源 IP 落在其中即内网
var localSubnets = func() []*net.IPNet {
	var out []*net.IPNet
	ifaces, err := net.Interfaces()
	if err != nil {
		return out
	}
	for _, iface := range ifaces {
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, a := range addrs {
			if ipnet, ok := a.(*net.IPNet); ok {
				out = append(out, ipnet)
			}
		}
	}
	return out
}()

// clientIsLAN — 事实判定：客户端来源 IP 是否属于内网。
// 环回 / 本机网卡子网 / 私有段（RFC1918、ULA）/ 链路本地 / CGNAT（虚拟网卡常见）→ 内网；
// 其余（公网边缘 IP、代理出口）→ 外网。前端据此外网走分片与进度面板，内网走直传。
func clientIsLAN(r *http.Request) bool {
	host := r.RemoteAddr
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	ip := net.ParseIP(strings.TrimSpace(host))
	if ip == nil {
		return false
	}
	if ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() {
		return true
	}
	if v4 := ip.To4(); v4 != nil {
		// CGNAT 100.64.0.0/10：Tailscale 等虚拟网段，速度接近内网
		if v4[0] == 100 && v4[1] >= 64 && v4[1] < 128 {
			return true
		}
	}
	for _, n := range localSubnets {
		if n.Contains(ip) {
			return true
		}
	}
	return false
}

// ==================== 静态资源（web-dist 磁盘层优先，go:embed 兜底）====================

func serveStatic(w http.ResponseWriter, r *http.Request, pathname string) {
	var name string
	if pathname == "/" {
		name = "dist/index.html"
	} else {
		name = "dist" + path.Clean("/"+pathname)
	}
	rel := strings.TrimPrefix(name, "dist/")

	// 方案 B 磁盘热更新层：BASE_DIR/web-dist 存在同名文件则优先。
	// 按请求 stat，换装即生效、无需重启；Clean 已把 .. 收敛到根，但磁盘是真实文件系统，
	// 这里额外拒绝分隔符变体与盘符，防借道磁盘层穿越。
	if isStaticRelSafe(rel) {
		if data, err := os.ReadFile(filepath.Join(webDistDir(), rel)); err == nil {
			writeStatic(w, rel, data)
			return
		}
	}

	data, err := distFS.ReadFile(name)
	if err != nil {
		if os.IsNotExist(err) || strings.Contains(err.Error(), "invalid") || strings.Contains(err.Error(), "not exist") {
			w.Header().Set("Content-Type", "text/plain")
			w.WriteHeader(404)
			w.Write([]byte("文件未找到"))
			return
		}
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(500)
		w.Write([]byte("服务器错误"))
		return
	}
	writeStatic(w, rel, data)
}

func isStaticRelSafe(rel string) bool {
	return rel != "" && !strings.Contains(rel, "..") &&
		!strings.ContainsAny(rel, "\\:")
}

// writeStatic — 内容类型 + 缓存策略：vite 哈希资产长缓存 immutable，
// 入口页与未哈希资源 no-cache（保证前端热更新刷新即生效）
func writeStatic(w http.ResponseWriter, rel string, data []byte) {
	ext := strings.ToLower(filepath.Ext(rel))
	contentType := mimeTypes[ext]
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	w.Header().Set("Content-Type", contentType)
	if strings.HasPrefix(rel, "assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
	w.WriteHeader(200)
	w.Write(data)
}

// ==================== 路由分发 ====================

func createHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec := &statusRecorder{ResponseWriter: w, status: 0}
		w = rec

		// CORS
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "*")

		if r.Method == http.MethodOptions {
			w.WriteHeader(204)
			return
		}

		if !rateLimitMiddleware(r) {
			write429(w)
			return
		}

		pathname := r.URL.Path
		start := time.Now()

		switch {
		case pathname == "/":
			serveStatic(w, r, "/")
		case pathname == "/api/files":
			handleFileList(w, r)
		case strings.HasPrefix(pathname, "/download/"):
			handleDownload(w, r, pathname)
		case pathname == "/api/upload":
			handleUpload(w, r)
		case pathname == "/api/upload-chunk":
			handleUploadChunk(w, r)
		case pathname == "/api/merge-chunks":
			handleMergeChunks(w, r)
		case strings.HasPrefix(pathname, "/api/delete/"):
			handleDelete(w, r, pathname)
		case strings.HasPrefix(pathname, "/api/raw/"):
			handleRawFile(w, r, pathname)
		case strings.HasPrefix(pathname, "/api/files/") && r.Method == http.MethodPut:
			handleSaveContent(w, r, pathname)
		case strings.HasPrefix(pathname, "/api/files/") && r.Method == http.MethodPatch:
			handleRename(w, r, pathname)
		case pathname == "/api/clipboard" && r.Method == http.MethodGet:
			handleGetClipboard(w, r)
		case pathname == "/api/clipboard/send":
			handleSendClipboard(w, r)
		case pathname == "/api/clipboard" && r.Method == http.MethodDelete:
			handleClearClipboard(w, r)
		case strings.HasPrefix(pathname, "/api/clipboard/"):
			handleDeleteClipItem(w, r, pathname)
		case pathname == "/api/share/generate":
			handleGenerateShare(w, r)
		case strings.HasPrefix(pathname, "/api/share/"):
			handleShareDownload(w, r, pathname)
		case pathname == "/api/upload-token/generate":
			handleGenerateUploadToken(w, r)
		case pathname == "/api/upload-token" || pathname == "/api/upload-with-token":
			handleTokenUpload(w, r)
		case pathname == "/api/download-zip":
			handleDownloadZip(w, r)
		case strings.HasPrefix(pathname, "/api/zip-progress/"):
			handleZipProgress(w, strings.Replace(pathname, "/api/zip-progress/", "", 1))
		case strings.HasPrefix(pathname, "/api/zip-download/"):
			handleZipDownload(w, strings.Replace(pathname, "/api/zip-download/", "", 1))
		case strings.HasPrefix(pathname, "/api/zip-cancel/"):
			handleZipCancel(w, r, strings.Replace(pathname, "/api/zip-cancel/", "", 1))
		case strings.HasPrefix(pathname, "/api/thumbnail/"):
			handleThumbnail(w, r, pathname)
		case pathname == "/api/disk-status":
			serveDiskStatus(w, r)
		case pathname == "/api/update/manifest" && r.Method == http.MethodGet:
			handleUpdateManifest(w, r)
		case pathname == "/api/update/apply/web" && r.Method == http.MethodPost:
			handleApplyWebUpdate(w, r)
		case pathname == "/api/update/apply/server" && r.Method == http.MethodPost:
			handleApplyServerUpdate(w, r)
		case pathname == "/api/update/rollback/web" && r.Method == http.MethodPost:
			handleRollbackWebUpdate(w, r)
		case pathname == "/api/server-info":
			serveServerInfo(w, r)
		case pathname == "/api/config" && r.Method == http.MethodGet:
			cfg := getConfig()
			sendJSON(w, 200, map[string]any{"publicUrl": cfg.PublicURL, "logAccess": cfg.LogAccess})
		case pathname == "/api/config" && r.Method == http.MethodPatch:
			body, err := parseJSONBody(r, 10*1024*1024)
			if err != nil {
				sendError(w, 400, "配置格式错误")
				return
			}
			updateConfig(body)
			sendJSON(w, 200, map[string]any{"success": true})
		default:
			serveStatic(w, r, pathname)
		}

		if os.Getenv("FS_DEBUG_HEADERS") == "1" {
			log.Printf("[DBG] %s %s range=%q status=%d", r.Method, pathname, r.Header.Get("Range"), rec.status)
		}
		if getConfig().LogAccess {
			log.Printf("[Access] %s %s %d %v %s", r.Method, pathname, rec.status, time.Since(start), remoteIP(r))
		}
	})
}

// statusRecorder — 记录响应状态码
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (sr *statusRecorder) WriteHeader(code int) {
	sr.status = code
	sr.ResponseWriter.WriteHeader(code)
}

func (sr *statusRecorder) Write(b []byte) (int, error) {
	if sr.status == 0 {
		sr.status = 200
	}
	return sr.ResponseWriter.Write(b)
}
