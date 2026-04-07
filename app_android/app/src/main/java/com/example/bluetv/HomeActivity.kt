package com.example.bluetv

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.LinearLayoutManager
import com.bumptech.glide.Glide
import com.example.bluetv.databinding.ActivityHomeBinding
import com.google.android.exoplayer2.ExoPlayer
import com.google.android.exoplayer2.MediaItem
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

    private lateinit var binding: ActivityHomeBinding

    private val BACKEND_URL  = "https://bluetv-full-project.onrender.com"
    private val API_KEY      = "btv_k8x2mP9qL4wN7vR3jY6cT1hB5fA0eZ"
    private val PREFS_NAME   = "bluetv_prefs"
    private val CRED_TTL_MS  = 2 * 60 * 60 * 1000L
    private val CACHE_TTL_MS = 6 * 60 * 60 * 1000L

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    // Abas
    private val tabs = listOf("LIVE", "FILMES", "SÉRIES", "KIDS", "ANIME", "ESPORTES")
    private var currentTab = 0

    private val tabData     = mutableMapOf<String, List<Channel>>()
    private val networkDone = mutableSetOf<String>()
    private val loadCount   = AtomicInteger(0)
    private val totalLoads  = 3

    private var selectedGroup   = "Todos"
    private val favoriteIds     = mutableSetOf<String>()
    private var selectedChannel: Channel? = null

    // ExoPlayer preview (novo — preview do canal antes de abrir tela cheia)
    private var previewPlayer: ExoPlayer? = null

    private var host     = ""
    private var username = ""
    private var password = ""

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityHomeBinding.inflate(layoutInflater)
        setContentView(binding.root)

        try {
            val prefs    = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            host         = fixHost(prefs.getString("host", "") ?: "")
            username     = prefs.getString("username", "") ?: ""
            password     = prefs.getString("password", "") ?: ""
            val validade = prefs.getString("validade", null)
            val clientId = prefs.getString("client_id", "") ?: ""

            initPreviewPlayer()
            loadFavorites()
            setupTabs()

            val display = if (validade.isNullOrEmpty() || validade == "null") "—" else validade
            binding.tvValidadeInfo.text = "Expira: $display"

            binding.btnActionPlay.setOnClickListener { selectedChannel?.let { playChannel(it) } }
            binding.btnConfig.setOnClickListener {
                startActivity(Intent(this, SettingsActivity::class.java))
            }

            // Carrega cache da aba atual imediatamente
            readCache(tabs[currentTab])?.let {
                tabData[tabs[currentTab]] = it
                showLoading(false)
                renderTab()
            } ?: showLoading(true)

            if (clientId.isNotEmpty()) sendHeartbeat(clientId)

            val lastRefresh = prefs.getLong("last_cred_refresh", 0L)
            val credExpired = System.currentTimeMillis() - lastRefresh > CRED_TTL_MS
            if (clientId.isNotEmpty() && (credExpired || host.isEmpty())) {
                fetchFreshCredentials(clientId) { startNetworkFetch() }
            } else {
                startNetworkFetch()
            }

        } catch (e: Throwable) {
            binding.tvSelectedTitle.text = "Erro: ${e.message}"
        }
    }

    // ─── PREVIEW PLAYER ────────────────────────────────────────

    private fun initPreviewPlayer() {
        previewPlayer = ExoPlayer.Builder(this).build()
        binding.pvPreview.player = previewPlayer
    }

    private fun startPreview(url: String) {
        if (url.isEmpty()) return
        previewPlayer?.setMediaItem(MediaItem.fromUri(url))
        previewPlayer?.prepare()
        previewPlayer?.play()
    }

    private fun stopPreview() {
        previewPlayer?.stop()
    }

    // ─── TABS ──────────────────────────────────────────────────

    private fun setupTabs() {
        binding.rvTabs.layoutManager = LinearLayoutManager(this, LinearLayoutManager.HORIZONTAL, false)
        binding.rvTabs.adapter = TabAdapter(tabs, currentTab) { idx ->
            currentTab = idx
            selectedGroup = "Todos"
            stopPreview()
            readCache(tabs[currentTab])?.let { tabData[tabs[currentTab]] = it }
            renderTab()
        }
    }

    // ─── RENDER ────────────────────────────────────────────────

    private fun renderTab() {
        val tab    = tabs[currentTab]
        val isLive = tab == "LIVE" || tab == "ESPORTES"
        val list   = getFilteredList(tab)

        setupGroupsPanel(tab)

        if (isLive) {
            binding.layoutPreviewArea.visibility = View.VISIBLE
            binding.rvContentList.layoutManager  = LinearLayoutManager(this)
            binding.rvContentList.adapter = ChannelAdapter(
                channels         = list,
                displayMode      = ChannelAdapter.MODE_LIVE,
                favoriteIds      = favoriteIds,
                onFavoriteToggle = { toggleFavorite(it) },
                onClick          = { selectChannel(it) }
            )
            if (list.isEmpty()) {
                binding.tvSelectedTitle.text    = if (!networkDone.contains(tab)) "Carregando..." else "Sem canais"
                binding.btnActionPlay.visibility = View.GONE
            }
        } else {
            binding.layoutPreviewArea.visibility = View.GONE
            stopPreview()
            val cols = if (list.size > 10) 5 else 3
            binding.rvContentList.layoutManager  = GridLayoutManager(this, cols)
            binding.rvContentList.adapter = ChannelAdapter(
                channels         = list,
                displayMode      = ChannelAdapter.MODE_GRID,
                favoriteIds      = favoriteIds,
                onFavoriteToggle = { toggleFavorite(it) },
                onClick          = { openDetail(it, tab) }
            )
        }

        binding.tvListTitle.text = "  $tab · ${list.size}"
    }

    private fun setupGroupsPanel(tab: String) {
        val full   = tabData[tab] ?: emptyList()
        val groups = listOf("Todos") +
            full.map { it.group }.filter { it.isNotEmpty() }.distinct().sorted()

        binding.rvSidebar.layoutManager = LinearLayoutManager(this)
        binding.rvSidebar.adapter = GroupAdapter(groups, selectedGroup) { g ->
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
        selectedChannel = ch
        binding.tvSelectedTitle.text     = ch.name
        binding.tvSelectedEpg.text       = if (ch.epgTitle.isNotEmpty()) "Agora: ${ch.epgTitle}" else ch.group
        binding.btnActionPlay.visibility  = View.VISIBLE

        if (ch.logo.isNotEmpty()) {
            Glide.with(this).load(ch.logo)
                .placeholder(R.drawable.ic_channel_placeholder)
                .into(binding.ivPreviewLogo)
        } else {
            binding.ivPreviewLogo.setImageResource(R.drawable.ic_channel_placeholder)
        }
        // Preview automático
        startPreview(ch.url)
    }

    private fun playChannel(ch: Channel) {
        stopPreview()
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

    private fun startNetworkFetch() {
        if (host.isEmpty() || username.isEmpty()) {
            runOnUiThread {
                showLoading(false)
                binding.tvListTitle.text = "  Sem credenciais — pressione ⚙"
            }
            return
        }
        loadLive(); loadVod(); loadSeries()
    }

    private fun loadLive() {
        fetchRaw("$host/player_api.php?username=$username&password=$password&action=get_live_categories") { catBody ->
            val catMap = buildCategoryMap(catBody)
            fetchRaw("$host/player_api.php?username=$username&password=$password&action=get_live_streams") { body ->
                if (!body.isNullOrEmpty() && body.startsWith("[")) {
                    try {
                        val arr      = JSONArray(body)
                        val live     = mutableListOf<Channel>()
                        val esportes = mutableListOf<Channel>()
                        for (i in 0 until arr.length()) {
                            val o     = arr.getJSONObject(i)
                            val id    = o.optString("stream_id")
                            val catId = o.optString("category_id")
                            val cat   = catMap[catId] ?: o.optString("category_name", catId.ifEmpty { "Geral" })
                            val ch    = Channel(id, o.optString("name"),
                                "$host/live/$username/$password/$id.ts",
                                o.optString("stream_icon"), cat, id)
                            if (isSport(cat)) esportes.add(ch) else live.add(ch)
                        }
                        val fusedLive     = M3UParser.fuseChannels(live)
                        val fusedEsportes = M3UParser.fuseChannels(esportes)
                        tabData["LIVE"]     = fusedLive
                        tabData["ESPORTES"] = fusedEsportes
                        networkDone += setOf("LIVE", "ESPORTES")
                        saveCache("LIVE", fusedLive); saveCache("ESPORTES", fusedEsportes)
                        runOnUiThread { if (currentTab == 0 || currentTab == 5) renderTab() }
                    } catch (e: Exception) {}
                }
                checkDone()
            }
        }
    }

    private fun loadVod() {
        fetchRaw("$host/player_api.php?username=$username&password=$password&action=get_vod_categories") { catBody ->
            val catMap = buildCategoryMap(catBody)
            fetchRaw("$host/player_api.php?username=$username&password=$password&action=get_vod_streams") { body ->
                if (!body.isNullOrEmpty() && body.startsWith("[")) {
                    try {
                        val arr    = JSONArray(body)
                        val filmes = mutableListOf<Channel>()
                        val kids   = mutableListOf<Channel>()
                        val anime  = mutableListOf<Channel>()
                        for (i in 0 until arr.length()) {
                            val o     = arr.getJSONObject(i)
                            val id    = o.optString("stream_id")
                            val ext   = o.optString("container_extension", "mp4")
                            val catId = o.optString("category_id")
                            val cat   = catMap[catId] ?: o.optString("category_name", catId.ifEmpty { "" })
                            val year  = o.optString("year", "")
                            val ch    = Channel(id, o.optString("name"),
                                "$host/movie/$username/$password/$id.$ext",
                                o.optString("stream_icon"), cat, id, year = year)
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
                    } catch (e: Exception) {}
                }
                checkDone()
            }
        }
    }

    private fun loadSeries() {
        fetchRaw("$host/player_api.php?username=$username&password=$password&action=get_series_categories") { catBody ->
            val catMap = buildCategoryMap(catBody)
            fetchRaw("$host/player_api.php?username=$username&password=$password&action=get_series") { body ->
                if (!body.isNullOrEmpty() && body.startsWith("[")) {
                    try {
                        val arr    = JSONArray(body)
                        val series = mutableListOf<Channel>()
                        for (i in 0 until arr.length()) {
                            val o     = arr.getJSONObject(i)
                            val id    = o.optString("series_id")
                            val catId = o.optString("category_id")
                            val cat   = catMap[catId] ?: o.optString("category_name", "Séries")
                            series.add(Channel(id, o.optString("name"), "",
                                o.optString("cover"), cat, id))
                        }
                        tabData["SÉRIES"] = series
                        networkDone.add("SÉRIES")
                        saveCache("SÉRIES", series)
                        runOnUiThread { if (currentTab == 2) renderTab() }
                    } catch (e: Exception) {}
                }
                checkDone()
            }
        }
    }

    private fun buildCategoryMap(body: String?): Map<String, String> {
        if (body.isNullOrEmpty() || !body.startsWith("[")) return emptyMap()
        return try {
            val arr = JSONArray(body)
            val map = mutableMapOf<String, String>()
            for (i in 0 until arr.length()) {
                val o  = arr.getJSONObject(i)
                val id = o.optString("category_id")
                val nm = o.optString("category_name")
                if (id.isNotEmpty() && nm.isNotEmpty()) map[id] = nm
            }
            map
        } catch (e: Exception) { emptyMap() }
    }

    /** HTTP simples sem incrementar loadCount */
    private fun fetchRaw(url: String, onDone: (String?) -> Unit) {
        client.newCall(Request.Builder().url(url).build()).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { onDone(null) }
            override fun onResponse(call: Call, response: Response) {
                val body = response.body?.string(); response.close()
                onDone(body)
            }
        })
    }

    private fun checkDone() {
        if (loadCount.incrementAndGet() >= totalLoads) {
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
                                binding.tvValidadeInfo.text = "Expira: ${v ?: "—"}"
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
                    put("logo", ch.logo); put("group", ch.group)
                    put("streamId", ch.streamId); put("year", ch.year)
                })
            }
            File(filesDir, "cache_$key.json").writeText(
                JSONObject().apply {
                    put("time", System.currentTimeMillis()); put("data", arr)
                }.toString()
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
                        o.optString("logo"), o.optString("group"), o.optString("streamId"),
                        year = o.optString("year"))
            }
        } catch (e: Exception) { null }
    }

    // ─── HELPERS ───────────────────────────────────────────────

    private fun showLoading(v: Boolean) {
        binding.pbLoading.visibility = if (v) View.VISIBLE else View.GONE
    }

    private fun fixHost(h: String): String {
        if (h.isEmpty()) return h
        return if (h.startsWith("http://") || h.startsWith("https://")) h.trimEnd('/')
        else "http://${h.trimEnd('/')}"
    }

    private fun isSport(cat: String) = cat.lowercase().let {
        it.contains("sport") || it.contains("esport") || it.contains("futebol") ||
        it.contains("foot") || it.contains("luta") || it.contains("basket")
    }

    private fun isKids(cat: String) = cat.lowercase().let {
        it.contains("kid") || it.contains("infantil") || it.contains("disney") ||
        it.contains("criança") || it.contains("pixar") || it.contains("cartoon")
    }

    private fun sendHeartbeat(clientId: String) {
        val body = JSONObject().apply {
            put("client_code", clientId)
            put("device_model", android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL)
            put("apk_version", "2.1")
        }.toString().toRequestBody("application/json".toMediaType())
        client.newCall(
            Request.Builder().url("$BACKEND_URL/app/heartbeat")
                .post(body).addHeader("x-api-key", API_KEY).build()
        ).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {}
            override fun onResponse(call: Call, response: Response) { response.close() }
        })
    }

    // ─── LIFECYCLE ─────────────────────────────────────────────

    override fun onResume() {
        super.onResume()
        // Ao voltar do player, não recomeça o preview automaticamente
    }

    override fun onStop() {
        super.onStop()
        previewPlayer?.pause()
    }

    override fun onDestroy() {
        super.onDestroy()
        previewPlayer?.release()
        previewPlayer = null
    }
}
