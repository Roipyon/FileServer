package com.fileserver.go

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * 前台服务：拉起 jniLibs 内嵌的 Go 服务器二进制（libfileserver.so）。
 *
 * Go 端约定：
 *   - FILESERVER_HOME 指向应用私有目录（config.json / shared-files / temp-* 落这里）
 *   - PORT 取自设置（config.json），被占用时 Go 自动 +1 重试；壳在启动后探测真实端口
 *   - FS_LOCAL_IPS 由壳注入本机 IPv4 列表（热点接口等 Go 进程枚举不到的场景兜底）
 */
class FileServerService : Service() {

    private var updateThread: Thread? = null

    override fun onCreate() {
        super.onCreate()
        createChannel()
        startForeground(NOTIFICATION_ID, buildNotification())
        startUpdating()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        FileServerManager.start(this)
        refreshNotification()
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        updateThread?.interrupt()
        updateThread = null
        FileServerManager.stop()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    // ==================== 通知 ====================

    /** 主标题 "FileServer 运行中"，副标题为全部 IP（多行）；点击通知回到 APP */
    private fun buildNotification(): android.app.Notification {
        val pi = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("FileServer 运行中")
            .setContentText("正在启动服务…")
            .setStyle(NotificationCompat.BigTextStyle().bigText("正在启动服务…"))
            .setSmallIcon(R.drawable.ic_notification)
            .setOngoing(true)
            .setContentIntent(pi)
            .build()
    }

    /** 定时刷新通知中的 IP 列表（覆盖热点开启/关闭、网络切换等变化） */
    private fun startUpdating() {
        updateThread = Thread {
            while (!Thread.currentThread().isInterrupted) {
                try {
                    refreshNotification()
                } catch (_: Exception) {
                }
                try {
                    Thread.sleep(10_000)
                } catch (_: InterruptedException) {
                    return@Thread
                }
            }
        }.apply { start() }
    }

    private fun refreshNotification() {
        val port = FileServerManager.discoverPort() ?: FileServerManager.basePort
        val ips = NetIps.listIps()
        val bigText = if (ips.isEmpty()) {
            "等待网络连接…"
        } else {
            ips.joinToString("\n") { "http://$it:$port" }
        }

        val pi = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("FileServer 运行中")
            .setContentText(ips.firstOrNull()?.let { "http://$it:$port" } ?: "等待网络连接…")
            .setStyle(NotificationCompat.BigTextStyle().bigText(bigText))
            .setSmallIcon(R.drawable.ic_notification)
            .setOngoing(true)
            .setContentIntent(pi)
            .build()
        // 周期性重发：通知可能在权限授予前首发，必须补发才会在抽屉出现
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification)
    }

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
    // 与 Go listenWithFallback 的重试数一致：basePort..basePort+10 内探测真实端口
    const val PORT_RANGE = 10

    /** 起始端口（取自 config.json，默认 8080） */
    @Volatile
    var basePort: Int = 8080
        private set

    @Volatile
    var actualPort: Int = 8080
        private set

    private var process: Process? = null

    val isRunning: Boolean
        get() = process?.isAlive == true

    /** 探测真实端口：先试缓存值，再扫 basePort..basePort+PORT_RANGE（命中即缓存） */
    fun discoverPort(): Int? {
        if (httpOk(actualPort)) return actualPort
        for (p in basePort..basePort + PORT_RANGE) {
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
        val cfg = ServerConfigRepo.load(context)
        basePort = cfg.port
        actualPort = cfg.port

        val nativeDir: String = context.applicationInfo.nativeLibraryDir
        val binary = File(nativeDir, "libfileserver.so")
        val home: File = context.filesDir
        val logFile = File(home, "server.log")

        process = ProcessBuilder(binary.absolutePath)
            .directory(home)
            .redirectErrorStream(true)
            .apply {
                environment()["FILESERVER_HOME"] = home.absolutePath
                environment()["PORT"] = basePort.toString()
                environment()["NO_OPEN"] = "1"
                // 壳侧枚举的本机 IPv4：热点接口等 Go 进程枚举受限的场景兜底
                environment()["FS_LOCAL_IPS"] = NetIps.listIps().joinToString(",")
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
