package com.jefferson.nexusassistente.web

import android.util.Log
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/**
 * A pesquisa do Nexus: ele mesmo, na internet, sem abrir o navegador.
 *
 * ## Por que não é o navegador
 *
 * A ideia de "pesquisar abrindo o navegador" tem dois problemas: o usuário
 * sai do app (e a conversa se perde), e a página de resultado é feita para
 * olhos, não para voz. Aqui o Nexus faz a consulta por HTTP, monta a resposta
 * em texto falado e continua na conversa.
 *
 * ## Duas fontes, na ordem
 *
 * 1. **Wikipédia em português** — a melhor fonte para o que o Nexus mais
 *    recebe: curiosidade e fato ("quem foi Tiradentes", "qual o maior
 *    oceano"). A resposta é o resumo do verbete, em uma frase.
 * 2. **Busca na web (DuckDuckGo, versão leve)** — para o que não está na
 *    Wikipédia. Vem o primeiro resultado: título e um trecho.
 *
 * ## Honestidade
 *
 * Se nenhuma fonte responder, o Nexus **não inventa**: devolve `null` e o
 * app avisa que não conseguiu. É o mesmo combinado do resto do aplicativo.
 */
data class WebAnswer(
    /** A resposta, pronta para ser falada. */
    val answer: String,
    /** O título do que foi encontrado (para a tela). */
    val title: String,
    /** De onde veio (para a tela). */
    val source: String,
    /** O endereço, para o usuário conferir. */
    val url: String,
)

class WebSearchProvider {

    companion object {
        private const val TAG = "NEXUS_SEARCH"
        private const val TIMEOUT_MS = 12_000

        /** Quantas frases da Wikipédia cabem na resposta falada. */
        private const val MAX_SENTENCES = 2
    }

    /**
     * Procura a resposta na internet.
     *
     * Bloqueante: quem chama precisa rodar fora da thread principal.
     */
    fun search(rawQuery: String): WebAnswer? {
        val query = rawQuery.trim()
        if (query.isEmpty()) return null

        return wikipedia(query) ?: webSearch(query)
    }

    // -----------------------------------------------------------------
    // Wikipédia
    // -----------------------------------------------------------------

    /**
     * Procura na Wikipédia em português e devolve o resumo do verbete.
     */
    private fun wikipedia(query: String): WebAnswer? {
        val term = searchTerm(query) ?: return null
        val encoded = URLEncoder.encode(term, "UTF-8")
        val url = "https://pt.wikipedia.org/w/api.php?action=query&list=search" +
            "&srsearch=$encoded&srlimit=1&format=json&utf8=1"

        val body = get(url, "application/json") ?: return null
        val results = try {
            JSONObject(body).optJSONObject("query")?.optJSONArray("search")
        } catch (error: Exception) {
            null
        } ?: return null
        if (results.length() == 0) return null

        val title = results.optJSONObject(0)?.optString("title").orEmpty()
        if (title.isEmpty()) return null

        // O resumo do verbete: uma ou duas frases, do jeito que se fala.
        val summaryUrl = "https://pt.wikipedia.org/api/rest_v1/page/summary/" +
            URLEncoder.encode(title.replace(' ', '_'), "UTF-8")
        val summaryBody = get(summaryUrl, "application/json") ?: return null
        val extract = try {
            JSONObject(summaryBody).optString("extract")
        } catch (error: Exception) {
            ""
        }
        val text = firstSentences(extract, MAX_SENTENCES)
        if (text.isEmpty()) return null

        return WebAnswer(
            answer = text,
            title = title,
            source = "Wikipédia",
            url = "https://pt.wikipedia.org/wiki/${title.replace(' ', '_')}",
        )
    }

    /**
     * O TERMO a procurar: o que o usuário perguntou, sem as palavras da
     * pergunta ("qual a capital de", "quem foi", "me diga").
     */
    private fun searchTerm(query: String): String? {
        val cleaned = query
            .replace(Regex("(?i)\\b(qual|quais|quem|quando|onde|como|por que|porque|quanto|quanta|quantos|quantas|o que|que|me|diga|fale|sobre|conjunto|de|do|da|em|no|na|para|pra|por|do|da|o|a|os|as|e|é|foi|era|significa|significado)\\b"), " ")
            .replace(Regex("[?!.,;:\"'()\\[\\]]"), " ")
            .replace(Regex("\\s+"), " ")
            .trim()

        if (cleaned.isEmpty()) return null
        // A busca da Wikipédia é melhor com o termo curto.
        return cleaned.split(' ').take(6).joinToString(" ").ifEmpty { null }
    }

    // -----------------------------------------------------------------
    // Busca na web
    // -----------------------------------------------------------------

    /**
     * Busca na web (DuckDuckGo leve) e devolve o primeiro resultado.
     */
    private fun webSearch(query: String): WebAnswer? {
        val encoded = URLEncoder.encode(query, "UTF-8")
        val url = "https://html.duckduckgo.com/html/?q=$encoded&kl=br-pt"

        val body = get(url, "text/html") ?: return null
        val title = firstMatch(body, Regex("(?is)<a[^>]*class=\"[^\"]*result__a[^\"]*\"[^>]*>(.*?)</a>"))
        val snippet = firstMatch(body, Regex("(?is)<a[^>]*class=\"[^\"]*result__snippet[^\"]*\"[^>]*>(.*?)</a>"))
        val link = firstMatch(body, Regex("(?is)<a[^>]*class=\"[^\"]*result__a[^\"]*\"[^>]*href=\"([^\"]+)\""))

        val cleanTitle = cleanHtml(title)
        val cleanSnippet = cleanHtml(snippet)
        if (cleanTitle.isEmpty() && cleanSnippet.isEmpty()) return null

        val answer = if (cleanSnippet.isNotEmpty()) {
            "$cleanTitle. $cleanSnippet"
        } else {
            cleanTitle
        }

        return WebAnswer(
            answer = firstSentences(answer, 3),
            title = cleanTitle.ifEmpty { "Resultado da busca" },
            source = "Web",
            url = link.ifEmpty { "https://duckduckgo.com/?q=$encoded" },
        )
    }

    // -----------------------------------------------------------------
    // Auxiliares
    // -----------------------------------------------------------------

    /** Baixa a página (ou o JSON) com teto de tempo. */
    private fun get(url: String, accept: String): String? {
        var connection: HttpURLConnection? = null
        return try {
            connection = (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = TIMEOUT_MS
                readTimeout = TIMEOUT_MS
                setRequestProperty("Accept", accept)
                setRequestProperty("Accept-Language", "pt-BR,pt;q=0.9")
                setRequestProperty("User-Agent", "Nexus/1.0 (Android; assistente pessoal)")
            }
            if (connection.responseCode !in 200..299) {
                Log.w(TAG, "Resposta ${connection.responseCode} de $url")
                null
            } else {
                val reader = BufferedReader(InputStreamReader(connection.inputStream, "UTF-8"))
                val body = reader.use { it.readText() }
                body.takeIf { it.isNotBlank() }
            }
        } catch (error: Exception) {
            Log.w(TAG, "Falha ao buscar em $url: ${error.message}")
            null
        } finally {
            connection?.disconnect()
        }
    }

    /** O primeiro texto que casa com o padrão (sem as tags). */
    private fun firstMatch(body: String, pattern: Regex): String {
        val match = pattern.find(body) ?: return ""
        return match.groupValues.drop(1).firstOrNull { it.isNotEmpty() }.orEmpty()
    }

    /** Tira as tags e limpa os espaços. */
    private fun cleanHtml(html: String): String {
        return html
            .replace(Regex("(?is)<[^>]+>"), " ")
            .replace("&nbsp;", " ")
            .replace("&amp;", "&")
            .replace("&quot;", "\"")
            .replace("&#39;", "'")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace(Regex("\\s+"), " ")
            .trim()
    }

    /** As primeiras frases do texto (a resposta falada não é um texto corrido). */
    private fun firstSentences(text: String, count: Int): String {
        val clean = text.replace(Regex("\\s+"), " ").trim()
        if (clean.isEmpty()) return ""
        val parts = clean.split(Regex("(?<=[.!?])\\s+"))
        if (parts.size <= count) return clean
        return parts.take(count).joinToString(" ").trim()
    }
}
