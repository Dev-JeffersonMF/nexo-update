package com.jefferson.nexusassistente

import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

import com.jefferson.nexusassistente.native.NexusNativeModule
import com.jefferson.nexusassistente.service.NexusOverlayService

class MainActivity : ReactActivity() {

  companion object {
    /** Instância viva usada para trazer o assistente à frente / minimizá-lo. */
    @Volatile
    private var current: MainActivity? = null

    /** Marca o intent que veio do despertar por "nexo". */
    const val EXTRA_WAKE_WORD = "nexus_wake_word"

    /** Traz o assistente para a frente sem recriar a tarefa. */
    fun launch(context: Context) {
      try {
        val intent = Intent(context, MainActivity::class.java).apply {
          flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
        }
        context.startActivity(intent)
      } catch (_: Exception) {
        // Nunca derruba o app só porque não conseguiu reabrir a tela.
      }
    }

    /**
     * Abre o assistente depois de ouvir "nexo", inclusive com a tela bloqueada.
     *
     * O Android 10+ bloqueia abrir telas em segundo plano, mas o Nexus tem a
     * permissão de sobreposição (mascote), que é uma das exceções. O extra faz a
     * activity aparecer sobre o bloqueio e acender a tela.
     */
    fun launchForWakeWord(context: Context) {
      try {
        val intent = Intent(context, MainActivity::class.java).apply {
          flags = Intent.FLAG_ACTIVITY_NEW_TASK or
            Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
            Intent.FLAG_ACTIVITY_SINGLE_TOP
          putExtra(EXTRA_WAKE_WORD, true)
        }
        context.startActivity(intent)
      } catch (_: Exception) {
        // Sem permissão para abrir por cima do bloqueio: o evento do JS ainda
        // chega se o processo estiver vivo.
      }
    }

    /** Minimiza o assistente (volta para a home do Android). */
    fun moveToBack(): Boolean {
      val activity = current ?: return false
      return activity.moveTaskToBack(true)
    }

    fun isForeground(): Boolean = current != null

    /**
     * `true` somente quando a tela do assistente está de fato em primeiro plano.
     * É a condição usada para garantir que o mascote nunca apareça sobre ele.
     */
    fun isResumedForeground(): Boolean = current?.resumed == true
  }

  /** Rastreado porque minimizar pode falhar; o overlay depende disso. */
  @Volatile
  private var resumed = false

  override fun onCreate(savedInstanceState: Bundle?) {
    // Set the theme to AppTheme BEFORE onCreate to support
    // coloring the background, status bar, and navigation bar.
    // This is required for expo-splash-screen.
    setTheme(R.style.AppTheme);
    super.onCreate(null)
    current = this
    if (intent?.getBooleanExtra(EXTRA_WAKE_WORD, false) == true) {
      showOverLockScreen()
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    if (intent.getBooleanExtra(EXTRA_WAKE_WORD, false)) {
      showOverLockScreen()
    }
  }

  /**
   * Mostra o assistente por cima da tela de bloqueio e acende a tela.
   *
   * Quem chama é o serviço da palavra "nexo". Sem isso, o Android abria a tela
   * atrás do bloqueio e o usuário não via o Nexus respondendo.
   */
  private fun showOverLockScreen() {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
        setShowWhenLocked(true)
        setTurnScreenOn(true)
      } else {
        @Suppress("DEPRECATION")
        window.addFlags(
          WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
            WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
            WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
        )
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val keyguard = getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
        keyguard?.requestDismissKeyguard(this, null)
      }
    } catch (_: Exception) {
      // Sem permissão para aparecer sobre o bloqueio: o app abre normalmente.
    }
  }

  override fun onResume() {
    super.onResume()
    current = this
    resumed = true
    // ORDEM CRÍTICA para evitar race conditions:
    // 1. Para a wake word ANTES de esconder o mascote (libera microfone)
    // 2. Esconde o mascote (o overlay não pode ficar sobre a tela do app)
    // 3. Notifica o módulo nativo que o app está em foreground
    NexusNativeModule.onAssistantForeground(this)
    NexusOverlayService.hide()
    NexusNativeModule.notifyAssistantForeground()
    NexusNativeModule.emitEvent("onAssistantForeground")
  }

  override fun onPause() {
    resumed = false
    NexusNativeModule.emitEvent("onAssistantBackground")
    super.onPause()
  }

  override fun onDestroy() {
    resumed = false
    if (current === this) current = null
    super.onDestroy()
  }

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "main"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
          this,
          BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
          object : DefaultReactActivityDelegate(
              this,
              mainComponentName,
              fabricEnabled
          ){})
  }

  /**
    * Align the back button behavior with Android S
    * where moving root activities to background instead of finishing activities.
    * @see <a href="https://developer.android.com/reference/android/app/Activity#onBackPressed()">onBackPressed</a>
    */
  override fun invokeDefaultOnBackPressed() {
      if (Build.VERSION.SDK_INT <= Build.VERSION_CODES.R) {
          if (!moveTaskToBack(false)) {
              // For non-root activities, use the default implementation to finish them.
              super.invokeDefaultOnBackPressed()
          }
          return
      }

      // Use the default back button implementation on Android S
      // because it's doing more than [Activity.moveTaskToBack] in fact.
      super.invokeDefaultOnBackPressed()
  }
}
