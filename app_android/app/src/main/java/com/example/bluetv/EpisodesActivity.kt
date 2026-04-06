package com.example.bluetv

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import okhttp3.*
import org.json.JSONObject
import java.io.IOException

data class Episode(
    val id: String,
    val title: String,
    val episodeNum: Int,
    val season: Int,
    val duration: String,
    val url: String
)

class EpisodesActivity : AppCompatActivity() {

    private val PREFS_NAME = "bluetv_prefs"
    private val client = OkHttpClient()

    private lateinit var rvSeasons: RecyclerView
    private lateinit var rvEpisodes: RecyclerView
    private lateinit var progressBar: ProgressBar

    private var allEpisodes = mapOf<Int, List<Episode>>() // season -> episodes
    private var currentSeason = 1

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_episodes)

        val seriesName = intent.getStringExtra("series_name") ?: ""
        val seriesId   = intent.getStringExtra("series_id") ?: ""

        rvSeasons   = findViewById(R.id.rvSeasons)
        rvEpisodes  = findViewById(R.id.rvEpisodes)
        progressBar = findViewById(R.id.progressBar)

        findViewById<TextView>(R.id.tvSeriesName).text = seriesName
        findViewById<TextView>(R.id.btnBack).setOnClickListener { finish() }

        rvSeasons.layoutManager = LinearLayoutManager(this, LinearLayoutManager.HORIZONTAL, false)
        rvEpisodes.layoutManager = LinearLayoutManager(this)

        if (seriesId.isNotEmpty()) {
            fetchEpisodes(seriesId)
        } else {
            Toast.makeText(this, "ID da série não encontrado", Toast.LENGTH_SHORT).show()
        }
    }

    private fun fetchEpisodes(seriesId: String) {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val host     = prefs.getString("host", null) ?: return
        val username = prefs.getString("username", null) ?: return
        val password = prefs.getString("password", null) ?: return

        val url = "$host/player_api.php?username=$username&password=$password&action=get_series_info&series_id=$seriesId"

        showLoading(true)
        val req = Request.Builder().url(url).build()
        client.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                runOnUiThread {
                    showLoading(false)
                    Toast.makeText(this@EpisodesActivity, "Erro ao carregar episódios", Toast.LENGTH_SHORT).show()
                }
            }
            override fun onResponse(call: Call, response: Response) {
                val body = response.body?.string() ?: return
                response.close()
                try {
                    val json = JSONObject(body)
                    val episodesJson = json.optJSONObject("episodes") ?: run {
                        runOnUiThread {
                            showLoading(false)
                            Toast.makeText(this@EpisodesActivity, "Nenhum episódio encontrado", Toast.LENGTH_SHORT).show()
                        }
                        return
                    }

                    val prefs2 = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    val h = prefs2.getString("host", "") ?: ""
                    val u = prefs2.getString("username", "") ?: ""
                    val p = prefs2.getString("password", "") ?: ""

                    val grouped = mutableMapOf<Int, MutableList<Episode>>()
                    val seasons = episodesJson.keys().asSequence().toList()
                        .mapNotNull { it.toIntOrNull() }.sorted()

                    for (season in seasons) {
                        val arr = episodesJson.optJSONArray(season.toString()) ?: continue
                        val list = mutableListOf<Episode>()
                        for (i in 0 until arr.length()) {
                            val ep = arr.getJSONObject(i)
                            val epId  = ep.optString("id", "")
                            val title = ep.optString("title", "Episódio ${i + 1}")
                            val epNum = ep.optInt("episode_num", i + 1)
                            val dur   = ep.optString("info", "")
                                .let { runCatching { JSONObject(it).optString("duration", "") }.getOrDefault("") }
                            val ext   = ep.optString("container_extension", "mp4")
                            val streamUrl = "$h/series/$u/$p/$epId.$ext"
                            list.add(Episode(epId, title, epNum, season, dur, streamUrl))
                        }
                        grouped[season] = list
                    }

                    allEpisodes = grouped
                    currentSeason = seasons.firstOrNull() ?: 1

                    runOnUiThread {
                        showLoading(false)
                        setupSeasonTabs(seasons)
                        showEpisodes(currentSeason)
                    }
                } catch (e: Exception) {
                    runOnUiThread {
                        showLoading(false)
                        Toast.makeText(this@EpisodesActivity, "Erro ao processar dados", Toast.LENGTH_SHORT).show()
                    }
                }
            }
        })
    }

    private fun setupSeasonTabs(seasons: List<Int>) {
        rvSeasons.adapter = object : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
            override fun getItemCount() = seasons.size
            override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
                val v = LayoutInflater.from(parent.context).inflate(R.layout.item_tab, parent, false)
                return object : RecyclerView.ViewHolder(v) {}
            }
            override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
                val season = seasons[position]
                val tv = holder.itemView.findViewById<TextView>(R.id.tvTab)
                tv.text = "T$season"
                tv.setTextColor(if (season == currentSeason) 0xFFe50914.toInt() else 0xFFFFFFFF.toInt())
                tv.textSize = if (season == currentSeason) 16f else 14f
                holder.itemView.setOnClickListener {
                    currentSeason = season
                    notifyDataSetChanged()
                    showEpisodes(season)
                }
                holder.itemView.setOnFocusChangeListener { _, hasFocus ->
                    tv.setTextColor(if (hasFocus || season == currentSeason) 0xFFe50914.toInt() else 0xFFFFFFFF.toInt())
                }
            }
        }
    }

    private fun showEpisodes(season: Int) {
        val episodes = allEpisodes[season] ?: return
        rvEpisodes.adapter = object : RecyclerView.Adapter<RecyclerView.ViewHolder>() {
            override fun getItemCount() = episodes.size
            override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
                val v = LayoutInflater.from(parent.context).inflate(R.layout.item_episode, parent, false)
                return object : RecyclerView.ViewHolder(v) {}
            }
            override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
                val ep = episodes[position]
                holder.itemView.findViewById<TextView>(R.id.tvEpNumber).text = ep.episodeNum.toString()
                holder.itemView.findViewById<TextView>(R.id.tvEpTitle).text = ep.title
                holder.itemView.findViewById<TextView>(R.id.tvEpInfo).text =
                    if (ep.duration.isNotEmpty()) ep.duration else "T${season} · Ep ${ep.episodeNum}"
                holder.itemView.setOnClickListener {
                    val intent = Intent(this@EpisodesActivity, PlayerActivity::class.java)
                    intent.putExtra("stream_url", ep.url)
                    intent.putExtra("channel_name", ep.title)
                    intent.putExtra("channel_logo", "")
                    startActivity(intent)
                }
                holder.itemView.setOnFocusChangeListener { _, hasFocus ->
                    holder.itemView.scaleX = if (hasFocus) 1.02f else 1.0f
                    holder.itemView.scaleY = if (hasFocus) 1.02f else 1.0f
                }
            }
        }
    }

    private fun showLoading(loading: Boolean) {
        progressBar.visibility = if (loading) View.VISIBLE else View.GONE
        rvEpisodes.visibility = if (loading) View.GONE else View.VISIBLE
    }
}
