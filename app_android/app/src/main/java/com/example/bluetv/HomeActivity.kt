package com.example.bluetv

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.ImageView
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class HomeActivity : AppCompatActivity() {

    private val BACKEND_URL  = "https://bluetv-full-project.onrender.com"
    private val API_KEY      = "btv_k8x2mP9qL4wN7vR3jY6cT1hB5fA0eZ"
    private val PREFS_NAME   = "bluetv_prefs"
    private val CRED_TTL_MS  = 2 * 60 * 60 * 1000L
    private val CACHE_TTL_MS = 6 * 60 * 60 * 1000L

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    // Abas no topo
    private val tabs = listOf("LIVE", "FILMES", "SÉRIES", "KIDS", "ANIME", "ESPORTES")
    private var currentTab = 0

    private val tabData      = mutableMapOf<String, List<Channel>>()
    private val networkDone  = mutableSetOf<String>()
    private val loadingCount = AtomicInteger(0)
    private val totalLoads   = 3

    private var selectedGroup   = "Todos"
    private val favoriteIds     = mutableSetOf<String>()
    private var selectedChannel: Channel? = null

    // Views
    private lateinit var layoutGroups:    View
    private lateinit var layoutLive:      View
    private lateinit var rvGroups:        RecyclerView
    private lateinit var rvChannels:      RecyclerView
    private lateinit var rvGrid:          RecyclerView
    private lateinit var progressBar:     ProgressBar
    private lateinit var tvStatus:        TextView
    private lateinit var ivSelectedLogo:  ImageView
    private lateinit var tvSelectedName:  TextView
    private lateinit var tvSelectedGroup: TextView
    private lateinit var btnWatchNow:     TextView

    private var host     = ""
    private var username = ""
    private var password = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            setContentView(R.layout.activity_home)

            val prefs    = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            host         = fixHost(prefs.getString("host", "") ?: "")
            username     = prefs.getString("username", "") ?: ""
            password     = prefs.getString("password", "") ?: ""
            val validade = prefs.getString("validade", null)
            val clientId = prefs.getString("client_id", "") ?: ""

            bindViews()
            loadFavorites()
            setupTabs()

            val display = if (validade.isNullOrEmpty() || validade == "null") "—" else validade
            findViewById<TextView>(R.id.tvExpira).text = "Expira: $display"

            btnWatchNow.setOnClickListener { selectedChannel?.let { playChannel(it) } }
            findViewById<TextView>(R.id.btnConfig).setOnClickListener {
                startActivity(Intent(this, SettingsActivity::class.java))
            }

            // Cache imediato da aba atual
            val cached = readCache(tabs[currentTab])
            if (cached != null) {
                tabData[tabs[currentTab]] = cached
                showLoading(false)
                renderTab()
            } else {
                showLoading(true)
            }

            if (clientId.isNotEmpty()) sendHeartbeat(clientId)

            val lastRefresh   = prefs.getLong("last_cred_refresh", 0L)
            val credExpired   = System.currentTimeMillis() - lastRefresh > CRED_TTL_MS
            val noCredentials = host.isEmpty() || username.isEmpty()

            if (clientId.isNotEmpty() && (credExpired || noCredentials)) {
                fetchFreshCredentials(clientId) { startNetworkLoad() }
            } else {
                startNetworkLoad()
            }

        } catch (e: Throwable) {
            setContentView(android.widget.LinearLayout(this).apply {
                orientation = android.widget.LinearLayout.VERTICAL
                setBackgroundColor(android.graphics.Color.parseColor("#0a0a1a"))
                setPadding(40, 60, 40, 40)
                addView(android.widget.TextView(this@HomeActivity).apply {
                    text = "ERRO: ${e.javaClass.simpleName}\n${e.message}"
                    textSize = 12f
                    setTextColor(android.graphics.Color.WHITE)
                })
            })
        }
    }

    private fun bindViews() {
        layoutGroups    = findViewById(R.id.layoutGroups)
        layoutLive      = findViewById(R.id.layoutLive)
        rvGroups        = findViewById(R.id.rvGroups)
        rvChannels      = findViewById(R.id.rvChannels)
        rvGrid          = findViewById(R.id.rvGrid)
        progressBar     = findViewById(R.id.progressBar)
        tvStatus        = findViewById(R.id.tvStatus)
        ivSelectedLogo  = findViewById(R.id.ivSelectedLogo)
        tvSelectedName  = findViewById(R.id.tvSelectedName)
        tvSelectedGroup = findViewById(R.id.tvSelectedGroup)
        btnWatchNow     = findViewById(R.id.btnWatchNow)
    }

    // ─── TABS ──────────────────────────────────────────────────

    private fun setupTabs() {
        val rv = findViewById<RecyclerView>(R.id.rvTabs)
        rv.layoutManager = LinearLayoutManager(this, LinearLayoutManager.HORIZONTAL, false)
        rv.adapter = TabAdapter(tabs, currentTab) { idx ->
            currentTab = idx
            selectedGroup = "Todos"
            onTabSelected()
        }
    }

    private fun onTabSelected() {
        if (!tabData.containsKey(tabs[currentTab])) {
            readCache(tabs[currentTab])?.let { tabData[tabs[currentTab]] = it }
        }
        renderTab()
    }

    // ─── RENDER ────────────────────────────────────────────────

    private fun renderTab() {
        val tab    = tabs[currentTab]
        val isLive = tab == "LIVE" || tab == "ESPORTES"
        val list   = getFilteredList(tab)

        setupGroupsPanel(tab)

        if (isLive) {
            layoutLive.visibility = View.VISIBLE
            rvGrid.visibility     = View.GONE
            rvChannels.layoutManager = LinearLayoutManager(this)
            rvChannels.adapter = ChannelAdapter(
                channels         = list,
                displayMode      = ChannelAdapter.MODE_LIVE,
                favoriteIds      = favoriteIds,
                onFavoriteToggle = { toggleFavorite(it) },
                onClick          = { selectChannel(it) }
            )
            if (list.isEmpty()) {
                tvSelectedName.text    = if (!networkDone.contains(tab)) "Carregando..." else "Sem canais"
                btnWatchNow.visibility = View.GONE
                ivSelectedLogo.setImageResource(R.drawable.ic_channel_placeholder)
            }
        } else {
            layoutLive.visibility = View.GONE
            rvGrid.visibility     = View.VISIBLE
            rvGrid.layoutManager  = GridLayoutManager(this, 3)
            rvGrid.adapter = ChannelAdapter(
                channels         = list,
                displayMode      = ChannelAdapter.MODE_GRID,
                favoriteIds      = favoriteIds,
                onFavoriteToggle = { toggleFavorite(it) },
                onClick          = { openDetail(it, tab) }
            )
        }

        tvStatus.text = when {
            list.isNotEmpty() -> "${list.size} ${tab.lowercase()}"
            !networkDone.contains(tab) -> "Carregando $tab..."
            else -> "Sem conteúdo"
        }
    }

    private fun setupGroupsPanel(tab: String) {
        val full   = tabData[tab] ?: emptyList()
        val groups = listOf("Todos") +
            full.map { it.group }.filter { it.isNotEmpty() }.distinct().sorted()

        if (groups.size <= 1) {
            layoutGroups.visibility = View.GONE
            return
        }
        layoutGroups.visibility = View.VISIBLE
        rvGroups.layoutManager = LinearLayoutManager(this)
        rvGroups.adapter = GroupAdapter(groups, selectedGroup) { g ->
            selectedGroup = g
            renderTab()
        }
    }

    private fun getFilteredList(tab: String): List<Channel> {
        var list = tabData[tab] ?: emptyList()
        if (selectedGroup != "Todos") list = list.filter { it.group == selectedGroup }
        val favs = list.filter { favoriteIds.contains(it.id) }
        val rest = list.filter { !favoriteIds.contains(it.id) }
        return favs + rest
    }

    // ─── CHANNEL ACTIONS ───────────────────────────────────────

    private fun selectChannel(ch: Channel) {
        selectedChannel        = ch
        tvSelectedName.text    = ch.name
        tvSelectedGroup.text   = if (ch.epgTitle.isNotEmpty()) "Agora: ${ch.epgTitle}" else ch.group
        btnWatchNow.visibility = View.VISIBLE
        if (ch.logo.isNotEmpty()) {
            Glide.with(this).load(ch.logo)
                .placeholder(R.drawable.ic_channel_placeholder)
                .into(ivSelectedLogo)
        } else {
            ivSelectedLogo.setImageResource(R.drawable.ic_channel_placeholder)
        }
    }

    private fun playChannel(ch: Channel) {
        ChannelData.currentList  = getFilteredList(tabs[currentTab])
        ChannelData.currentIndex = ChannelData.currentList.indexOfFirst { it.id == ch.id }
        startActivity(Intent(this, PlayerActivity::class.java))
    }

    private fun openDetail(ch: Channel, tab: String) {
        val isSeries = tab == "SÉRIES" || ch.url.isEmpty()
        startActivity(Intent(this, DetailActivity::class.java).apply {
            putExtra("stream_url",    ch.url)
            putExtra("channel_name",  ch.name)
            putExtra("channel_logo",  ch.logo)
            putExtra("channel_group", if (isSeries) "series" else ch.group)
            putExtra("stream_id",     ch.id)
        })
    }

    private fun toggleFavorite(ch: Channel) {
        if (favoriteIds.contains(ch.id)) favoriteIds.remove(ch.id)
        else favoriteIds.add(ch.id)
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
            .putString("favorites", favoriteIds.joinToString(",")).apply()
        renderTab()
    }

    private fun loadFavorites() {
        val raw = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .getString("favorites", "") ?: ""
        if (raw.isNotEmpty()) favoriteIds.addAll(raw.split(",").filter { it.isNotEmpty() })
    }

    // ─── NETWORK LOAD ──────────────────────────────────────────

    private fun startNetworkLoad() {
        if (host.isEmpty() || username.isEmpty()) {
            runOnUiThread {
                showLoading(false)
                tvStatus.text = "Credenciais não encontradas. Pressione ⚙ para reativar."
            }
            return
        }
        when (currentTab) {
            0, 5   -> { loadLive(); loadVod(); loadSeries() }
            1, 3, 4 -> { loadVod(); loadLive(); loadSeries() }
            2      -> { loadSeries(); loadLive(); loadVod() }
            else   -> { loadLive(); loadVod(); loadSeries() }
        }
    }

    private fun loadLive() {
        fetch("$host/player_api.php?username=$username&password=$password&action=get_live_streams") { body ->
            val arr      = JSONArray(body)
            val live     = mutableListOf<Channel>()
            val esportes = mutableListOf<Channel>()
            for (i in 0 until arr.length()) {
                val o  = arr.getJSONObject(i)
                val id = o.optString("stream_id")
                val ch = Channel(id, o.optString("name"),
                    "$host/live/$username/$password/$id.ts",
                    o.optString("stream_icon"),
                    o.optString("category_name", o.optString("category_id", "Geral")), id)
                if (isSport(ch.group)) esportes.add(ch) else live.add(ch)
            }
            tabData["LIVE"]     = live
            tabData["ESPORTES"] = esportes
            networkDone += setOf("LIVE", "ESPORTES")
            saveCache("LIVE", live); saveCache("ESPORTES", esportes)
            runOnUiThread {
                if (currentTab == 0 || currentTab == 5) renderTab()
            }
        }
    }

    private fun loadVod() {
        fetch("$host/player_api.php?username=$username&password=$password&action=get_vod_streams") { body ->
            val arr    = JSONArray(body)
            val filmes = mutableListOf<Channel>()
            val kids   = mutableListOf<Channel>()
            val anime  = mutableListOf<Channel>()
            for (i in 0 until arr.length()) {
                val o   = arr.getJSONObject(i)
                val id  = o.optString("stream_id")
                val ext = o.optString("container_extension", "mp4")
                val cat = o.optString("category_name", o.optString("category_id", ""))
                val ch  = Channel(id, o.optString("name"),
                    "$host/movie/$username/$password/$id.$ext",
                    o.optString("stream_icon"), cat, id)
                when {
                    cat.lowercase().contains("anime") -> anime.add(ch)
                    isKids(cat) -> kids.add(ch)
                    else -> filmes.add(ch)
                }
            }
            val kidsFinal = kids.ifEmpty { filmes.filter { isKids(it.name) } }
            tabData["FILMES"] = filmes
            tabData["KIDS"]   = kidsFinal
            tabData["ANIME"]  = anime
            networkDone += setOf("FILMES", "KIDS", "ANIME")
            saveCache("FILMES", filmes); saveCache("KIDS", kidsFinal); saveCache("ANIME", anime)
            runOnUiThread { if (currentTab in listOf(1, 3, 4)) renderTab() }
        }
    }

    private fun loadSeries() {
        fetch("$host/player_api.php?username=$username&password=$password&action=get_series") { body ->
            val arr    = JSONArray(body)
            val series = mutableListOf<Channel>()
            for (i in 0 until arr.length()) {
                val o  = arr.getJSONObject(i)
                val id = o.optString("series_id")
                series.add(Channel(id, o.optString("name"), "",
                    o.optString("cover"), o.optString("category_name", "Séries"), id))
            }
            tabData["SÉRIES"] = series
            networkDone.add("SÉRIES")
            saveCache("SÉRIES", series)
            runOnUiThread { if (currentTab == 2) renderTab() }
        }
    }

    private fun fetch(url: String, onSuccess: (String) -> Unit) {
        client.newCall(Request.Builder().url(url).build()).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { checkDone() }
            override fun onResponse(call: Call, response: Response) {
                val body = response.body?.string(); response.close()
                if (!body.isNullOrEmpty() && body.startsWith("[")) {
                    try { onSuccess(body) } catch (e: Exception) {}
                }
                checkDone()
            }
        })
    }

    private fun checkDone() {
        if (loadingCount.incrementAndGet() >= totalLoads) {
            runOnUiThread { showLoading(false) }
        }
    }

    // ─── CREDENTIALS ───────────────────────────────────────────

    private fun fetchFreshCredentials(clientId: String, onDone: () -> Unit) {
        client.newCall(
            Request.Builder().url("$BACKEND_URL/app/status/bluetv/$clientId")
                .addHeader("x-api-key", API_KEY).build()
        ).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { onDone() }
            override fun onResponse(call: Call, response: Response) {
                val body = response.body?.string(); response.close()
                try {
                    val x = JSONObject(body ?: "").optJSONObject("xtream")
                    if (x != null) {
                        val h = fixHost(x.optString("host"))
                        val u = x.optString("username")
                        val p = x.optString("password")
                        if (h.isNotEmpty() && u.isNotEmpty()) {
                            host = h; username = u; password = p
                            val v = x.optString("validade").let {
                                if (it.isEmpty() || it == "null") null else it
                            }
                            getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
                                .putString("host", h).putString("username", u)
                                .putString("password", p).putString("validade", v)
                                .putLong("last_cred_refresh", System.currentTimeMillis())
                                .apply()
                            runOnUiThread {
                                val display = v ?: "—"
                                findViewById<TextView>(R.id.tvExpira).text = "Expira: $display"
                            }
                        }
                    }
                } catch (e: Exception) {}
                onDone()
            }
        })
    }

    // ─── CACHE ─────────────────────────────────────────────────

    private fun saveCache(key: String, list: List<Channel>) {
        try {
            val arr = JSONArray()
            list.forEach { ch ->
                arr.put(JSONObject().apply {
                    put("id", ch.id); put("name", ch.name); put("url", ch.url)
                    put("logo", ch.logo); put("group", ch.group); put("streamId", ch.streamId)
                })
            }
            File(filesDir, "cache_$key.json").writeText(
                JSONObject().apply { put("time", System.currentTimeMillis()); put("data", arr) }.toString()
            )
        } catch (e: Exception) {}
    }

    private fun readCache(key: String): List<Channel>? {
        return try {
            val file = File(filesDir, "cache_$key.json")
            if (!file.exists()) return null
            val wrap = JSONObject(file.readText())
            if (System.currentTimeMillis() - wrap.getLong("time") > CACHE_TTL_MS) return null
            val arr = wrap.getJSONArray("data")
            (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                Channel(o.optString("id"), o.optString("name"), o.optString("url"),
                        o.optString("logo"), o.optString("group"), o.optString("streamId"))
            }
        } catch (e: Exception) { null }
    }

    // ─── HELPERS ───────────────────────────────────────────────

    private fun showLoading(v: Boolean) {
        progressBar.visibility = if (v) View.VISIBLE else View.GONE
    }

    private fun fixHost(h: String): String {
        if (h.isEmpty()) return h
        return if (h.startsWith("http://") || h.startsWith("https://")) h.trimEnd('/')
        else "http://${h.trimEnd('/')}"
    }

    private fun isSport(cat: String) = cat.lowercase().let {
        it.contains("sport") || it.contains("esport") || it.contains("futebol") || it.contains("foot")
    }

    private fun isKids(cat: String) = cat.lowercase().let {
        it.contains("kid") || it.contains("infantil") || it.contains("disney") ||
        it.contains("criança") || it.contains("pixar")
    }

    private fun sendHeartbeat(clientId: String) {
        val body = JSONObject().apply {
            put("client_code", clientId)
            put("device_model", android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL)
        }.toString().toRequestBody("application/json".toMediaType())
        client.newCall(
            Request.Builder().url("$BACKEND_URL/app/heartbeat")
                .post(body).addHeader("x-api-key", API_KEY).build()
        ).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {}
            override fun onResponse(call: Call, response: Response) { response.close() }
        })
    }
}
