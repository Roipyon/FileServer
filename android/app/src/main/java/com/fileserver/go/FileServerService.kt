package com.fileserver.go

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.IBinder
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * 前台服务：拉起 jniLibs 内嵌的 Go 服务器二进制（libfileserver.so）。
 *
 * Go 端约定：
 *   - FILESERVER_HOME 指向应用私有目录（config.json / shared-files / temp-* 落这里）
 *   - PORT 起始 8080，被占用时 Go 自动 +1 重试；壳在启动后探测真实端口
 */
class FileServerService : Service() {

    override fun onCreate() {
        super.onCreate()
        createChannel()
        val notification: Notification =
            Notification.Builder(this, CHANNEL_ID)
                .setContentTitle("FileServer 运行中")
                .setContentText("局域网文件服务运行中")
                .setSmallIcon(android.R.drawable.stat_notify_sync)
                .build()
        startForeground(NOTIFICATION_ID, notification)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        FileServerManager.start(this)
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        FileServerManager.stop()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun createChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID, "FileServer 服务", NotificationManager.IMPORTANCE_LOW,
        )
        getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
    }

    companion object {
        const val CHANNEL_ID = "fileserver"
        const val NOTIFICATION_ID = 1
    }
}

/** 管理内嵌 Go 服务器进程的生命周期 */
object FileServerManager {
    const val PORT = 8080
    // 与 Go listenWithFallback 的重试数一致：PORT..PORT+10 内探测真实端口
    const val PORT_RANGE = 10

    @Volatile
    var actualPort: Int = PORT
        private set

    private var process: Process? = null

    val isRunning: Boolean
        get() = process?.isAlive == true

    /** 探测真实端口：先试缓存值，再扫 PORT..PORT+PORT_RANGE（命中即缓存） */
    fun discoverPort(): Int? {
        if (httpOk(actualPort)) return actualPort
        for (p in PORT..PORT + PORT_RANGE) {
            if (p != actualPort && httpOk(p)) {
                actualPort = p
                return p
            }
        }
        return null
    }

    private fun httpOk(port: Int): Boolean = try {
        val conn = URL("http://127.0.0.1:$port/api/server-info")
            .openConnection() as HttpURLConnection
        conn.connectTimeout = 500
        conn.readTimeout = 500
        (conn.responseCode == 200).also { conn.disconnect() }
    } catch (_: Exception) {
        false
    }

    fun start(context: android.content.Context) {
        if (isRunning) return
        val nativeDir: String = context.applicationInfo.nativeLibraryDir
        val binary = File(nativeDir, "libfileserver.so")
        val home: File = context.filesDir
        val logFile = File(home, "server.log")

        process = ProcessBuilder(binary.absolutePath)
            .directory(home)
            .redirectErrorStream(true)
            .apply {
                environment()["FILESERVER_HOME"] = home.absolutePath
                environment()["PORT"] = PORT.toString()
                environment()["NO_OPEN"] = "1"
            }
            .start()
        // 后台线程收集服务器日志到文件，便于排障
        Thread {
            try {
                process?.inputStream?.bufferedReader()?.useLines { lines ->
                    logFile.appendText(lines.joinToString("\n"))
                }
            } catch (_: Exception) { /* 进程结束 */ }
        }.start()
    }

    fun stop() {
        process?.destroy()
        process = null
    }
}
