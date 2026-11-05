package com.fileserver.go

import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat

private val UPLOAD_SIZE_OPTIONS = listOf(
    "100MB" to 104857600L,
    "1GB" to 1073741824L,
    "10GB" to 10737418240L,
    "50GB" to 53687091200L,
)

/**
 * 服务设置页 — 读写 config.json。
 * 不提供 root（安卓固定为应用私有目录）与 rateLimit（安全兜底保持默认）。
 * 服务运行中保存即重启生效；未运行则下次启动生效。
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun SettingsScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val initial = remember { ServerConfigRepo.load(context) }
    var portText by remember { mutableStateOf(initial.port.toString()) }
    var ttlText by remember { mutableStateOf(initial.cacheTTL.toString()) }
    var publicUrl by remember { mutableStateOf(initial.publicUrl) }
    var maxUploadBytes by remember { mutableStateOf(initial.maxUploadSize) }
    var logAccess by remember { mutableStateOf(initial.logAccess) }
    var message by remember { mutableStateOf("") }

    MaterialTheme(colorScheme = appColorScheme()) {
        Surface(modifier = Modifier.fillMaxSize()) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(WindowInsets.safeDrawing.asPaddingValues())
                    .padding(horizontal = 16.dp)
                    .verticalScroll(rememberScrollState()),
            ) {
                // 顶栏
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                    Spacer(Modifier.width(4.dp))
                    Text("服务设置", style = MaterialTheme.typography.titleLarge)
                }

                OutlinedTextField(
                    value = portText,
                    onValueChange = { portText = it.filter { c -> c.isDigit() }.take(5) },
                    label = { Text("服务端口（1024-65535）") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )

                Spacer(Modifier.height(12.dp))
                Text("单文件上传上限", style = MaterialTheme.typography.titleSmall)
                FlowRow(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    UPLOAD_SIZE_OPTIONS.forEach { (label, bytes) ->
                        FilterChip(
                            selected = maxUploadBytes == bytes,
                            onClick = { maxUploadBytes = bytes },
                            label = { Text(label) },
                        )
                    }
                }

                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = ttlText,
                    onValueChange = { ttlText = it.filter { c -> c.isDigit() }.take(4) },
                    label = { Text("文件列表缓存（秒）") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )

                Spacer(Modifier.height(12.dp))
                OutlinedTextField(
                    value = publicUrl,
                    onValueChange = { publicUrl = it },
                    label = { Text("公网访问地址（可选，如域名）") },
                    placeholder = { Text("https://example.com") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )

                Spacer(Modifier.height(12.dp))
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Column {
                        Text("访问日志", style = MaterialTheme.typography.titleSmall)
                        Text("在终端输出请求日志", style = MaterialTheme.typography.bodySmall)
                    }
                    Switch(checked = logAccess, onCheckedChange = { logAccess = it })
                }

                Spacer(Modifier.height(20.dp))
                Button(
                    onClick = {
                        val config = ServerConfig(
                            port = portText.toIntOrNull()?.coerceIn(1024, 65535) ?: initial.port,
                            maxUploadSize = maxUploadBytes,
                            cacheTTL = ttlText.toIntOrNull()?.coerceIn(0, 3600) ?: initial.cacheTTL,
                            logAccess = logAccess,
                            publicUrl = publicUrl.trim(),
                        )
                        try {
                            ServerConfigRepo.save(context, config)
                            if (FileServerManager.isRunning) {
                                // 重启服务使配置生效
                                context.stopService(Intent(context, FileServerService::class.java))
                                FileServerManager.stop()
                                ContextCompat.startForegroundService(
                                    context, Intent(context, FileServerService::class.java),
                                )
                                message = "已保存并重启服务，配置已生效"
                            } else {
                                message = "已保存，启动服务后生效"
                            }
                        } catch (e: Exception) {
                            message = "保存失败：${e.message}"
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("保存") }

                if (message.isNotEmpty()) {
                    Spacer(Modifier.height(10.dp))
                    Text(message, style = MaterialTheme.typography.bodySmall)
                }
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}
