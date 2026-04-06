package com.example.bluetv

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.view.View
import android.widget.ImageView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.bumptech.glide.Glide
import com.bumptech.glide.load.resource.drawable.DrawableTransitionOptions
import okhttp3.*
import org.json.JSONObject
import java.io.IOException

class DetailActivity : AppCompatActivity() {

    private val PREFS_NAME = "bluetv_prefs"
    private val client = OkHttpClient()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_detail)

        val name     = intent.getStringExtra("channel_name") ?: ""
        val logo     = intent.getStringExtra("channel_logo") ?: ""
        val url      = intent.getStringExtra("stream_url") ?: ""
        val group    = intent.getStringExtra("channel_group") ?: ""
        val streamId = intent.getStringExtra("stream_id") ?: ""

        val ivPoster    = findViewById<ImageView>(R.id.ivPoster)
        val tvTitle     = findViewById<TextView>(R.id.tvTitle)
        val tvYear      = findViewById<TextView>(R.id.tvYear)
        val tvRating    = findViewById<TextView>(R.id.tvRating)
        val tvCategory  = findViewById<TextView>(R.id.tvCategory)
        val tvPlot      = findViewById<TextView>(R.id.tvPlot)
        val btnPlay     = findViewById<TextView>(R.id.btnPlay)
        val btnBack     = findViewById<TextView>(R.id.btnBack)

        tvTitle.text = name
        tvCategory.text = group

        if (logo.isNotEmpty()) {
            Glide.with(this)
                .load(logo)
                .placeholder(R.drawable.ic_channel_placeholder)
                .transition(DrawableTransitionOptions.withCrossFade())
                .into(ivPoster)
        } else {
            ivPoster.setImageResource(R.drawable.ic_channel_placeholder)
        }

        btnBack.setOnClickListener { finish() }

        btnPlay.setOnClickListener {
            val intent = Intent(this, PlayerActivity::class.java)
            intent.putExtra("stream_url", url)
            intent.putExtra("channel_name", name)
            intent.putExtra("channel_logo", logo)
            startActivity(intent)
        }

        // Tentar buscar detalhes extras via Xtream Codes API
        if (streamId.isNotEmpty()) {
            fetchDetails(streamId, group, tvYear, tvRating, tvPlot)
        } else {
            // Tentar extrair o ID a partir da URL (ex: .../movie/user/pass/12345.mp4)
            val idFromUrl = extractIdFromUrl(url)
            if (idFromUrl.isNotEmpty()) {
                fetchDetails(idFromUrl, group, tvYear, tvRating, tvPlot)
            }
        }
    }

    private fun extractIdFromUrl(url: String): String {
        return try {
            // Xtream URL: http://host/movie/username/password/12345.mp4
            val segments = url.split("/")
            val lastSegment = segments.last()
            lastSegment.substringBeforeLast(".").filter { it.isDigit() }
        } catch (e: Exception) { "" }
    }

    private fun fetchDetails(streamId: String, group: String,
                             tvYear: TextView, tvRating: TextView, tvPlot: TextView) {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val host     = prefs.getString("host", null) ?: return
        val username = prefs.getString("username", null) ?: return
        val password = prefs.getString("password", null) ?: return

        val action = if (group.lowercase().contains("serie") || group.lowercase().contains("series")) {
            "get_series_info&series_id=$streamId"
        } else {
            "get_vod_info&vod_id=$streamId"
        }

        val apiUrl = "$host/player_api.php?username=$username&password=$password&action=$action"

        val req = Request.Builder().url(apiUrl).build()
        client.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) { /* sem detalhes, ok */ }
            override fun onResponse(call: Call, response: Response) {
                val body = response.body?.string() ?: return
                response.close()
                try {
                    val json = JSONObject(body)
                    val info = json.optJSONObject("info") ?: json.optJSONObject("movie_data") ?: return

                    val year   = info.optString("releasedate", "").take(4)
                        .ifEmpty { info.optString("year", "") }
                    val rating = info.optString("rating", "")
                        .ifEmpty { info.optString("rating_5based", "") }
                    val plot   = info.optString("plot", "")
                        .ifEmpty { info.optString("description", "") }

                    runOnUiThread {
                        if (year.isNotEmpty()) tvYear.text = year
                        if (rating.isNotEmpty()) tvRating.text = "★ $rating"
                        if (plot.isNotEmpty()) tvPlot.text = plot
                    }
                } catch (e: Exception) { /* JSON inválido, não faz nada */ }
            }
        })
    }
}
