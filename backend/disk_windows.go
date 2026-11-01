//go:build windows

// 磁盘空间 — Windows 实现
package main

import (
	"golang.org/x/sys/windows"
)

// 返回 (freeBytes, totalBytes, error)
func diskUsage(path string) (int64, int64, error) {
	var freeAvail, total, totalFree uint64
	err := windows.GetDiskFreeSpaceEx(
		windows.StringToUTF16Ptr(path),
		&freeAvail, &total, &totalFree,
	)
	if err != nil {
		return 0, 0, err
	}
	return int64(totalFree), int64(total), nil
}
