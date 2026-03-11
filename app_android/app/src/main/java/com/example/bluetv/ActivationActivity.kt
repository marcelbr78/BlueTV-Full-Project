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

class ActivationActivity : AppCompatActivity() {

    private val BACKEND_URL = "https://bluetv-full-project.onrender.com"
    private val API_KEY = "btv_k8x2mP9qL4wN7vR3jY6cT1hB5fA0eZ"
    private val WHATSAPP_NUMBER = "5547997193147"
    private val PREFS_NAME = "bluetv_prefs"

    private val client = OkHttpClient()
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
        tvStatus = findViewById(R.id.tvStatus)
        btnSolicitar = findViewById(R.id.btnSolicitar)
        ivQrCode = findViewById(R.id.ivQrCode)
        progressBar = findViewById(R.id.progressBar)

        val clientId = getOrCreateClientId()
        tvClientId.text = clientId
        generateQrCode(clientId)
        startPolling(clientId)

        btnSolicitar.setOnClickListener { openWhatsApp(clientId) }
    }

    private fun getOrCreateClientId(): String {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        var id = prefs.getString("client_id", null)
        if (id == null) {
            val chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
            id = "BLUETV-" + (1..5).map { chars.random() }.joinToString("")
            prefs.edit().putString("client_id", id).apply()
            registerClient(id)
        }
        return id
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
            override fun onFailure(call: Call, e: IOException) {}
            override fun onResponse(call: Call, response: Response) { response.close() }
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
            override fun onFailure(call: Call, e: IOException) {}
            override fun onResponse(call: Call, response: Response) {
                val body = response.body?.string() ?: return
                response.close()
                try {
                    val json = JSONObject(body)
                    if (json.optString("status") == "ok") {
                        val x = json.optJSONObject("xtream") ?: return
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
                } catch (e: Exception) {}
            }
        })
    }

    override fun onDestroy() {
        super.onDestroy()
        pollingRunnable?.let { handler.removeCallbacks(it) }
    }
}
