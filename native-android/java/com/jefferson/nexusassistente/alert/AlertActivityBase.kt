package com.jefferson.nexusassistente.alert

import android.animation.ObjectAnimator
import android.animation.ValueAnimator
import android.app.Activity
import android.app.NotificationManager
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.LayerDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import com.jefferson.nexusassistente.R
import com.jefferson.nexusassistente.reminder.ReminderActions
import com.jefferson.nexusassistente.reminder.ReminderReceiver
import com.jefferson.nexusassistente.service.NexusOverlayService
import com.jefferson.nexusassistente.storage.Reminder
import com.jefferson.nexusassistente.storage.ReminderStore
import java.util.Calendar
import java.util.Locale

/**
 * A tela que abre quando um lembrete ou um alarme toca.
 *
 * ## O que ela é
 *
 * Uma tela cheia, POR CIMA DE QUALQUER APLICATIVO (inclusive da tela de
 * bloqueio), com o mascote logo acima da descrição e DOIS botões na metade de
 * baixo da tela:
 *
 * - **Parar** — o Nexus cala na hora e o lembrete é CONCLUÍDO. O de uma vez só
 *   é apagado (a função dele foi cumprida); o diário continua valendo para
 *   amanhã, no mesmo horário.
 * - **Pausar** — a fala para e uma contagem de soneca de 5 SEGUNDOS começa
 *   (5…4…3…2…1 no próprio botão). No fim dela o Nexus volta a falar a mesma
 *   frase, em loop, até o usuário tocar em Parar.
 *
 * ## O que o Nexus fala
 *
 * SÓ "nome do usuário + descrição" (ex.: "Jefferson, trabalho.") — sem data e
 * sem hora, como o usuário pediu. A regra mora em [AlertSpeech]: alarme ou
 * lembrete criado com a palavra "trabalho" fala "nome do usuário + frase
 * motivacional" no lugar da descrição. A frase falada repete em loop.
 *
 * ## Sem duplicação
 *
 * - O mascote FLUTUANTE não aparece aqui: é uma tela do próprio Nexus, e o
 *   mascote grande já está nela (o flutuante só laga e trava).
 * - A notificação do lembrete é CANCELADA assim que esta tela abre: a tela
 *   já mostra e já fala tudo — repetir na barra seria barulho dobrado.
 */
abstract class AlertActivityBase : Activity() {

    companion object {
        private const val TAG = "NEXUS_ALERT"

        const val EXTRA_ID = "reminder_id"

        /** O instante deste toque — o diário já pode estar reagendado para amanhã. */
        const val EXTRA_AT = "reminder_at"

        /** Folga entre uma repetição da fala e a próxima. */
        private const val LOOP_GAP_MS = 900L

        /** A soneca do botão Pausar: 5 segundos e a fala volta. */
        private const val PAUSE_SECONDS = 5
    }

    private var engine: TextToSpeech? = null
    private var engineReady = false
    private var reminder: Reminder? = null

    /** O instante DESTE toque (o diário já pode estar reagendado para amanhã). */
    protected var fireAt: Long = System.currentTimeMillis()
        private set

    /** A frase que este toque fala ("Jefferson, trabalho."). */
    private var speechText: String = ""

    /** `true` enquanto a fala deve repetir (só Parar desliga). */
    @Volatile
    private var looping = false

    /** `true` durante a contagem de soneca do botão Pausar. */
    @Volatile
    private var paused = false

    private val mainHandler = Handler(Looper.getMainLooper())
    private var pauseRunnable: Runnable? = null
    private var mascotBreath: ObjectAnimator? = null
    private var pauseButton: Button? = null

    /** O que a tela é: "LEMBRETE" ou "ALARME". */
    protected abstract val kindLabel: String

    /**
     * Uma linha opcional embaixo da hora (o alarme usa para a frase do dia).
     *
     * Devolver `null` mantém a tela como sempre foi.
     */
    protected open fun screenNote(reminder: Reminder): String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val id = intent.getStringExtra(EXTRA_ID) ?: run {
            finish()
            return
        }
        val found = ReminderStore(this).get(id) ?: run {
            finish()
            return
        }
        reminder = found

        showOverLockScreen()

        /*
         * A hora na TELA é a DESTE toque (o diário já pode estar reagendado
         * para amanhã). A FALA não menciona hora nenhuma: o usuário pediu
         * "só o nome e a descrição".
         */
        fireAt = intent.getLongExtra(EXTRA_AT, found.triggerAtMillis)
        val spokenTime = spokenTimeOf(fireAt)

        // A TELA do sistema Nexus: o mascote flutuante não entra aqui.
        hideFloatingMascot()
        // A tela já mostra e já fala: a notificação da barra sai agora.
        cancelReminderNotification(found.id)

        /*
         * A FALA é construída ANTES da tela: o alarme "trabalho" sorteia a
         * frase motivacional na fala e a tela mostra a MESMA frase.
         */
        speechText = AlertSpeech.phraseFor(this, found)
        setContentView(buildScreen(found, spokenTime))
        Log.d(TAG, "Fala do alerta: \"$speechText\"")

        startSpeechLoop()
    }

    override fun onDestroy() {
        looping = false
        paused = false
        pauseRunnable?.let { mainHandler.removeCallbacks(it) }
        mascotBreath?.cancel()
        stopSpeaking()
        // A tela do alerta fechou: o mascote flutuante pode voltar (se o app
        // não estiver na frente — a regra do serviço continua mandando).
        try {
            NexusOverlayService.show(this)
        } catch (error: Exception) {
            Log.w(TAG, "Não consegui devolver o mascote flutuante: ${error.message}")
        }
        super.onDestroy()
    }

    // ------------------------------------------------------------------
    // Tela cheia, inclusive na tela de bloqueio
    // ------------------------------------------------------------------

    private fun showOverLockScreen() {
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            @Suppress("DEPRECATION")
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON,
            )
        }
    }

    // ------------------------------------------------------------------
    // A tela
    // ------------------------------------------------------------------

    private fun buildScreen(reminder: Reminder, spokenTime: String): View {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(28), dp(24), dp(28), dp(36))
            background = GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(Color.parseColor("#050B16"), Color.parseColor("#0B1424")),
            )
        }

        /*
         * O bloco central (mascote + descrição) fica no MEIO da tela e os
         * botões DESCIDOS, na metade de baixo: a descrição aparece inteira,
         * por maior que seja, sem brigar com os botões.
         */
        root.addView(
            View(this).apply {
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    0,
                    1.1f,
                )
            },
        )

        val mascot = ImageView(this).apply {
            setImageResource(R.drawable.nexus_mascote)
            adjustViewBounds = true
            contentDescription = "Mascote do Nexus"
            layoutParams = LinearLayout.LayoutParams(dp(118), dp(118)).apply {
                gravity = Gravity.CENTER_HORIZONTAL
                bottomMargin = dp(10)
            }
        }
        root.addView(mascot)
        breatheMascot(mascot)

        root.addView(
            TextView(this).apply {
                text = kindLabel
                setTextColor(Color.parseColor("#5FE3F5"))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
                letterSpacing = 0.18f
                gravity = Gravity.CENTER
                layoutParams = fullWidth(bottom = 8)
            },
        )

        /*
         * A descrição é o dono da tela: entra GRANDE, quebra em quantas
         * linhas precisar e o mascote fica LOGO ACIMA dela.
         *
         * No alarme/lembrete "trabalho" ela é a frase motivacional sorteada
         * (a mesma que está sendo falada).
         */
        val shown = if (AlertSpeech.isWorkSubject(reminder)) {
            speechText.substringAfter(", ").ifBlank { speechText }
        } else {
            reminder.description.ifEmpty { reminder.title }.ifEmpty { "seu lembrete" }
        }
        val description = TextView(this).apply {
            text = shown
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 28f)
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            gravity = Gravity.CENTER
            layoutParams = fullWidth(bottom = 10)
        }
        root.addView(description)
        enterFromBottom(description, delayMs = 60)

        root.addView(
            TextView(this).apply {
                text = spokenTime
                setTextColor(Color.parseColor("#9AA7BD"))
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
                gravity = Gravity.CENTER
                layoutParams = fullWidth(bottom = 14)
            },
        )

        val note = screenNote(reminder)
        if (!note.isNullOrBlank()) {
            root.addView(
                TextView(this).apply {
                    text = note
                    setTextColor(Color.parseColor("#5FE3F5"))
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
                    gravity = Gravity.CENTER
                    layoutParams = fullWidth(bottom = 14)
                },
            )
        }

        root.addView(
            View(this).apply {
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    0,
                    1f,
                )
            },
        )

        // Os botões: PARAR (vermelho) e PAUSAR (ciano), 3D, na metade de baixo.
        val stop = make3dButton(
            label = "Parar",
            baseColor = Color.parseColor("#E0435A"),
            bottomColor = Color.parseColor("#7E1F30"),
        ) { stopAndFinish() }
        val pause = make3dButton(
            label = "Pausar",
            baseColor = Color.parseColor("#0B7C93"),
            bottomColor = Color.parseColor("#06323D"),
        ) { pauseSpeaking() }
        pauseButton = pause
        enterFromBottom(pause, delayMs = 140)

        root.addView(
            LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER
                layoutParams = fullWidth(bottom = 0)

                addView(
                    stop.apply {
                        layoutParams = LinearLayout.LayoutParams(0, dp(62), 1f).apply {
                            marginEnd = dp(10)
                        }
                    },
                )
                addView(
                    pause.apply {
                        layoutParams = LinearLayout.LayoutParams(0, dp(62), 1f)
                    },
                )
            },
        )

        return root
    }

    /**
     * Botão com cara de 3D: corpo com gradiente, base escura (o "volume"),
     * brilho de toque (ripple) e um leve encolhimento quando o dedo pousa.
     */
    private fun make3dButton(
        label: String,
        baseColor: Int,
        bottomColor: Int,
        onClick: () -> Unit,
    ): Button {
        val density = resources.displayMetrics.density
        val corner = (26 * density).toInt()
        val depth = (7 * density).toInt()

        val body = GradientDrawable(
            GradientDrawable.Orientation.TOP_BOTTOM,
            intArrayOf(lighten(baseColor, 0.18f), baseColor),
        ).apply { cornerRadius = corner.toFloat() }

        val bottom = GradientDrawable().apply {
            setColor(bottomColor)
            cornerRadius = corner.toFloat()
        }

        val layers = LayerDrawable(arrayOf(bottom, body)).apply {
            setLayerInset(1, 0, 0, 0, depth)
        }

        val ripple = RippleDrawable(
            ColorStateList.valueOf(Color.argb(90, 255, 255, 255)),
            layers,
            null,
        )

        return Button(this).apply {
            text = label
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            isAllCaps = false
            background = ripple
            elevation = depth.toFloat()
            setOnClickListener { onClick() }
            setOnTouchListener { view, event ->
                when (event.actionMasked) {
                    MotionEvent.ACTION_DOWN -> {
                        view.animate()
                            .scaleX(0.95f).scaleY(0.95f)
                            .translationZ(0f)
                            .setDuration(90)
                            .start()
                    }
                    MotionEvent.ACTION_UP,
                    MotionEvent.ACTION_CANCEL,
                    -> {
                        view.animate()
                            .scaleX(1f).scaleY(1f)
                            .translationZ(depth.toFloat())
                            .setDuration(140)
                            .start()
                    }
                }
                false
            }
        }
    }

    private fun lighten(color: Int, factor: Float): Int {
        val r = (Color.red(color) + (255 - Color.red(color)) * factor).toInt()
        val g = (Color.green(color) + (255 - Color.green(color)) * factor).toInt()
        val b = (Color.blue(color) + (255 - Color.blue(color)) * factor).toInt()
        return Color.rgb(r.coerceIn(0, 255), g.coerceIn(0, 255), b.coerceIn(0, 255))
    }

    /** A coruja "respira" enquanto fala — o ícone nunca muda de tamanho de vez. */
    private fun breatheMascot(view: View) {
        mascotBreath = ObjectAnimator.ofFloat(view, View.SCALE_X, 1f, 1.06f).apply {
            duration = 900L
            repeatMode = ValueAnimator.REVERSE
            repeatCount = ValueAnimator.INFINITE
            addUpdateListener { animator ->
                val value = animator.animatedValue as Float
                view.scaleY = 1f + (value - 1f) * 0.85f
            }
            start()
        }
    }

    private fun enterFromBottom(view: View, delayMs: Long = 0) {
        view.alpha = 0f
        view.translationY = dp(18).toFloat()
        view.animate()
            .alpha(1f)
            .translationY(0f)
            .setStartDelay(delayMs)
            .setDuration(320)
            .start()
    }

    private fun fullWidth(bottom: Int): LinearLayout.LayoutParams =
        LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.WRAP_CONTENT,
        ).apply { bottomMargin = dp(bottom) }

    // ------------------------------------------------------------------
    // Os botões
    // ------------------------------------------------------------------

    /** PARAR: o Nexus cala, o lembrete é concluído e a tela fecha. */
    private fun stopAndFinish() {
        looping = false
        paused = false
        stopSpeaking()
        val current = reminder ?: return
        try {
            ReminderActions.complete(this, current)
        } catch (error: Exception) {
            Log.w(TAG, "Falha ao encerrar o lembrete: ${error.message}")
        }
        finishAlert(current.id)
    }

    /**
     * PAUSAR: a fala para e volta depois de 5 segundos.
     *
     * A contagem aparece no próprio botão (5…4…3…2…1). No zero a fala
     * recomeça do início e o botão volta a dizer "Pausar".
     */
    private fun pauseSpeaking() {
        if (paused) return
        paused = true
        try {
            engine?.stop()
        } catch (_: Exception) {
            // Nunca derruba a tela por causa da voz.
        }

        var remaining = PAUSE_SECONDS
        val tick = object : Runnable {
            override fun run() {
                val button = pauseButton ?: return
                if (!paused) {
                    button.text = "Pausar"
                    return
                }
                if (remaining <= 0) {
                    paused = false
                    button.text = "Pausar"
                    speakNow()
                    return
                }
                button.text = "Continua em $remaining"
                remaining -= 1
                mainHandler.postDelayed(this, 1_000L)
            }
        }
        pauseRunnable?.let { mainHandler.removeCallbacks(it) }
        pauseRunnable = tick
        mainHandler.post(tick)
    }

    /** Fecha a tela e tira a notificação do lembrete da barra. */
    private fun finishAlert(id: String) {
        cancelReminderNotification(id)
        finish()
    }

    private fun cancelReminderNotification(id: String) {
        try {
            val manager = getSystemService(NotificationManager::class.java)
            manager?.cancel(ReminderReceiver.notificationId(id))
        } catch (error: Exception) {
            Log.w(TAG, "Falha ao limpar a notificação: ${error.message}")
        }
    }

    private fun hideFloatingMascot() {
        try {
            NexusOverlayService.hide()
        } catch (error: Exception) {
            Log.w(TAG, "Falha ao esconder o mascote flutuante: ${error.message}")
        }
    }

    // ------------------------------------------------------------------
    // A voz (em loop, até Parar)
    // ------------------------------------------------------------------

    private fun startSpeechLoop() {
        looping = true
        paused = false
        engine = TextToSpeech(this) { status ->
            if (status != TextToSpeech.SUCCESS) {
                Log.w(TAG, "A voz do aparelho não está disponível")
                return@TextToSpeech
            }
            try {
                engine?.language = Locale.forLanguageTag("pt-BR")
                engine?.setSpeechRate(0.96f)
                engine?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                    override fun onStart(utteranceId: String?) {}

                    /**
                     * Uma repetição acabou: agenda a próxima (a não ser que o
                     * usuário tenha tocado em Parar ou Pausar).
                     */
                    override fun onDone(utteranceId: String?) {
                        if (looping && !paused) {
                            mainHandler.postDelayed(
                                { speakNow() },
                                LOOP_GAP_MS,
                            )
                        }
                    }

                    @Deprecated("Deprecated in Java")
                    override fun onError(utteranceId: String?) {
                        if (looping && !paused) {
                            mainHandler.postDelayed(
                                { speakNow() },
                                LOOP_GAP_MS * 2,
                            )
                        }
                    }
                })
                engineReady = true
                speakNow()
            } catch (error: Exception) {
                Log.w(TAG, "Falha ao preparar a voz do alerta: ${error.message}")
            }
        }
    }

    private fun speakNow() {
        if (!looping || paused || !engineReady) return
        try {
            engine?.speak(speechText, TextToSpeech.QUEUE_FLUSH, null, "nexus-alert")
        } catch (error: Exception) {
            Log.w(TAG, "Falha ao falar o alerta: ${error.message}")
        }
    }

    private fun stopSpeaking() {
        try {
            engine?.stop()
            engine?.shutdown()
        } catch (_: Exception) {
            // Desligar a voz nunca pode derrubar a tela.
        }
        engine = null
        engineReady = false
    }

    // ------------------------------------------------------------------
    // Auxiliares
    // ------------------------------------------------------------------

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    /**
     * A hora MOSTRADA (não falada): 12 HORAS com o período.
     *
     * "27/10, meio-dia e meia da tarde" — e não "14:30".
     */
    private fun spokenTimeOf(millis: Long): String {
        val calendar = Calendar.getInstance().apply { timeInMillis = millis }
        val day = "${calendar.get(Calendar.DAY_OF_MONTH)}/${calendar.get(Calendar.MONTH) + 1}"
        return "$day, ${spokenClockOf(millis)}"
    }

    /**
     * Só o relógio, com o período: "seis em ponto da manhã", "meio-dia e meia".
     */
    private fun spokenClockOf(millis: Long): String {
        val calendar = Calendar.getInstance().apply { timeInMillis = millis }
        val hour = calendar.get(Calendar.HOUR_OF_DAY)
        val minute = calendar.get(Calendar.MINUTE)

        val period = if (hour < 12) "da manhã" else if (hour < 18) "da tarde" else "da noite"
        val hour12 = if (hour % 12 == 0) 12 else hour % 12
        val hourWord = if (hour12 == 1) "uma" else hour12.toString()

        return when {
            hour == 12 && minute == 0 -> "meio-dia"
            hour == 12 && minute == 30 -> "meio-dia e meia"
            hour == 12 -> "meio-dia e ${minutesOf(minute)}"
            hour == 0 && minute == 0 -> "meia-noite"
            hour == 0 && minute == 30 -> "meia-noite e meia"
            hour == 0 -> "meia-noite e ${minutesOf(minute)}"
            minute == 0 -> "$hourWord em ponto $period"
            minute == 30 -> "$hourWord e meia $period"
            else -> "$hourWord e ${minutesOf(minute)} $period"
        }
    }

    /** 45 → "quarenta e cinco" (a escrita da tela, não a fala). */
    private fun minutesOf(minute: Int): String {
        val units = listOf(
            "zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito",
            "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis",
            "dezessete", "dezoito", "dezenove",
        )
        if (minute < units.size) return units[minute]

        val tens = listOf("", "", "vinte", "trinta", "quarenta", "cinquenta")
        val ten = minute / 10
        val unit = minute % 10
        return if (unit == 0) tens[ten] else "${tens[ten]} e ${units[unit]}"
    }
}
