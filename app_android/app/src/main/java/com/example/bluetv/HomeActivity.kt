package com.example.bluetv

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.View
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.ImageView
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

class HomeActivity : AppCompatActivity() {

    private val BACKEND_URL = "https://bluetv-full-project.onrender.com"
    private val API_KEY     = "btv_k8x2mP9qL4wN7vR3jY6cT1hB5fA0eZ"
    private val PREFS_NAME  = "bluetv_prefs"
    private val CRED_TTL_MS = 2 * 60 * 60 * 1000L

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    private val menuItems = listOf("BUSCA", "FAVORITOS", "AO VIVO", "FILMES", "SÉRIES", "CONFIG")
    private var currentMenuIndex = 2 

    private val tabData = mutableMapOf<String, List<Channel>>()
    private val favoriteIds = mutableSetOf<String>()
    
    private var searchQuery = ""
    private var selectedCategory = "Todos"

    private lateinit var rvSidebar:    RecyclerView
    private lateinit var rvCategories: RecyclerView
    private lateinit var rvContent:    RecyclerView
    private lateinit var ivSelectedLogo: ImageView
    private lateinit var tvSelectedName: TextView
    private lateinit var tvSelectedDesc: TextView
    private lateinit var btnWatchNow:    TextView
    private lateinit var tvTitleContent: TextView

    private var host     = ""
    private var username = ""
    private var password = ""
    private var selectedChannel: Channel? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        try {
            setContentView(R.layout.activity_home)
            
            val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            host      = fixHost(prefs.getString("host", "") ?: "")
            username  = prefs.getString("username", "") ?: ""
            password  = prefs.getString("password", "") ?: ""
            val clientId    = prefs.getString("client_id", "") ?: ""
            val lastRefresh = prefs.getLong("last_cred_refresh", 0L)
            val validade    = prefs.getString("validade", "—") ?: "—"

            bindViews()
            loadFavorites()
            setupSidebar()
            
            findViewById<TextView>(R.id.tvExpira).text = "Expira: $validade"
            btnWatchNow.setOnClickListener { selectedChannel?.let { openPlayer(it) } }

            val needsRefresh = (System.currentTimeMillis() - lastRefresh > CRED_TTL_MS) || host.isEmpty()
            if (clientId.isNotEmpty() && needsRefresh) {
                fetchFreshCredentials(clientId) { startNetworkLoad() }
            } else {
                startNetworkLoad()
            }

        } catch (e: Exception) { finish() }
    }

    private fun bindViews() {
        rvSidebar      = findViewById(R.id.rvSidebar)
        rvCategories   = findViewById(R.id.rvCategories)
        rvContent      = findViewById(R.id.rvContent)
        ivSelectedLogo = findViewById(R.id.ivSelectedLogo)
        tvSelectedName = findViewById(R.id.tvSelectedName)
        tvSelectedDesc = findViewById(R.id.tvSelectedDesc)
        btnWatchNow    = findViewById(R.id.btnWatchNow)
        tvTitleContent = findViewById(R.id.tvTitleContent)
    }

    private fun setupSidebar() {
        rvSidebar.layoutManager = LinearLayoutManager(this)
        rvSidebar.adapter = SidebarAdapter(menuItems, currentMenuIndex) { index ->
            currentMenuIndex = index
            handleMenuSelection(menuItems[index])
        }
    }

    private fun handleMenuSelection(menu: String) {
        if (menu == "CONFIG") {
            startActivity(Intent(this, SettingsActivity::class.java))
            return
        }
        selectedCategory = "Todos"
        setupCategoriesFor(menu)
        renderContent()
    }

    private fun setupCategoriesFor(menu: String) {
        val full = tabData[menu] ?: emptyList()
        val cats = listOf("Todos") + full.map { it.group }.filter { it.isNotEmpty() }.distinct().sorted()
        
        rvCategories.layoutManager = LinearLayoutManager(this)
        rvCategories.adapter = CategoryAdapter(cats, selectedCategory) { cat ->
            selectedCategory = cat
            tvTitleContent.text = cat
            renderContent()
        }
    }

    private fun startNetworkLoad() {
        if (host.isEmpty() || username.isEmpty()) return
        loadLive()
        loadVod()
        loadSeries()
    }

    private fun loadLive() {
        fetch("$host/player_api.php?username=$username&password=$password&action=get_live_streams") { body ->
            val arr = JSONArray(body)
            val list = (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                val id = o.optString("stream_id")
                Channel(id, o.optString("name"), "$host/live/$username/$password/$id.ts",
                        o.optString("stream_icon"), o.optString("category_name", "Geral"), id)
            }
            val fused = M3UParser.fuseChannels(list)
            tabData["AO VIVO"] = fused
            runOnUiThread { if (menuItems[currentMenuIndex] == "AO VIVO") { setupCategoriesFor("AO VIVO"); renderContent() } }
            fetchEpg()
        }
    }

    private fun fetchEpg() {
        fetch("$host/player_api.php?username=$username&password=$password&action=get_all_epg") { body ->
            try {
                val epgData = JSONObject(body).optJSONObject("epg_listings") ?: return@fetch
                tabData["AO VIVO"]?.forEach { ch ->
                    val prog = epgData.optJSONArray(ch.streamId)?.optJSONObject(0)
                    if (prog != null) ch.epgTitle = prog.optString("title")
                }
                runOnUiThread { rvContent.adapter?.notifyDataSetChanged() }
            } catch (e: Exception) {}
        }
    }

    private fun loadVod() {
        fetch("$host/player_api.php?username=$username&password=$password&action=get_vod_streams") { body ->
            val arr = JSONArray(body)
            val list = (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                val id = o.optString("stream_id")
                Channel(id, o.optString("name"), "$host/movie/$username/$password/$id.mp4",
                        o.optString("stream_icon"), o.optString("category_name", "VOD"), id)
            }
            val fused = M3UParser.fuseChannels(list)
            tabData["FILMES"] = fused
            runOnUiThread { if (menuItems[currentMenuIndex] == "FILMES") { setupCategoriesFor("FILMES"); renderContent() } }
        }
    }

    private fun loadSeries() {
        fetch("$host/player_api.php?username=$username&password=$password&action=get_series") { body ->
            val arr = JSONArray(body)
            val list = (0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                val id = o.optString("series_id")
                Channel(id, o.optString("name"), "",
                        o.optString("cover"), o.optString("category_name", "Séries"), id)
            }
            tabData["SÉRIES"] = list
            runOnUiThread { if (menuItems[currentMenuIndex] == "SÉRIES") { setupCategoriesFor("SÉRIES"); renderContent() } }
        }
    }

    private fun renderContent() {
        val menu = menuItems[currentMenuIndex]
        var list = tabData[menu] ?: emptyList()

        if (menu == "FAVORITOS") {
            list = (tabData["AO VIVO"] ?: emptyList()).filter { favoriteIds.contains(it.id) }
        }

        if (selectedCategory != "Todos") {
            list = list.filter { it.group == selectedCategory }
        }

        val isGrid = menu == "FILMES" || menu == "SÉRIES"
        rvContent.layoutManager = if (isGrid) GridLayoutManager(this, 3) else LinearLayoutManager(this)
        rvContent.adapter = ChannelAdapter(list, if (isGrid) 1 else 0, favoriteIds, { toggleFavorite(it) }, { selectItem(it) })
    }

    private fun selectItem(ch: Channel) {
        selectedChannel = ch
        tvSelectedName.text = ch.name
        tvSelectedDesc.text = if (ch.epgTitle.isNotEmpty()) "Agora: ${ch.epgTitle}" else ch.group
        Glide.with(this).load(ch.logo).placeholder(R.drawable.ic_launcher_foreground).into(ivSelectedLogo)
        btnWatchNow.visibility = View.VISIBLE
    }

    private fun openPlayer(ch: Channel) {
        if (ch.url.isEmpty()) { // É uma série
            startActivity(Intent(this, DetailActivity::class.java).apply {
                putExtra("channel_name", ch.name); putExtra("channel_logo", ch.logo)
                putExtra("stream_id", ch.id); putExtra("channel_group", "series")
            })
            return
        }
        ChannelData.currentList = getFilteredList(menuItems[currentMenuIndex])
        ChannelData.currentIndex = ChannelData.currentList.indexOfFirst { it.id == ch.id }
        startActivity(Intent(this, PlayerActivity::class.java))
    }

    private fun fetchFreshCredentials(clientId: String, onDone: () -> Unit) {
        client.newCall(Request.Builder().url("$BACKEND_URL/app/status/bluetv/$clientId").addHeader("x-api-key", API_KEY).build()).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { onDone() }
            override fun onResponse(call: Call, response: Response) {
                val body = response.body?.string(); response.close()
                try {
                    val x = JSONObject(body ?: "").optJSONObject("xtream")
                    if (x != null) {
                        host = fixHost(x.optString("host")); username = x.optString("username"); password = x.optString("password")
                        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
                            .putString("host", host).putString("username", username).putString("password", password)
                            .putString("validade", x.optString("validade")).putLong("last_cred_refresh", System.currentTimeMillis()).apply()
                    }
                } catch (e: Exception) {}
                onDone()
            }
        })
    }

    private fun loadFavorites() {
        val raw = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).getString("favorites", "") ?: ""
        if (raw.isNotEmpty()) favoriteIds.addAll(raw.split(","))
    }

    private fun toggleFavorite(ch: Channel) {
        if (favoriteIds.contains(ch.id)) favoriteIds.remove(ch.id) else favoriteIds.add(ch.id)
        getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit().putString("favorites", favoriteIds.joinToString(",")).apply()
        renderContent()
    }

    private fun fetch(url: String, onSuccess: (String) -> Unit) {
        client.newCall(Request.Builder().url(url).build()).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {}
            override fun onResponse(call: Call, response: Response) {
                val body = response.body?.string() ?: ""; response.close()
                if (body.startsWith("[") || body.startsWith("{")) onSuccess(body)
            }
        })
    }

    private fun getFilteredList(menu: String): List<Channel> {
        var list = if (menu == "FAVORITOS")
            (tabData["AO VIVO"] ?: emptyList()).filter { favoriteIds.contains(it.id) }
        else
            tabData[menu] ?: emptyList()
        if (selectedCategory != "Todos") list = list.filter { it.group == selectedCategory }
        if (searchQuery.isNotEmpty()) list = list.filter { it.name.contains(searchQuery, ignoreCase = true) }
        return list
    }

    private fun fixHost(h: String) = if (h.startsWith("http")) h.trimEnd('/') else "http://${h.trimEnd('/')}"
}
