// 配置管理 — 优先级：环境变量 > config.json > 默认值
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type Config struct {
	Port           int    `json:"port"`
	Root           string `json:"root"`
	CacheTTL       int    `json:"cacheTTL"`
	PublicURL      string `json:"publicUrl"`
	LogAccess      bool   `json:"logAccess"`
	RateLimit      int    `json:"rateLimit"`
	RateLimitWindow int64 `json:"rateLimitWindow"`
	MaxUploadSize  int64  `json:"maxUploadSize"`

	isDocker bool
}

var config = Config{
	Port:           3000,
	Root:           "./shared-files",
	CacheTTL:       5,
	PublicURL:      "",
	LogAccess:      false,
	RateLimit:      5000,
	RateLimitWindow: 60000,
	MaxUploadSize:  10 * 1024 * 1024 * 1024,
}

// BASE_DIR — 可写数据锚点：FILESERVER_HOME 环境变量 > exe 所在目录（Go 版无开发态/打包态之分）
var BASE_DIR = func() string {
	if h := os.Getenv("FILESERVER_HOME"); h != "" {
		return h
	}
	if exe, err := os.Executable(); err == nil {
		return filepath.Dir(exe)
	}
	return "."
}()

// FFMPEG_BIN — FFMPEG_PATH 环境变量 > PATH 探测
var FFMPEG_BIN = func() string {
	if p := os.Getenv("FFMPEG_PATH"); p != "" {
		return p
	}
	return "ffmpeg"
}()

func loadConfig() {
	configPath := filepath.Join(BASE_DIR, "config.json")
	if data, err := os.ReadFile(configPath); err == nil {
		if err := json.Unmarshal(data, &config); err != nil {
			fmt.Printf("[Config] config.json 加载失败，使用默认值: %v\n", err)
		} else {
			fmt.Printf("[Config] 已加载 config.json (%s)\n", configPath)
		}
	} else {
		// 首次运行自动生成默认配置（FILESERVER_HOME 指向新目录时先确保存在）
		os.MkdirAll(BASE_DIR, 0755)
		out, _ := json.MarshalIndent(config, "", "  ")
		if err := os.WriteFile(configPath, append(out, '\n'), 0644); err == nil {
			fmt.Printf("[Config] 已生成默认配置文件 (%s)\n", configPath)
		} else {
			fmt.Printf("[Config] 配置文件生成失败（将仅使用默认值）: %v\n", err)
		}
	}

	if p := os.Getenv("PORT"); p != "" {
		fmt.Sscanf(p, "%d", &config.Port)
	}
	if p := os.Getenv("STORAGE_PATH"); p != "" {
		config.Root = p
	}
	if p := os.Getenv("PUBLIC_URL"); p != "" {
		config.PublicURL = p
	}
	if p, ok := os.LookupEnv("LOG_ACCESS"); ok {
		config.LogAccess = p == "true" || p == "1"
	}
	if p := os.Getenv("CACHE_TTL"); p != "" {
		fmt.Sscanf(p, "%d", &config.CacheTTL)
	}

	config.isDocker = detectDocker()
	if config.isDocker {
		config.LogAccess = false
		fmt.Println("[Config] 检测到容器环境，已调整默认配置")
	}
}

func detectDocker() bool {
	if _, err := os.Stat("/.dockerenv"); err == nil {
		return true
	}
	if data, err := os.ReadFile("/proc/self/cgroup"); err == nil {
		return strings.Contains(string(data), "docker")
	}
	return false
}

func getConfig() Config { return config }

// updateConfig — 仅允许 publicUrl / logAccess，运行时生效不持久化
func updateConfig(overrides map[string]any) {
	if v, ok := overrides["publicUrl"]; ok {
		if s, ok := v.(string); ok {
			config.PublicURL = s
		}
	}
	if v, ok := overrides["logAccess"]; ok {
		if b, ok := v.(bool); ok {
			config.LogAccess = b
		}
	}
}
