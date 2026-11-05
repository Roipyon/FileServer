package com.fileserver.go

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

class MainActivity : ComponentActivity() {

    private val notifPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 33) {
            notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        // Web 界面上次选择的深浅色 → 控制台与开屏的唯一主题源
        NativeTheme.init(this)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            // 开屏保持 700ms；退场整体 300ms 淡出，渐变进入主界面
            val splash = installSplashScreen()
            var hold = true
            android.os.Handler(android.os.Looper.getMainLooper()).postDelayed({ hold = false }, 700)
            splash.setKeepOnScreenCondition { hold }
            splash.setOnExitAnimationListener { provider ->
                provider.view.animate()
                    .alpha(0f)
                    .setDuration(300L)
                    .withEndAction { provider.remove() }
                    .start()
            }
        }
        // 打开即启动：前台服务拉起内嵌 Go 服务器
        ContextCompat.startForegroundService(this, Intent(this, FileServerService::class.java))
        setContent { App() }
    }
}

@Composable
fun App() {
    val context = LocalContext.current
    var showSettings by remember { mutableStateOf(false) }

    MaterialTheme(colorScheme = appColorScheme()) {
        if (showSettings) {
            SettingsScreen(onBack = { showSettings = false })
            return@MaterialTheme
        }

        var running by remember { mutableStateOf(FileServerManager.isRunning) }
        var ready by remember { mutableStateOf(false) }

        // 静默轮询：running=服务进程存活（控制启动/停止互斥），ready=HTTP 可用（控制打开界面）
        LaunchedEffect(Unit) {
            while (true) {
                running = withContext(Dispatchers.IO) { FileServerManager.isRunning }
                ready = running && withContext(Dispatchers.IO) { serverReady() }
                delay(if (running) 2000 else 500)
            }
        }

        Surface(modifier = Modifier.fillMaxSize()) {
            Column(
                // targetSdk 35 强制 edge-to-edge：safeDrawing 覆盖系统栏与刘海
                modifier = Modifier
                    .fillMaxSize()
                    .padding(WindowInsets.safeDrawing.asPaddingValues())
                    .padding(24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(14.dp, Alignment.CenterVertically),
            ) {
                Button(
                    onClick = {
                        running = true
                        FileServerManager.start(context)
                        ContextCompat.startForegroundService(
                            context, Intent(context, FileServerService::class.java),
                        )
                    },
                    enabled = !running,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("启动服务") }

                OutlinedButton(
                    onClick = {
                        running = false
                        context.stopService(Intent(context, FileServerService::class.java))
                        FileServerManager.stop()
                    },
                    enabled = running,
                    modifier = Modifier.fillMaxWidth(),
                    colors = ButtonDefaults.outlinedButtonColors(
                        contentColor = Color(0xFFC4554D),
                        disabledContentColor = Color(0xFFC4554D).copy(alpha = 0.38f),
                    ),
                ) { Text("停止服务") }

                Button(
                    onClick = {
                        context.startActivity(Intent(context, BrowserActivity::class.java))
                    },
                    enabled = ready,
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("打开文件界面") }

                OutlinedButton(
                    onClick = { showSettings = true },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text("设置") }
            }
        }
    }
}

fun serverReady(): Boolean = FileServerManager.discoverPort() != null
