package com.jefferson.nexusassistente.core

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import android.view.accessibility.AccessibilityNodeInfo
import com.jefferson.nexusassistente.contacts.ContactFinder
import com.jefferson.nexusassistente.media.RadioStreamManager
import com.jefferson.nexusassistente.rea.ReaLayoutAnalyzer
import com.jefferson.nexusassistente.service.NexusAccessibilityService
import com.jefferson.nexusassistente.weather.WeatherProvider

class NexusMasterEngine(
    private val context: Context,
    private val accessibilityService: NexusAccessibilityService
) {

    private val radioManager = RadioStreamManager(context)
    private val contactFinder = ContactFinder(context)
    private val weatherProvider = WeatherProvider(context)
    private val appDetector = AppDetector(context)
    
    private var conversationState: ConversationState = ConversationState.IDLE
    private var pendingContact: String? = null
    private var pendingMessage: String? = null
    private var pendingAction: PendingAction? = null
    private var pendingMediaAction: MediaAction? = null

    enum class ConversationState {
        IDLE,
        WAITING_CONTACT_NAME,
        WAITING_MESSAGE,
        WAITING_CONFIRMATION,
        WAITING_CALL_TYPE,
        WAITING_RADIO_NAME,
        WAITING_CITY_NAME,
        WAITING_MEDIA_QUERY
    }

    enum class PendingAction {
        SEND_WHATSAPP_MESSAGE,
        WHATSAPP_VOICE_CALL,
        WHATSAPP_VIDEO_CALL,
        LOCAL_CALL,
        PLAY_RADIO
    }

    enum class MediaAction {
        PLAY_YOUTUBE,
        PLAY_OITUBE,
        PAUSE,
        RESUME,
        NEXT,
        PREVIOUS,
        STOP
    }

    fun processCommand(command: String) {
        val cmd = command.lowercase().trim()
        Log.d("NEXUS_ENGINE", "Processando comando: $cmd (estado: $conversationState)")

        when (conversationState) {
            ConversationState.IDLE -> handleIdleState(cmd)
            ConversationState.WAITING_CONTACT_NAME -> handleWaitingContact(cmd)
            ConversationState.WAITING_MESSAGE -> handleWaitingMessage(cmd)
            ConversationState.WAITING_CONFIRMATION -> handleWaitingConfirmation(cmd)
            ConversationState.WAITING_CALL_TYPE -> handleWaitingCallType(cmd)
            ConversationState.WAITING_RADIO_NAME -> handleWaitingRadioName(cmd)
            ConversationState.WAITING_CITY_NAME -> handleWaitingCityName(cmd)
            ConversationState.WAITING_MEDIA_QUERY -> handleWaitingMediaQuery(cmd)
        }
    }

    private fun handleIdleState(cmd: String) {
        when {
            // WhatsApp messaging
            cmd.contains("enviar mensagem") || cmd.contains("mandar mensagem") -> {
                val contactName = extractTargetName(cmd, "mensagem")
                if (contactName.isNotBlank()) {
                    initiateWhatsAppMessage(contactName)
                } else {
                    conversationState = ConversationState.WAITING_CONTACT_NAME
                    pendingAction = PendingAction.SEND_WHATSAPP_MESSAGE
                    speak("Para quem você quer enviar a mensagem?")
                }
            }
            // WhatsApp calls
            cmd.contains("chamada de vídeo") || cmd.contains("ligar de vídeo") -> {
                val contactName = extractTargetName(cmd, "vídeo")
                if (contactName.isNotBlank()) {
                    initiateWhatsAppCall(contactName, true)
                } else {
                    conversationState = ConversationState.WAITING_CONTACT_NAME
                    pendingAction = PendingAction.WHATSAPP_VIDEO_CALL
                    speak("Para quem você quer fazer a chamada de vídeo?")
                }
            }
            cmd.contains("chamada de voz") || cmd.contains("ligar no whatsapp") -> {
                val contactName = extractTargetName(cmd, "voz")
                if (contactName.isNotBlank()) {
                    initiateWhatsAppCall(contactName, false)
                } else {
                    conversationState = ConversationState.WAITING_CONTACT_NAME
                    pendingAction = PendingAction.WHATSAPP_VOICE_CALL
                    speak("Para quem você quer fazer a chamada de voz?")
                }
            }
            // Local phone call
            cmd.contains("fazer ligação") || cmd.contains("ligar para") -> {
                val contactName = cmd.replace("fazer ligação para", "").replace("ligar para", "").trim()
                if (contactName.isNotBlank()) {
                    initiateLocalCall(contactName)
                } else {
                    conversationState = ConversationState.WAITING_CONTACT_NAME
                    pendingAction = PendingAction.LOCAL_CALL
                    speak("Para qual número ou contato você quer ligar?")
                }
            }
            // Radio
            cmd.contains("tocar rádio") -> {
                val radioName = cmd.replace("tocar rádio", "").trim()
                if (radioName.isNotBlank()) {
                    playRadio(radioName)
                } else {
                    conversationState = ConversationState.WAITING_RADIO_NAME
                    speak("Qual rádio você quer ouvir?")
                }
            }
            cmd.contains("parar rádio") || cmd.contains("desligar rádio") -> {
                radioManager.stopRadio()
                speak("Rádio desligada")
            }
            // Weather
            cmd.contains("clima") || cmd.contains("temperatura") || cmd.contains("tempo") -> {
                val cityName = extractCityName(cmd)
                if (cityName.isNotBlank()) {
                    getWeather(cityName)
                } else {
                    conversationState = ConversationState.WAITING_CITY_NAME
                    speak("De qual cidade você quer saber o clima?")
                }
            }
            // Media controls
            cmd.contains("pausar") || cmd.contains("parar música") -> {
                handleMediaControl(MediaAction.PAUSE)
            }
            cmd.contains("continuar") || cmd.contains("retomar") -> {
                handleMediaControl(MediaAction.RESUME)
            }
            cmd.contains("próxima") || cmd.contains("pular") || cmd.contains("next") -> {
                handleMediaControl(MediaAction.NEXT)
            }
            cmd.contains("anterior") || cmd.contains("voltar") || cmd.contains("previous") -> {
                handleMediaControl(MediaAction.PREVIOUS)
            }
            cmd.contains("parar") && !cmd.contains("rádio") -> {
                handleMediaControl(MediaAction.STOP)
            }
            // YouTube/OiTube playback
            cmd.contains("tocar no youtube") || cmd.contains("tocar youtube") || (cmd.contains("tocar") && cmd.contains("youtube")) -> {
                val query = cmd.replace("tocar no youtube", "").replace("tocar youtube", "").replace("tocar", "").trim()
                if (query.isNotBlank()) {
                    playYouTube(query)
                } else {
                    conversationState = ConversationState.WAITING_MEDIA_QUERY
                    pendingMediaAction = MediaAction.PLAY_YOUTUBE
                    speak("O que você quer tocar no YouTube?")
                }
            }
            cmd.contains("tocar no oitube") || cmd.contains("tocar oitube") || (cmd.contains("tocar") && cmd.contains("oitube")) -> {
                val query = cmd.replace("tocar no oitube", "").replace("tocar oitube", "").replace("tocar", "").trim()
                if (query.isNotBlank()) {
                    playOiTube(query)
                } else {
                    conversationState = ConversationState.WAITING_MEDIA_QUERY
                    pendingMediaAction = MediaAction.PLAY_OITUBE
                    speak("O que você quer tocar no OiTube?")
                }
            }
            else -> {
                speak("Não entendi o comando. Tente: enviar mensagem, fazer chamada, tocar música no OiTube, tocar rádio, ou perguntar o clima.")
            }
        }
    }

    private fun handleWaitingContact(cmd: String) {
        val contactName = cmd.trim()
        when (pendingAction) {
            PendingAction.SEND_WHATSAPP_MESSAGE -> initiateWhatsAppMessage(contactName)
            PendingAction.WHATSAPP_VOICE_CALL -> initiateWhatsAppCall(contactName, false)
            PendingAction.WHATSAPP_VIDEO_CALL -> initiateWhatsAppCall(contactName, true)
            PendingAction.LOCAL_CALL -> initiateLocalCall(contactName)
            else -> {}
        }
        conversationState = ConversationState.IDLE
        pendingAction = null
    }

    private fun handleWaitingMessage(cmd: String) {
        pendingMessage = cmd.trim()
        conversationState = ConversationState.WAITING_CONFIRMATION
        speak("A mensagem é: $pendingMessage. Posso enviar?")
    }

    private fun handleWaitingConfirmation(cmd: String) {
        val normalized = cmd.lowercase().trim()
        if (normalized.contains("sim") || normalized.contains("pode") || normalized.contains("envia") || normalized.contains("confirmo")) {
            pendingContact?.let { contactName ->
                pendingMessage?.let { message ->
                    sendWhatsAppMessage(contactName, message)
                }
            }
        } else {
            speak("Mensagem cancelada")
        }
        conversationState = ConversationState.IDLE
        pendingContact = null
        pendingMessage = null
    }

    private fun handleWaitingCallType(cmd: String) {
        conversationState = ConversationState.IDLE
    }

    private fun handleWaitingRadioName(cmd: String) {
        playRadio(cmd.trim())
        conversationState = ConversationState.IDLE
    }

    private fun handleWaitingCityName(cmd: String) {
        getWeather(cmd.trim())
        conversationState = ConversationState.IDLE
    }

    private fun handleWaitingMediaQuery(cmd: String) {
        val query = cmd.trim()
        when (pendingMediaAction) {
            MediaAction.PLAY_YOUTUBE -> playYouTube(query)
            MediaAction.PLAY_OITUBE -> playOiTube(query)
            else -> {}
        }
        conversationState = ConversationState.IDLE
        pendingMediaAction = null
    }

    private fun handleMediaControl(action: MediaAction) {
        // Try to use accessibility service to control media
        val root = accessibilityService.rootInActiveWindow
        if (root != null) {
            val packageName = root.packageName?.toString()
            when (packageName) {
                ReaLayoutAnalyzer.YOUTUBE_PACKAGE -> controlYouTubeMedia(root, action)
                ReaLayoutAnalyzer.OITUBE_PACKAGE -> controlOiTubeMedia(root, action)
                else -> {
                    // Fallback to radio manager for radio
                    when (action) {
                        MediaAction.PAUSE -> radioManager.pauseRadio()
                        MediaAction.RESUME -> radioManager.resumeRadio()
                        MediaAction.STOP -> radioManager.stopRadio()
                        else -> speak("Controle de mídia não disponível para este app")
                    }
                }
            }
        } else {
            // No active window, use radio manager as fallback
            when (action) {
                MediaAction.PAUSE -> radioManager.pauseRadio()
                MediaAction.RESUME -> radioManager.resumeRadio()
                MediaAction.STOP -> radioManager.stopRadio()
                else -> speak("Nenhuma mídia reproduzindo no momento")
            }
        }
    }

    private fun controlYouTubeMedia(root: AccessibilityNodeInfo, action: MediaAction) {
        val elementKey = when (action) {
            MediaAction.PLAY_YOUTUBE, MediaAction.RESUME, MediaAction.PAUSE -> "play_pause_button"
            MediaAction.NEXT -> "next_button"
            MediaAction.PREVIOUS -> "prev_button"
            else -> return
        }
        val node = reaAnalyzer.findTargetElement(root, ReaLayoutAnalyzer.YOUTUBE_PACKAGE, elementKey)
        node?.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        val message = when (action) {
            MediaAction.PAUSE -> "Pausado"
            MediaAction.RESUME -> "Retomado"
            MediaAction.NEXT -> "Próximo"
            MediaAction.PREVIOUS -> "Anterior"
            else -> "Controlado"
        }
        speak(message)
    }

    private fun controlOiTubeMedia(root: AccessibilityNodeInfo, action: MediaAction) {
        val elementKey = when (action) {
            MediaAction.PLAY_YOUTUBE, MediaAction.RESUME, MediaAction.PAUSE -> "play_pause_button"
            MediaAction.NEXT -> "next_button"
            MediaAction.PREVIOUS -> "prev_button"
            else -> return
        }
        val node = reaAnalyzer.findTargetElement(root, ReaLayoutAnalyzer.OITUBE_PACKAGE, elementKey)
        node?.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        val message = when (action) {
            MediaAction.PAUSE -> "Pausado"
            MediaAction.RESUME -> "Retomado"
            MediaAction.NEXT -> "Próximo"
            MediaAction.PREVIOUS -> "Anterior"
            else -> "Controlado"
        }
        speak(message)
    }

    private val reaAnalyzer = ReaLayoutAnalyzer()

    private fun initiateWhatsAppMessage(contactName: String) {
        val contact = contactFinder.searchContact(contactName)
        if (contact != null) {
            pendingContact = contact.name
            speak("Contato encontrado: ${contact.name}. Qual a mensagem?")
            conversationState = ConversationState.WAITING_MESSAGE
        } else {
            speak("Contato '$contactName' não encontrado na agenda")
            conversationState = ConversationState.IDLE
        }
    }

    private fun sendWhatsAppMessage(contactName: String, message: String) {
        val contact = contactFinder.searchContact(contactName)
        if (contact != null) {
            val opened = contactFinder.openWhatsAppChat(contact.phoneNumber)
            if (opened) {
                speak("Abrindo conversa com ${contact.name}")
                // The accessibility service will handle typing and sending when the window opens
            }
        }
    }

    private fun initiateWhatsAppCall(contactName: String, isVideo: Boolean) {
        val contact = contactFinder.searchContact(contactName)
        if (contact != null) {
            val opened = contactFinder.openWhatsAppChat(contact.phoneNumber)
            if (opened) {
                speak("${if (isVideo) "Iniciando chamada de vídeo" else "Iniciando chamada de voz"} com ${contact.name}")
                // Accessibility service will click the call button
            }
        } else {
            speak("Contato '$contactName' não encontrado")
        }
    }

    private fun initiateLocalCall(contactNameOrNumber: String) {
        val contact = contactFinder.searchContact(contactNameOrNumber)
        val number = contact?.phoneNumber ?: contactNameOrNumber
        val success = contactFinder.makeLocalCall(number)
        if (success) {
            speak("Ligando para $number")
        } else {
            speak("Não foi possível fazer a ligação. Verifique as permissões.")
        }
    }

    private fun playRadio(radioName: String) {
        val success = radioManager.playStation(radioName).success
        if (success) {
            speak("Tocando $radioName")
        } else {
            speak("Rádio '$radioName' não encontrada. Tente: ${radioManager.getAvailableStations().joinToString(", ")}")
        }
    }

    private fun playYouTube(query: String) {
        val success = appDetector.openYouTubeSearch(query)
        if (success) {
            speak("Tocando $query no YouTube")
        } else {
            speak("YouTube não está instalado")
        }
    }

    private fun playOiTube(query: String) {
        val success = appDetector.openOiTubeSearch(query)
        if (success) {
            speak("Tocando $query no OiTube")
        } else {
            speak("OiTube não está instalado")
        }
    }

    private fun getWeather(cityName: String) {
        speak("Buscando clima para $cityName...")
        // TODO: Implement async weather fetch
    }

    private fun extractTargetName(fullCommand: String, keyword: String): String {
        val patterns = listOf("para ", "pro ", "pra ")
        for (pattern in patterns) {
            val idx = fullCommand.lastIndexOf(pattern)
            if (idx >= 0) {
                return fullCommand.substring(idx + pattern.length).trim()
            }
        }
        return fullCommand.replace("enviar mensagem", "").replace("mandar mensagem", "").trim()
    }

    private fun extractCityName(cmd: String): String {
        val patterns = listOf("em ", "na ", "no ", "de ")
        for (pattern in patterns) {
            val idx = cmd.lastIndexOf(pattern)
            if (idx >= 0) {
                return cmd.substring(idx + pattern.length).trim()
            }
        }
        return ""
    }

    private fun speak(text: String) {
        Log.d("NEXUS_SPEAK", text)
        // TODO: Implement TTS callback to React Native
    }

    fun shutdown() {
        radioManager.release()
    }
}