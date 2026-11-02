# Voz do Nexus: ativação por palavra e voz nova (análise + plano)

> **Atualizado (outubro de 2026).** A **voz** é a do **próprio aparelho**, em
> português do Brasil, e o app escolhe a **melhor** voz que o aparelho tem: a
> local e neural quando existir (é o que tira o sotaque de robô da voz padrão do
> Android). Não há motor neural, modelo embutido nem servidor dentro do app — o
> APK não carrega nenhum peso de voz. O `expo-speech` fica como rede de
> segurança quando a ponte nativa não está disponível.
>
> A **ativação por palavra** continua fora do projeto: o detector KWS
> segurava um `AudioRecord` contínuo e travava o `SpeechRecognizer` do
> sistema. O microfone abre apenas no toque (botão do app ou mascote).
>
> Detalhe do que está no ar hoje: seção 4.5.

Documento de análise e de plano. Nada aqui está implementado ainda, exceto o que
está marcado como **[feito]**.

---

## 1. O que foi pedido

1. O mascote flutuante **não** pode aparecer dentro do app (só quando o app é
   minimizado).
2. Uma **alternativa de interação por chamado** (estilo Alexa): falar "Nexo" e o
   assistente acordar — **sem** o microfone ficar ligando/desligando e fazendo
   barulho.
3. Uma **voz nova**: feminina, "sexy", 18 anos, português brasileiro, gerada
   pelo Qwen3-TTS (repo `flybirdxx/ComfyUI-Qwen-TTS`), funcionando em modo
   online e offline.

---

## 2. Mascote sobre o app — **[feito]**

O mascote aparecia por cima da tela do próprio Nexus. Duas causas:

- **Corrida real**: `MainActivity.onResume` chama `hide()` no mascote, mas o
  serviço de overlay podia estar *subindo* nesse instante. O `hide` não achava
  nada para remover, o `addOverlay` continuava e o mascote ficava preso na tela.
- **Falta de trava**: o serviço só checava se a tela do assistente estava em
  primeiro plano no momento do `show` vindo do JS.

Correção (nativo, `NexusOverlayService.kt`):

- `closing`: trava setada em `removeOverlay`; `addOverlay` aborta se ela estiver
  ligada.
- `startOverlay` e `addOverlay` checam `MainActivity.isResumedForeground()`: com
  o app na frente, o mascote **não** aparece (e o serviço se encerra).
- No JS (`returnToStandby`): se o app está em primeiro plano, o Nexus **não**
  manda o usuário para a home nem chama o mascote — quem está com o app na frente
  continua com o app na frente.

---

## 3. Ativação por palavra: como a Alexa faz (e como o Nexus vai fazer)

### 3.1 O que a Alexa faz

A Alexa tem **duas camadas**:

| Camada | Onde roda | O que faz |
|---|---|---|
| Motor de wake word (DSP) | **no aparelho**, sempre ligado | escuta o micro em fluxo contínuo, baixo consumo, sem beep, sem nuvem |
| Reconhecimento + LLM | na nuvem | só entra em cena **depois** da palavra de ativação |

O ponto que importa: o microfone **nunca** fica "abrindo e fechando sessão" do
reconhecimento. Ele fica aberto o tempo todo num motor pequeno, e a palavra é
detectada localmente.

### 3.2 Por que o Nexus hoje faz barulho

O caminho antigo (`app/core/voiceSessionPolicy.mjs`, regra 1) usava o
`SpeechRecognizer` do Android em sessões curtas, em ciclo, procurando a palavra.
Isso produzia exatamente o que o usuário odiava: **bip do serviço de
reconhecimento** a cada sessão, microfone abrindo/fechando sem parar, bateria
descendo. A escuta passiva foi desligada por esse motivo (e o código comenta
isso).

### 3.3 O que substitui: keyword spotting on-device (sherpa-onnx)

O padrão correto no Android é **KWS (keyword spotting)**: um modelo pequeno, de
3M parâmetros, rodando em `AudioRecord` contínuo, que só avisa "achei a palavra".
O `SpeechRecognizer` só é aberto **depois** que a palavra foi detectada — uma
única vez, para o pedido.

Por que sherpa-onnx:

- Apache-2.0, **sem conta, sem chave de API, sem nuvem** (bate na exigência de
  não vazar nada).
- Tem **AAR oficial para Android** (`sherpa-onnx-1.13.8.aar`, ~25 MB) e app de
  exemplo de KWS — é a mesma base usada pelo `qwen-audio-agent` (projeto de voz
  full-duplex para OpenCode/Claude Code/Codex) e pela extensão de voz para VS
  Code, ou seja: é o padrão de mercado para "acordar chamando".
- Roda em CPU, com baixo consumo: o microfone fica aberto, mas não com o motor
  pesado de ASR.
- Modelo 3M (`sherpa-onnx-kws-zipformer-zh-en-3M`) + tokens do `espeak-ng`
  (pt-BR) para a palavra **"Nexo"** (e "Nexus"), que **não muda**.

Regras do Nexus com o KWS:

| Situação | Microfone | Comportamento |
|---|---|---|
| App na frente | fechado | só o botão de microfone (como hoje) |
| App minimizado, mascote visível | **aberto só no KWS** | "Nexo" → abre o `SpeechRecognizer` por **uma** captura |
| Captura em andamento | aberto (ASR) | uma sessão só, como hoje |
| Nexus falando | fechado | o Nexus não se ouve |

Ganho direto: some o bip (o ASR só abre depois da palavra) e o consumo cai
muito (modelo de 3M em vez do ASR completo rodando em ciclos).

---

## 4. A voz: o que o repo `ComfyUI-Qwen-TTS` é (e o que ele não é)

### 4.1 O que é

- É um **nó de ComfyUI** (Python) para o **Qwen3-TTS** da Alibaba: clonagem de
  voz, *voice design* (descrever a voz em texto) e vozes predefinidas.
- Modelos: `Qwen3-TTS-12Hz-1.7B-Base/VoiceDesign` + `Qwen3-TTS-Tokenizer-12Hz`
  (alguns GB).
- **Rodar exige**: ComfyUI + Python 3.10–3.12 + `torch`/`torchaudio` +
  `transformers==4.57.3` (ou >= 5) e, para velocidade, GPU NVIDIA.

### 4.2 O que ele NÃO é (e por que a ideia "online e offline" não fecha)

- **Não roda no celular.** Não existe build Android/ONNX dele. "Offline no
  Nexus" usando esse repo é impossível.
- **É servidor.** "Online" significaria: o Nexus manda o texto por HTTP para o
  ComfyUI (API `/prompt` + `/view`) e recebe o WAV. Funciona, mas o PC tem que
  estar ligado e o ComfyUI no ar.
- **Neste PC não dá.** Medido agora: i3-4130 (2 núcleos/4 threads), 16 GB RAM,
  Radeon RX 560 XT (sem CUDA), Python 3.14 instalado (o `torch` não tem wheel
  para 3.14). No CPU, o Qwen3-TTS 0.6B levaria dezenas de segundos por frase —
  inviável para um assistente.

Ou seja: a "voz feminina sexy de 18 anos, pt-BR" **é** o que o *VoiceDesignNode*
do Qwen3-TTS faz melhor, mas ele precisa de uma máquina com GPU NVIDIA (≥ 8 GB).

### 4.3 O que dá para ter **grátis, offline e no próprio celular**

Duas opções existiram. A segunda foi a adotada:

**a) Modelo embarcado (Kokoro, sherpa-onnx)** — foi o que estava no ar até
outubro de 2026 e foi **removido**:

- **Kokoro 82M int8 multi-lang v1.1** (`kokoro-int8-multi-lang-v1_1`): vozes
  `pf_dora`, `pf_alice` (femininas, **pt-BR**) e `pm_alex` (masculina).
- ~90 MB de modelo + 28 MB de vozes + AAR do sherpa-onnx com o `onnxruntime`
  em 4 arquiteturas: **346 MB de APK** para uma voz.
- Sem chave, sem conta, offline — mas dependia do eSpeak (que exige caminho de
  arquivo) e na maioria das vezes ficava mudo, caindo no TTS do sistema.
- Alternativas pt-BR: Piper `pt_BR-cadu/edresson/faber/jeff`, Coqui `pt-cv`,
  MMS `por`.

**b) A voz do próprio aparelho (adotada)** — o motor de voz que o Android já
traz:

- **Zero peso no APK** e zero configuração.
- A qualidade depende do que o aparelho tem: o Google TTS traz vozes neurais
  em pt-BR (`Cacilda`, `Katita`, `Maria`, `Yara`, `Athina`) que soam humanas,
  e as **locais** funcionam sem internet.
- O Nexus **escolhe** a melhor (ver 4.5) — em vez de herdar a padrão, que é a
  que soa robótica.

O "tom sexy de 18 anos" não vem do modelo: vem de **como o texto é escrito**
(fala do Nexus) + parâmetros de prosódia (velocidade, tom) + escolha da voz
feminina. Dá para chegar bem perto, e é instantâneo e grátis.

### 4.4 Desenho final da voz (adotado)

O Nexus fala por um **único** motor: o TTS do **próprio aparelho** (o mesmo de
"Acessibilidade › Texto para fala"). O app **escolhe** a voz em vez de herdar a
padrão do motor:

| Fonte | Quando | Como |
|---|---|---|
| **Voz do aparelho (nativa)** | padrão | `NexusDeviceVoice` escolhe a melhor voz pt-BR (local e neural, quando existir) e acerta o timbre |
| **`expo-speech`** | rede de segurança | o mesmo TTS do aparelho pelo Expo, quando a ponte nativa não está disponível ou falha |

Ganhos: **zero peso no APK** (o modelo antigo ocupava 346 MB), latência baixa,
funciona sem internet quando a voz é local, e a voz escolhida é a melhor que o
aparelho tem — em vez da `pt-BR-language-standard`, que é a que soa robótica.

### 4.5 O que está no ar hoje - **[feito]**

Voz do aparelho, sem nenhum modelo dentro do app:

| Peça | Onde | Tamanho |
|---|---|---|
| Motor Kotlin (escolhe a voz) | `native-android/java/.../voice/NexusDeviceVoice.kt` | ~12 KB |
| Ponte com o JS | `NexusNativeModule.speakVoice/stopVoice/listVoices` | - |
| Modelo de voz | **no aparelho** (o que o Google TTS já tem) | 0 no APK |

- **Como a voz é escolhida** (`NexusDeviceVoice.score`): primeiro a **local**
  (já baixada no aparelho: responde na hora e funciona sem internet), depois a
  **neural** (Wavenet/Enhanced), depois a de **nome feminino** do Google em
  português (Cacilda, Katita, Maria, Yara, Athina, Luciana), e por último a
  qualidade declarada pelo motor. A `pt-BR-language-standard` — a padrão do
  Google, a mais robótica — perde para todas.
- **Timbre:** altura 1,06 (sobe um pouco: a voz fica feminina) e velocidade 0,95
  (desce um pouco: a cadência fica humana, em vez de quem lê o texto correndo).
- **Falar:** `App.tsx` → `speakText` → `nexusNative.speakVoice()`. Se a ponte
  nativa falhar, o app cai no `expo-speech` (mesmo TTS, voz padrão). Se as duas
  falharem, o texto continua na tela. **O Nexus nunca fica mudo.**
- **Parar:** `stopSpeech()` corta as duas vozes — senão uma fala que caiu para o
  `expo-speech` continuaria depois do "parar".
- **Diagnóstico:** `listVoices()` devolve as vozes em português que o aparelho
  tem (a primeira é a escolhida) e o `logcat` mostra a escolha em `NEXUS_VOICE`.

**O que foi retirado** (e por quê):

- **Kokoro-82M + sherpa-onnx:** 114 MB de modelo + 28 MB de vozes + AAR com o
  `onnxruntime` em 4 arquiteturas. O APK passou de **346 MB para ~35 MB**. E o
  ganho era pequeno: a voz neural ficava em silêncio quando o eSpeak não
  achava os dicionários, ou seja, na maioria das vezes.
- **Qwen3-TTS (ComfyUI):** exige um PC com GPU NVIDIA ligado e rodando. Não é
  "offline no Nexus" — é um servidor. Fora do app.

**Se a voz ainda soar robótica**, o caminho é o próprio aparelho: baixar a voz
neural em português do Brasil em *Acessibilidade › Texto para fala* (o Google
TTS oferece "Cacilda", "Katita", "Maria", "Yara"). Depois de baixada, ela
aparece como voz **local** e o `NexusDeviceVoice` a escolhe sozinho.

---

## 5. Etapas (ordem sugerida)

1. **[feito]** Mascote nunca sobre o app.
2. **[feito]** Voz do aparelho com a melhor voz pt-BR escolhida
   (`NexusDeviceVoice`), timbre ajustado, `expo-speech` como rede de segurança e
   o Kokoro **removido** (o APK caiu de 346 MB para ~35 MB).
3. **KWS "Nexo"**: modelo 3M + `espeak-ng` pt-BR, escuta contínua só com o app
   minimizado, ao detectar a palavra abre **uma** captura do `SpeechRecognizer`.
4. **Adaptador Qwen3-TTS** (descartado): exigiria um PC com GPU NVIDIA ligado e
   rodando — não é "offline no Nexus", é um servidor. Fora do app.
5. Testes no aparelho: bateria, falso positivo do "Nexo", latência da fala.

---

## 6. Pendências/decisões do usuário

- **Voz**: a voz neural do aparelho (Cacilda, Katita, Maria, Yara) precisa estar
  **baixada** em *Acessibilidade › Texto para fala* para o Nexus a usar — o app
  escolhe sozinho, mas não pode baixar voz por conta própria. Fica a cargo do
  usuário, uma vez.
- **Palavra de ativação**: manter **"Nexo"** (o usuário pediu para não mudar) e
  aceitar "Nexus" como variante? O modelo KWS aceita várias palavras.
- O app tem permissão de microfone e serviço em primeiro plano: o KWS precisa
 两者 — microfone em foreground e电池Optimization desligada.
