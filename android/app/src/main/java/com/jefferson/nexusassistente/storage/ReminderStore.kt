package com.jefferson.nexusassistente.storage

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/**
 * Um lembrete/despertador do Nexus.
 *
 * `triggerAtMillis` é o instante exato do próximo disparo. `repeatDaily` faz o
 * Nexus reagendar o mesmo lembrete para o dia seguinte depois que ele toca —
 * é o "me acorde todo dia às 6h".
 */
data class Reminder(
    val id: String,
    val title: String,
    val description: String,
    val triggerAtMillis: Long,
    val enabled: Boolean,
    val repeatDaily: Boolean,
    val createdAt: Long,
    /**
     * O TIPO: "lembrete" ou "alarme".
     *
     * A diferença é a TELA que abre quando toca: o alarme é o despertador
     * (fala o horário para o usuário levantar); o lembrete é o recado ("ir ao
     * psicólogo"). Os dois ficam guardados aqui, com dia e hora exatos.
     */
    val kind: String = KIND_REMINDER,
) {
    /** `true` quando é o despertador (abre a tela de alarme). */
    val isAlarm: Boolean get() = kind == KIND_ALARM

    companion object {
        /** Um recado: abre a tela de LEMBRETE. */
        const val KIND_REMINDER = "lembrete"

        /** O despertador: abre a tela de ALARME. */
        const val KIND_ALARM = "alarme"
    }
}

/**
 * Lembretes do usuário, guardados em `SharedPreferences`.
 *
 * O agendamento de verdade é do [com.jefferson.nexusassistente.reminder.ReminderScheduler];
 * aqui só vive a lista, para o usuário poder perguntar "quais são meus
 * lembretes?" e ouvir tudo em voz alta mesmo depois de reiniciar o aparelho.
 */
class ReminderStore(context: Context) {

    private val prefs = context.applicationContext
        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    /** Todos os lembretes, ordenados pelo horário (o próximo primeiro). */
    @Synchronized
    fun list(): List<Reminder> {
        val array = readAll()
        val reminders = ArrayList<Reminder>(array.length())

        for (index in 0 until array.length()) {
            val item = array.optJSONObject(index) ?: continue
            reminders.add(
                Reminder(
                    id = item.optString("id"),
                    title = item.optString("title"),
                    description = item.optString("description"),
                    triggerAtMillis = item.optLong("triggerAtMillis"),
                    enabled = item.optBoolean("enabled", true),
                    repeatDaily = item.optBoolean("repeatDaily", false),
                    createdAt = item.optLong("createdAt"),
                    kind = item.optString("kind", KIND_REMINDER),
                )
            )
        }

        return reminders.sortedBy { it.triggerAtMillis }
    }

    /** Só os lembretes ativos, do mais próximo para o mais distante. */
    @Synchronized
    fun listEnabled(): List<Reminder> = list().filter { it.enabled }

    @Synchronized
    fun get(id: String): Reminder? = list().firstOrNull { it.id == id }

    /** Cria um lembrete e devolve o que ficou salvo. */
    @Synchronized
    fun save(
        title: String,
        description: String,
        triggerAtMillis: Long,
        repeatDaily: Boolean = false,
        kind: String = KIND_REMINDER,
    ): Reminder {
        val cleanTitle = title.trim().ifEmpty { description.trim().take(60).ifEmpty { "Lembrete" } }

        val reminder = Reminder(
            id = UUID.randomUUID().toString(),
            title = cleanTitle.take(80),
            description = description.trim().take(500),
            triggerAtMillis = triggerAtMillis,
            enabled = true,
            repeatDaily = repeatDaily,
            createdAt = System.currentTimeMillis(),
            kind = if (kind == KIND_ALARM) KIND_ALARM else KIND_REMINDER,
        )

        val array = readAll()
        array.put(toJson(reminder))
        writeAll(array)
        return reminder
    }

    /**
     * Edita os campos informados de um lembrete.
     *
     * Campos com valor nulo são mantidos como estão — é o que permite "muda o
     * horário do lembrete 2" sem obrigar o usuário a repetir a descrição.
     */
    @Synchronized
    fun update(
        id: String,
        title: String? = null,
        description: String? = null,
        triggerAtMillis: Long? = null,
        enabled: Boolean? = null,
        repeatDaily: Boolean? = null,
    ): Reminder? {
        val array = readAll()
        var updated: Reminder? = null

        for (index in 0 until array.length()) {
            val item = array.optJSONObject(index) ?: continue
            if (item.optString("id") != id) continue

            val current = Reminder(
                id = item.optString("id"),
                title = item.optString("title"),
                description = item.optString("description"),
                triggerAtMillis = item.optLong("triggerAtMillis"),
                enabled = item.optBoolean("enabled", true),
                repeatDaily = item.optBoolean("repeatDaily", false),
                createdAt = item.optLong("createdAt"),
                kind = item.optString("kind", KIND_REMINDER),
            )

            updated = current.copy(
                title = title?.trim()?.takeIf { it.isNotEmpty() }?.take(80) ?: current.title,
                description = description?.trim()?.take(500) ?: current.description,
                triggerAtMillis = triggerAtMillis ?: current.triggerAtMillis,
                enabled = enabled ?: current.enabled,
                repeatDaily = repeatDaily ?: current.repeatDaily,
            )
            array.put(index, toJson(updated))
            break
        }

        if (updated != null) writeAll(array)
        return updated
    }

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
        JSONArray(prefs.getString(KEY_REMINDERS, "[]"))
    } catch (_: Exception) {
        JSONArray()
    }

    private fun writeAll(array: JSONArray) {
        prefs.edit().putString(KEY_REMINDERS, array.toString()).apply()
    }

    private fun toJson(reminder: Reminder): JSONObject = JSONObject()
        .put("id", reminder.id)
        .put("title", reminder.title)
        .put("description", reminder.description)
        .put("triggerAtMillis", reminder.triggerAtMillis)
        .put("enabled", reminder.enabled)
        .put("repeatDaily", reminder.repeatDaily)
        .put("createdAt", reminder.createdAt)
        .put("kind", reminder.kind)

    companion object {
        private const val PREFS_NAME = "nexus_reminders"
        private const val KEY_REMINDERS = "reminders"

        /*
         * Os mesmos dois tipos do [Reminder] — um único lugar guarda o valor
         * ("lembrete"/"alarme") e o repositório só empresta o nome.
         */
        const val KIND_REMINDER = Reminder.KIND_REMINDER
        const val KIND_ALARM = Reminder.KIND_ALARM
    }
}
