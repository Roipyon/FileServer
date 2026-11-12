package com.fileserver.go

import android.app.Activity
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.provider.Settings
import android.view.View
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
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
 * 分享接收：系统分享菜单的图片 → 落盘 cache/imports → multipart 上传本机服务共享目录。
 */
class BrowserActivity : Activity() {

    companion object {
        private const val REQ_FILE_CHOOSER = 1001
        private const val APK_MIME = "application/vnd.android.package-archive"
        private const val UPDATE_CHANNEL = "update"
        private const val NOTIFY_UPDATE = 2001
        private const val DOWNLOAD_CHANNEL = "downloads"
        private const val NOTIFY_DOWNLOAD = 2002
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
                    // 壳内自下载：直接流式写公共 Download + 自有通知栏进度。
                    // 不再交系统下载管理器——localhost 任务可能在其调度器里长期 PENDING，
                    // 无通知也无文件（真机打包下载与模拟器均复现）；旧安卓无此问题走回退
                    toast("下载中...在通知栏查看进度")
                    Thread {
                        downloadToPublicDownloads(url, resolveDownloadName(url, contentDisposition), mimetype)
                    }.start()
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
        handleShareIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleShareIntent(intent)
    }

    // ==================== 分享接收（截图/相册 → 共享目录）====================

    private fun handleShareIntent(intent: Intent) {
        val action = intent.action ?: return
        if (action != Intent.ACTION_SEND && action != Intent.ACTION_SEND_MULTIPLE) return

        val uris: List<Uri> = if (action == Intent.ACTION_SEND) {
            val u = if (Build.VERSION.SDK_INT >= 33) {
                intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
            } else {
                @Suppress("DEPRECATION")
                intent.getParcelableExtra(Intent.EXTRA_STREAM)
            }
            listOfNotNull(u ?: intent.data)
        } else {
            if (Build.VERSION.SDK_INT >= 33) {
                intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java).orEmpty()
            } else {
                @Suppress("DEPRECATION")
                intent.getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM).orEmpty()
            }
        }
        if (uris.isEmpty()) {
            toast("未获取到分享内容")
            return
        }
        toast("正在接收 ${uris.size} 张图片…")

        Thread {
            try {
                // 可能未开过应用：确保本地服务在跑、端口就绪
                if (!FileServerManager.isRunning) {
                    FileServerManager.start(this)
                    ContextCompat.startForegroundService(this, Intent(this, FileServerService::class.java))
                }
                var ready = false
                repeat(40) {
                    if (FileServerManager.discoverPort() != null) ready = true
                    if (!ready) Thread.sleep(250)
                }
                if (!ready) {
                    runOnUiThread { toast("本地服务未就绪，请打开应用后重试") }
                    return@Thread
                }

                val mime = intent.type ?: "image/*"
                val dir = File(cacheDir, "imports").apply { mkdirs() }
                dir.listFiles()?.forEach { it.delete() }

                val used = mutableSetOf<String>()
                val staged = uris.mapNotNull { uri ->
                    val display = queryDisplayName(uri)
                    val base = (display?.substringBeforeLast('.') ?: "share_${System.currentTimeMillis()}").take(60)
                        .replace(Regex("[\\\\/:*?\"<>|]"), "_")
                    var name = base
                    var i = 1
                    while (!used.add(name)) name = "$base(${i++})"
                    val ext = display?.substringAfterLast('.', "")?.takeIf { it.length in 1..5 }
                        ?: mime.substringAfter('/').substringBefore('+').let { if (it == "jpeg") "jpg" else it }.ifEmpty { "img" }
                    val f = File(dir, "$name.$ext")
                    try {
                        contentResolver.openInputStream(uri)?.use { input ->
                            f.outputStream().use { output -> input.copyTo(output) }
                        } ?: return@mapNotNull null
                    } catch (e: Exception) {
                        android.util.Log.e("FSShare", "stage fail $uri", e)
                        return@mapNotNull null
                    }
                    if (f.length() == 0L) return@mapNotNull null
                    f
                }
                if (staged.isEmpty()) {
                    runOnUiThread { toast("读取分享内容失败") }
                    return@Thread
                }

                val ok = uploadToServer(staged)
                runOnUiThread {
                    if (ok > 0) toast("已添加 $ok 张图片到共享目录")
                    else toast("上传失败")
                }
            } catch (e: Exception) {
                android.util.Log.e("FSShare", "outer", e)
                runOnUiThread { toast("分享接收失败: ${e.message ?: e.javaClass.simpleName}") }
            }
        }.start()
    }

    private fun queryDisplayName(uri: Uri): String? = try {
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null
        }
    } catch (e: Exception) {
        null
    }

    /** multipart 上传到本机服务 /api/upload，返回成功数 */
    private fun uploadToServer(files: List<File>): Int {
        val boundary = "----FileServer${System.currentTimeMillis()}"
        val conn = URL("http://127.0.0.1:${FileServerManager.actualPort}/api/upload")
            .openConnection() as HttpURLConnection
        conn.requestMethod = "POST"
        conn.doOutput = true
        conn.connectTimeout = 10_000
        conn.readTimeout = 300_000
        conn.setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
        conn.setChunkedStreamingMode(256 * 1024)
        conn.outputStream.use { out ->
            for (f in files) {
                out.write(
                    ("--$boundary\r\n" +
                        "Content-Disposition: form-data; name=\"files\"; filename=\"${f.name}\"\r\n" +
                        "Content-Type: application/octet-stream\r\n\r\n").toByteArray(Charsets.UTF_8),
                )
                f.inputStream().use { it.copyTo(out, 64 * 1024) }
                out.write("\r\n".toByteArray())
            }
            out.write(("--$boundary--\r\n").toByteArray())
        }
        val code = conn.responseCode
        conn.disconnect()
        return if (code in 200..299) files.size else 0
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

    // ==================== 下载落地 ====================

    /** 下载落地文件名：优先取 Content-Disposition 的 filename（后端统一 encodeURIComponent）。
     *  不用系统的 URLUtil.guessFileName：它按 URL 末段猜名，/api/zip-download/<任务号>
     *  这类无后缀路径会被误判成 .bin。兜底取 URL 末段解码。 */
    private fun resolveDownloadName(url: String, contentDisposition: String?): String {
        if (contentDisposition != null) {
            Regex("""filename\s*=\s*"([^"]+)"""").find(contentDisposition)?.let { m ->
                val raw = m.groupValues[1]
                return runCatching { java.net.URLDecoder.decode(raw, "UTF-8") }.getOrDefault(raw)
            }
        }
        val seg = url.substringBefore('?').substringAfterLast('/')
        val decoded = runCatching { java.net.URLDecoder.decode(seg, "UTF-8") }.getOrDefault(seg)
        return decoded.ifBlank { "file-${System.currentTimeMillis()}" }
    }

    /** 壳内自下载：流式写入公共 Download（MediaStore），通知栏进度/完成/失败。
     *  绕开系统下载管理器的任务调度，失败可感知、文件名与落点完全可控。
     *  API < 29 无分区存储，经典下载管理器路径稳定，走回退。 */
    private fun downloadToPublicDownloads(url: String, fileName: String, mimetype: String?) {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(DOWNLOAD_CHANNEL) == null) {
            nm.createNotificationChannel(
                NotificationChannel(DOWNLOAD_CHANNEL, "文件下载", NotificationManager.IMPORTANCE_LOW),
            )
        }
        fun notifyDl(title: String, percent: Int, indeterminate: Boolean, ongoing: Boolean, error: Boolean = false) {
            val n = NotificationCompat.Builder(this, DOWNLOAD_CHANNEL)
                .setSmallIcon(if (error) android.R.drawable.stat_notify_error else android.R.drawable.stat_sys_download)
                .setContentTitle(title)
                .setContentText(fileName)
                .setOnlyAlertOnce(true)
                .setOngoing(ongoing)
                .setAutoCancel(!ongoing)
                .setProgress(100, percent.coerceIn(0, 100), indeterminate)
                .build()
            nm.notify(NOTIFY_DOWNLOAD, n)
        }
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                val values = ContentValues().apply {
                    put(MediaStore.Downloads.DISPLAY_NAME, fileName)
                    put(MediaStore.Downloads.MIME_TYPE, mimetype ?: "application/octet-stream")
                    put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                    put(MediaStore.Downloads.IS_PENDING, 1)
                }
                val resolver = contentResolver
                val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                    ?: throw IllegalStateException("无法创建下载条目")
                try {
                    val conn = URL(url).openConnection() as HttpURLConnection
                    conn.connectTimeout = 10_000
                    conn.readTimeout = 120_000
                    conn.instanceFollowRedirects = true
                    val total = conn.contentLengthLong
                    var lastPct = -1
                    notifyDl("正在下载", 0, indeterminate = total <= 0, ongoing = true)
                    conn.inputStream.use { input ->
                        resolver.openOutputStream(uri)!!.use { output ->
                            val buf = ByteArray(64 * 1024)
                            var read = 0L
                            var n: Int
                            while (input.read(buf).also { n = it } != -1) {
                                output.write(buf, 0, n)
                                read += n
                                if (total > 0) {
                                    val pct = (read * 100 / total).toInt()
                                    if (pct != lastPct) {
                                        lastPct = pct
                                        notifyDl("正在下载", pct, indeterminate = false, ongoing = true)
                                    }
                                }
                            }
                            output.flush()
                        }
                    }
                    values.clear()
                    values.put(MediaStore.Downloads.IS_PENDING, 0)
                    resolver.update(uri, values, null, null)
                    nm.notify(
                        NOTIFY_DOWNLOAD,
                        NotificationCompat.Builder(this, DOWNLOAD_CHANNEL)
                            .setSmallIcon(android.R.drawable.stat_sys_download_done)
                            .setContentTitle("下载完成")
                            .setContentText(fileName)
                            .setAutoCancel(true)
                            .build(),
                    )
                } catch (e: Exception) {
                    resolver.delete(uri, null, null) // 清掉 IS_PENDING 残留
                    throw e
                }
            } else {
                val req = android.app.DownloadManager.Request(Uri.parse(url))
                    .setDestinationInExternalPublicDir(android.os.Environment.DIRECTORY_DOWNLOADS, fileName)
                    .setNotificationVisibility(android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                (getSystemService(DOWNLOAD_SERVICE) as android.app.DownloadManager).enqueue(req)
            }
        } catch (e: Exception) {
            notifyDl("下载失败", 0, indeterminate = false, ongoing = false, error = true)
            runOnUiThread { toast("下载失败: ${e.message ?: e.javaClass.simpleName}") }
        }
    }

    // ==================== 整包自更新（方案 A）====================

    /** 后台线程内调用：下载 APK（通知栏进度）→ 校验安装权限 → FileProvider + 系统安装器 */
    private fun downloadAndInstallApk(url: String) {
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(UPDATE_CHANNEL) == null) {
            nm.createNotificationChannel(
                NotificationChannel(UPDATE_CHANNEL, "软件更新", NotificationManager.IMPORTANCE_LOW),
            )
        }
        fun notifyUpdate(title: String, percent: Int, indeterminate: Boolean = false, error: Boolean = false) {
            val n = NotificationCompat.Builder(this, UPDATE_CHANNEL)
                .setSmallIcon(if (error) android.R.drawable.stat_notify_error else android.R.drawable.stat_sys_download)
                .setContentTitle(title)
                .setOnlyAlertOnce(true)
                .setOngoing(!error)
                .setProgress(100, percent.coerceIn(0, 100), indeterminate)
                .build()
            nm.notify(NOTIFY_UPDATE, n)
        }
        try {
            val dir = File(cacheDir, "updates").apply { mkdirs() }
            // 清掉历史安装包，避免缓存堆积
            dir.listFiles()?.forEach { it.delete() }
            val file = File(dir, "update_${System.currentTimeMillis()}.apk")
            val conn = URL(url).openConnection() as HttpURLConnection
            conn.connectTimeout = 10_000
            conn.readTimeout = 60_000
            conn.instanceFollowRedirects = true
            val total = conn.contentLengthLong
            var lastPct = -1
            notifyUpdate("正在下载更新", 0, indeterminate = total <= 0)
            conn.inputStream.use { input ->
                file.outputStream().use { output ->
                    if (total > 0) {
                        val buf = ByteArray(64 * 1024)
                        var read = 0L
                        var n: Int
                        while (input.read(buf).also { n = it } != -1) {
                            output.write(buf, 0, n)
                            read += n
                            val pct = (read * 100 / total).toInt()
                            if (pct != lastPct) {
                                lastPct = pct
                                notifyUpdate("正在下载更新", pct)
                            }
                        }
                    } else {
                        input.copyTo(output)
                    }
                }
            }
            nm.cancel(NOTIFY_UPDATE)
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
            notifyUpdate("更新下载失败", 0, error = true)
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
