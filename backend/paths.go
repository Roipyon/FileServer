// 路径常量与目录引导
package main

import (
	"log"
	"os"
	"path/filepath"
)

var (
	sharedFolder      string
	chunkTempDir      string
	clipboardDir      string
	thumbnailCacheDir string
	incomingDir       string
	zipTempDir        string
)

func initDataDirectories() {
	sharedFolder = resolvePath(config.Root)
	chunkTempDir = filepath.Join(BASE_DIR, "temp-chunks")
	clipboardDir = filepath.Join(sharedFolder, ".clipboard")
	thumbnailCacheDir = filepath.Join(BASE_DIR, "temp-thumbnails")
	incomingDir = filepath.Join(sharedFolder, "incoming")
	zipTempDir = filepath.Join(BASE_DIR, "temp-zip")

	for _, d := range []string{sharedFolder, chunkTempDir, clipboardDir, thumbnailCacheDir, incomingDir, zipTempDir} {
		if err := os.MkdirAll(d, 0755); err != nil {
			log.Printf("[Error] 创建目录失败 %s: %v", d, err)
		}
	}
}

func resolvePath(p string) string {
	if filepath.IsAbs(p) {
		return p
	}
	return filepath.Join(BASE_DIR, p)
}

// cleanDirectory — 清空目录内文件
func cleanDirectory(dir string, logMsg string) int {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return 0
	}
	count := 0
	for _, e := range entries {
		if err := os.RemoveAll(filepath.Join(dir, e.Name())); err == nil {
			count++
		}
	}
	if count > 0 && logMsg != "" {
		log.Printf("[Info] %s: %d 个文件", logMsg, count)
	}
	return count
}
