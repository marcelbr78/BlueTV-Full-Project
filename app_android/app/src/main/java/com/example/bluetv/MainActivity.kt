package com.example.bluetv

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.UUID

class MainActivity : AppCompatActivity() {

    private val BACKEND_URL = "https://bluetv-full-project.onrender.com"
    private val API_KEY = "btv_k8x2mP9qL4wN7vR3jY6cT1hB5fA0eZ"
    private val WHATSAPP_NUMBER = "5547997193147"
    private val PREFS_NAME = "bluetv_prefs"
    private val KEY_CLIENT_ID = "client_id"
    private val KEY_STATUS = "status"

    private val client = OkHttpClient()
    private val handler = Handler(Looper.getMainLooper())
    private var pollingRunnable: Runnable? = null
    private var isPolling = false

    // Views
    private lateinit var tvClientId: TextView
    private lateinit var tvStatus: TextView
    private lateinit var tvStatusDetail: TextView
    private lateinit var btnSolicitarTeste: Button
    private lateinit var btnAbrirPlayer: Button
    private lateinit var layoutCredenciais: LinearLayout
    private lateinit var tvHost: TextView
    private lateinit var tvUsername: TextView
    private lateinit var tvPassword: TextView
    private lateinit var tvValidade: TextView
    private lateinit var progressBar: ProgressBar
    private lateinit var ivQrCode: ImageView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        initViews()
        val clientId = getOrCreateClientId()
        tvClientId.text = clientId
        generateQrCode(clientId)

        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val savedStatus = prefs.getString(KEY_STATUS, "pending")

        if (savedStatus == "ok") {
            checkStatus(clientId)
        } else {
            setStatus("pending")
            // Iniciar polling automaticamente ao abrir o app
            startPolling(clientId)
        }

        btnSolicitarTeste.setOnClickListener {
            openWhatsApp(clientId)
            startPolling(clientId)
        }

        btnAbrirPlayer.setOnClickListener {
            val prefs2 = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            val m3u = prefs2.getString("m3u_url", null)
            if (m3u != null) {
                val intent = Intent(this, PlayerActivity::class.java)
                intent.putExtra("m3u_url", m3u)
                startActivity(intent)
            }
        }
    }

    private fun initViews() {
        tvClientId = findViewById(R.id.tvClientId)
        tvStatus = findViewById(R.id.tvStatus)
        tvStatusDetail = findViewById(R.id.tvStatusDetail)
        btnSolicitarTeste = findViewById(R.id.btnSolicitarTeste)
        btnAbrirPlayer = findViewById(R.id.btnAbrirPlayer)
        layoutCredenciais = findViewById(R.id.layoutCredenciais)
        tvHost = findViewById(R.id.tvHost)
        tvUsername = findViewById(R.id.tvUsername)
        tvPassword = findViewById(R.id.tvPassword)
        tvValidade = findViewById(R.id.tvValidade)
        progressBar = findViewById(R.id.progressBar)
        ivQrCode = findViewById(R.id.ivQrCode)
    }

    private fun getOrCreateClientId(): String {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        var clientId = prefs.getString(KEY_CLIENT_ID, null)
        if (clientId == null) {
            val chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
            clientId = "BLUETV-" + (1..5).map { chars.random() }.joinToString("")
            prefs.edit().putString(KEY_CLIENT_ID, clientId).apply()
            registerClient(clientId)
        }
        return clientId
    }

    private fun registerClient(clientId: String) {
        val json = JSONObject()
        json.put("client_code", clientId)
        json.put("device_id", UUID.randomUUID().toString())

        val body = json.toString().toRequestBody("application/json".toMediaType())
        val request = Request.Builder()
            .url("$BACKEND_URL/app/register")
            .post(body)
            .addHeader("x-api-key", API_KEY)
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {}
            override fun onResponse(call: Call, response: Response) {}
        })
    }

    private fun generateQrCode(clientId: String) {
        val message = "Olá bom dia! Sou cliente ID $clientId e gostaria de um teste IPTV BlueTV 😊"
        val encoded = Uri.encode(message)
        val waUrl = "https://wa.me/$WHATSAPP_NUMBER?text=$encoded"

        try {
            val writer = com.google.zxing.qrcode.QRCodeWriter()
            val bitMatrix = writer.encode(waUrl, com.google.zxing.BarcodeFormat.QR_CODE, 400, 400)
            val width = bitMatrix.width
            val height = bitMatrix.height
            val bmp = android.graphics.Bitmap.createBitmap(width, height, android.graphics.Bitmap.Config.RGB_565)
            for (x in 0 until width) {
                for (y in 0 until height) {
                    bmp.setPixel(x, y, if (bitMatrix[x, y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE)
                }
            }
            runOnUiThread { ivQrCode.setImageBitmap(bmp) }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun openWhatsApp(clientId: String) {
        val message = "Olá bom dia! Sou cliente ID $clientId e gostaria de um teste IPTV BlueTV 😊"
        val encoded = Uri.encode(message)
        val url = "https://wa.me/$WHATSAPP_NUMBER?text=$encoded"
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url))
        startActivity(intent)
    }

    private fun startPolling(clientId: String) {
        if (isPolling) return
        isPolling = true
        setStatus("waiting")

        // Verificar imediatamente
        checkStatus(clientId)

        pollingRunnable = object : Runnable {
            override fun run() {
                checkStatus(clientId)
                handler.postDelayed(this, 5000)
            }
        }
        handler.postDelayed(pollingRunnable!!, 5000)
    }

    private fun stopPolling() {
        pollingRunnable?.let { handler.removeCallbacks(it) }
        isPolling = false
    }

    private fun checkStatus(clientId: String) {
        val url = "$BACKEND_URL/app/status/bluetv/$clientId"
        android.util.Log.d("BlueTV", "Checking status: $url")
        
        val request = Request.Builder()
            .url(url)
            .get()
            .addHeader("x-api-key", API_KEY)
            .addHeader("Content-Type", "application/json")
            .build()

        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                android.util.Log.e("BlueTV", "Status check failed: ${e.message}")
            }

            override fun onResponse(call: Call, response: Response) {
                val bodyStr = response.body?.string() ?: return
                android.util.Log.d("BlueTV", "Status response: $bodyStr")
                
                try {
                    val json = JSONObject(bodyStr)
                    val status = json.optString("status", "pending")
                    android.util.Log.d("BlueTV", "Status: $status")

                    if (status == "ok") {
                        val xtream = json.optJSONObject("xtream")
                        if (xtream != null) {
                            val host = xtream.optString("host")
                            val username = xtream.optString("username")
                            val password = xtream.optString("password")
                            val validade = xtream.optString("validade")
                            val m3uUrl = xtream.optString("m3u_url")
                            val plano = xtream.optString("plano")

                            android.util.Log.d("BlueTV", "Credenciais recebidas! Host: $host")

                            val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                            prefs.edit()
                                .putString(KEY_STATUS, "ok")
                                .putString("host", host)
                                .putString("username", username)
                                .putString("password", password)
                                .putString("validade", validade)
                                .putString("m3u_url", m3uUrl)
                                .putString("plano", plano)
                                .apply()

                            stopPolling()
                            runOnUiThread {
                                setStatus("ok")
                                showCredenciais(host, username, password, validade)
                            }
                        }
                    }
                } catch (e: Exception) {
                    android.util.Log.e("BlueTV", "Erro ao parsear resposta: ${e.message}")
                }
            }
        })
    }

    private fun setStatus(status: String) {
        when (status) {
            "pending" -> {
                tvStatus.text = "⚪ Aguardando Activação"
                tvStatus.setTextColor(getColor(android.R.color.white))
                tvStatusDetail.text = "Escaneie o QR Code ou toque em Solicitar Teste"
                progressBar.visibility = View.GONE
                btnSolicitarTeste.visibility = View.VISIBLE
                btnAbrirPlayer.visibility = View.GONE
                layoutCredenciais.visibility = View.GONE
            }
            "waiting" -> {
                tvStatus.text = "🔵 A Processar..."
                tvStatusDetail.text = "Aguarde, as suas credenciais estão a ser geradas"
                progressBar.visibility = View.VISIBLE
                btnSolicitarTeste.isEnabled = false
            }
            "ok" -> {
                tvStatus.text = "🟢 Activo!"
                tvStatus.setTextColor(getColor(android.R.color.holo_green_light))
                tvStatusDetail.text = "O seu acesso IPTV está configurado e pronto"
                progressBar.visibility = View.GONE
                btnSolicitarTeste.visibility = View.GONE
                btnAbrirPlayer.visibility = View.VISIBLE
                
                val clientId = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .getString(KEY_CLIENT_ID, null)
                if (clientId != null) startHeartbeat(clientId)
            }
        }
    }

    private fun startHeartbeat(clientId: String) {
        val heartbeatRunnable = object : Runnable {
            override fun run() {
                val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                val channel = prefs.getString("current_channel", null)
                
                val json = JSONObject()
                json.put("client_code", clientId)
                json.put("device_model", android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL)
                json.put("apk_version", "1.0")
                if (channel != null) json.put("current_channel", channel)

                val body = json.toString().toRequestBody("application/json".toMediaType())
                val request = Request.Builder()
                    .url("$BACKEND_URL/app/heartbeat")
                    .post(body)
                    .addHeader("x-api-key", API_KEY)
                    .build()

                client.newCall(request).enqueue(object : Callback {
                    override fun onFailure(call: Call, e: IOException) {}
                    override fun onResponse(call: Call, response: Response) {
                        response.close()
                    }
                })
                handler.postDelayed(this, 30000) // a cada 30 segundos
            }
        }
        handler.post(heartbeatRunnable)
    }

    private fun sendOffline(clientId: String) {
        val json = JSONObject()
        json.put("client_code", clientId)
        val body = json.toString().toRequestBody("application/json".toMediaType())
        val request = Request.Builder()
            .url("$BACKEND_URL/app/offline")
            .post(body)
            .addHeader("x-api-key", API_KEY)
            .build()
        client.newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {}
            override fun onResponse(call: Call, response: Response) { response.close() }
        })
    }

    private fun showCredenciais(host: String, username: String, password: String, validade: String) {
        layoutCredenciais.visibility = View.VISIBLE
        tvHost.text = host
        tvUsername.text = username
        tvPassword.text = password
        tvValidade.text = validade

        // Navegar para HomeActivity após 2 segundos
        handler.postDelayed({
            val intent = Intent(this, HomeActivity::class.java)
            startActivity(intent)
        }, 2000)
    }

    override fun onDestroy() {
        val clientId = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString(KEY_CLIENT_ID, null)
        if (clientId != null) sendOffline(clientId)
        
        super.onDestroy()
        stopPolling()
    }
}
