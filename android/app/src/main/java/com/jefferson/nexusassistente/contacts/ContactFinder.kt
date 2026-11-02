package com.jefferson.nexusassistente.contacts

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.ContactsContract
import android.text.TextUtils
import android.util.Log
import java.text.Normalizer

data class ContactResult(
    val name: String,
    val phoneNumber: String,
    val contactId: Long
)

class ContactFinder(private val context: Context) {

    private companion object {
        /** Pacote do WhatsApp: é para ele que os links de conversa apontam. */
        const val WHATSAPP_PACKAGE = "com.whatsapp"
    }

    fun searchContact(query: String): ContactResult? {
        val contactsList = mutableListOf<ContactResult>()
        val uri = ContactsContract.CommonDataKinds.Phone.CONTENT_URI
        val projection = arrayOf(
            ContactsContract.CommonDataKinds.Phone._ID,
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER
        )

        try {
            context.contentResolver.query(uri, projection, null, null, null)?.use { cursor ->
                val idIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone._ID)
                val nameIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)
                val phoneIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)

                while (cursor.moveToNext()) {
                    val id = cursor.getLong(idIdx)
                    val name = cursor.getString(nameIdx) ?: continue
                    val number = cursor.getString(phoneIdx) ?: continue
                    contactsList.add(ContactResult(name, number, id))
                }
            }
        } catch (e: Exception) {
            Log.e("NEXUS_CONTACTS", "Erro ao buscar contatos: ${e.message}")
            return null
        }

        return findBestMatch(query, contactsList)
    }

    fun searchContacts(query: String): List<ContactResult> {
        val contactsList = mutableListOf<ContactResult>()
        val uri = ContactsContract.CommonDataKinds.Phone.CONTENT_URI
        val projection = arrayOf(
            ContactsContract.CommonDataKinds.Phone._ID,
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER
        )

        try {
            context.contentResolver.query(uri, projection, null, null, null)?.use { cursor ->
                val idIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone._ID)
                val nameIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)
                val phoneIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)

                while (cursor.moveToNext()) {
                    val id = cursor.getLong(idIdx)
                    val name = cursor.getString(nameIdx) ?: continue
                    val number = cursor.getString(phoneIdx) ?: continue
                    contactsList.add(ContactResult(name, number, id))
                }
            }
        } catch (e: Exception) {
            Log.e("NEXUS_CONTACTS", "Erro ao buscar contatos: ${e.message}")
        }

        val cleanQuery = normalize(query).trim()
        return contactsList.filter { contact ->
            val cleanName = normalize(contact.name)
            cleanName.contains(cleanQuery) || levenshteinDistance(cleanQuery, cleanName) <= 3
        }.sortedBy { contact ->
            val cleanName = normalize(contact.name)
            if (cleanName.contains(cleanQuery)) 0 else levenshteinDistance(cleanQuery, cleanName)
        }
    }

    /**
     * Normaliza o texto para busca: remove acentos, lowercase, remove espaços extras.
     * Ex.: "Mãe" → "mae", "Maria Silva" → "maria silva"
     */
    private fun normalize(text: String): String {
        val noAccents = Normalizer.normalize(text, Normalizer.Form.NFD)
            .replace("[\\p{InCombiningDiacriticalMarks}]".toRegex(), "")
        return noAccents.lowercase().replace("\\s+".toRegex(), " ").trim()
    }

    private fun findBestMatch(query: String, contacts: List<ContactResult>): ContactResult? {
        val cleanQuery = normalize(query).trim()
        var bestMatch: ContactResult? = null
        var lowestDistance = Int.MAX_VALUE

        for (contact in contacts) {
            val cleanContactName = normalize(contact.name)

            if (cleanContactName.contains(cleanQuery)) {
                return contact
            }

            val distance = levenshteinDistance(cleanQuery, cleanContactName)
            if (distance < lowestDistance && distance <= 3) {
                lowestDistance = distance
                bestMatch = contact
            }
        }
        return bestMatch
    }

    private fun levenshteinDistance(lhs: CharSequence, rhs: CharSequence): Int {
        val lhsLength = lhs.length
        val rhsLength = rhs.length
        var cost = IntArray(lhsLength + 1) { it }
        var newCost = IntArray(lhsLength + 1) { 0 }

        for (i in 1..rhsLength) {
            newCost[0] = i
            for (j in 1..lhsLength) {
                val match = if (lhs[j - 1] == rhs[i - 1]) 0 else 1
                newCost[j] = minOf(
                    newCost[j - 1] + 1,
                    cost[j] + 1,
                    cost[j - 1] + match
                )
            }
            val swap = cost
            cost = newCost
            newCost = swap
        }
        return cost[lhsLength]
    }

    /**
     * Verifica se um número de telefone tem conta no WhatsApp.
     *
     * Consulta o sistema Android para saber se existe algum app capaz de
     * atender o intent `whatsapp://send?phone=...`. Se não houver, o número
     * não pode receber mensagens pelo WhatsApp instalado neste aparelho.
     *
     * Isso evita o Nexus tentar enviar mensagem para contato da agenda que
     * não tem WhatsApp e falhar silenciosamente.
     */
    fun hasWhatsAppAccount(phoneNumber: String): Boolean {
        val cleaned = cleanPhoneForWhatsApp(phoneNumber)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            data = Uri.parse("whatsapp://send?phone=$cleaned")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        return context.packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY) != null
    }

    /**
     * Abre o chat do WhatsApp direto pelo número (wa.me).
     * Formata o número para padrão internacional do Brasil (+55) se necessário.
     *
     * O `setPackage` é o que garante que quem abre é o WhatsApp: sem ele, o
     * Android pode entregar o link `wa.me` para o NAVEGADOR, e aí a conversa
     * nunca abre e a automação seguinte falha sem entender por quê.
     */
    fun openWhatsAppChat(phoneNumber: String): Boolean {
        val cleanedNumber = cleanPhoneForWhatsApp(phoneNumber)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            data = Uri.parse("https://wa.me/$cleanedNumber")
            setPackage(WHATSAPP_PACKAGE)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            context.startActivity(intent)
            return true
        } catch (e: Exception) {
            Log.e("NEXUS_CONTACTS", "Erro ao abrir WhatsApp: ${e.message}")
            return false
        }
    }

    /**
     * Limpa e formata o telefone para o formato que o wa.me espera:
     * Apenas dígitos, com código do país (55 para Brasil) sem o +.
     * Ex.: "(11) 99999-9999" → "5511999999999"
     *       "99999-9999" → "5511999999999" (assume DDD 11 se for 8-9 dígitos)
     *       "+55 11 99999-9999" → "5511999999999"
     */
    private fun cleanPhoneForWhatsApp(phoneNumber: String): String {
        val digitsOnly = phoneNumber.replace(Regex("[^0-9]"), "")

        // Se já tem código do país (começa com 55 e tem 12-13 dígitos)
        if (digitsOnly.startsWith("55") && digitsOnly.length >= 12) {
            return digitsOnly
        }

        // Se tem 10-11 dígitos (DDD + número), adiciona 55
        if (digitsOnly.length >= 10) {
            return "55$digitsOnly"
        }

        // Número curto (só o número sem DDD) - assume DDD 11 como fallback
        return "5511$digitsOnly"
    }

    fun makeLocalCall(phoneNumber: String): Boolean {
        val cleanedNumber = phoneNumber.replace(Regex("[^0-9]"), "")
        val intent = Intent(Intent.ACTION_CALL).apply {
            data = Uri.parse("tel:$cleanedNumber")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
            context.startActivity(intent)
            return true
        } catch (e: SecurityException) {
            Log.e("NEXUS_CONTACTS", "Permissão CALL_PHONE não concedida")
            return false
        } catch (e: Exception) {
            Log.e("NEXUS_CONTACTS", "Erro ao fazer ligação: ${e.message}")
            return false
        }
    }
}