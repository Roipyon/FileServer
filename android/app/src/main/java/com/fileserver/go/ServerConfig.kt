package com.fileserver.go

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.net.Inet4Address
import java.net.NetworkInterface

/**
 * 服务配置 — 读写应用私有目录下的 config.json（与 Go 端同一份配置）。
 * 字段全集写入，避免 Go 端解析时缺失键落到零值。
 */
data class ServerConfig(
    val port: Int = 8080,
    val maxUploadSize: Long = 10737418240L, // 10GB
    val cacheTTL: Int = 5,
    val logAccess: Boolean = false,
    val publicUrl: String = "",
)

object ServerConfigRepo {

    private fun file(context: Context): File = File(context.filesDir, "config.json")

    fun load(context: Context): ServerConfig {
        return try {
            val obj = JSONObject(file(context).readText())
            ServerConfig(
                port = obj.optInt("port", 8080).coerceIn(1024, 65535),
                maxUploadSize = obj.optLong("maxUploadSize", 10737418240L),
                cacheTTL = obj.optInt("cacheTTL", 5),
                logAccess = obj.optBoolean("logAccess", false),
                publicUrl = obj.optString("publicUrl", ""),
            )
        } catch (_: Exception) {
            ServerConfig()
        }
    }

    fun save(context: Context, c: ServerConfig) {
        val obj = JSONObject().apply {
            put("port", c.port)
            put("root", "./shared-files")
            put("cacheTTL", c.cacheTTL)
            put("publicUrl", c.publicUrl)
            put("logAccess", c.logAccess)
            put("rateLimit", 5000)
            put("rateLimitWindow", 60000)
            put("maxUploadSize", c.maxUploadSize)
        }
        file(context).writeText(obj.toString(2))
    }
}

/**
 * 本机 IPv4 枚举 — 独立于 Go 进程，应用域内必可见：
 * 热点接口（swlan0/ap0）在"手机开热点当服务端"时也能拿到地址。
 */
object NetIps {

    fun listIps(): List<String> = try {
        val out = mutableListOf<String>()
        val interfaces = NetworkInterface.getNetworkInterfaces() ?: return emptyList()
        for (ni in interfaces) {
            val name = ni.name?.lowercase() ?: continue
            // 排除回环/移动数据/虚拟占位接口；热点接口（swlan0/ap0/wlan*）保留
            if (name.startsWith("lo") || name.startsWith("rmnet") ||
                name.startsWith("dummy") || name.startsWith("ifb")
            ) continue
            if (!ni.isUp) continue
            for (addr in ni.inetAddresses) {
                if (addr is Inet4Address && !addr.isLoopbackAddress &&
                    !addr.isLinkLocalAddress && addr.isSiteLocalAddress
                ) {
                    addr.hostAddress?.let { out.add(it) }
                }
            }
        }
        out.distinct()
    } catch (_: Exception) {
        emptyList()
    }
}
