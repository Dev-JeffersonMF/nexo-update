package com.jefferson.nexusassistente.storage

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Uma anotação do usuário: uma ideia que ele pediu para o Nexus guardar.
 *
 * O título é derivado do próprio texto (as primeiras palavras) para a lista
 * ficar legível sem o usuário ter de nomear nada.
 */
data class Note(
    val id: String,
    val title: String,
    val text: String,
    val createdAt: Long,
)

/**
 * Anotações do usuário, guardadas nas preferências privadas do app.
 *
 * Ficam em JSON dentro de `SharedPreferences` de propósito: o volume é pequeno
 * (o usuário fala uma ideia por vez), não precisa de banco e sobrevive à
 * reinstalação do app sem depender de nenhum serviço externo.
 *
 * A lista é sempre devolvida da mais nova para a mais antiga — é a ordem em que
 * o usuário pensa nelas ("apaga a anotação 2").
 */
class NoteStore(context: Context) {

    private val prefs = context.applicationContext
        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /** Todas as anotações, da mais recente para a mais antiga. */
    @Synchronized
    fun list(): List<Note> {
        val array = readAll()
        val notes = ArrayList<Note>(array.length())

        for (index in 0 until array.length()) {
            val item = array.optJSONObject(index) ?: continue
            notes.add(
                Note(
                    id = item.optString("id"),
                    title = item.optString("title"),
                    text = item.optString("text"),
                    createdAt = item.optLong("createdAt"),
                )
            )
        }

        return notes.sortedByDescending { it.createdAt }
    }

    /** Guarda uma anotação nova e devolve o que ficou salvo. */
    @Synchronized
    fun save(text: String, title: String = ""): Note {
        val cleanText = text.trim()
        val cleanTitle = title.trim().ifEmpty { deriveTitle(cleanText) }

        val note = Note(
            id = UUID.randomUUID().toString(),
            title = cleanTitle.take(80),
            text = cleanText.take(4000),
            createdAt = System.currentTimeMillis(),
        )

        val array = readAll()
        array.put(
            JSONObject()
                .put("id", note.id)
                .put("title", note.title)
                .put("text", note.text)
                .put("createdAt", note.createdAt)
        )

        // Teto de segurança: o usuário nunca perde as recentes, e o arquivo não
        // cresce para sempre.
        writeAll(trimToLimit(array))
        return note
    }

    /** Apaga uma anotação pelo id. `true` quando alguma coisa foi removida. */
    @Synchronized
    fun delete(id: String): Boolean {
        val array = readAll()
        val remaining = JSONArray()
        var removed = false

        for (index in 0 until array.length()) {
            val item = array.optJSONObject(index) ?: continue
            if (item.optString("id") == id) {
                removed = true
            } else {
                remaining.put(item)
            }
        }

        if (removed) writeAll(remaining)
        return removed
    }

    /** Apaga tudo. Devolve quantas anotações existiam. */
    @Synchronized
    fun clear(): Int {
        val count = readAll().length()
        writeAll(JSONArray())
        return count
    }

    // ------------------------------------------------------------------
    // Interno
    // ------------------------------------------------------------------

    private fun readAll(): JSONArray = try {
        JSONArray(prefs.getString(KEY_NOTES, "[]"))
    } catch (_: Exception) {
        // JSON corrompido não pode travar o app: começa limpo.
        JSONArray()
    }

    private fun writeAll(array: JSONArray) {
        prefs.edit().putString(KEY_NOTES, array.toString()).apply()
    }

    /** Mantém só as [MAX_NOTES] mais recentes. */
    private fun trimToLimit(array: JSONArray): JSONArray {
        if (array.length() <= MAX_NOTES) return array

        val items = ArrayList<JSONObject>(array.length())
        for (index in 0 until array.length()) {
            array.optJSONObject(index)?.let { items.add(it) }
        }

        val kept = items.sortedByDescending { it.optLong("createdAt") }.take(MAX_NOTES)
        return JSONArray().apply { kept.forEach { put(it) } }
    }

    /** Título a partir das primeiras palavras do texto. */
    private fun deriveTitle(text: String): String {
        val words = text.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
        val short = words.take(8).joinToString(" ")
        return when {
            short.isEmpty() -> "Anotação"
            short.length <= 60 -> short
            else -> short.take(57).trimEnd() + "..."
        }
    }

    companion object {
        private const val PREFS_NAME = "nexus_notes"
        private const val KEY_NOTES = "notes"
        private const val MAX_NOTES = 500
    }
}
