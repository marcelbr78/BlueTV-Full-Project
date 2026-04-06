package com.example.bluetv

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.GridLayoutManager
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
    private var allChannels = listOf<Channel>()

    private lateinit var rvChannels: RecyclerView
    private lateinit var progressBar: ProgressBar

    // Abas que usam player direto (sem tela de detalhe)
    private val directPlayTabs = setOf("LIVE", "ESPORTES")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_home)

        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val validade = prefs.getString("validade", "—")
        val m3uUrl = prefs.getString("m3u_url", null)
        val clientId = prefs.getString("client_id", "")

        rvChannels = findViewById(R.id.rvChannels)
        progressBar = findViewById(R.id.progressBar)

        findViewById<TextView>(R.id.tvExpira).text = "Expira: $validade"
        setupTabs()

        if (m3uUrl != null) {
            showLoading(true)
            loadM3U(m3uUrl)
        } else {
            Toast.makeText(this, "URL não encontrada. Reative o app.", Toast.LENGTH_LONG).show()
        }

        if (!clientId.isNullOrEmpty()) sendHeartbeat(clientId)

        findViewById<TextView>(R.id.btnConfig).setOnClickListener {
            val prefs2 = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            prefs2.edit().putString("status", "pending").apply()
            startActivity(Intent(this, ActivationActivity::class.java))
            finish()
        }
    }

    private fun setupTabs() {
        val rvTabs = findViewById<RecyclerView>(R.id.rvTabs)
        rvTabs.layoutManager = LinearLayoutManager(this, LinearLayoutManager.HORIZONTAL, false)
        rvTabs.adapter = TabAdapter(tabs, currentTab) { index ->
            currentTab = index
            renderChannels()
        }
    }

    private fun loadM3U(url: String) {
        val req = Request.Builder().url(url).build()
        client.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                runOnUiThread {
                    showLoading(false)
                    Toast.makeText(this@HomeActivity, "Erro ao carregar canais", Toast.LENGTH_SHORT).show()
                }
            }
            override fun onResponse(call: Call, response: Response) {
                val body = response.body?.string() ?: return
                response.close()
                allChannels = M3UParser.parse(body)
                runOnUiThread {
                    showLoading(false)
                    renderChannels()
                }
            }
        })
    }

    private fun renderChannels() {
        val tab = tabs[currentTab]
        val isLiveMode = tab in directPlayTabs

        val filtered = when (tab) {
            "LIVE"     -> M3UParser.groupByQuality(
                allChannels.filter { ch ->
                    val g = ch.group.lowercase()
                    !g.contains("filme") && !g.contains("serie") &&
                    !g.contains("kid") && !g.contains("anime") &&
                    !g.contains("adult") && !g.contains("esport") && !g.contains("sport")
                }
            )
            "FILMES"   -> allChannels.filter { it.group.lowercase().let { g -> g.contains("filme") || g.contains("movie") } }
            "SÉRIES"   -> allChannels.filter { it.group.lowercase().let { g -> g.contains("serie") || g.contains("series") } }
            "KIDS"     -> allChannels.filter { it.group.lowercase().let { g -> g.contains("kid") || g.contains("infantil") || g.contains("criança") } }
            "ANIME"    -> allChannels.filter { it.group.lowercase().contains("anime") }
            "ESPORTES" -> allChannels.filter { it.group.lowercase().let { g -> g.contains("esport") || g.contains("sport") || g.contains("futebol") } }
            else -> allChannels
        }

        val displayMode = if (isLiveMode) ChannelAdapter.MODE_LIVE else ChannelAdapter.MODE_GRID

        if (isLiveMode) {
            rvChannels.layoutManager = LinearLayoutManager(this, LinearLayoutManager.VERTICAL, false)
        } else {
            rvChannels.layoutManager = GridLayoutManager(this, 3)
        }

        rvChannels.adapter = ChannelAdapter(filtered, displayMode) { channel ->
            if (isLiveMode) {
                // LIVE e ESPORTES: vai direto pro player
                val intent = Intent(this, PlayerActivity::class.java)
                intent.putExtra("stream_url", channel.url)
                intent.putExtra("channel_name", channel.name)
                intent.putExtra("channel_logo", channel.logo)
                startActivity(intent)
            } else {
                // FILMES, SÉRIES, KIDS, ANIME: abre tela de detalhe
                val intent = Intent(this, DetailActivity::class.java)
                intent.putExtra("stream_url", channel.url)
                intent.putExtra("channel_name", channel.name)
                intent.putExtra("channel_logo", channel.logo)
                intent.putExtra("channel_group", channel.group)
                intent.putExtra("stream_id", channel.id)
                startActivity(intent)
            }
        }
    }

    private fun showLoading(loading: Boolean) {
        progressBar.visibility = if (loading) View.VISIBLE else View.GONE
        rvChannels.visibility = if (loading) View.GONE else View.VISIBLE
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
