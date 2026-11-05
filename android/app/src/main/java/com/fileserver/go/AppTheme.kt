package com.fileserver.go

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.Color

/**
 * 全应用共享色板 — 配色跟随 Web 端主题选择（唯一主题源；未选择时回退系统），
 * 色值取自 Web 端 CSS 变量（暖金主色 / 米白浅色 / 深棕暗色）。
 */
@Composable
fun appColorScheme(): ColorScheme {
    val webTheme by NativeTheme.themeFlow.collectAsState()
    val dark = webTheme?.let { it == "dark" } ?: isSystemInDarkTheme()
    return if (dark) darkColorScheme(
        primary = Color(0xFFC8843C),
        onPrimary = Color(0xFF1A1612),
        background = Color(0xFF1A1612),
        onBackground = Color(0xFFE8E0D5),
        surface = Color(0xFF1A1612),
        onSurface = Color(0xFFE8E0D5),
        surfaceVariant = Color(0xFF2C2420),
        onSurfaceVariant = Color(0xFFB8AC9C),
        outline = Color(0xFF6B5D4D),
    ) else lightColorScheme(
        primary = Color(0xFFC8843C),
        onPrimary = Color(0xFFFFFFF5),
        background = Color(0xFFFAF7F2),
        onBackground = Color(0xFF2C2420),
        surface = Color(0xFFFAF7F2),
        onSurface = Color(0xFF2C2420),
        surfaceVariant = Color(0xFFEFE8DC),
        onSurfaceVariant = Color(0xFF6B5D4D),
        outline = Color(0xFFB8A88F),
    )
}
