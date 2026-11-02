# Nexus Assistente

Aplicativo Android Expo com conversa em português, comandos por voz (botão de
microfone dentro do app ou toque no mascote flutuante), fala opcional e comandos
locais determinísticos. O aplicativo fica isolado em sua própria pasta. O REA e
os APKs de referência não são dependências do app nem fornecem código
incorporado nele. A integração com o Gemini é feita diretamente pelo celular,
sem servidor do projeto.

> Registro completo do desenvolvimento — decisões, o que já foi verificado e as
> **ressalvas honestas** (o que ainda não dá para afirmar) — em
> [`docs/DESENVOLVIMENTO.md`](docs/DESENVOLVIMENTO.md).

## O que funciona hoje

- Respostas locais para saudações (pelo nome e pela hora), ajuda, data, hora e
  contas aritméticas.
- Abertura de Google, YouTube, Wikipedia e WhatsApp, ou pesquisa no Google.
- Perguntas abertas encaminhadas diretamente à API Gemini pelo celular.
- Comandos de voz: **um toque no microfone = um comando** dentro do app; fora
  dele, **um toque no mascote** — o Nexus responde "Estou ouvindo" e abre o
  microfone para um pedido. **Não existe escuta passiva**: o microfone nunca
  abre sozinho.
- Separação de fala e barulho (VAD): ruído de televisão, vento ou conversa
  distante não vira comando.
- Chamadas em canais separados: `liga para amor` (aparelho),
  `liga para amor via whatsapp` (voz no WhatsApp) e
  `ligar para amor chamada de vídeo` (vídeo no WhatsApp).
- Pesquisa de telefone de lugares na internet **sem abrir navegador**: o Nexus
  fala o nome e o número e só disca depois do "sim".
- Notificações do WhatsApp: avisa quem mandou, pergunta antes de ler, toca áudio,
  capta a resposta por voz, **escreve no chat sem enviar** e só envia com
  confirmação (recusando, apaga o que escreveu).
- Anotações com título, data e hora, guardadas no aparelho e lidas em voz alta.
- Lembretes/despertador por dia, hora e minuto, com editar, apagar e desativar.
- Frase do dia (lista local) e manchetes/fofocas reais de feeds RSS — feed fora
  do ar resulta em "não consegui buscar", nunca em notícia inventada.
- Rádios de Minas, YouTube/OiTube, controle de mídia, clima, abrir apps.
- **"Tempo" é clima**: "me informe o tempo da cidade de Matozinhos" faz a
  mesma consulta que "me informe o clima" — o "tempo" sozinho ("quanto tempo
  a luz do sol leva") continua sendo curiosidade, não previsão.
- **Rede neural que aprende no dia a dia** (`app/core/neuralLearner.mjs`):
  cada comando que dá certo ensina a frase; quando você repete um pedido que
  o Nexus não entendeu de OUTRO jeito e dá certo, ele liga os dois e passa a
  entender o primeiro; "não é isso" faz desaprender na hora. A matriz nunca
  executa nada — ela traduz a intenção aprendida para um pedido canônico e
  quem executa são os roteadores de sempre, com as MESMAS confirmações
  (mensagem de WhatsApp e contato por chute nunca saem da rede). O
  aprendizado fica salvo no aparelho.
- **Cérebro de conversa offline** (`app/core/conversationBrain.mjs`): piada,
  tédio, apoio, motivação e papo em fala brasileira, sem internet. Quando a
  internet responde um papo, o par pergunta→resposta entra na biblioteca e
  passa a valer offline.
- Alarme conversacional: "criar um alarme" → nome ("trabalho") → hora ("6:00")
  → dia ("amanhã") → "Alarme criado para amanhã às 6 da manhã, trabalho."
  No alarme chamado **trabalho**, o Nexus fala "Bom dia + seu nome, está na
  hora" e uma **frase motivacional diferente a cada toque**; qualquer outro
  alarme fala a saudação com seu nome e o **relógio REAL** de agora (não o
  horário agendado — o toque pode atrasar). O botão "Daqui a pouco" agora é
  **Soneca** (mesma função: toca de novo em 5 minutos).
- Respostas faladas que podem ser ligadas ou desligadas na tela. A voz é a do
  **próprio aparelho** (a melhor voz em português do Brasil que ele tem, com o
  timbre ajustado) — o app não embute nenhum modelo de voz.
- Ícone próprio e mascote visual: `mascote-ocioso` enquanto aguarda você, boca
  fechada no estado normal e boca aberta enquanto ouve, pensa ou fala. O mascote
  fica **dentro do balão** e diz o que está fazendo ("Estou ouvindo...",
  "Deixa eu pensar...").
- Pedido falado na correria é entendido: "toca musicha", "climma em bh" e
  "manda whatsap pro João" chegam como "toca música", "clima em bh" e "manda
  WhatsApp para o João".
- Ações externas limitadas a endereços HTTPS conhecidos; o texto gerado pela
  IA nunca é interpretado como um comando para executar ações.

Saudações, ajuda, data, hora e contas simples são respondidas no próprio
aparelho sem internet. Abrir um site inicia o navegador, mas o conteúdo do site
precisa de conexão. Perguntas abertas usam a API Gemini pela internet. Sem
rede, o app informa a indisponibilidade e mantém os comandos locais
disponíveis; não tenta adivinhar uma resposta que não tem.

A voz e os recursos nativos precisam de um build Android, não funcionam no Expo
Go. A tela principal não tem botões de atalho de propósito: enviar mensagem,
ligar, tocar música e afins são pedidos feitos por voz ou texto, nunca por
ícones.

## Desenvolvimento Android

Para desenvolver e gerar o APK, é preciso Node.js 22 ou mais recente,
Android Studio/SDK e Java 17 configurados. Essas ferramentas de compilação não
são necessárias depois que o APK de produção é instalado no celular.

```powershell
npm install
npm run android
```

Para abrir o Expo durante o desenvolvimento:

```powershell
npm start
```

O reconhecimento de fala usa código nativo e precisa de um build Android; o
Expo Go não inclui esse módulo. O APK de produção é gerado com:

```powershell
$env:NODE_ENV = "production"
cd android
.\gradlew.bat app:assembleRelease -PreactNativeArchitectures=arm64-v8a
adb install -r app\build\outputs\apk\release\app-release.apk
```

O APK fica em `android\app\build\outputs\apk\release`. Ele é assinado com a
chave de **debug** (padrão do Expo prebuild): instala por cima de builds
anteriores, mas não serve para publicar na Play Store.

> **`SDK location not found`?** `npx expo prebuild --clean` apaga o
> `android/local.properties`. Recrie-o com `sdk.dir=C\:\\Users\\<voce>\\AppData\\Local\\Android\\Sdk`
> ou defina `ANDROID_HOME` antes do build.

> **Por que só `arm64-v8a`?** O caminho do projeto contém um espaço
> (`Nova pasta`), o que estoura o limite de caminho do CMake ao compilar o
> codegen C++ da arquitetura 32-bit (`armeabi-v7a`). Todos os celulares Android
> atuais são `arm64-v8a`. Para voltar a incluir 32-bit, mova o projeto para um
> caminho curto sem espaços (ex.: `C:\dev\nexus`) e remova o parâmetro.

### Código nativo e `expo prebuild`

O diretório `android/` é gerado e fica fora do controle de versão. Para o
código nativo sobreviver a `npx expo prebuild --clean` e aos builds EAS, a
fonte da verdade é a pasta **`native-android/`**, aplicada pelo config plugin
`plugins/nexus-native.js` (registrado em `app.json` → `expo.plugins`). Ele:

- copia os fontes Kotlin (`native-android/java/**`) para o projeto gerado;
- copia o mascote (`nexus_mascote.png`) e o config do serviço de
  acessibilidade;
- declara no `AndroidManifest.xml` as permissões, o serviço de acessibilidade,
  o serviço de voz em primeiro plano e o serviço do mascote flutuante
  (`specialUse`).

Ao alterar qualquer arquivo em `android/app/src/main/...`, replique a mudança em
`native-android/` para não perder o ajuste no próximo prebuild. Depois de
instalado, perguntas locais e Gemini direto funcionam no celular sem deixar o
computador ou Expo de desenvolvimento em execução.

## API Gemini usada diretamente pelo aplicativo

O app lê `EXPO_PUBLIC_GEMINI_API_KEY` e `EXPO_PUBLIC_GEMINI_MODEL` do arquivo
`.env` na pasta do projeto (`NexusAssistente/.env`). O `app.config.js` lê
somente essas duas variáveis para montar o app; nenhuma chave é copiada para
arquivos-fonte.
Depois de alterar o `.env`, gere novamente o build para a configuração chegar
ao aplicativo.

**Importante:** acesso direto de um app móvel ao Gemini embute a chave no APK,
onde ela pode ser extraída. Não há servidor do usuário ou chave secreta no
celular. Restrinja a chave e suas cotas no Google AI Studio/Google Cloud e
acompanhe o uso. Se mais tarde for necessário manter a chave realmente secreta,
será preciso usar um backend próprio.

## Verificações

```powershell
npm install
npm run typecheck
npm test
npx expo install --check
```

Além das regras de conversa, `npm test` inclui testes de **contrato sobre o
código nativo**: como o Kotlin não roda nos testes, eles leem os fontes `.kt` e o
manifesto e conferem garantias que, se quebrarem, causariam mentira na tela — por
exemplo, se o alarme exato reflete o retorno real do `AlarmManager`, se os
receptores/permissões estão declarados no plugin **e** no `app.json`, e se uma
chamada perdida nunca pergunta "quer atender?".

**Antes de usar os recursos nativos:** gere o build Android (`npm run android` ou
`eas build`), conceda as permissões na tela do app e, para o despertador na hora
exata, libere "Alarmes e lembretes" nas configurações do sistema. Veja as
pendências em [`docs/DESENVOLVIMENTO.md`](docs/DESENVOLVIMENTO.md).
