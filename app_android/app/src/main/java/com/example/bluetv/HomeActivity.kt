package com.example.bluetv

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

class HomeActivity : AppCompatActivity() {

    private val PREFS_NAME = "bluetv_prefs"
    private val BACKEND_URL = "https://bluetv-full-project.onrender.com"
    private val API_KEY = "btv_k8x2mP9qL4wN7vR3jY6cT1hB5fA0eZ"
    private val client = OkHttpClient()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_home)

        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val clientId = prefs.getString("client_id", "—")
        val plano = prefs.getString("plano", "Teste")
        val validade = prefs.getString("validade", "—")
        val m3uUrl = prefs.getString("m3u_url", null)

        findViewById<TextView>(R.id.tvClientId).text = clientId
        findViewById<TextView>(R.id.tvPlano).text = "📦 $plano"
        findViewById<TextView>(R.id.tvValidade).text = "🗓️ Válido até: $validade"

        // Botão TV ao Vivo
        findViewById<LinearLayout>(R.id.btnTvAoVivo).setOnClickListener {
            if (m3uUrl != null) {
                val intent = Intent(this, PlayerActivity::class.java)
                intent.putExtra("m3u_url", m3uUrl)
                intent.putExtra("category", "tv")
                startActivity(intent)
            } else {
                Toast.makeText(this, "URL não encontrada", Toast.LENGTH_SHORT).show()
            }
        }

        // Botão Séries
        findViewById<LinearLayout>(R.id.btnSeries).setOnClickListener {
            Toast.makeText(this, "Em breve!", Toast.LENGTH_SHORT).show()
        }

        // Botão Filmes
        findViewById<LinearLayout>(R.id.btnFilmes).setOnClickListener {
            Toast.makeText(this, "Em breve!", Toast.LENGTH_SHORT).show()
        }

        // Botão Sair / Voltar à activação
        findViewById<TextView>(R.id.tvSair).setOnClickListener {
            val intent = Intent(this, MainActivity::class.java)
            intent.flags = Intent.FLAG_ACTIVITY_CLEAR_TOP
            startActivity(intent)
        }

        // Heartbeat
        sendHeartbeat(clientId ?: "")
    }

    private fun sendHeartbeat(clientId: String) {
        val json = JSONObject()
        json.put("client_code", clientId)
        json.put("device_model", android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL)
        json.put("apk_version", "1.0")

        val body = json.toString()
            .toRequestBody("application/json".toMediaTypeOrNull())
        val request = Request.Builder()
            .url("$BACKEND_URL/app/heartbeat")
            .post(body)
            .addHeader("x-api-key", API_KEY)
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {}
            override fun onResponse(call: Call, response: Response) { response.close() }
        })
    }
}
