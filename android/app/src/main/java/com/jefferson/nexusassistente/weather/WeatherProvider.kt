package com.jefferson.nexusassistente.weather

import android.content.Context
import android.location.Location
import android.location.LocationManager
import android.util.Log
import com.google.android.gms.location.FusedLocationProviderClient
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

data class WeatherInfo(
    val temperature: Double,
    val condition: String,
    val humidity: Int,
    val windSpeed: Double,
    val cityName: String,
    val timestamp: Long = System.currentTimeMillis(),
    /** Chance de chuva em % — só existe na previsão de um dia à frente. */
    val rainChance: Int? = null,
    /** `true` quando a resposta é a previsão de amanhã (não o tempo de agora). */
    val forecast: Boolean = false,
) {
    fun toSpeechText(): String {
        return "Em $cityName, a temperatura é de ${temperature.toInt()} graus, $condition. " +
               "Umidade de $humidity por cento, vento a ${windSpeed.toInt()} quilômetros por hora."
    }
}

class WeatherProvider(private val context: Context) {

    private val fusedLocationClient: FusedLocationProviderClient = LocationServices.getFusedLocationProviderClient(context)
    private val OPEN_METEO_BASE_URL = "https://api.open-meteo.com/v1/forecast"

    suspend fun getCurrentWeather(cityName: String? = null): WeatherInfo? {
        return try {
            val location = if (cityName != null) {
                getLocationByCityName(cityName)
            } else {
                getCurrentLocation()
            }

            location?.let { loc ->
                fetchWeatherFromOpenMeteo(loc.latitude, loc.longitude, cityName ?: "localização atual")
            }
        } catch (e: Exception) {
            Log.e("NEXUS_WEATHER", "Erro ao obter clima: ${e.message}")
            null
        }
    }

    /**
     * A PREVISÃO de amanhã: chance de chuva e temperatura máxima.
     *
     * É o que responde "vai chover amanhã?" com verdade — o clima de agora
     * não diz nada sobre o dia seguinte.
     */
    suspend fun getTomorrowForecast(cityName: String? = null): WeatherInfo? {
        return try {
            val location = if (cityName != null) {
                getLocationByCityName(cityName)
            } else {
                getCurrentLocation()
            }

            location?.let { loc ->
                fetchForecastFromOpenMeteo(loc.latitude, loc.longitude, cityName ?: "sua região")
            }
        } catch (e: Exception) {
            Log.e("NEXUS_WEATHER", "Erro ao obter a previsão: ${e.message}")
            null
        }
    }

    /** Consulta a previsão diária (amanhã) no Open-Meteo. */
    private suspend fun fetchForecastFromOpenMeteo(
        lat: Double,
        lon: Double,
        cityName: String
    ): WeatherInfo? {
        return CoroutineScope(Dispatchers.IO).async {
            val urlString = "$OPEN_METEO_BASE_URL?latitude=$lat&longitude=$lon" +
                "&daily=precipitation_probability_max,weathercode,temperature_2m_max" +
                "&forecast_days=2&timezone=America/Sao_Paulo"
            val url = URL(urlString)
            val connection = url.openConnection() as HttpURLConnection
            connection.requestMethod = "GET"
            connection.connectTimeout = 10000
            connection.readTimeout = 10000

            try {
                val responseCode = connection.responseCode
                if (responseCode == HttpURLConnection.HTTP_OK) {
                    val inputStream = connection.inputStream
                    val response = inputStream.bufferedReader().readText()
                    inputStream.close()
                    parseForecastResponse(response, cityName)
                } else {
                    Log.e("NEXUS_WEATHER", "HTTP error na previsão: $responseCode")
                    null
                }
            } catch (e: Exception) {
                Log.e("NEXUS_WEATHER", "Erro na requisição da previsão: ${e.message}")
                null
            } finally {
                connection.disconnect()
            }
        }.await()
    }

    /** Lê a previsão de amanhã (o segundo dia da lista). */
    private fun parseForecastResponse(jsonString: String, cityName: String): WeatherInfo? {
        return try {
            val json = JSONObject(jsonString)
            val daily = json.getJSONObject("daily")

            val codes = daily.getJSONArray("weathercode")
            val chances = daily.getJSONArray("precipitation_probability_max")
            val maxTemps = daily.getJSONArray("temperature_2m_max")

            // O primeiro dia é hoje: a previsão pedida é o SEGUNDO.
            val index = 1
            val code = codes.optInt(index, 0)
            val chance = chances.optInt(index, -1).let { if (it < 0) null else it }
            val maxTemp = maxTemps.optDouble(index, 0.0)

            val condition = when {
                chance != null && chance >= 60 -> "com ${chance}% de chance de chuva"
                chance != null && chance >= 30 -> "com ${chance}% de chance de chuva"
                else -> weatherCodeToCondition(code)
            }

            WeatherInfo(
                temperature = maxTemp,
                condition = condition,
                humidity = 0,
                windSpeed = 0.0,
                cityName = cityName,
                rainChance = chance,
                forecast = true
            )
        } catch (e: Exception) {
            Log.e("NEXUS_WEATHER", "Erro ao parsear a previsão: ${e.message}")
            null
        }
    }

    private suspend fun getCurrentLocation(): Location? {
        try {
            val cts = CancellationTokenSource()
            val location = fusedLocationClient.getCurrentLocation(Priority.PRIORITY_HIGH_ACCURACY, cts.token).await()
            if (location != null) return location
            // O serviço de localização pode responder "inativo" e devolver NULO
            // (sem exceção): sem este ramo, o clima simplesmente não vinha.
            Log.w("NEXUS_WEATHER", "Localização em tempo real indisponível")
        } catch (e: Exception) {
            Log.e("NEXUS_WEATHER", "Erro ao obter localização: ${e.message}")
        }

        // A ÚLTIMA posição que o próprio Android guardou.
        lastKnownLocation()?.let { return it }

        // Fallback para Matozinhos - MG
        return Location("fallback").apply {
            latitude = -19.5578
            longitude = -44.0814
        }
    }

    /** A última posição conhecida pelo LocationManager do sistema. */
    private fun lastKnownLocation(): Location? {
        val manager = context.getSystemService(Context.LOCATION_SERVICE) as? LocationManager
            ?: return null
        return try {
            listOf(
                LocationManager.GPS_PROVIDER,
                LocationManager.NETWORK_PROVIDER,
                LocationManager.PASSIVE_PROVIDER
            ).mapNotNull { manager.getLastKnownLocation(it) }
                .maxByOrNull { it.time }
        } catch (e: Exception) {
            Log.w("NEXUS_WEATHER", "Sem última posição conhecida: ${e.message}")
            null
        }
    }

    private fun getLocationByCityName(cityName: String): Location? {
        // Simplified: for known cities, return hardcoded coordinates
        val knownCities = mapOf(
            "matozinhos" to Location("matozinhos").apply { latitude = -19.5578; longitude = -44.0814 },
            "belo horizonte" to Location("bh").apply { latitude = -19.9167; longitude = -43.9345 },
            "contagem" to Location("contagem").apply { latitude = -19.9317; longitude = -44.0539 },
            "betim" to Location("betim").apply { latitude = -19.9678; longitude = -44.1978 },
            "sete lagoas" to Location("sete_lagoas").apply { latitude = -19.4658; longitude = -44.2469 }
        )
        return knownCities[cityName.lowercase().trim()]
    }

    private suspend fun fetchWeatherFromOpenMeteo(lat: Double, lon: Double, cityName: String): WeatherInfo? {
        return CoroutineScope(Dispatchers.IO).async {
            val urlString = "$OPEN_METEO_BASE_URL?latitude=$lat&longitude=$lon&current_weather=true&timezone=America/Sao_Paulo"
            val url = URL(urlString)
            val connection = url.openConnection() as HttpURLConnection
            connection.requestMethod = "GET"
            connection.connectTimeout = 10000
            connection.readTimeout = 10000

            try {
                val responseCode = connection.responseCode
                if (responseCode == HttpURLConnection.HTTP_OK) {
                    val inputStream = connection.inputStream
                    val response = inputStream.bufferedReader().readText()
                    inputStream.close()
                    parseWeatherResponse(response, cityName)
                } else {
                    Log.e("NEXUS_WEATHER", "HTTP error: $responseCode")
                    null
                }
            } catch (e: Exception) {
                Log.e("NEXUS_WEATHER", "Erro na requisição: ${e.message}")
                null
            } finally {
                connection.disconnect()
            }
        }.await()
    }

    private fun parseWeatherResponse(jsonString: String, cityName: String): WeatherInfo? {
        return try {
            val json = JSONObject(jsonString)
            val current = json.getJSONObject("current_weather")
            
            val temperature = current.getDouble("temperature")
            val windSpeed = current.getDouble("windspeed")
            val weatherCode = current.getInt("weathercode")
            
            val condition = weatherCodeToCondition(weatherCode)
            val humidity = estimateHumidity(weatherCode, temperature)
            
            WeatherInfo(
                temperature = temperature,
                condition = condition,
                humidity = humidity,
                windSpeed = windSpeed,
                cityName = cityName
            )
        } catch (e: Exception) {
            Log.e("NEXUS_WEATHER", "Erro ao parsear resposta: ${e.message}")
            null
        }
    }

    private fun weatherCodeToCondition(code: Int): String {
        return when (code) {
            0 -> "céu limpo"
            1, 2, 3 -> "parcialmente nublado"
            45, 48 -> "neblina"
            51, 53, 55 -> "chuvisco"
            56, 57 -> "chuvisco gelado"
            61, 63, 65 -> "chuva"
            66, 67 -> "chuva gelada"
            71, 73, 75 -> "neve"
            77 -> "grãos de neve"
            80, 81, 82 -> "pancadas de chuva"
            85, 86 -> "pancadas de neve"
            95 -> "tempestade"
            96, 99 -> "tempestade com granizo"
            else -> "condição desconhecida"
        }
    }

    private fun estimateHumidity(weatherCode: Int, temperature: Double): Int {
        return when {
            weatherCode in 0..3 -> 40 // céu limpo/parcialmente nublado
            weatherCode in 45..48 -> 90 // neblina
            weatherCode in 51..67 -> 80 // chuva/chuvisco
            weatherCode in 71..77 -> 70 // neve
            weatherCode in 80..99 -> 85 // pancadas/tempestade
            else -> 60
        }
    }
}