package com.jefferson.nexusassistente.core

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.graphics.drawable.Drawable
import android.net.Uri
import android.util.Log
import com.jefferson.nexusassistente.rea.ReaLayoutAnalyzer

data class AppCapability(
    val packageName: String,
    val appName: String,
    val versionName: String?,
    val versionCode: Long,
    val supportsWhatsAppMessaging: Boolean = false,
    val supportsWhatsAppCalls: Boolean = false,
    val supportsYouTubePlayback: Boolean = false,
    val supportsMediaControls: Boolean = false,
    val supportsRadioStreaming: Boolean = false,
    val supportsVoiceAssistant: Boolean = false
)

data class InstalledApp(
    val packageName: String,
    val appName: String,
    val versionName: String?,
    val versionCode: Long,
    val icon: Drawable?,
    val isSystemApp: Boolean,
    val capabilities: AppCapability
)

class AppDetector(private val context: Context) {

    private val packageManager: PackageManager = context.packageManager

    // Known app packages and their capabilities
    private val knownApps = mapOf(
        ReaLayoutAnalyzer.WHATSAPP_PACKAGE to AppCapability(
            packageName = ReaLayoutAnalyzer.WHATSAPP_PACKAGE,
            appName = "WhatsApp",
            versionName = null,
            versionCode = 0,
            supportsWhatsAppMessaging = true,
            supportsWhatsAppCalls = true
        ),
        ReaLayoutAnalyzer.YOUTUBE_PACKAGE to AppCapability(
            packageName = ReaLayoutAnalyzer.YOUTUBE_PACKAGE,
            appName = "YouTube",
            versionName = null,
            versionCode = 0,
            supportsYouTubePlayback = true,
            supportsMediaControls = true
        ),
        ReaLayoutAnalyzer.OITUBE_PACKAGE to AppCapability(
            packageName = ReaLayoutAnalyzer.OITUBE_PACKAGE,
            appName = "OiTube",
            versionName = null,
            versionCode = 0,
            supportsYouTubePlayback = true,
            supportsMediaControls = true
        ),
        ReaLayoutAnalyzer.GEMINI_PACKAGE to AppCapability(
            packageName = ReaLayoutAnalyzer.GEMINI_PACKAGE,
            appName = "Google Gemini",
            versionName = null,
            versionCode = 0,
            supportsVoiceAssistant = true
        ),
        ReaLayoutAnalyzer.ALEXA_PACKAGE to AppCapability(
            packageName = ReaLayoutAnalyzer.ALEXA_PACKAGE,
            appName = "Amazon Alexa",
            versionName = null,
            versionCode = 0,
            supportsVoiceAssistant = true
        )
    )

    fun getInstalledApps(): List<InstalledApp> {
        val apps = mutableListOf<InstalledApp>()
        val installedPackages = packageManager.getInstalledPackages(PackageManager.GET_META_DATA)

        for (pkg in installedPackages) {
            val appInfo = pkg.applicationInfo ?: continue
            val isSystem = (appInfo.flags and ApplicationInfo.FLAG_SYSTEM) != 0
            val capabilities = knownApps[pkg.packageName] ?: AppCapability(
                packageName = pkg.packageName,
                appName = appInfo.loadLabel(packageManager).toString(),
                versionName = pkg.versionName,
                versionCode = pkg.versionCode.toLong()
            )

            apps.add(InstalledApp(
                packageName = pkg.packageName,
                appName = appInfo.loadLabel(packageManager).toString(),
                versionName = pkg.versionName,
                versionCode = pkg.versionCode.toLong(),
                icon = appInfo.loadIcon(packageManager),
                isSystemApp = isSystem,
                capabilities = capabilities
            ))
        }

        // Registro no logcat: é como se confere, no aparelho, se o Nexus está
        // enxergando os apps instalados. Sem "QUERY_ALL_PACKAGES" (ou sem as
        // <queries> do manifesto) o Android 11+ esconde os outros aplicativos e
        // esta lista volta quase vazia — era isso que fazia o assistente dizer
        // que não havia nenhum app no aparelho e cair no navegador.
        Log.d(TAG, "Apps visíveis para o Nexus: ${apps.size} (pacotes do sistema inclusive)")

        return apps.sortedBy { it.appName.lowercase() }
    }

    fun getKnownAppsStatus(): Map<String, Boolean> {
        val status = mutableMapOf<String, Boolean>()
        for (pkgName in knownApps.keys) {
            status[pkgName] = isPackageInstalled(pkgName)
        }
        return status
    }

    fun isPackageInstalled(packageName: String): Boolean {
        try {
            packageManager.getPackageInfo(packageName, 0)
            return true
        } catch (e: PackageManager.NameNotFoundException) {
            return false
        }
    }

    fun getAppInfo(packageName: String): InstalledApp? {
        try {
            val pkg = packageManager.getPackageInfo(packageName, PackageManager.GET_META_DATA)
            val appInfo = pkg.applicationInfo ?: return null
            val isSystem = (appInfo.flags and ApplicationInfo.FLAG_SYSTEM) != 0
            val capabilities = knownApps[packageName] ?: AppCapability(
                packageName = packageName,
                appName = appInfo.loadLabel(packageManager).toString(),
                versionName = pkg.versionName,
                versionCode = pkg.versionCode.toLong()
            )
            return InstalledApp(
                packageName = packageName,
                appName = appInfo.loadLabel(packageManager).toString(),
                versionName = pkg.versionName,
                versionCode = pkg.versionCode.toLong(),
                icon = appInfo.loadIcon(packageManager),
                isSystemApp = isSystem,
                capabilities = capabilities
            )
        } catch (e: PackageManager.NameNotFoundException) {
            return null
        }
    }

    fun launchApp(packageName: String): Boolean {
        val intent = packageManager.getLaunchIntentForPackage(packageName)
        if (intent != null) {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            try {
                context.startActivity(intent)
                return true
            } catch (e: Exception) {
                Log.e("NEXUS_APPDETECTOR", "Erro ao lançar app: ${e.message}")
                return false
            }
        }
        return false
    }

    fun openWhatsAppChat(phoneNumber: String): Boolean {
        if (!isPackageInstalled(WHATSAPP_PACKAGE)) return false
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$phoneNumber")).apply {
            setPackage(WHATSAPP_PACKAGE)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            context.startActivity(intent)
            return true
        } catch (e: Exception) {
            Log.e("NEXUS_APPDETECTOR", "Erro ao abrir WhatsApp: ${e.message}")
            return false
        }
    }

    /**
     * Abre a busca do YouTube no app do YouTube.
     *
     * Usa o endereço normal de resultados (e não `ACTION_SEARCH`): o app do
     * YouTube entende este link com `setPackage` — conferido no aparelho — e o
     * usuário cai direto na lista de resultados, sem passar por navegador.
     */
    fun openYouTubeSearch(query: String): Boolean {
        if (!isPackageInstalled(YOUTUBE_PACKAGE)) return false
        val intent = Intent(
            Intent.ACTION_VIEW,
            Uri.parse("https://www.youtube.com/results?search_query=${Uri.encode(query)}")
        ).apply {
            setPackage(YOUTUBE_PACKAGE)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            context.startActivity(intent)
            return true
        } catch (e: Exception) {
            Log.e("NEXUS_APPDETECTOR", "Erro ao abrir YouTube: ${e.message}")
            return false
        }
    }

    fun openOiTubeSearch(query: String): Boolean {
        if (!isPackageInstalled(OITUBE_PACKAGE)) return false
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://www.youtube.com/results?search_query=${Uri.encode(query)}")).apply {
            setPackage(OITUBE_PACKAGE)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            context.startActivity(intent)
            return true
        } catch (e: Exception) {
            Log.e("NEXUS_APPDETECTOR", "Erro ao abrir OiTube: ${e.message}")
            return false
        }
    }

    /**
     * Abre um endereço no navegador padrão (último recurso, quando nenhum app
     * de música/vídeo está instalado).
     */
    fun openWebSearch(url: String): Boolean {
        if (!url.startsWith("https://")) return false
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        return try {
            context.startActivity(intent)
            true
        } catch (e: Exception) {
            Log.e("NEXUS_APPDETECTOR", "Erro ao abrir o navegador: ${e.message}")
            false
        }
    }

    fun getAvailableMediaApps(): List<InstalledApp> {
        return getInstalledApps().filter { it.capabilities.supportsMediaControls || it.capabilities.supportsYouTubePlayback }
    }

    fun getAvailableMessagingApps(): List<InstalledApp> {
        return getInstalledApps().filter { it.capabilities.supportsWhatsAppMessaging }
    }

    fun getAvailableVoiceAssistantApps(): List<InstalledApp> {
        return getInstalledApps().filter { it.capabilities.supportsVoiceAssistant }
    }

    companion object {
        /** Etiqueta do logcat para conferir a detecção no aparelho. */
        private const val TAG = "NEXUS_APPDETECTOR"

        const val WHATSAPP_PACKAGE = "com.whatsapp"
        const val YOUTUBE_PACKAGE = "com.google.android.youtube"
        const val OITUBE_PACKAGE = "com.skipads.oitube.official"
    }
}