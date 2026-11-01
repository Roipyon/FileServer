//go:build !windows

// 磁盘空间 — Unix 实现
package main

import (
	"syscall"
)

func diskUsage(path string) (int64, int64, error) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return 0, 0, err
	}
	free := int64(st.Bfree) * int64(st.Bsize)
	total := int64(st.Blocks) * int64(st.Bsize)
	return free, total, nil
}
