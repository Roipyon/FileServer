package com.fileserver.go

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.MediaStore
import android.provider.Settings
import android.view.View
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.content.FileProvider
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * 全屏 WebView 界面 — 纯 View 层级（不经 Compose AndroidView 互操作），
 * 与独立浏览器同构的窗口环境，规避嵌入布局下的渲染状态问题。
 *
 * 文件选择：实现 onShowFileChooser（相册/任意文件走系统选择器，
 * capture 拍照走系统相机 + FileProvider 落盘），网页内 <input type="file"> 全部可用。
 * 外链跳转：非本机地址（连接面板中的 IP 链接等）交由外部浏览器打开。
 * 下载：APK 走整包自更新（下载 → FileProvider → 系统安装器），其余文件交系统下载管理器。
 */
class BrowserActivity : Activity() {

    companion object {
        private const val REQ_FILE_CHOOSER = 1001
        private const val APK_MIME = "application/vnd.android.package-archive"
    }

    private lateinit var webView: WebView
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var pendingCameraUri: Uri? = null

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
            settings.allowFileAccess = false
            android.webkit.WebView.setWebContentsDebuggingEnabled(true)
            webViewClient = object : WebViewClient() {
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                    return handleExternalUrl(request.url)
                }

                @Deprecated("Deprecated in Java")
                override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean {
                    return handleExternalUrl(Uri.parse(url))
                }

                override fun onPageFinished(view: WebView, url: String) {
                    // 注入主题监听：网页切深浅色 → 原生控制台与下次开屏跟随
                    view.evaluateJavascript(NativeTheme.INJECT_JS, null)
                }
            }
            webChromeClient = object : WebChromeClient() {
                override fun onShowFileChooser(
                    view: WebView,
                    callback: ValueCallback<Array<Uri>>,
                    params: FileChooserParams,
                ): Boolean {
                    if (filePathCallback != null) {
                        // 上一次会话未结束，先作废
                        filePathCallback?.onReceiveValue(null)
                    }
                    filePathCallback = callback
                    return launchFileChooser(params)
                }
            }
            addJavascriptInterface(NativeTheme.Bridge(this@BrowserActivity), "FileServerNative")
            setDownloadListener { url, _, contentDisposition, mimetype, _ ->
                val looksLikeApk = url.substringBefore('?').endsWith(".apk", true) ||
                    mimetype == APK_MIME ||
                    contentDisposition?.substringBefore('?')?.endsWith(".apk", true) == true
                if (looksLikeApk) {
                    // 整包自更新（方案 A）：壳内下载后触发系统安装器
                    toast("开始下载更新…")
                    Thread { downloadAndInstallApk(url) }.start()
                } else {
                    // 普通文件下载交系统下载管理器（通知栏可见）
                    val req = android.app.DownloadManager.Request(Uri.parse(url))
                        .setNotificationVisibility(android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    (getSystemService(DOWNLOAD_SERVICE) as android.app.DownloadManager).enqueue(req)
                    toast("已交给系统下载")
                }
            }
            layoutParams = android.widget.LinearLayout.LayoutParams(
                android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
                android.widget.LinearLayout.LayoutParams.MATCH_PARENT,
            )
        }
        root.addView(webView)
        setContentView(root)
        webView.loadUrl("http://127.0.0.1:${FileServerManager.actualPort}/")
    }

    // ==================== 文件选择 ====================

    private fun launchFileChooser(params: WebChromeClient.FileChooserParams): Boolean {
        val acceptTypes = params.acceptTypes?.filter { it.isNotBlank() } ?: emptyList()
        val isImageOnly = acceptTypes.isNotEmpty() && acceptTypes.all { it.startsWith("image") }

        // 拍照（capture 属性）→ 系统相机，照片经 FileProvider 落盘回传
        if (params.isCaptureEnabled && isImageOnly) {
            val cameraDir = File(cacheDir, "camera").apply { mkdirs() }
            val photoFile = File(cameraDir, "capture_${System.currentTimeMillis()}.jpg")
            val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", photoFile)
            val cameraIntent = Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
                putExtra(MediaStore.EXTRA_OUTPUT, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            }
            if (cameraIntent.resolveActivity(packageManager) != null) {
                pendingCameraUri = uri
                startActivityForResult(cameraIntent, REQ_FILE_CHOOSER)
                return true
            }
            // 无可用相机应用 → 回退到通用选择器
        }

        val intent = params.createIntent().apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            if (acceptTypes.size > 1) {
                putExtra(Intent.EXTRA_MIME_TYPES, acceptTypes.toTypedArray())
            }
            // createIntent 按 mode 设置过，部分厂商文件管理器依赖显式值，这里再兜底一次
            putExtra(
                Intent.EXTRA_ALLOW_MULTIPLE,
                params.mode == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE,
            )
        }
        return try {
            startActivityForResult(
                Intent.createChooser(intent, "选择文件"),
                REQ_FILE_CHOOSER,
            )
            true
        } catch (e: Exception) {
            filePathCallback = null
            false
        }
    }

    /**
     * 解析选择器结果：多选经 Intent.clipData 回传（单选在 data）。
     * WebView 自带的 parseResult 在部分版本上不解析 ClipData，
     * 会导致批量选择返回后无任何文件回传（网页不触发上传）。
     */
    private fun parseChooserUris(data: Intent?): Array<Uri>? {
        if (data == null) return null
        data.clipData?.let { clip ->
            val uris = (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri }
            if (uris.isNotEmpty()) return uris.toTypedArray()
        }
        return WebChromeClient.FileChooserParams.parseResult(RESULT_OK, data)
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == REQ_FILE_CHOOSER) {
            val callback = filePathCallback
            filePathCallback = null
            var uris: Array<Uri>? = null
            if (resultCode == RESULT_OK) {
                uris = pendingCameraUri?.let { arrayOf(it) }
                    ?: parseChooserUris(data)
            }
            pendingCameraUri = null
            callback?.onReceiveValue(uris ?: arrayOf())
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    // ==================== 整包自更新（方案 A）====================

    /** 后台线程内调用：下载 APK → 校验安装权限 → FileProvider + 系统安装器 */
    private fun downloadAndInstallApk(url: String) {
        try {
            val dir = File(cacheDir, "updates").apply { mkdirs() }
            // 清掉历史安装包，避免缓存堆积
            dir.listFiles()?.forEach { it.delete() }
            val file = File(dir, "update_${System.currentTimeMillis()}.apk")
            val conn = URL(url).openConnection() as HttpURLConnection
            conn.connectTimeout = 10_000
            conn.readTimeout = 60_000
            conn.instanceFollowRedirects = true
            conn.inputStream.use { input ->
                file.outputStream().use { output -> input.copyTo(output) }
            }
            runOnUiThread {
                if (Build.VERSION.SDK_INT >= 26 && !packageManager.canRequestPackageInstalls()) {
                    toast("已下载，请先允许「安装未知应用」后重试")
                    startActivity(
                        Intent(
                            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                            Uri.parse("package:$packageName"),
                        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                    )
                    return@runOnUiThread
                }
                toast("下载完成，正在打开安装器…")
                val uri = FileProvider.getUriForFile(this, "$packageName.fileprovider", file)
                startActivity(
                    Intent(Intent.ACTION_VIEW).apply {
                        setDataAndType(uri, APK_MIME)
                        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
                    },
                )
            }
        } catch (e: Exception) {
            runOnUiThread { toast("下载失败: ${e.message ?: e.javaClass.simpleName}") }
        }
    }

    private fun toast(msg: String) {
        android.widget.Toast.makeText(this, msg, android.widget.Toast.LENGTH_SHORT).show()
    }

    // ==================== 外链跳转 ====================

    private fun handleExternalUrl(uri: Uri): Boolean {
        val host = uri.host ?: return false
        // 本机服务页面留在 WebView；连接面板里的 IP 链接等交给外部浏览器
        if (host == "127.0.0.1" || host == "localhost") return false
        return try {
            startActivity(
                Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            true
        } catch (e: Exception) {
            false
        }
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        filePathCallback?.onReceiveValue(null)
        filePathCallback = null
        webView.apply {
            loadUrl("about:blank")
            clearHistory()
            (parent as? android.view.ViewGroup)?.removeView(this)
            destroy()
        }
        super.onDestroy()
    }
}
