package com.fileserver.go

import android.app.UiModeManager
import android.content.Context
import android.os.Build
import android.webkit.JavascriptInterface
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * 主题同步：Web 界面的深浅色切换（<html data-theme>）作为全局唯一主题源。
 *
 * 机制：WebView 注入轮询脚本 → JS 桥回传 → UiModeManager.setApplicationNightMode
 * （API 31+ per-app 夜间模式，系统级持久化）→ 控制台重组跟随 + 冷启动开屏的
 * values/values-night 资源解析同样按此模式取色。
 *
 * 注意：不要用 MODE_NIGHT_AUTO——per-app 通道里它走"日出日落"时间调度而非
 * "跟随系统手动设置"，会在全局深色时把 App 置为浅色。
 * 主题源 = Web 最后选择（二态）；从未选择时跟随系统。
 */
object NativeTheme {

    private const val PREF = "web-theme"
    private const val KEY = "mode"

    /** 当前生效主题（Web 最后选择；null = 从未选择，跟随系统） */
    val themeFlow = MutableStateFlow<String?>(null)

    /** MainActivity 冷启动时调用：读入已持久化的选择 */
    fun init(context: Context) {
        themeFlow.value = stored(context)
    }

    /** 持久化 + 应用（BrowserActivity 的 JS 桥入口） */
    fun apply(context: Context, mode: String) {
        context.getSharedPreferences(PREF, Context.MODE_PRIVATE)
            .edit().putString(KEY, mode).apply()
        themeFlow.value = mode
        applySystem(context, mode)
    }

    /** 仅应用已持久化的选择（MainActivity 冷启动时调用） */
    fun applyStored(context: Context) {
        stored(context)?.let {
            themeFlow.value = it
            applySystem(context, it)
        }
    }

    private fun applySystem(context: Context, mode: String) {
        if (Build.VERSION.SDK_INT < 31) return
        val um = context.getSystemService(UiModeManager::class.java) ?: return
        val target = when (mode) {
            "light" -> UiModeManager.MODE_NIGHT_NO
            "dark" -> UiModeManager.MODE_NIGHT_YES
            else -> return
        }
        um.setApplicationNightMode(target)
    }

    private fun stored(context: Context): String? =
        context.getSharedPreferences(PREF, Context.MODE_PRIVATE).getString(KEY, null)

    /** 注入 WebView 的主题监听脚本：轮询 data-theme，变化即回调原生桥 */
    const val INJECT_JS: String = """
        (function(){
          if (window.__fsThemeHook) return;
          window.__fsThemeHook = true;
          var last = null;
          var send = function(){
            var t = document.documentElement.getAttribute('data-theme');
            if (t && t !== last) { last = t; try { FileServerNative.onTheme(t); } catch (e) {} }
          };
          setInterval(send, 300);
          send();
        })()
    """

    /** JS 桥：网页通过 FileServerNative.onTheme('dark'|'light') 上报主题 */
    class Bridge(private val context: Context) {
        @JavascriptInterface
        fun onTheme(mode: String) {
            apply(context.applicationContext, mode)
        }
    }
}
