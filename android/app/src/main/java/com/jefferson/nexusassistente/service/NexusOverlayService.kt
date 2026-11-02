package com.jefferson.nexusassistente.service

import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.TextView
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.jefferson.nexusassistente.MainActivity
import com.jefferson.nexusassistente.R
import kotlin.math.abs

/**
 * Mascote flutuante do Nexus.
 *
 * É um serviço em primeiro plano que desenha o mascote por cima de OUTROS
 * aplicativos (TYPE_APPLICATION_OVERLAY). Regras de segurança do produto:
 *
 *  - só aparece quando o assistente pede (`ACTION_SHOW`), nunca sozinho;
 *  - nunca fica sobre a tela do próprio assistente: [MainActivity] esconde o
 *    mascote em `onResume`, via [hide];
 *  - exige `SYSTEM_ALERT_WINDOW`; sem a permissão ele encerra sem crashar.
 */
class NexusOverlayService : Service() {

    companion object {
        private const val TAG = "NEXUS_OVERLAY"
        const val CHANNEL_ID = "NexusOverlayChannel"
        const val NOTIFICATION_ID = 2
        const val ACTION_SHOW = "com.jefferson.nexusassistente.OVERLAY_SHOW"
        const val ACTION_HIDE = "com.jefferson.nexusassistente.OVERLAY_HIDE"

        /** Guarda onde o usuário deixou o mascote. */
        private const val PREFS_NAME = "nexus_overlay_position"
        private const val KEY_X = "mascot_x"
        private const val KEY_Y = "mascot_y"

        /** Margem para o mascote nunca nascer colado no relógio nem na barra. */
        private const val EDGE_MARGIN_DP = 36

        /** Tempo de dedo pressionado no mascote que abre o assistente. */
        private const val LONG_PRESS_MS = 450L

        /** Janela do toque duplo (abre o assistente na hora, sem segurar). */
        private const val DOUBLE_TAP_MS = 340L

        @Volatile
        private var instance: NexusOverlayService? = null

        /** Avisa o JS quando o mascote é tocado para falar (o microfone abre). */
        @Volatile
        var onMascotTapped: (() -> Unit)? = null

        fun isVisible(): Boolean = instance?.attached == true

        /**
         * Pinta no mascote o estado de escuta aberta pelo toque.
         *
         * O usuário toca para falar sem abrir o app, então precisa de um sinal de
         * que o Nexus está ouvindo: a notificação do mascote passa a dizer "estou
         * ouvindo" e a imagem respira (alfa), sem mudar de tamanho.
         */
        fun setListening(on: Boolean) {
            val current = instance ?: return
            Handler(Looper.getMainLooper()).post { current.applyListening(on) }
        }

        /** Esconde o mascote. Sempre chamado com segurança na thread principal. */
        fun hide() {
            val current = instance ?: return
            Handler(Looper.getMainLooper()).post { current.removeOverlay(stopService = true) }
        }

        /** Pede o mascote na tela. Só funciona se a sobreposição estiver liberada. */
        fun show(context: Context) {
            // Já está na tela: não reinicia o serviço nem o relógio do
            // startForeground sem necessidade.
            if (instance?.attached == true) return
            try {
                val intent = Intent(context, NexusOverlayService::class.java).apply { action = ACTION_SHOW }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    context.startForegroundService(intent)
                } else {
                    context.startService(intent)
                }
            } catch (e: Exception) {
                Log.e(TAG, "Não foi possível iniciar o overlay: ${e.message}")
            }
        }
    }

    private var windowManager: WindowManager? = null
    private var overlayView: View? = null
    private var overlayImage: ImageView? = null
    private var params: WindowManager.LayoutParams? = null
    @Volatile
    private var attached = false

    /**
     * `true` quando o serviço já está em foreground.
     *
     * O `startForeground()` é chamado no `onCreate` - o Android exige isso logo
     * depois de um `startForegroundService()`, e se a chamada atrasa o sistema
     * mata o PROCESSO com `ForegroundServiceDidNotStartInTimeException` - e é
     * repetido a CADA `onStartCommand` (ver a rede de segurança lá).
     */
    @Volatile
    private var inForeground = false

    /**
     * `true` quando alguém já pediu para esconder o mascote.
     *
     * Existe por causa de uma corrida real: `onResume` da tela do assistente
     * chama [hide] exatamente enquanto o serviço está subindo. Sem esta trava, o
     * `hide` não achava nada para remover, o `addOverlay` continuava e o mascote
     * ficava preso POR CIMA da tela do próprio Nexus.
     */
    @Volatile
    private var closing = false

    /** `true` enquanto o microfone está aberto por um toque no mascote. */
    private var listening = false

    /**
     * Respiração do mascote enquanto ele ouve.
     *
     * O aviso de "estou ouvindo" é de ALFA, não de tamanho: o mascote ficava
     * crescendo a cada toque, o que o usuário não quer — o ícone tem que ficar no
     * mesmo tamanho sempre.
     */
    private var listeningPulse: ObjectAnimator? = null

    /** Agenda o toque longo (abrir o assistente) sem travar o arraste. */
    private val longPressHandler = Handler(Looper.getMainLooper())

    /** Lado do mascote em pixels, usado para limitar o arraste à tela. */
    private var mascotSizePx = 0

    private val prefs by lazy { getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE) }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        // O canal precisa existir antes do primeiro startForeground().
        createNotificationChannel()

        /*
         * O startForeground() acontece AQUI, e não no onStartCommand.
         *
         * O Android exige que um serviço iniciado com startForegroundService()
         * chame startForeground() logo depois. Se a chamada atrasa - e ela
         * atrasa quando a thread principal está ocupada com o app voltando do
         * background - o sistema mata o PROCESSO com
         * ForegroundServiceDidNotStartInTimeException. Como o serviço de
         * acessibilidade mora no mesmo processo, o auto-bot caía junto e o app
         * passava a dizer que a permissão nunca foi dada.
         *
         * No onCreate o serviço ainda está na sua primeira volta, então a
         * obrigação é cumprida no primeiro instante possível.
         */
        if (!startForegroundSafely()) {
            // Sem foreground não dá para ser um serviço de foreground: encerra
            // agora, antes que o sistema puxe o tapete.
            stopSelf()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val action = intent?.action ?: ACTION_SHOW
        return try {
            /*
             * Todo `startForegroundService()` exige uma chamada a
             * `startForeground()`. Repetimos AQUI, sem condicionar a
             * `inForeground`: no vaivém "esconde/mostra" o serviço pode ser
             * reiniciado antes de o `onDestroy` rodar, e o Android zera o
             * estado de foreground mesmo com o campo antigo ainda `true`.
             * Confiar nele nesse intervalo dava
             * `ForegroundServiceDidNotStartInTimeException` — e o sistema
             * matava o processo inteiro do assistente.
             */
            if (!startForegroundSafely()) {
                stopSelf(startId)
                return START_NOT_STICKY
            }
            if (action == ACTION_HIDE) {
                removeOverlay(stopService = true)
            } else {
                startOverlay()
            }
            START_NOT_STICKY
        } catch (e: Exception) {
            Log.e(TAG, "Falha no serviço de overlay", e)
            stopSelf()
            START_NOT_STICKY
        }
    }

    private fun startOverlay() {
        if (!canDrawOverlays()) {
            Log.w(TAG, "Sobreposição não liberada; encerrando o overlay.")
            removeOverlay(stopService = true)
            return
        }
        // Regra dura: o mascote é para quando o app NÃO está na frente. Se a tela
        // do assistente está em primeiro plano, aparecer aqui seria um bug (o
        // usuário já tem o botão de microfone na própria tela).
        if (MainActivity.isResumedForeground()) {
            Log.d(TAG, "Tela do assistente em primeiro plano: mascote não aparece.")
            removeOverlay(stopService = true)
            return
        }
        if (attached) return

        // Nova chamada para mostrar: a trava do `hide` anterior não vale mais.
        closing = false
        instance = this
        addOverlay()
    }

    private fun canDrawOverlays(): Boolean {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this)
    }

    private fun startForegroundSafely(): Boolean {
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        } else {
            0
        }
        return try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), type)
            inForeground = true
            true
        } catch (e: Exception) {
            Log.e(TAG, "startForeground do overlay falhou", e)
            inForeground = false
            false
        }
    }

    private fun addOverlay() {
        val wm = getSystemService(Context.WINDOW_SERVICE) as? WindowManager ?: return
        windowManager = wm

        // Última checagem antes de aparecer: se o assistente voltou para a frente
        // (ou alguém já mandou esconder) enquanto este serviço subia, não aparece.
        if (closing || MainActivity.isResumedForeground()) {
            Log.d(TAG, "Mascote cancelado no último instante (app em primeiro plano).")
            removeOverlay(stopService = true)
            return
        }

        val density = resources.displayMetrics.density
        val sizePx = (128 * density).toInt()
        val closePx = (26 * density).toInt()

        val root = FrameLayout(this)
        root.layoutParams = FrameLayout.LayoutParams(sizePx, sizePx)
        // Fundo transparente: o mascote é só o desenho, sem caixa em volta.
        root.setBackgroundColor(Color.TRANSPARENT)

        val image = ImageView(this)
        image.setImageResource(R.drawable.nexus_mascote)
        image.scaleType = ImageView.ScaleType.FIT_CENTER
        image.setBackgroundColor(Color.TRANSPARENT)
        image.layoutParams = FrameLayout.LayoutParams(sizePx, sizePx).apply {
            gravity = Gravity.CENTER
        }
        root.addView(image)

        val close = TextView(this)
        close.text = "×"
        close.setTextColor(Color.WHITE)
        close.textSize = 16f
        close.gravity = Gravity.CENTER
        close.background = GradientDrawable().apply {
            shape = GradientDrawable.OVAL
            setColor(Color.argb(200, 30, 41, 59))
            setStroke((1.5f * density).toInt(), Color.argb(220, 57, 213, 232))
        }
        close.layoutParams = FrameLayout.LayoutParams(closePx, closePx).apply {
            gravity = Gravity.TOP or Gravity.END
        }
        close.setOnClickListener {
            removeOverlay(stopService = true)
        }
        root.addView(close)

        val metrics = resources.displayMetrics
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }
        val lp = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            type,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT,
        )
        mascotSizePx = sizePx
        overlayImage = image
        lp.gravity = Gravity.TOP or Gravity.START

        // O usuário pode deixar o mascote onde quiser: a posição fica salva e
        // ele reaparece no mesmo lugar. Na primeira vez nasce à direita, no
        // meio da tela — e nunca sobre a tela do próprio assistente.
        val firstRun = !prefs.contains(KEY_X)
        lp.x = if (firstRun) {
            (metrics.widthPixels - sizePx - (12 * density).toInt()).coerceAtLeast(0)
        } else {
            prefs.getInt(KEY_X, 0)
        }
        lp.y = if (firstRun) metrics.heightPixels / 2 else prefs.getInt(KEY_Y, 0)
        clampPosition(lp)
        params = lp

        // O arraste/toque fica só na imagem do mascote: assim o botão "×" que
        // fica por cima continua recebendo o clique para fechar o mascote.
        attachDragBehavior(image)

        try {
            wm.addView(root, lp)
            overlayView = root
            attached = true
            animateIn(root)
            Log.d(TAG, "Mascote flutuante exibido")
        } catch (e: Exception) {
            Log.e(TAG, "Não foi possível adicionar o mascote", e)
            removeOverlay(stopService = true)
        }
    }

    private fun animateIn(view: View) {
        view.alpha = 0f
        view.scaleX = 0.7f
        view.scaleY = 0.7f
        view.animate().alpha(1f).scaleX(1f).scaleY(1f).setDuration(180).start()
    }

    /**
     * Arraste e toques do mascote.
     *
     * O `updateViewLayout` só aceita a view que foi adicionada à janela (o
     * container) — nunca um filho dela. Era exatamente esse o motivo de o
     * mascote não sair do lugar: a chamada recebia a imagem e o Android
     * recusava, com a falha engolida pelo try/catch.
     *
     * Ao soltar, a posição é salva para o mascote reaparecer onde o usuário
     * deixou. Um toque curto abre o MICROFONE para o pedido; segurar o mascote
     * (toque longo) traz o assistente de volta para a tela.
     */
    private fun attachDragBehavior(view: View) {
        var startX = 0
        var startY = 0
        var grabbedX = 0f
        var grabbedY = 0f
        var dragging = false
        var longPressed = false
        var longPressRunnable: Runnable? = null
        var lastTapAt = 0L
        var lastTapX = 0f
        var lastTapY = 0f
        val density = resources.displayMetrics.density

        // O dedo treme alguns pixels ao segurar. Com 6dp o mascote virava
        // "arrasto" e o toque longo era cancelado. 16dp separa mão trêmula de
        // arrasto de verdade.
        val dragSlop = (16 * density)
        val doubleTapSlop = (40 * density)

        view.setOnTouchListener { touched, event ->
            val lp = params ?: return@setOnTouchListener false
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    startX = lp.x
                    startY = lp.y
                    grabbedX = event.rawX
                    grabbedY = event.rawY
                    dragging = false
                    longPressed = false
                    // Toque = uma leve mudança de alfa. O mascote NÃO cresce e
                    // NÃO pisca forte (o piscar de 0.55 parecia tremor).
                    touched.animate().cancel()
                    touched.animate().alpha(0.85f).setDuration(70).start()
                    val pending = Runnable {
                        if (dragging || longPressed) return@Runnable
                        longPressed = true
                        Log.d(TAG, "Toque longo no mascote: abrindo o assistente")
                        MainActivity.launch(this)
                    }
                    longPressRunnable = pending
                    longPressHandler.postDelayed(pending, LONG_PRESS_MS)
                    true
                }

                MotionEvent.ACTION_MOVE -> {
                    val dx = (event.rawX - grabbedX).toInt()
                    val dy = (event.rawY - grabbedY).toInt()
                    if (!dragging && (abs(dx) > dragSlop || abs(dy) > dragSlop)) {
                        dragging = true
                        longPressRunnable?.let { longPressHandler.removeCallbacks(it) }
                    }
                    if (dragging) {
                        lp.x = startX + dx
                        lp.y = startY + dy
                        clampPosition(lp)
                        moveOverlay()
                    }
                    true
                }

                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    longPressRunnable?.let { longPressHandler.removeCallbacks(it) }
                    longPressRunnable = null
                    // Solta o piscar do toque (sem mexer no tamanho).
                    touched.animate().cancel()
                    touched.alpha = 1f

                    // O toque longo já abriu o assistente: nada mais a fazer.
                    // O `listening` NÃO bloqueia mais o toque — quando ele ficava
                    // preso em `true`, o mascote parava de abrir o microfone e o
                    // usuário ficava sem conseguir falar.
                    if (longPressed) {
                        dragging = false
                        return@setOnTouchListener true
                    }

                    if (dragging) {
                        prefs.edit().putInt(KEY_X, lp.x).putInt(KEY_Y, lp.y).apply()
                        Log.d(TAG, "Mascote reposicionado em (${lp.x}, ${lp.y})")
                        dragging = false
                        return@setOnTouchListener true
                    }

                    if (event.actionMasked == MotionEvent.ACTION_UP) {
                        val now = System.currentTimeMillis()
                        val doubleTap = now - lastTapAt <= DOUBLE_TAP_MS &&
                            abs(event.rawX - lastTapX) <= doubleTapSlop &&
                            abs(event.rawY - lastTapY) <= doubleTapSlop
                        if (doubleTap) {
                            // Dois toques rápidos = abrir o Nexus na hora. É o
                            // caminho mais rápido; o toque longo continua valendo.
                            lastTapAt = 0L
                            Log.d(TAG, "Toque duplo no mascote: abrindo o assistente")
                            MainActivity.launch(this)
                        } else {
                            lastTapAt = now
                            lastTapX = event.rawX
                            lastTapY = event.rawY
                            val handler = onMascotTapped
                            if (handler == null) {
                                // A ponte com o JavaScript ainda não está pronta (processo
                                // recém-criado). Dispara broadcast para o NexusNativeModule
                                // processar assim que inicializar, e abre o app como fallback
                                // visual imediato. O broadcast garante que a captura comece
                                // mesmo se o app estiver subindo.
                                Log.d(TAG, "Toque no mascote sem ponte JS: disparando broadcast + abrindo app")
                                val intent = Intent("com.jefferson.nexusassistente.MASCOT_TAP")
                                intent.putExtra("startCapture", true)
                                sendBroadcast(intent)
                                MainActivity.launch(this)
                            } else {
                                // Toque curto: abre o microfone para o pedido.
                                // FIX: Seta listening ANTES de invocar o handler, para evitar
                                // race onde a captura começa antes do visual de "ouvindo".
                                setListening(true)
                                Log.d(TAG, "Toque no mascote: abrindo o microfone para o pedido")
                                handler.invoke()
                            }
                        }
                    }
                    dragging = false
                    true
                }

                else -> false
            }
        }
    }

    /**
     * Reflete no mascote o microfone aberto/fechado.
     *
     * Sinal de escuta é ALFA (respiração), nunca tamanho: o ícone não cresce nem
     * no toque nem enquanto ouve.
     */
    private fun applyListening(on: Boolean) {
        if (listening == on) return
        listening = on
        updateNotification()

        listeningPulse?.cancel()
        listeningPulse = null
        val image = overlayImage
        if (image == null) {
            Log.d(TAG, if (on) "Mascote ouvindo o pedido" else "Mascote de volta ao repouso")
            return
        }

        if (on) {
            listeningPulse = ObjectAnimator.ofFloat(image, View.ALPHA, 1f, 0.85f).apply {
                duration = 900L
                repeatMode = ValueAnimator.REVERSE
                repeatCount = ValueAnimator.INFINITE
                start()
            }
        } else {
            image.alpha = 1f
        }
        Log.d(TAG, if (on) "Mascote ouvindo o pedido" else "Mascote de volta ao repouso")
    }

    /** Atualiza a notificação do mascote (fala se está ouvindo). */
    private fun updateNotification() {
        if (!attached) return
        try {
            val manager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
                ?: return
            manager.notify(NOTIFICATION_ID, buildNotification())
        } catch (e: Exception) {
            Log.w(TAG, "Falha ao atualizar a notificação do mascote: ${e.message}")
        }
    }

    /** Reposiciona a janela do mascote. Só a view raiz pode ser movida. */
    private fun moveOverlay() {
        val view = overlayView ?: return
        val lp = params ?: return
        try {
            windowManager?.updateViewLayout(view, lp)
        } catch (e: Exception) {
            Log.w(TAG, "Falha ao mover o mascote: ${e.message}")
        }
    }

    /** Mantém o mascote inteiro dentro da tela, longe dos cantos do sistema. */
    private fun clampPosition(lp: WindowManager.LayoutParams) {
        val (screenWidth, screenHeight) = screenSize()
        val density = resources.displayMetrics.density
        val margin = (EDGE_MARGIN_DP * density).toInt()
        val maxX = (screenWidth - mascotSizePx).coerceAtLeast(0)
        val maxY = (screenHeight - mascotSizePx).coerceAtLeast(0)

        lp.x = lp.x.coerceIn(0, maxX)
        lp.y = lp.y.coerceIn(margin.coerceAtMost(maxY), maxY)
    }

    private fun screenSize(): Pair<Int, Int> {
        val wm = windowManager ?: getSystemService(Context.WINDOW_SERVICE) as? WindowManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && wm != null) {
            val bounds = wm.currentWindowMetrics.bounds
            return bounds.width() to bounds.height()
        }
        @Suppress("DEPRECATION")
        val metrics = resources.displayMetrics
        return metrics.widthPixels to metrics.heightPixels
    }

    private fun removeOverlay(stopService: Boolean) {
        // Trava antes de remover: se o serviço ainda estiver subindo, o
        // `addOverlay` não pode desenhar o mascote depois desta chamada.
        closing = true
        val view = overlayView
        overlayView = null
        overlayImage = null
        listeningPulse?.cancel()
        listeningPulse = null
        listening = false
        if (view != null && attached) {
            try {
                windowManager?.removeView(view)
            } catch (e: Exception) {
                Log.w(TAG, "Falha ao remover o mascote: ${e.message}")
            }
        }
        attached = false
        if (stopService) {
            try {
                ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
            } catch (e: Exception) {
                Log.w(TAG, "Falha ao remover a notificação do overlay: ${e.message}")
            }
            inForeground = false
            stopSelf()
        }
        Log.d(TAG, "Mascote flutuante ocultado")
    }

    private fun buildNotification(): Notification {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT
        }
        val pendingIntent = PendingIntent.getActivity(
            this,
            0,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("NEXUS em ação")
            .setContentText(
                if (listening) {
                    "Estou ouvindo: fale o seu pedido."
                } else {
                    "Toque para falar; toque duas vezes (ou segure) para abrir o assistente."
                }
            )
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val channel = NotificationChannel(
            CHANNEL_ID,
            "NEXUS — Mascote flutuante",
            NotificationManager.IMPORTANCE_LOW,
        ).apply {
            description = "Mantém o mascote do Nexus visível sobre outros aplicativos."
            setShowBadge(false)
        }
        val manager = getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        manager.createNotificationChannel(channel)
    }

    override fun onDestroy() {
        removeOverlay(stopService = false)
        try {
            ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        } catch (e: Exception) {
            Log.w(TAG, "Falha ao remover a notificação do overlay ao destruir", e)
        }
        inForeground = false
        instance = null
        super.onDestroy()
        Log.d(TAG, "Serviço de overlay destruído")
    }
}
