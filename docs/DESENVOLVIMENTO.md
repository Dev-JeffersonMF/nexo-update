# Nexus Assistente — nota de desenvolvimento

Documento de registro do desenvolvimento: o que foi construído, por que cada
decisão foi tomada desse jeito, o que já está verificado e **o que ainda não dá
para afirmar**. Escrito para quem (inclusive eu, depois) precisar continuar sem
repetir o caminho nem acreditar em promessa que o código não cumpre.

Última atualização: rede neural de aprendizado + tempo/clima + cérebro de
conversa + alarme conversacional (seção 12).

---

## 1. A ideia

Um assistente pessoal no estilo Jarvis, rodando em Android, que:

- ouve comandos falados (dentro do app e por toque no mascote flutuante);
- **liga** para pessoas (chamada normal do aparelho) e faz chamadas de
  **WhatsApp** de voz e vídeo — canais separados, sem ambiguidade;
- **pesquisa telefone de lugares na internet** (UPA, táxi, farmácia…) sem abrir
  navegador, **fala o nome e o número para confirmação** e só então liga;
- **lê notificações do WhatsApp**, pergunta antes de ler, toca áudio, capta a
  resposta por voz, **escreve no chat sem enviar**, pede confirmação e só então
  envia (ou apaga o que escreveu);
- guarda **anotações** e cria **lembretes/despertador** por dia, hora e minuto,
  lendo os agendados em voz alta, com editar/apagar/desativar;
- conversa (saudação pelo nome, frase do dia, manchetes reais, dúvidas gerais).

Regra que atravessa tudo: **nunca fingir**. Se o Nexus não conseguiu fazer algo,
ele diz que não conseguiu — em vez de anunciar sucesso.

---

## 2. Arquitetura em três camadas

```
┌─────────────────────────────────────────────────────────────────┐
│ App.tsx            orquestração: fala, mostra, decide a ordem   │
├─────────────────────────────────────────────────────────────────┤
│ app/core/*.mjs     REGRAS PURAS (sem rede, sem aparelho,        │
│                    sem armazenamento) — testáveis com `npm test`│
│ app/services/*.ts  ponte com o mundo (fetch, módulo nativo)     │
├─────────────────────────────────────────────────────────────────┤
│ native-android/    Kotlin: microfone, acessibilidade, alarmes,  │
│                    notificações, armazenamento local            │
└─────────────────────────────────────────────────────────────────┘
```

Por que separar assim: as decisões **sensíveis** (o texto que vai ser falado, se
é "sim" ou "não", qual canal de ligação, se o áudio toca agora ou depois) moram
nos módulos `.mjs`, que rodam em `npm test` — **sem aparelho**. O Kotlin só
executa o que já foi decidido e devolve o **resultado real**, que é o que o app
fala para o usuário.

Os `.mjs` têm arquivos `.d.mts` ao lado com os tipos: o TypeScript confere o
contrato sem deixar o núcleo virar código dependente do React Native.

---

## 3. Mapa dos arquivos

### Núcleo puro (`app/core/`)

| Arquivo | Responsabilidade |
| --- | --- |
| `nativeCommands.mjs` | Roteador PT-BR: rádio, música, mídia, abrir apps, WhatsApp, chamadas, ligação local. Contém `parseLookupTarget` (ordem invertida "pesquise o número de X e ligue") e a flag `lookup` para lugares. |
| `intentRouter.mjs` | Respostas locais (saudação pelo nome, ajuda, horas, data, cálculo), links diretos e a **guarda** que impede "pesquise o número da UPA **e ligue**" de virar pesquisa na web. |
| `phoneLookup.mjs` | Monta a consulta, lê o HTML do DuckDuckGo, pontua candidatos e escolhe o telefone mais provável. |
| `notificationFlow.mjs` | Máquina de estados da conversa de uma notificação (chamada/áudio/texto → ler → responder → confirmar). |
| `assistantTasks.mjs` | Anotações e lembretes: intenção, horário (`parseWhen`), títulos, formatação falada. |
| `voiceSessionPolicy.mjs` | Quando o mascote aparece, quando o microfone abre e o que dizer no fim de cada captura. |
| `dailyExtras.mjs` | Frase do dia (lista fixa, escolhida pelo dia) e manchetes (leitura de RSS). |
| `conversationPrivacy.mjs` | Seleção do histórico enviado ao modelo (o que sai e o que fica). |
| `notificationMessage.mjs` | Transforma a notificação em frase falada. |
| `geminiClient.mjs` | Requisição/resposta do Gemini e tradução de erros para PT-BR. |
| `permissionPlan.mjs` | Quais permissões pedir, em que ordem e com que explicação. |

### Serviços (`app/services/`)

- `nexusNative.ts` — **a ponte**: tipos, métodos e eventos do módulo nativo.
  Todo `invoke` tem um valor de reserva, então uma falha do nativo nunca quebra
  a tela.
- `phoneLookup.ts` / `newsFeed.ts` — `fetch` no aparelho (DuckDuckGo HTML e
  feeds RSS do G1). **Nunca abrem navegador.**
- `assistantApi.ts`, `nexusProfile.ts`, `nexusPermissions.ts` — modelo, perfil e
  permissões.

### Interface (`app/ui/`)

- `theme.ts` — a fonte única de cores, espaçamentos, raios e tipografia. A
  paleta é escura com o ciano do mascote como destaque. **Nenhuma tela escreve
  hexadecimal solto.**
- `motion.tsx` — blocos de animação reutilizáveis (`FadeSlideIn`, `PopIn`,
  `Pulse`, `TypingDots`). Só `Animated` do React Native, com
  `useNativeDriver: true`.
- `Mascot.tsx` — a coruja viva. A arte continua sendo a mesma (três poses em
  `assets/`); o que o componente acrescenta é o **movimento**: ela respira e
  flutua parada, flutua mais rápido e acende o brilho das antenas quando está
  ouvindo, inclina de leve quando está pensando e pulsa quando fala. Depois de
  um tempo parada ela **adormece** (crossfade para a pose de sono) e acorda
  sozinha. Se o aparelho pedir menos movimento, ela fica estática.

### Nativo (`native-android/`)

- `voice/NexusVoiceEngine.kt` — dono único do microfone (duas portas: botão do
  app e toque no mascote; nunca as duas juntas) + **VAD**.
- `voice/NexusDeviceVoice.kt` — a voz do Nexus: o TTS do **próprio aparelho**
  (pt-BR). Escolhe a melhor voz em português que o aparelho tem (a local e
  neural, quando existir) e acerta o timbre (altura 1,06, velocidade 0,95).
  Sem modelo embutido: o APK não carrega nenhum peso de voz.
- `service/NexusAccessibilityService.kt` — faz o trabalho braçal no WhatsApp:
  abrir conversa, escrever/enviar/apagar, tocar áudio, iniciar chamada, atender,
  recusar.
- `service/NexusNotificationListenerService.kt` — lê notificações do WhatsApp e
  classifica (`message`, `voice-call`, `video-call`, `missed-call`, `isAudio`).
- `service/NexusOverlayService.kt` — mascote flutuante.
- `storage/NoteStore.kt`, `storage/ReminderStore.kt`, `storage/ProfileStore.kt`
  — JSON em `SharedPreferences`.
- `reminder/ReminderScheduler.kt`, `reminder/ReminderReceiver.kt`,
  `reminder/BootReceiver.kt` — `AlarmManager`, disparo e reagendamento no boot.
- `native/NexusNativeModule.kt` — todos os `@ReactMethod` e o canal de eventos.
- `rea/ReaLayoutAnalyzer.kt` — mapa de seletores do WhatsApp.

### Plugins e configuração

- `plugins/nexus-native.js` — gera `android/` a partir de `native-android/`:
  copia fontes, registra serviços/receptores e declara permissões.
- `app.json` + `app.config.js` — declaram as mesmas permissões e o plugin.
  **Os dois precisam ficar em sincronia** (há teste garantindo isso).

> `android/` é gerado e ignorado pelo git. **A fonte da verdade é
> `native-android/`.** Nunca editar `android/` na mão.

---

## 4. O que foi construído, por etapa

### Etapa 1 — Interface e primeiro uso
Tema em `app/ui/theme.ts`, telas de splash/boas-vindas/permissões e um fluxo de
onboarding que pede as permissões uma a uma, explicando cada uma. Animações só
com `Animated` do próprio React Native (sem biblioteca extra).

### Etapa 2 — Pesquisa de telefone e ligação
`phoneLookup.mjs` + `phoneLookup.ts`: consulta o endpoint HTML do DuckDuckGo,
lê os resultados e escolhe o número por pontuação. O app **fala o nome e o
número** e espera o "sim" antes de discar. Números nunca são discados
automaticamente.

### Etapa 3 — Canais de ligação separados
`nativeCommands.mjs` distingue, por palavra:

| Fala | O que acontece |
| --- | --- |
| `liga para amor` | chamada **normal** do aparelho |
| `liga para amor via whatsapp` | chamada de **voz** no WhatsApp |
| `ligar para amor chamada de vídeo` | chamada de **vídeo** no WhatsApp |
| `pesquise o número da UPA de Matozinhos e ligue` | **pesquisa** o número, confirma e liga pelo aparelho |

Contatos são sempre resolvidos pela **agenda** pelo nome falado; `lookup: true`
(ir à internet) só vale para lugares ou pesquisa explícita. Lugares **nunca** vão
para o WhatsApp: ligam pelo aparelho.

Depois de **enviar uma mensagem** pelo comando direto, o WhatsApp fica na frente
e o usuário ficaria preso nele. Quando o envio termina com sucesso, o Nexus volta
para a home e deixa o mascote flutuante esperando o próximo comando — o mesmo
repouso usado no fim da fila de notificações. Se o serviço de acessibilidade não
estiver disponível para ir à home, o app traz a própria tela do Nexus para a
frente como plano B.

### Etapa 4 — Notificações: ler, ouvir e responder por voz
Estado em `notificationFlow.mjs` (puro) e execução em `App.tsx`:

```
chamada   → "Chamada de voz de X. Quer atender?"   → atender / recusar
perdida   → "Chamada perdida de X. Quer que eu ligue de volta?" → ligar de volta
áudio     → "Chegou um áudio de X. Quer ouvir?"    → tocar → "Quer responder?"
texto     → "Mensagem de X. Quer que eu leia?"     → ler → "Quer responder?"
responder → capta a fala → escreve no chat SEM enviar → "Posso enviar?"
             sim → envia      não → apaga e volta ao repouso
```

Decisões que valem registro:

- **Chamada perdida não pergunta "quer atender?"** — seria uma ação impossível.
  Passou a ter tipo próprio (`missed-call`) e oferece **ligar de volta**, que é
  uma capacidade real.
- **Atender/recusar é melhor esforço e honesto.** Não existe API para atender:
  o serviço de acessibilidade procura o botão pelo **nome acessível**
  ("Atender"/"Recusar") e toca no centro. Sem botão, devolve `false` e o Nexus
  pede para o usuário tocar — nunca anuncia "atendida".
  (Antes, "sim" chamava o contato de volta por engano: era um falso positivo.)
- **Chamada tocar** é reconhecida pela notificação de verdade
  (`CATEGORY_CALL` + notificação contínua), não pelo texto. "Chamada perdida"
  tem palavra-chave própria e **não** é promovida a "chamada para atender".
- **Áudio** só é marcado como áudio quando o **próprio WhatsApp** escreve isso.
  Notificação sem texto pode ser foto ou figurinha — o Nexus pergunta de forma
  neutra a respeito.
- **Tocar áudio espera terminar** (`waitForVoiceNoteEnd`, teto de 2 min): a
  pergunta "quer responder?" só vem depois. Nada de `sleep` de tempo fixo.
- **O controle de reprodução é achado pelo nome acessível**, não pelo texto.
  Uma mensagem que diga "vou ouvir depois" contém "ouvir" — se o texto fosse
  aceito, o Nexus tocaria na bolha da mensagem em vez de tocar o áudio.
- **Falha essencial para o fluxo.** Se escrever/enviar/apagar falhar, a conversa
  termina: o app já disse o que houve, e continuar perguntando "posso enviar?"
  seria confirmar uma resposta que nem chegou no chat.
- **Quem fala "enviada"/"apagada" é quem executou** — o módulo puro nunca
  promete sucesso (os `say` desses passos são vazios de propósito).

### Etapa 5 — Voz com separação de fala e barulho (VAD)
O reconhecedor do Google **não responde "nada" ao ruído**: responde uma frase.
Sem julgar isso, a televisão ligada virava pedido de música. A solução **não**
reescreve `AudioRecord` — usa o volume que o próprio reconhecedor entrega:

- `onRmsChanged` alimenta `noteRms`: o piso do ambiente cai rápido (silêncio
  chegou) e sobe devagar (barulho passageiro não vira "o novo silêncio") e **não
  sobe durante fala** (senão a própria fala seria rebaixada a ruído).
- Passar do piso por `SPEECH_MARGIN_DB` = houve fala.
- `onBeginningOfSpeech` e `onPartialResults` também marcam fala.
- **Sem amostras de volume o Nexus não julga** (`MIN_VAD_SAMPLES`): prefere ouvir
  demais a inventar surdez e recusar um pedido real.
- Frase vinda de barulho termina como `noise` (nunca como comando).
- `onEndOfSpeech` marca o fim da fala; o **teto do pedido** (15 s) se estende
  até 3 vezes enquanto ainda há fala — antes, uma frase longa era cortada no meio
  (o teto ignorava que havia fala; era um bug real).
- Erros viraram motivos distintos: `silence` (nem falou), `network` (o
  reconhecimento é online e a internet falhou), `error` (microfone), `noise`.
  Antes tudo chegava como `error`, e o app dava sempre o mesmo conselho, muitas
  vezes errado.

### Extras de conversa
- **Saudação pelo nome e pela hora**: "Bom dia, Jefferson! Estou aqui."
- **Previsão do tempo** falada (`nativeCommands.mjs` → nativo `WeatherProvider`,
  via Open-Meteo).
- **Frase do dia**: lista fixa, escolhida pelo dia do calendário (mesma frase o
  dia inteiro) — nada inventado pelo modelo.
- **Manchetes e fofocas**: títulos reais dos feeds RSS do G1 (`newsFeed.ts`), com
  o nó `dailyExtras.mjs` só formatando a fala. Feed fora do ar = "não consegui
  buscar", nunca uma notícia inventada.
- Esses pedidos são atendidos **depois** de todo comando explícito, para "abre o
  YouTube e vê as notícias" não virar leitura em voz alta.

---

## 5. Detalhes que evitam falso positivo

- **Confirmação de ligação pesquisada** e as respostas da conversa de
  notificação são interceptadas **antes** do roteador de comandos. Sem isso,
  um "sim" sozinho cairia em "confirmar envio" do WhatsApp.
- `CALL_TOKENS` em `intentRouter.mjs`: um pedido com verbo de ligação não pode
  ser capturado pela pesquisa na web.
- `REMINDER_TERMS` não inclui mais `aviso`/`avisos` (pegava conversa comum);
  passou a usar `me avisa` / `me avise` / `me avisar`.
- Na etapa `listening` da resposta, **qualquer** texto é a resposta (é o que o
  usuário ditou). Cancelar exige palavra explícita (`cancela`, `deixa`,
  `esquece`, `desiste`) em até 3 palavras — um "não" ditado como resposta é
  tratado como resposta, e a confirmação seguinte resolve. Preferimos não perder
  o recado a cancelar por engano.
- Texto que não é resposta curta, numa pergunta do fluxo, **encerra a conversa**
  (devolvendo a mídia) e segue como comando normal.

---

## 6. Como verificar

```bash
npm test           # regras puras + contratos (162 testes)
npm run typecheck  # tsc --noEmit
npm run lint       # expo lint
```

O build do nativo (o que realmente valida o Kotlin) é:

```powershell
$env:NODE_ENV = "production"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
npx expo prebuild --clean --platform android --no-install
# recriar android/local.properties (o prebuild --clean apaga):
#   sdk.dir=C\:\\Users\\<voce>\\AppData\\Local\\Android\\Sdk
cd android
.\gradlew.bat app:assembleRelease -PreactNativeArchitectures=arm64-v8a
adb install -r app\build\outputs\apk\release\app-release.apk
```

`-PreactNativeArchitectures=arm64-v8a` não é preferência: com o espaço no
caminho do projeto, compilar o C++ de 32 bits estoura o limite de caminho do
CMake. O APK de release é assinado com a chave de debug (padrão do Expo
prebuild), então instala por cima sem drama — mas não serve para publicar.

> **Reinstalar o APK desliga o serviço de acessibilidade no Android.** Depois de
> cada instalação (principalmente quando a assinatura muda e o Android exige
> desinstalar), reative **NEXUS Auto-Bot** em Configurações → Acessibilidade.
> Sem ele o Nexus ainda abre a conversa pelo link `wa.me` — que não depende de
> acessibilidade —, mas não escreve nem toca em nada. O módulo nativo agora
> detecta isso antes de abrir o WhatsApp e responde com uma mensagem clara, em
> vez de deixar o app em "Pensando...".
>
> Dá para religar sem passar pelas telas do Android:
>
> ```bash
> adb shell settings put secure accessibility_enabled 1
> adb shell settings put secure enabled_accessibility_services \
>   com.jefferson.nexusassistente/com.jefferson.nexusassistente.service.NexusAccessibilityService
> ```
>
> O `dumpsys accessibility` confirma: `Bound services:{Service[label=NEXUS
> Auto-Bot, ...]}` e o log `NEXUS_A11Y: Serviço de acessibilidade conectado`.

### O mascote não derruba mais o auto-bot

Dois defeitos se alimentavam, e os dois foram corrigidos:

1. **O crash.** `NexusOverlayService` era iniciado com `startForegroundService()`
   mas só chamava `startForeground()` no `onStartCommand`. Quando a thread
   principal estava ocupada, o Android matava o **processo** com
   `ForegroundServiceDidNotStartInTimeException` — e como o serviço de
   acessibilidade mora no mesmo processo, o auto-bot caía junto. Agora o
   `startForeground()` acontece no `onCreate()`, o primeiro instante possível.
2. **O falso "desligada".** A detecção de `isAccessibilityServiceEnabled()`
   passou por duas rodadas de defeito, e as duas_importavam o mesmo sintoma
   (o app pedindo uma permissão que o usuário já tinha aceito):

   - **Rodada 1** — olhava só a lista de serviços **ativos** do sistema. Um
     serviço que cai sai dessa lista, então o app dizia "a automação está
     desligada" mesmo com a permissão já dada.
   - **Rodada 2** — passou a ler só a configuração do Android
     (`Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES`). **Nesse aparelho
     (moto g84, Android 15) essa leitura volta `null` para app comum** — é
     leitura protegida. O log do app provou:
     `A11Y check: component=com.jefferson... enabled=[null]`, com o serviço
     ligado, conectado e o `dumpsys accessibility` mostrando
     `Bound services:{Service[label=NEXUS Auto-Bot...]}`.

   A correção que funciona em todo aparelho: **o próprio serviço rodando** é a
   prova definitiva (`NexusAccessibilityService.isConnected()`). A
   configuração do Android e a lista de ativos ficaram como reservas.

O efeito prático: o app distingue os três estados — permissão **não pedida**,
permissão **concedida mas o serviço ainda não conectou**, e serviço **conectado**
— e não repete um pedido de permissão que o usuário já atendeu.

`tests/nativeBridgeContract.test.mjs` merece destaque: como o Kotlin não roda no
`npm test`, ele **lê os fontes `.kt` e o manifesto** e confere contratos
essenciais — por exemplo: o `exact` do alarme vem mesmo do `AlarmManager`; os
receptores e permissões estão declarados no plugin **e** no `app.json`; a
chamada nunca liga de volta no lugar de atender; o controle de áudio é achado
pelo nome acessível.

---

## 7. Ressalvas honestas (importante)

1. **O Kotlin compilou e rodou no aparelho.** O primeiro build real
   (`assembleRelease`) **encontrou 3 erros de compilação** — todos corrigidos e
   registrados na seção 8. Depois do build, o APK foi instalado e aberto: módulo
   nativo ativo, lembretes criados e disparados. Leitura e testes de contrato
   não substituem o compilador — mas agora o caminho foi percorrido.
2. **Alarme exato concedido e verificado.** `USE_EXACT_ALARM: granted=true` e
   `SCHEDULE_EXACT_ALARM: allow` no aparelho. Um lembrete de "+2 minutos" foi
   criado pelo app, e o `dumpsys alarm` mostrou o agendamento como
   `setAlarmClock` (seção "Alarm clock", `exactAllowReason=policy_permission`).
   Ele tocou na hora certa e falou o texto — confirmado no aparelho. Vale
   lembrar: **o lembrete vive dentro do Nexus** (AlarmManager próprio), então
   ele *não* aparece no relógio/agenda do celular. É de propósito.
3. **Leitura de notificação e acessibilidade** precisam estar ligadas nas
   configurações do Android; sem elas, os fluxos de WhatsApp e de lembrete não
   funcionam.
4. **Seletores do WhatsApp** foram confirmados no aparelho só para os fluxos
   investigados (abrir conversa, enviar, menu de ligação). O botão de
   atender/recusar e o controle de áudio são **melhor esforço** por nome
   acessível, com aviso honesto quando não acham — não foram confirmados em tela
   de chamada real.
5. **A chave do Gemini fica no APK.** Foi uma decisão aceita: não há servidor
   intermediário. A chave vive no `.env` (fora do git) e é injetada em
   `app.config.js` → `extra`. Continua sendo um risco: quem extrair o APK
   encontra a chave.
6. **O repositório agora tem commit.** O primeiro commit (`a311dc2`) registra todo
   o estado atual, então dá para voltar atrás. Antes dele não havia nenhuma rede
   de proteção: tudo estava sem commit.
7. **NexusMasterEngine.kt é código morto** — ficou como está, de propósito, para
   não misturar limpeza com funcionalidade.
8. **REA (ferramenta de inspeção)**: o MCP foi corrigido subindo 6.4.0 → 6.7.0;
   o VSCode ainda precisa de *Developer: Reload Window* para carregar a versão
   nova. Avisos restantes (`jadx`, `ghidra`, etc.) são opcionais.
9. `App.tsx.backup` e `App.tsx.restored` continuam na raiz — podem ser trabalho
   do usuário; não foram tocados.
10. **A conversa é só em memória.** Se o Android destruir a tela do Nexus
    enquanto ele está em segundo plano (foi o que aconteceu no teste: entrou no
    WhatsApp e o JS reiniciou uma vez), o histórico da conversa recomeça. As
    **anotações e lembretes não se perdem** — esses ficam no armazenamento
    nativo. Persistir a conversa seria uma mudança à parte, com decisão de
    privacidade (o que guardar, por quanto tempo).

---

## 8. Pendências conhecidas

### Primeiro build real — os 3 erros que o compilador achou

`npx expo prebuild --clean --platform android` seguido de
`gradlew app:assembleRelease` compilou o projeto inteiro pela primeira vez. Três
erros, todos em código nosso (nenhum no Expo ou nas bibliotecas):

| Arquivo | Erro do Kotlin | Causa | Correção |
| --- | --- | --- | --- |
| `NexusNativeModule.kt:670` | `'return' is prohibited here` | `return@searchAndSendWhatsAppMessage` dentro de um lambda **não-`inline`**: o label apontava para a função de fora, o que é um retorno não-local proibido | reescrito com `if/else` (o mesmo efeito, sem retorno) |
| `NexusAccessibilityService.kt:849` | `CharSequence` onde se esperava `String?` | o `fold` local recebia `String?`, mas `contentDescription` e `text` são `CharSequence?` | o `fold` local passou a receber `CharSequence?`, igual ao `foldText` que ele embrulha — corrige também os outros usos (`node.text`), que o compilador ainda não tinha listado |
| `NexusVoiceEngine.kt:535` | `Type checking has run into a recursive problem` | `directTimeoutRunnable` se reagenda **dentro do próprio inicializador**, e o Kotlin não infere o tipo | tipo explícito `: Runnable` |

Dois tropeços de ambiente, para não repetir:

- `expo prebuild --clean` **apaga o `android/local.properties`**; sem ele o Gradle
  para com *"SDK location not found"*. Recriado com `sdk.dir=...`.
- `ANDROID_HOME` não estava definido na sessão de build; é ele (ou o
  `local.properties`) que localiza o SDK.
- O caminho do projeto tem espaço (`Nova pasta`), então o build precisa de
  `-PreactNativeArchitectures=arm64-v8a` para não estourar o limite de caminho do
  CMake no código C++ de 32 bits.

### O que ainda falta

- **Reagendar/excluir/desligar** em uso real: o disparo e a fala foram
  confirmados; o reagendamento diário, o "desliga todos" e a sobrevivência ao
  reinício ainda não foram vistos acontecendo no aparelho.
- **Confirmar em tela real** o botão de atender/recusar e o controle de áudio do
  WhatsApp; se os nomes acessíveis forem outros, ajustar as listas em
  `NexusAccessibilityService.kt`.
- **Exercitar no aparelho** o VAD (voz em ambiente com barulho), a resposta por
  voz de notificação e as chamadas por WhatsApp.
- Ideias já mapeadas, não implementadas: respostas mais ricas para dúvidas de
  saúde/estilo de vida (hoje quem responde é o modelo, com o tom definido no
  `geminiClient.mjs`) e um resumo falado do que chegou enquanto o usuário
  esteve fora.

---

## 9. Histórico curto das decisões difíceis

| Problema | Decisão |
| --- | --- |
| Microfone abrindo e fechando sozinho | Sem escuta passiva: duas portas (botão do app / toque no mascote), uma por vez. |
| Ruído virando comando | VAD pelo volume do próprio reconhecedor, julgando só com amostras. |
| Frase longa cortada no teto | Teto se estende enquanto há fala (máx. 3 vezes). |
| "Chamada perdida" pedindo para atender | Tipo próprio + oferta de ligar de volta. |
| "Sim" do fluxo virando confirmar-envio | Fluxo de notificação interceptado antes do roteador. |
| "Pesquise o número da UPA e ligue" virando busca na web | `CALL_TOKENS` no roteador de intenções. |
| App prometendo o que não fez | Módulo puro decide; o app fala o resultado real; falha essencial encerra o fluxo. |
| Controle de áudio confundido com mensagem | Busca só pelo nome acessível. |
| `exact` do lembrete sempre `true` | Passou a refletir o retorno do `AlarmManager`. |

---

## 10. O que a revisão final encontrou (e o que foi feito)

Fechando o trabalho, revisei o código de ponta a ponta. Achados reais — todos
corrigidos, com teste onde era possível prender a regra:

| Achado | Risco | Correção |
| --- | --- | --- |
| Ruído (TV, vento) virava comando | Falso positivo grave | VAD pelo volume do reconhecedor + `noise` |
| Teto de 15 s cortava frase longa no meio | Perda do pedido | Teto se estende enquanto há fala (máx. 3×) |
| Rede, microfone e silêncio chegavam todos como `error` | Conselho errado na tela | Motivos `silence` / `network` / `error` / `noise` |
| Chamada **perdida** perguntava "quer atender?" | Ação impossível | Tipo `missed-call` + oferta de ligar de volta |
| Responder "sim" para atender **ligava de volta** | Ação errada e silenciosa | `answerWhatsAppCall` / `declineWhatsAppCall` (toca no botão, devolve o real) |
| Falha ao escrever/enviar/apagar e o Nexus seguia perguntando "posso enviar?" | Confirmação de algo inexistente | Falha essencial encerra o fluxo |
| Módulo dizia "Apaguei a resposta." sem conferir | Mentira na tela | Quem confirma é a interface, com o retorno real |
| Busca do controle de áudio olhava também o TEXTO da mensagem | Tocar na bolha em vez do áudio | Busca só pelo nome acessível |
| `exact` do lembrete era sempre `true` | Prometia hora exata sem ter | Reflete o `AlarmManager` |
| Ativar/desativar/apagar lembretes em lote afirmava sucesso | Mentira parcial | Conta os retornos e relata o que falhou |
| `aviso`/`avisos` capturavam conversa comum | Lembrete no lugar de conversa | Trocados por `me avisa` / `me avise` / `me avisar` |
| "pesquise o número da UPA e ligue" virava busca na web | Nunca ligava | `CALL_TOKENS` no roteador |
| README e textos da tela prometiam escuta passiva e palavra de ativação (que já não existiam) | Documentação mentirosa | Textos corrigidos + teste de contrato |
| `startFloatingListening` (chamado pelo JS) desligava a escuta passiva | — | Confirmado que não abre sessão; teste garante |
| Lembrete disparado aparecia **duas vezes** (balão + aviso) | Texto repetido na tela | Fica só o balão; a lista já rola até o fim |

A pilha de **voz neural e palavra de ativação** (`NexusTtsEngine`/Kokoro,
`NexusWakeWord`/sherpa-onnx, `NexusComplements`, `Phase.WAKE`,
`onHotwordDetected`, `summonMascotOverlay`) foi **removida** do projeto. O
detector KWS mantinha um `AudioRecord` contínuo, religava sozinho depois de cada
fala e travava o `SpeechRecognizer` do sistema; o Kokoro embacia 136 MB no APK
(114 MB de modelo + 28 MB de vozes + AAR do sherpa-onnx em 4 arquiteturas) e
dependia do eSpeak, então quase todo pedido caía no TTS do sistema mesmo assim.
Hoje a fala usa **só a voz do aparelho**, e o microfone tem uma porta única: o toque
(botão ⏺ dentro do app, mascote fora dele). Os testes de contrato garantem que a
pilha não volte.

---

## 11. Rodada de outubro/2026 (o que mudou depois da primeira entrega)

Tudo abaixo foi **verificado no aparelho** (moto g84 5G, `ZF524N85RP`).

### 11.1 A conversa não sumia mais

O histórico vivia só na memória do React: quando o Android matava a tela em
segundo plano, o app voltava com o chat vazio.

- `storage/ChatStore.kt` (novo): guarda o histórico em `SharedPreferences`.
- `NexusNativeModule`: `loadChatHistory` / `saveChatHistory` / `clearChatHistory`.
- `App.tsx`: carrega ao abrir e salva (com 600 ms de atraso, para não escrever a
  cada tecla).

Verificado: fechar o app e abrir de novo traz a conversa inteira.

### 11.2 O balão cortava o fim da frase ("faltando palavra")

Este era o defeito mais chato, e **não era do texto**: o texto completo estava
na tela (o leitor de acessibilidade lia "Agora são 18:12."), mas o desenho
parava em "Agora são".

Causa: no Android, um `Text` dentro de um balão de **largura automática** é
medido com uma largura um pouco menor que a do desenho. A frase que caberia em
uma linha quebrava em duas — e a **altura** do `Text` tinha sido calculada para
uma linha só, então a segunda linha era desenhada fora do balão e sumia.

Correções:

- `app/core/textMetrics.mjs` (novo, com teste): estima a largura do texto em dp
  (largura média de cada caractere no Roboto) e devolve a largura **definida**
  do balão, com 12% de folga para cobrir a diferença entre medição e desenho.
- `App.tsx`: o balão passa a ter largura definida; o texto do cabeçalho
  (`status`) ganhou `flex: 1` (largura definida dentro da linha).

Verificado no aparelho: "que horas sao", "Agora são 18:12.", "Boa noite como
você está" e o parágrafo de abertura aparecem **inteiros**.

### 11.3 A conversa sobe, tem limite e pode ser rolada

- `MAX_MESSAGES = 60`: as mensagens mais antigas são apagadas da lista (e do
  que fica salvo), para a conversa não pesar nem ocupar o bloco de interação.
- A tela **sobe sozinha** quando chega mensagem nova, mas **só se o usuário já
  estiver no fim**: quem subiu para ler o histórico não é puxado de volta
  (`nearBottomRef` + `onScroll`), e pode rolar para cima e para baixo à vontade.

### 11.4 O mascote aparecia por cima do app

Duas causas: uma **corrida** entre o `onResume` da tela e o serviço de overlay
subindo, e a falta de trava no serviço.

- `NexusOverlayService`: `closing` trava o `addOverlay` quando alguém já pediu
  para esconder; `startOverlay` e `addOverlay` checam
  `MainActivity.isResumedForeground()` — com o app na frente, o mascote **não**
  aparece.
- `App.tsx` (`returnToStandby`): se o app está em primeiro plano, o Nexus não
  manda o usuário para a home nem chama o mascote.

Verificado: o mascote aparece na home e some quando o app vem para a frente.

### 11.5 Fila de mensagens do WhatsApp (uma de cada vez)

Antes, três notificações seguidas abriam três conversas ao mesmo tempo. Agora
há uma **fila**: uma mensagem é lida e respondida por vez, e no fim o Nexus
avisa "Tem outra mensagem de X" e segue para a próxima. Quando a fila acaba,
ele volta para a home e deixa o mascote esperando.

- Ao **ler**, o Nexus agora **abre a conversa** do contato antes de recitar a
  mensagem (`open-chat` no fluxo puro).
- `openNotificationConversation` (novo): usa o intent da notificação quando ele
  é deste contato; senão procura o contato dentro do WhatsApp.
- A mídia (rádio/música) só volta quando a fila termina.

### 11.6 Outros ajustes

- "zap" e os apelidos que o ditado devolve ("whatsap", "watsap", "zapzinho",
  "wpp") passam a valer como WhatsApp — lista única (`WHATSAPP_TERMS`) usada
  também para limpar o nome do contato.
- O motor de voz guarda o **último parcial**: se o Android devolver o resultado
  final vazio ou cortado, o pedido não se perde.

### 11.7 Ambiente

O aparelho estava com **densidade de tela sobrescrita** (`wm density 340` num
tela de 400), o que desalinhavam a medição de texto do desenho. Foi restaurado
para a densidade física (`wm density reset`).

### 11.8 A voz: a do aparelho, sem modelo dentro do APK

O APK com o Kokoro tinha **346 MB** (114 MB de modelo + 28 MB de vozes + o AAR
do sherpa-onnx com o `onnxruntime` em 4 arquiteturas). A voz saiu de lá:

- `voice/NexusDeviceVoice.kt`: o TTS do **próprio aparelho** (pt-BR). O
  Android devolve todas as vozes do motor instalado; sem escolher, ele usa a
  padrão do Google TTS — a `pt-BR-language-standard`, que é a que soa robótica.
  Aqui a voz é **escolhida**: primeiro a **local** (já baixada: responde na hora
  e funciona sem internet), depois a **neural** (Wavenet/Enhanced), depois a de
  **nome feminino** do Google em português (Cacilda, Katita, Maria, Yara,
  Athina, Luciana) e por último a qualidade declarada pelo motor.
- O timbre é acertado no ponto: altura 1,06 (mais feminina) e velocidade 0,95
  (cadência humana, em vez de quem lê o texto correndo).
- `expo-speech` continua como rede de segurança: o nativo é o caminho normal e
  o `expo-speech` assume quando a ponte nativa não está disponível ou falha. Se
  as duas falharem, o texto continua na tela. **O Nexus nunca fica mudo.**
- O `expo-speech` não deixa escolher a voz no Android (o `voiceId` dele é só de
  iOS) — por isso a escolha da voz precisa ser nativa.

### 11.9 O mascote dentro do balão

- O mascote estava **do lado** do balão, como avatar solto na margem. Agora ele
  fica **dentro** do balão, no canto superior esquerdo — inclusive no balão de
  "pensando". O texto continua com a largura medida (a coruja fica ACIMA dele),
  então o bug antigo de "falta palavra" não volta.
- A inclinação da coruja estava **invertida**: a inclinação do estado ("pensando"
  inclina de leve) só era usada quando o aparelho pedia MENOS movimento. Agora o
  estado manda, e a rotação é sempre pequena — a coruja nunca fica de cabeça
  para baixo.
- O mascote ganhou **falas** (`app/core/mascotPhrases.mjs`): uma frase por
  estado, sorteada sem repetir a anterior, e a primeira fala do dia também
  varia.

### 11.10 A voz na correria: entender o pedido torto

A gente fala e digita com pressa: falta letra ("musicha"), falta sílaba ("musi"),
sobra letra ("climma"), a palavra sai torta ("whatsap"). `app/core/speechText.mjs`
corrige isso **antes** dos roteadores, para o pedido ser entendido localmente
em vez de cair no Gemini.

Quatro travas, para o Nexus não entender errado (entender errado é pior do que
não entender):

1. **A primeira letra tem que ser a mesma** — sem isso, "Amanda" (contato) vira
   "manda" (comando) e a mensagem vai para a pessoa errada.
2. **O corpo da mensagem nunca é tocado** — "manda pro João: toca violão" tem um
   "toca" que é da mensagem, não do pedido.
3. **Palavra curta é exata** — "pão" a uma letra de "paro" mudaria a descrição
   do lembrete.
4. **O erro é no fim da palavra** — "cerca" (nome de música) e "maria" (contato)
   estão a uma ou duas trocas de "certo" e "manda", mas o começo delas é
   diferente. O que vale como ditado é "musicha" → "musica", "lembe" → "lembra".

Além da correção de texto, a comparação por **palavra** ficou tolerante
(`containsAnyFuzzy`, `containsPhraseFuzzy`): "me lembe as 6" entende como
"me lembre as 6", e "anotaí" entende como "anota".

### 11.11 O balão que cortava a última linha

O texto do balão usava `width: '100%'`. No Android, a porcentagem é resolvida
com um arredondamento diferente do desenho: a última linha da frase — a que
ficava exatamente na borda — era desenhada e **cortada**. Na prática, a
pergunta "qual o maior cidade do mundo" aparecia como "qual o maior cidade do"
e o "mundo" sumia; a resposta do Nexus aparecia pela metade.

- A largura do texto agora é um **número**: a largura útil do balão
  (`bubbleWidth - 2 * spacing.lg`), calculada em JS. Medição e desenho usam a
  mesma conta, a frase quebra sozinha e nada fica de fora.
- A estimativa ganhou **folga** (`SAFETY` 1,12 → 1,18 e 8 dp fixos): com a
  folga no limite, a última linha caía na borda — e era ela que sumia.
- O **clima** foi para o conhecimento de bolso e para o Gemini: "como está o
  tempo em BH", "vai chover", "chuva em Contagem". O "tempo" sozinho NÃO vira
  clima: "quanto tempo a luz do sol leva" é uma curiosidade.

### 11.12 O conhecimento de bolso (sem internet)

O Gemini é o **pesquisador**: responde o que é aberto, atual e difícil. Mas
depende de rede, de cota e da boa vontade do serviço — e aí o assistente cala
na hora que o usuário mais precisa dele. (Medido no aparelho: o
`gemini-3.8-flash` respondeu **503 — "high demand"**, e o app apareceu com
"Estou sem conexão com o Gemini".)

`app/core/localKnowledge.mjs` é o **conhecimento de bolso**: mais de 40 fatos
( Brasil, Minas, mundo, ciência, tempo, curiosidades) que o Nexus responde na
hora, sem internet e com a mesma voz de sempre.

- Entra **antes** do Gemini: curiosidade e fato simples não dependem de rede.
- A pergunta é dobrada (minúsculas, sem acento) e comparada com os padrões de
  cada fato.
- **O que não entra:** notícia, preço, pessoa do momento, dado que muda. Isso
  é do Gemini — o Nexus não inventa resposta.
- Um **comando** não é pergunta: "abre o google" vai para o navegador, não
  para o conhecimento de bolso.

A voz nova e a ativação por palavra estão em `docs/VOZ-E-ATIVACAO.md`.

---

## 12. Rodada de outubro/2026 — a rede neural de aprendizado, o cérebro de conversa e o alarme conversacional

O pedido do usuário, na íntegra: **"tempo é a mesma coisa que clima"** —
"me informe o tempo da cidade de matozinhos" tem que valer o mesmo que
"me informe o clima da cidade de matozinhos". E: uma **rede neural** que
aprenda, no dia a dia, os parâmetros de fala e a **ligação de palavras** do
diálogo informal brasileiro — online e offline — para identificar o que
significa e responder certo. Separada em arquivos: a matriz é só a base de
ligação, a ponte entre os outros códigos, para um erro não virar
"maranhado". E o **alarme conversacional** com frase motivacional.

### 12.1 "Tempo" é clima quando o pedido traz lugar

O roteador do clima (`nativeCommands.mjs`) passou a reconhecer
`tempo da cidade (de|minha|nossa)` e a extrair a cidade limpa
("cidade de matozinhos" → "matozinhos"). O "tempo" SOZINHO continua NÃO sendo
clima: "quanto tempo a luz do sol leva para chegar na Terra" segue para o
conhecimento de bolso (esse contrato está em teste).

**Bug antigo encontrado e corrigido no caminho:** o corrigidor de ditado
(`speechText.mjs`) virava "chegar" em "chegaram" (regra da "sílaba
faltante" + editDistance), e a curiosidade do Sol acima era lida como
"o que chegou?" — **abrindo a conversa mais recente do WhatsApp no meio de
uma pergunta de ciência**. A trava nova: token COMPLETO terminado em "r"/"s"
com sufixo a mais não é erro de ditado ("chegar"+`am` ≠ ditado torto). O
teste da curiosidade do Sol agora trava os dois lados.

### 12.2 A matriz de ligação (`app/core/neuralLearner.mjs`)

A rede em si é pequena de propósito (JS puro, sem dependência, roda no
celular): **feedforward 256 → 32 → N** com hashing trick de unigramas +
bigramas, aprendizado online por SGD — somada a um **classificador de
palavras (Naive Bayes com suavização)** que aprende a ligação
palavra → intenção. As duas visões se somam na predição (0.75 NB + 0.25
rede): quem generaliza "tempo"→"clima" com UM exemplo é o modelo de
palavras; a rede feedforward consolida com o tempo.

Aprendizado no dia a dia, todo persistido no aparelho (`NeuralStore.kt` +
`load/saveNeuralState` na ponte, mesmo desenho do histórico do chat):

1. **Acerto**: cada plano nativo que executa com sucesso treina a frase com
   a intenção que ela teve (`learnIntent`);
2. **Correção**: a frase que nenhum roteador entendeu fica registrada; se o
   usuário a REPETE de outro jeito parecido (Jaccard de conteúdo ≥ 0.25,
   janela de 3 min), as duas frases se ligam — a que falhou aprende a mesma
   intenção (`learnFromCorrection`). Na próxima, a primeira fala já funciona;
3. **Desaprender**: "não é isso" logo após uma resposta da rede cria a
   intenção fantasma `resposta_errada` (`registerNegative`) — a frase passa
   a não auto-executar mais.

### 12.3 A ponte que impede o "maranhado" (`app/core/neuralIntent.mjs`)

A matriz NÃO executa nada. A intenção prevista (com confiança ≥ 0.62) é
convertida em um **pedido canônico** ("tempo da cidade de matozinhos" →
`clima em matozinhos`) e reprocessada pelo `planNativeCommand` de sempre —
as MESMAS confirmações e travas valem: clima sem cidade pergunta, ligação
para lugar pede "sim". Intenções de **contato/mensagem de WhatsApp nunca são
auto-executadas pela rede** (nome de pessoa extraído errado = mensagem para
a pessoa errada); `local-call` exige marcador explícito ("para/com + nome")
e, sem ele, o fluxo pergunta "para quem eu ligo?" como sempre.

A base inicial (`neuralSeed.mjs`) só existe para a rede não nascer muda:
falares informais mapeados para as MESMAS ações dos roteadores. É aplicada
uma única vez (`seeded` persistido) — depois, quem ensina é o uso.

### 12.4 O cérebro de conversa (`app/core/conversationBrain.mjs`)

Bate-papo informal brasileiro OFFLINE — piada, tédio, apoio, motivação,
"você tem namorada?", "como você aprende?" — sem duplicar o `smallTalk`
(saudações/obrigado/tchau continuam lá). As respostas variam
(aleatórias de propósito) e cada resposta treina a matriz com
`chat-<tópico>`, então o pedido dito de outro jeito é lembrado pela rede.

**A internet acrescenta, nunca substitui:** quando a pesquisa responde um
papo, o par pergunta→resposta entra na biblioteca (`learnConversationPair`)
e passa a valer offline por similaridade de conteúdo (Jaccard ≥ 0.5).

### 12.5 O alarme conversacional (dialogue pedido pelo usuário)

- **Criação** (`App.tsx`, fluxo por etapas): "criar um alarme" → "Qual o
  nome do alarme?" ("trabalho") → "Para que hora quer o alarme?" ("6:00") →
  "Para qual dia você quer o alarme?" ("amanhã") → "Alarme criado para
  amanhã às 6 da manhã, trabalho." O LEMBRETE mantém a ordem antiga
  (o que é → o dia → a hora).
- **Ao tocar** (`AlarmeActivity.kt`): alarme **"trabalho"** (ou "trabalhar")
  fala "Bom dia, <nome>! Está na hora." + **frase motivacional sorteada a
  cada toque** (`MotivationalPhrases.nextRandom`, nunca repete a anterior —
  `forToday` da frase fixa do dia saiu). Qualquer OUTRO alarme fala a
  saudação com o nome e o **relógio REAL de agora** (`spokenClockOf(now)`) —
  não o horário agendado — e SEM frase motivacional.
- **Botão**: "Daqui a pouco" agora é **Soneca** (mesma função: +5 min,
  `ReminderActions.SNOOZE_MINUTES`).
- Detalhe de ordem: a fala é construída ANTES da tela, porque o alarme
  "trabalho" sorteia a frase na fala e a tela mostra a MESMA frase.

### 12.6 Como foi verificado

- `npm test`: **289 testes** passando — novos: `neuralLearner` (ligação
  tempo↔clima, correção, desaprendizado, roundtrip), `neuralIntent` (canônico
  por intenção + segurança: WhatsApp fora da auto-execução), 
  `conversationBrain` (papo, pares aprendidos, limites), `nativeCommands`
  ("tempo da cidade", regressão da curiosidade do Sol), `speechText`
  (chegar→chegaram), `reminderFlow` (contrato das novas perguntas, todas via
  `askAndListen`).
- `npm run typecheck` e `npm run lint` limpos; `.d.mts` criados para os
  quatro módulos novos (padrão da casa).
- Build Android release (arm64-v8a) concluído e instalado via adb no
  aparelho do usuário; testes de conversa dirigidos por `adb shell input
  text` + screenshot + `logcat`.

### 12.7 Ressalvas honestas desta rodada

- A confiança 0.62 e o peso 0.75 do modelo de palavras foram calibrados
  com a base inicial + os casos de teste — não com semanas de uso real.
  Se a rede errar por excesso de confiança, os caminhos são: subir
  `MIN_CONFIDENCE`, baixar `WORD_MODEL_WEIGHT`, ou dizer "não é isso"
  (desaprende a ligação na hora).
- O estado persistido (pesos arredondados a 4 casas + vocabulário limitado a
  800 palavras + 150 pares de conversa) deve ficar na casa de ~100 KB; o
  corte de 900 KB do `NeuralStore` é a rede de segurança, não o esperado.
  Meses de uso podem pedir poda mais agressiva — ainda não medimos isso.
- A extração de cidade da PONTE (`leftoverWords`) aceita no máximo 5
  palavras; cidades com nome muito composto podem ficar fora (o roteador
  determinístico, que não tem esse limite, pega a maioria antes da rede).
- O TTS do alarme continua sendo o do APARELHO: sem voz pt-BR instalada, a
  tela abre, mostra tudo, e o aviso falado não sai (comportamento de sempre,
  documentado na seção de voz).
