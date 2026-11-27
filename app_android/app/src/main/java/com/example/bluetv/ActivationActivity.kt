package com.example.bluetv

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.widget.*
import androidx.appcompat.app.AppCompatActivity
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit

class ActivationActivity : AppCompatActivity() {

    private val BACKEND_URL = "https://bluetv-full-project.onrender.com"
    private val API_KEY = "btv_k8x2mP9qL4wN7vR3jY6cT1hB5fA0eZ"
    private val WHATSAPP_NUMBER = "5547997193147"
    private val PREFS_NAME = "bluetv_prefs"

    // Timeout aumentado para 30s — Render free tier pode demorar no cold start
    private val client = OkHttpClient.Builder()
        .connectTimeout(30, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private val handler = Handler(Looper.getMainLooper())
    private var pollingRunnable: Runnable? = null

    private lateinit var tvClientId: TextView
    private lateinit var tvStatus: TextView
    private lateinit var btnSolicitar: Button
    private lateinit var ivQrCode: ImageView
    private lateinit var progressBar: ProgressBar

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_activation)

        tvClientId = findViewById(R.id.tvClientId)
        tvStatus   = findViewById(R.id.tvStatus)
        btnSolicitar = findViewById(R.id.btnSolicitar)
        ivQrCode   = findViewById(R.id.ivQrCode)
        progressBar = findViewById(R.id.progressBar)

        val clientId = getOrCreateClientId()
        tvClientId.text = clientId
        tvStatus.text = "Aguardando ativação..."
        generateQrCode(clientId)
        startPolling(clientId)

        btnSolicitar.setOnClickListener { openWhatsApp(clientId) }
    }

    private fun getOrCreateClientId(): String {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        var id = prefs.getString("client_id", null)
        if (id == null) {
            id = generateDeviceId()
            prefs.edit().putString("client_id", id).apply()
            registerClient(id)
        }
        return id
    }

    private fun generateDeviceId(): String {
        val chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
        val androidId = android.provider.Settings.Secure.getString(
            contentResolver, android.provider.Settings.Secure.ANDROID_ID
        )
        return "BLUETV-" + if (!androidId.isNullOrEmpty()) {
            // ID determinístico: mesmo dispositivo = mesmo código, mesmo após limpar dados
            val seed = androidId.toLongOrNull(16) ?: androidId.hashCode().toLong()
            val rng = java.util.Random(seed)
            (1..5).map { chars[rng.nextInt(chars.length)] }.joinToString("")
        } else {
            // Fallback: ID aleatório se ANDROID_ID não estiver disponível
            (1..5).map { chars.random() }.joinToString("")
        }
    }

    private fun registerClient(clientId: String) {
        val json = JSONObject()
        json.put("client_code", clientId)
        json.put("device_id", UUID.randomUUID().toString())
        json.put("device_model", android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL)
        val body = json.toString().toRequestBody("application/json".toMediaType())
        val req = Request.Builder().url("$BACKEND_URL/app/register")
            .post(body).addHeader("x-api-key", API_KEY).build()
        client.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                runOnUiThread { tvStatus.text = "Sem conexão. Tentando..." }
            }
            override fun onResponse(call: Call, response: Response) {
                response.close()
                runOnUiThread { tvStatus.text = "Aguardando ativação..." }
            }
        })
    }

    private fun generateQrCode(clientId: String) {
        val msg = "Olá bom dia! Sou cliente ID $clientId e gostaria de um teste iptv BlueTV"
        val url = "https://wa.me/$WHATSAPP_NUMBER?text=${Uri.encode(msg)}"
        try {
            val writer = com.google.zxing.qrcode.QRCodeWriter()
            val bm = writer.encode(url, com.google.zxing.BarcodeFormat.QR_CODE, 300, 300)
            val bmp = android.graphics.Bitmap.createBitmap(bm.width, bm.height, android.graphics.Bitmap.Config.RGB_565)
            for (x in 0 until bm.width) for (y in 0 until bm.height)
                bmp.setPixel(x, y, if (bm[x, y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE)
            runOnUiThread { ivQrCode.setImageBitmap(bmp) }
        } catch (e: Exception) { e.printStackTrace() }
    }

    private fun openWhatsApp(clientId: String) {
        val msg = "Olá bom dia! Sou cliente ID $clientId e gostaria de um teste iptv BlueTV"
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$WHATSAPP_NUMBER?text=${Uri.encode(msg)}")))
    }

    private fun startPolling(clientId: String) {
        pollingRunnable = object : Runnable {
            override fun run() {
                checkStatus(clientId)
                handler.postDelayed(this, 5000)
            }
        }
        handler.post(pollingRunnable!!)
    }

    private fun checkStatus(clientId: String) {
        val req = Request.Builder()
            .url("$BACKEND_URL/app/status/bluetv/$clientId")
            .addHeader("x-api-key", API_KEY).build()

        client.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                runOnUiThread { tvStatus.text = "Erro de conexão. Tentando..." }
            }

            override fun onResponse(call: Call, response: Response) {
                val body = response.body?.string()
                response.close()

                if (body == null) {
                    runOnUiThread { tvStatus.text = "Resposta vazia. Tentando..." }
                    return
                }

                try {
                    val json = JSONObject(body)
                    val status = json.optString("status")

                    runOnUiThread { tvStatus.text = "Status: $status" }

                    if (status == "ok") {
                        val x = json.optJSONObject("xtream") ?: run {
                            runOnUiThread { tvStatus.text = "Erro: xtream ausente" }
                            return
                        }

                        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                        prefs.edit()
                            .putString("status", "ok")
                            .putString("host", x.optString("host"))
                            .putString("username", x.optString("username"))
                            .putString("password", x.optString("password"))
                            .putString("validade", x.optString("validade"))
                            .putString("m3u_url", x.optString("m3u_url"))
                            .apply()

                        pollingRunnable?.let { handler.removeCallbacks(it) }

                        runOnUiThread {
                            startActivity(Intent(this@ActivationActivity, HomeActivity::class.java))
                            finish()
                        }
                    }
                } catch (e: Exception) {
                    runOnUiThread { tvStatus.text = "Erro: ${e.message}" }
                }
            }
        })
    }

    override fun onDestroy() {
        super.onDestroy()
        pollingRunnable?.let { handler.removeCallbacks(it) }
    }
}
