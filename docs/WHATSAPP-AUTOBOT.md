# Autobot no WhatsApp: o que foi aprendido na tela real

Captura feita por `adb` em **moto g84 5G, Android 15**, WhatsApp instalado e
logado, em 20/10/2026. Os dumps e screenshots originais estão em
`captures/whatsapp/` (`01-home.xml` … `09-call-controls.xml`), junto com o
resumo `summarize.cjs` usado para ler cada tela.

## Mapa das telas

### 1. Lista de conversas (`06-home`)
| O que | Como achar |
| --- | --- |
| Barra de pesquisa | `my_search_bar` (FrameLayout, `[0,256][1080,376]`) — é clicável |
| Texto da barra | `search_text` ("Pergunte à Meta AI ou pesquise") |
| Lista | `conversation_list_view_host` / `android:id/list` |
| Linha | `contact_row_container` → nome em `conversations_row_contact_name` |

### 2. Busca (`02-search`, `03-results`)
| O que | Como achar |
| --- | --- |
| Campo | `search_input` (EditText) — aceita `ACTION_SET_TEXT` |
| Lista de resultados | `result_list` (RecyclerView) |
| Nome do resultado | `conversations_row_contact_name` (mesmo id da home) |
| Seções | `title` = "Conversas" e "Pessoas" |

Buscar "Amor" devolveu, nesta ordem: **"Amor"** (conversa), **"Amor 2 Claro"** e
**"Amor Kezia"** (pessoas). Por isso a escolha é pelo **nome exato**: pegar a
primeira linha da lista abriria a pessoa errada quando a ordem muda.

### 3. Conversa (`04-chat`)
| O que | Como achar |
| --- | --- |
| Nome do contato | `conversation_contact_name` — confirma que abriu o contato certo |
| Campo de mensagem | `entry` (EditText) |
| Enviar | `send_container` (FrameLayout) — só existe quando há texto |
| Microfone | `voice_note_btn` — existe quando o campo está vazio |
| Ligação de vídeo | ImageButton **sem id**, `content-desc="Ligação de vídeo"` |
| Ligação de voz | ImageButton **sem id**, `content-desc="Ligação de voz"` |
| Mais opções | `menuitem_overflow` |

### 4. Chamada (`07-video-call`)
A chamada abre `com.whatsapp.calling.ui.VoipActivityV2` com
`call_screen_root` e `call_grid`. Ao tocar no meio da tela os controles
aparecem; ao sair, a chamada vira janela flutuante e o foco volta para
`com.whatsapp.Conversation`. O estado real é conferido por
`dumpsys audio` (`MODE_NORMAL` = sem chamada).

## Fluxo ensinado ao Nexus (o que o autobot faz)

1. **Abrir a busca**: tocar em `my_search_bar`.
2. **Pesquisar o contato**: `ACTION_SET_TEXT` em `search_input` com o nome.
3. **Escolher o contato**: varrer as linhas de `result_list` / lista de
   conversas, comparar `conversations_row_contact_name` **sem acento e sem
   caixa** e tocar na linha cujo nome é **igual** ao pedido.
4. **Conferir a conversa**: esperar `entry` aparecer e comparar
   `conversation_contact_name` com o nome pedido.
5. **Mandar mensagem**: `ACTION_SET_TEXT` em `entry` → tocar em
   `send_container` → esperar o campo esvaziar (o microfone volta) como prova
   de envio.
6. **Ligar**: quando a pessoa pede "liga para o Amor no WhatsApp" sem dizer o
   tipo, o Nexus pergunta **"Chamada de voz ou de vídeo para Amor?"** com o
   contato já escolhido e espera a resposta (`voz`/`vídeo`). Só então procura o
   botão direto do topo (`content-desc` "Ligação de voz" ou "Ligação de vídeo");
   se ele não existir, abre `Menu de ligação` e escolhe a opção. A chamada só é
   anunciada quando `message_input` desaparece e o pacote continua sendo
   `com.whatsapp`.
   - O contato vai de `whatsapp-start-call` (sem contato) para `call-choice`
     (contato escolhido, tipo faltando) e só depois para `whatsapp-call` com
     `video` = `true`/`false`.
   - Resposta não entendida repete a pergunta; "não" cancela.

## Evidências coletadas nesta sessão

- Mensagem real enviada para o contato **Amor**:
  `Oi! Teste do Nexus.` (dump `06-sent.xml`, `message_text` + status "Lida").
- Chamada de vídeo iniciada e tela de chamada capturada
  (`VoipActivityV2`, `07-video-call.xml`); encerrada em seguida
  (`dumpsys audio` → `MODE_NORMAL`).

## Cuidados

- O envio é irreversível: o teste usou uma frase curta e identificável.
- O botão de ligação não tem `resource-id`; qualquer mudança de texto do
  WhatsApp ("Ligação de vídeo") exige atualizar o mapa em
  `ReaLayoutAnalyzer.whatsappResilienceMaps`.
- Nada aqui depende de coordenada fixa: o motor usa os ids/descrições e toca no
  centro do nó.
