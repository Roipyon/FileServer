// FileServer 启动入口：端口自动降级、目录引导、终端 QR、优雅退出
package main

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/skip2/go-qrcode"
)

// appVersion 由构建脚本通过 -ldflags -X 注入；此处默认值需与发布版本一致
var appVersion = "2.1.1"

func main() {
	startedAt = time.Now()
	loadConfig()
	initDataDirectories()

	// 启动时清理临时目录
	cleanDirectory(chunkTempDir, "清理残留分片")
	cleanDirectory(thumbnailCacheDir, "已清理缩略图缓存")

	// 共享目录不存在时才创建并播种示例文件（目录已由 initDataDirectories 建好）
	if _, err := os.Stat(sharedFolder); os.IsNotExist(err) {
		os.MkdirAll(sharedFolder, 0755)
		seedTestFiles()
	}
	probeFFmpeg()

	// 限流清理协程
	go rateLimitJanitor()

	port := getConfig().Port
	ln := listenWithFallback(port, 10)
	if ln == nil {
		fmt.Printf("[Fatal] 端口 %d 及其后 10 个端口均被占用\n", port)
		os.Exit(1)
	}
	actualPort.Store(int64(ln.Addr().(*net.TCPAddr).Port))

	srv := &http.Server{Handler: createHandler()}
	go srv.Serve(ln)

	printAccessInfo(actualPort.Load())
	openBrowserIfConfigured(actualPort.Load())

	// 优雅退出
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	<-sig
	fmt.Println("\n[Info] 收到退出信号，正在关闭...")
	shareMu.Lock()
	shareTokens = map[string]*shareEntry{}
	uploadTokens = map[string]*uploadTokenEntry{}
	shareMu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
	os.Exit(0)
}

// listenWithFallback — 双栈监听，EADDRINUSE 时 port+1 重试
func listenWithFallback(port, maxRetries int) net.Listener {
	for i := 0; i <= maxRetries; i++ {
		p := port + i
		ln, err := net.Listen("tcp", fmt.Sprintf(":%d", p)) // "tcp" 默认双栈 ::+0.0.0.0
		if err == nil {
			return ln
		}
		fmt.Printf("[Warn] 端口 %d 被占用，尝试 %d\n", p, p+1)
	}
	return nil
}

func seedTestFiles() {
	tests := []struct{ name, content string }{
		{"测试文档.txt", "这是一个测试文档。"},
		{"使用说明.md", "# 文件共享系统使用说明\n\n欢迎使用 FileServer"},
	}
	for _, t := range tests {
		p := filepath.Join(sharedFolder, t.name)
		if _, err := os.Stat(p); os.IsNotExist(err) {
			os.WriteFile(p, []byte(t.content), 0644)
			logDebug(fmt.Sprintf("创建测试文件: %s", t.name))
		}
	}
}

func probeFFmpeg() {
	cmd := exec.Command(FFMPEG_BIN, "-version")
	if err := cmd.Run(); err == nil {
		fmt.Println("[Info] 检测到 FFmpeg，视频缩略图已启用")
	} else {
		fmt.Println("[Info] 未检测到 FFmpeg，视频缩略图不可用（其余功能不受影响）")
	}
}

func printAccessInfo(port int64) {
	cfg := getConfig()
	target := cfg.PublicURL
	if target == "" {
		if ips := getLocalIPs(); len(ips) > 0 {
			target = fmt.Sprintf("http://%s:%d", ips[0], port)
		} else {
			target = fmt.Sprintf("http://localhost:%d", port)
		}
	}

	fmt.Println("============================================")
	fmt.Printf("  FileServer v%s — 局域网文件传输服务\n", appVersion)
	fmt.Println("============================================")
	fmt.Printf("[Info] 服务端口: %d\n", port)
	fmt.Printf("[Info] 共享目录: %s\n", sharedFolder)
	if ips := getLocalIPs(); len(ips) > 0 {
		fmt.Println("[Info] 局域网访问地址:")
		for _, ip := range ips {
			fmt.Printf("         http://%s:%d\n", ip, port)
		}
	}
	fmt.Printf("[Info] 主入口: %s\n", target)

	// 终端二维码
	q, err := qrcode.New(target, qrcode.Low)
	if err == nil {
		fmt.Println(q.ToSmallString(false))
	}
}

func openBrowserIfConfigured(port int64) {
	if os.Getenv("NO_OPEN") != "" {
		return
	}
	url := fmt.Sprintf("http://localhost:%d", port)
	var cmd *exec.Cmd
	switch {
	case isWindows():
		cmd = exec.Command("cmd", "/c", "start", "", url)
	case isDarwin():
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	if err := cmd.Start(); err != nil {
		logDebug("自动打开浏览器失败: " + err.Error())
	} else {
		cmd.Process.Release()
		logDebug("已自动打开浏览器: " + url)
	}
}

func isWindows() bool { return os.PathSeparator == '\\' && os.Getenv("OS") == "Windows_NT" }
func isDarwin() bool {
	out, err := exec.Command("uname").Output()
	return err == nil && string(out) == "Darwin\n"
}
