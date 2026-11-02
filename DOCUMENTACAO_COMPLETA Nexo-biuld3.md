# NexusAssistente - Documentação Completa do Sistema

---

## 📋 Visão Geral

**NexusAssistente** é um assistente pessoal inteligente, modular e autônomo desenvolvido para Android com React Native / Expo. Diferente dos assistentes tradicionais dependentes de nuvem, o Nexus opera como o corpo central e núcleo de controle do dispositivo, funcionando tanto online quanto offline.

### Arquitetura Principal
- **Núcleo (Nexo)**: Responsável pela tomada de decisões, processamento de comandos locais, autoaprendizagem contínua e gestão completa de hardware e software do aparelho.
- **Apoio de Pesquisa (Gemini)**: Utilizado estritamente como banco de dados de pesquisa externa em tempo real quando o sistema necessita expandir conhecimento ou lidar com consultas complexas na nuvem.

---

## 🏗️ Estrutura do Código

```
NexusAssistente/
├── App.tsx                      # Componente principal (React Native/Expo)
├── package.json                 # Dependências e scripts
├── android/                     # Código nativo Android (Kotlin)
│   └── app/src/main/java/com/jefferson/nexusassistente/
│       ├── alert/               # Telas de alarme/lembrete (system overlay)
│       ├── media/               # Rádio, música, controles de mídia
│       ├── native/              # Bridge React Native ↔ Nativo
│       ├── reminder/            # Agendamento de alarmes/lembretes
│       ├── service/             # Serviços nativos (overlay, notificações, chamadas)
│       ├── storage/             # Persistência (SQLite/SharedPreferences)
│       ├── voice/               # Motor de voz (TTS/STT)
│       └── weather/             # Provedor de clima
├── app/
│   ├── core/                    # Lógica de negócio pura (testável)
│   │   ├── assistantTasks.mjs   # Lembretes/alarmes/anotações
│   │   ├── conversationBrain.mjs # Cérebro de conversa informal
│   │   ├── intentRouter.mjs     # Roteamento de comandos locais
│   │   ├── nativeCommands.mjs   # Roteador de comandos nativos
│   │   ├── neuralLearner.mjs    # Rede neural leve (JS puro)
│   │   ├── neuralIntent.mjs     # Intenções aprendidas
│   │   ├── notificationFlow.mjs # Fluxo de notificações WhatsApp
│   │   ├── voiceSessionPolicy.mjs # Política de microfone
│   │   └── ... (outros módulos)
│   ├── services/                # Serviços React Native
│   │   ├── nexusNative.ts       # Bridge para módulo nativo
│   │   ├── neuralMemory.ts      # Memória neural persistente
│   │   └── ...
│   └── ui/                      # Componentes de UI
└── native-android/              # Fonte de verdade do código nativo (Java/Kotlin)
```

---

## ✅ O que foi Corrigido e Melhorado (Build Atual)

### 🎨 **Interface de Alarme/Lembrete**
| Item | Antes | Depois |
|------|-------|--------|
| Mascote na tela | Aparecia (causava lag/travamento) | **Removido completamente** |
| Soneca | 5 segundos | **305 segundos (5min + 5s folga)** com contagem regressiva |
| Fala do alarme | Data/hora + nome + descrição | **Apenas "Nome + descrição"** (ex: "Jefferson, trabalho.") |
| Textos de confirmação | Exemplos longos | **Textos diretos**: "Alarme 'nome' criado" / "Lembrete 'nome' criado com sucesso" |

### 🎙️ **Reconhecimento de Voz e Entendimento "Sim/Não"**
| Funcionalidade | Melhoria |
|----------------|----------|
| **Tokens "Sim"** | Expandido de 20 para **50+ variações**: "sim", "pode ler", "leia", "fale", "prossiga na leitura", "prossiga leitura", "beleza", "vamos", "bora", "manda", "aceito", "pode falar", "continua", "continue", "prossegue", etc. |
| **Tokens "Não"** | Expandido para **30+ variações**: "não quero", "nao quero", "fechar", "não leia", "cancela", "cancelar", "deixa", "esquece", "negativo", "para", "recusa", "desiste", "chega", "basta", "não", "nao", etc. |
| **Confirmação de leitura** | Inclui "pode ler", "fale", "prossiga", "continua", "continue" |
| **Viés do reconhecedor (SHORT_ANSWER_BIAS)** | Expandido de 14 para **80+ palavras** para melhor reconhecimento de respostas curtas |
| **Passado para nativo** | Viés passado para `startDirectCapture()` em: botão microfone, wake word, toque no mascote, resposta de notificação |

### 📱 **Mascote Flutuante e Microfone**
| Problema | Solução |
|----------|---------|
| Mascote não abria microfone ao tocar | **Corrigido**: `onMascotTapped` agora passa `SHORT_ANSWER_BIAS` para `startDirectCapture()` |
| Microfone não reabria após resposta | **Corrigido**: `floatingMascotModeRef` reabre microfone automaticamente após fala (modo conversa contínua) |
| Viés de palavras não passado ao nativo | **Corrigido**: `SHORT_ANSWER_BIAS` passado em todas as chamadas `startDirectCapture()` |

### 📱 **Fluxo de Notificações WhatsApp (Novas Ações)**
| Tipo de Mídia | Comportamento |
|---------------|---------------|
| **Áudio** | Tenta reproduzir inline → se falha, abre WhatsApp no contato e reproduz lá |
| **Vídeo** | Abre WhatsApp no contato e reproduz lá |
| **Imagem** | Abre WhatsApp no contato → mostra imagem 5s → pergunta se quer responder → se sim: abre microfone → transcreve → envia → avisa "mensagem enviada" → volta ao Nexus |
| **Novas Ações** | `play-media-in-whatsapp`, `view-image-in-whatsapp`, `wait-and-ask-reply` |

### 🧠 **Rede Neural e Aprendizado**
| Melhoria | Detalhes |
|----------|----------|
| **Vocabulário neutro expandido** | Adicionadas gírias brasileiras: "manda", "faz", "ta", "tava", "to", "entao", "pq", "tb", "so" |
| **Novos verbos neutros** | "liga", "chama", "pesquisa", "abre", "fecha" |
| **Extração de parâmetros** | Nova função `extractParams()` para cidade, contato, query, estação |
| **Correção por sobreposição** | `CORRECTION_MIN_OVERLAP = 0.25` - aprende com 1 exemplo similar |

### 🌤️ **Clima e Pesquisa Web**
| Melhoria | Detalhes |
|----------|----------|
| **Fallback web** | Se Open-Meteo falhar, usa `searchWeb("clima agora {cidade}")` |
| **Unificação "tempo"/"clima"** | Regex unificada - "tempo" e "clima" são a mesma coisa |
| **Timeouts aumentados** | `CHAT_OPEN_TIMEOUT_MS: 10s→15s`, `VOICE_NOTE_MAX_MS: 120s→180s`, `VOICE_NOTE_GRACE_MS: 4s→8s` |

### 🎵 **Áudio WhatsApp (Playback)**
| Melhoria | Detalhes |
|----------|----------|
| **Labels "reproduzir"** | 18 variações PT-BR/EN (inclui "ouvir mensagem", "reproduzir voz", "play voice message", etc.) |
| **Labels "pausar"** | 4 variações ("pausar", "pause", "parar", "stop") |
| **Timeouts** | `CHAT_OPEN_TIMEOUT_MS: 10s→15s`, `VOICE_NOTE_MAX_MS: 120s→180s`, `VOICE_NOTE_GRACE_MS: 4s→8s` |

### 🔧 **Otimizações e Correções Gerais**
| Área | Melhoria |
|------|----------|
| **Filtro "lista de transmissão"** | Regex mais restritiva - exige "lista de/da/do/minha + transmissao" |
| **Pending flows reordenados** | Movidos ANTES do `resolveLocalCommand` (corrige "olá" ser saudação em vez de resposta) |
| **Microfone wake word** | Passa `SHORT_ANSWER_BIAS` para melhor reconhecimento |
| **Botão microfone** | Passa `SHORT_ANSWER_BIAS` para melhor reconhecimento |
| **Resposta notificação** | Passa bias para `startDirectCapture`/`startNotificationAnswerCapture` |
| **Build otimizado** | Removidos códigos duplicados, imports não usados, código morto |

---

## 📱 **Estrutura de Arquivos Principais (Resumo)**

### App.tsx (Principal)
- **Gerenciamento de estado**: mensagens, busy, speaking, capturing, pending flows
- **Handlers**: microfone, mascot tap, wake word, foreground/background
- **Processamento de comandos**: `processNativeCommand` com prioridade de pending flows
- **TTS**: `speakText` com token de interrupção e gate de fala

### app/core/notificationFlow.mjs
- **Fluxo completo**: ask-read → playing-audio → ask-reply → listening → confirm-send
- **Novas ações**: `play-media-in-whatsapp`, `view-image-in-whatsapp`, `wait-and-ask-reply`
- **Mídia**: áudio tenta inline → fallback WhatsApp; vídeo/imagem abrem no WhatsApp

### app/core/nativeCommands.mjs
- **Roteador determinístico**: WhatsApp, chamadas, rádio, mídia, clima, apps
- **Regex melhorada**: "lista de transmissão" vs "alice de transmissão"
- **Clima unificado**: "tempo" = "clima" com fallback web

### app/core/neuralLearner.mjs
- **Rede neural leve**: Feedforward 256→32→N + Naive Bayes (word-model)
- **Aprendizado**: `train()`, `learnFromCorrection()`, `registerNegative()`
- **Extração de parâmetros**: `extractParams()` para cidade, contato, query

### android/app/src/main/java/.../alert/AlertActivityBase.kt
- **Tela system overlay** (acima de lockscreen)
- **Soneca**: 305s com contagem regressiva no botão
- **Sem mascote** (conforme solicitado)
- **Botões 3D** com spring physics (OvershootInterpolator)

### native-android/.../NexusAccessibilityService.kt
- **Labels expandidas**: 18 variações "reproduzir", 4 "pausar"
- **Timeouts**: `CHAT_OPEN_TIMEOUT_MS=15s`, `VOICE_NOTE_MAX_MS=180s`, `GRACE_MS=8s`
- **Labels PT-BR/EN** completas para controles de voz

---

## ⚠️ O que Falta Melhorar (Backlog)

### 🎯 **Prioridade Alta**
1. **Auto-update system**: Implementar atualização automática via GitHub Releases / Expo Updates
2. **Testes automatizados**: Cobertura de testes unitários para `notificationFlow`, `nativeCommands`, `neuralLearner`
3. **Logs estruturados**: Sistema de logging unificado (React Native + Nativo) para debug remoto

### 🎯 **Prioridade Média**
4. **Wake word "Nexo"**: Melhorar precisão e reduzir falsos positivos
5. **Offline-first completo**: Cache de respostas Gemini para uso offline
6. **Backup/restore**: Exportar/importar configurações, memória neural, lembretes

### 🎯 **Prioridade Baixa**
7. **Widget desktop**: Companion app para Windows/Mac
8. **Multi-idioma**: Suporte a inglês/espanhol além do PT-BR
9. **Temas visuais**: Modo claro/escuro, cores personalizáveis

---

## 🚀 Como Buildar e Instalar

```bash
# 1. Limpar build anterior
cd android
.\gradlew clean

# 2. Build release
.\gradlew assembleRelease --no-daemon

# 3. Instalar no dispositivo (USB debugging ativo)
adb install -r app/build/outputs/apk/release/app-release.apk

# 4. Ver logs
adb logcat -c
adb shell monkey -p com.jefferson.nexusassistente -c android.intent.category.LAUNCHER 1
adb logcat --pid=$(adb shell pidof com.jefferson.nexusassistente) -v brief
```

---

## 📦 Publicação no GitHub

### Repositório Privado (Código Fonte)
```
github.com/seu-usuario/NexusAssistente (Private)
├── .github/workflows/          # CI/CD para build automático
├── android/                    # Código nativo
├── app/                        # Lógica React Native
├── native-android/             # Fonte de verdade nativo
├── App.tsx                     # Entry point
├── package.json
└── DOCUMENTACAO_COMPLETA.md
```

### Repositório Público (Releases + APK)
```
github.com/seu-usuario/NexusAssistente-Releases (Public)
├── releases/
│   ├── v1.0.0/
│   │   ├── app-release.apk
│   │   ├── checksums.txt
│   │   └── CHANGELOG.md
│   └── latest/
│       └── app-release.apk (symlink para latest)
├── docs/
│   ├── INSTALACAO.md
│   ├── COMANDOS.md
│   └── PERMISSOES.md
└── README.md
```

### GitHub Actions (CI/CD)
```yaml
# .github/workflows/release.yml
name: Release Build
on:
  push:
    tags: ['v*']
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Setup JDK 21
        uses: actions/setup-java@v4
        with: { java-version: '21', distribution: 'temurin' }
      - name: Setup Android SDK
        uses: android-actions/setup-android@v3
      - name: Build Release APK
        run: cd android && ./gradlew assembleRelease
      - name: Upload APK
        uses: actions/upload-artifact@v4
        with: { name: app-release, path: android/app/build/outputs/apk/release/app-release.apk }
      - name: Create Release
        uses: softprops/action-gh-release@v1
        with:
          files: android/app/build/outputs/apk/release/app-release.apk
          generate_release_notes: true
```

---

## 🔄 Sistema de Auto-Update (Próximo Passo)

### Opção 1: Expo Updates (Recomendado)
```bash
# Configurar no app.json
"expo": {
  "updates": {
    "enabled": true,
    "fallbackToCacheTimeout": 30000,
    "checkAutomatically": "ON_LOAD",
    "url": "https://u.expo.dev/SEU_PROJECT_ID"
  }
}
```

### Opção 2: GitHub Releases + Native Module
```kotlin
// NexusNativeModule.kt - Verificar atualizações
@ReactMethod
fun checkForUpdates(promise: Promise) {
    // Baixar latest release do GitHub
    // Comparar versionCode
    // Se novo: baixar APK → instalar via PackageInstaller
}
```

### Opção 3: Expo Application Services (EAS)
```bash
eas update --branch production --message "Bug fixes and improvements"
```

---

## 📝 Changelog Resumido (v1.0.0 → Atual)

### v1.2.0 (Build Atual)
- ✅ Interface alarme/lembrete sem mascote
- ✅ Soneca 305s com contagem regressiva
- ✅ Entendimento "sim/não" expandido (80+ variações)
- ✅ Mascote flutuante: microfone reabre automaticamente
- ✅ Viés de palavras passado ao nativo em todas as capturas
- ✅ Novas ações notificação: mídia no WhatsApp, imagem com resposta
- ✅ Labels áudio WhatsApp expandidas (PT-BR/EN)
- ✅ Timeouts aumentados para robustez
- ✅ Filtro "lista transmissão" mais preciso
- ✅ Pending flows reordenados (corrige "olá" como resposta)
- ✅ Textos alarme/lembrete simplificados
- ✅ Filtro "lista transmissão" vs "alice" corrigido
- ✅ Timeouts áudio WhatsApp aumentados
- ✅ Labels áudio expandidas (18 play, 4 pause)
- ✅ Viés palavras passado ao nativo em todas capturas

---

## 📞 Contato e Suporte

- **Desenvolvedor**: Jefferson
- **Dispositivo testado**: Motorola Moto G84 5G (Android 14/15)
- **Versão Android**: minSdk 24, targetSdk 36
- **React Native**: 0.86.3 / Expo SDK 57

---

*Documentação gerada automaticamente em 24/10/2026*
*Última atualização: Build v1.2.0*