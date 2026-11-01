package com.fileserver.go

import android.app.Activity
import android.os.Bundle
import android.view.View
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * 全屏 WebView 界面 — 纯 View 层级（不经 Compose AndroidView 互操作），
 * 与独立浏览器同构的窗口环境，规避嵌入布局下的渲染状态问题。
 */
class BrowserActivity : Activity() {

    private lateinit var webView: WebView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = android.widget.LinearLayout(this).apply {
            orientation = android.widget.LinearLayout.VERTICAL
            fitsSystemWindows = true
        }
        webView = WebView(this).apply {
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.useWideViewPort = true
            settings.loadWithOverviewMode = true
            android.webkit.WebView.setWebContentsDebuggingEnabled(true)
            webViewClient = object : WebViewClient() {
                override fun onPageFinished(view: WebView, url: String) {
                    // 注入主题监听：网页切深浅色 → 原生控制台与下次开屏跟随
                    view.evaluateJavascript(NativeTheme.INJECT_JS, null)
                }
            }
            addJavascriptInterface(NativeTheme.Bridge(this@BrowserActivity), "FileServerNative")
            layoutParams = android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
            )
        }
        root.addView(webView)
        setContentView(root)
        webView.loadUrl("http://127.0.0.1:${FileServerManager.actualPort}/")
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        webView.apply {
            loadUrl("about:blank")
            clearHistory()
            (parent as? android.view.ViewGroup)?.removeView(this)
            destroy()
        }
        super.onDestroy()
    }
}
