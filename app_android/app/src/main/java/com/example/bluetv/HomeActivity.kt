package com.example.bluetv

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import org.json.JSONObject
import java.io.IOException

class HomeActivity : AppCompatActivity() {

    private val BACKEND_URL = "https://bluetv-full-project.onrender.com"
    private val API_KEY = "btv_k8x2mP9qL4wN7vR3jY6cT1hB5fA0eZ"
    private val PREFS_NAME = "bluetv_prefs"
    private val client = OkHttpClient()

    private val tabs = listOf("LIVE", "FILMES", "SÉRIES", "KIDS", "ANIME", "ESPORTES")
    private var currentTab = 0
    private var channels = listOf<Channel>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_home)

        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val validade = prefs.getString("validade", "—")
        val m3uUrl = prefs.getString("m3u_url", null)
        val clientId = prefs.getString("client_id", "")

        findViewById<TextView>(R.id.tvExpira).text = "Expira: $validade"
        setupTabs()

        if (m3uUrl != null) {
            loadM3U(m3uUrl)
        }

        if (!clientId.isNullOrEmpty()) sendHeartbeat(clientId)

        // Botão CONFIG
        findViewById<TextView>(R.id.btnConfig).setOnClickListener {
            val prefs2 = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs2.edit().putString("status", "pending").apply()
            startActivity(Intent(this, ActivationActivity::class.java))
            finish()
        }
    }

    private fun setupTabs() {
        val tabsContainer = findViewById<RecyclerView>(R.id.rvTabs)
        tabsContainer.layoutManager = LinearLayoutManager(this, LinearLayoutManager.HORIZONTAL, false)
        val adapter = TabAdapter(tabs, currentTab) { index ->
            currentTab = index
            filterChannels()
        }
        tabsContainer.adapter = adapter
    }

    private fun loadM3U(url: String) {
        val req = Request.Builder().url(url).build()
        client.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                runOnUiThread { Toast.makeText(this@HomeActivity, "Erro ao carregar canais", Toast.LENGTH_SHORT).show() }
            }
            override fun onResponse(call: Call, response: Response) {
                val body = response.body?.string() ?: return
                response.close()
                channels = M3UParser.parse(body)
                runOnUiThread { filterChannels() }
            }
        })
    }

    private fun filterChannels() {
        val keyword = when (tabs[currentTab]) {
            "LIVE" -> null // todos os grupos de TV ao vivo
            "FILMES" -> "filme"
            "SÉRIES" -> "serie"
            "KIDS" -> "kid"
            "ANIME" -> "anime"
            "ESPORTES" -> "esport"
            else -> null
        }

        val filtered = if (keyword == null && tabs[currentTab] == "LIVE") {
            M3UParser.groupByQuality(
                channels.filter { ch ->
                    val g = ch.group.lowercase()
                    !g.contains("filme") && !g.contains("serie") &&
                    !g.contains("kid") && !g.contains("anime") && !g.contains("adult")
                }
            )
        } else if (keyword != null) {
            channels.filter { it.group.lowercase().contains(keyword) }
        } else {
            channels
        }

        val recycler = findViewById<RecyclerView>(R.id.rvChannels)
        recycler.layoutManager = LinearLayoutManager(this, LinearLayoutManager.HORIZONTAL, false)
        recycler.adapter = ChannelAdapter(filtered) { channel ->
            val intent = Intent(this, PlayerActivity::class.java)
            intent.putExtra("stream_url", channel.url)
            intent.putExtra("channel_name", channel.name)
            intent.putExtra("channel_logo", channel.logo)
            startActivity(intent)
        }
    }

    private fun sendHeartbeat(clientId: String) {
        val json = JSONObject()
        json.put("client_code", clientId)
        json.put("device_model", android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL)
        val body = RequestBody.create("application/json".toMediaType(), json.toString())
        val req = Request.Builder().url("$BACKEND_URL/app/heartbeat")
            .post(body).addHeader("x-api-key", API_KEY).build()
        client.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {}
            override fun onResponse(call: Call, response: Response) { response.close() }
        })
    }
}
