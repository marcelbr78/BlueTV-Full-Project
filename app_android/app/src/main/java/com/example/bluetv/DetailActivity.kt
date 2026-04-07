package com.example.bluetv

import android.app.AlertDialog
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

        val name        = intent.getStringExtra("channel_name") ?: ""
        val logo        = intent.getStringExtra("channel_logo") ?: ""
        val url         = intent.getStringExtra("stream_url") ?: ""
        val group       = intent.getStringExtra("channel_group") ?: ""
        val streamId    = intent.getStringExtra("stream_id") ?: ""
        val qualityJson = intent.getStringExtra("quality_urls") ?: ""

        val ivPoster   = findViewById<ImageView>(R.id.ivPoster)
        val tvTitle    = findViewById<TextView>(R.id.tvTitle)
        val tvYear     = findViewById<TextView>(R.id.tvYear)
        val tvRating   = findViewById<TextView>(R.id.tvRating)
        val tvCategory = findViewById<TextView>(R.id.tvCategory)
        val tvPlot     = findViewById<TextView>(R.id.tvPlot)
        val btnPlay    = findViewById<TextView>(R.id.btnPlay)
        val btnBack    = findViewById<TextView>(R.id.btnBack)

        tvTitle.text    = name
        tvCategory.text = group

        if (logo.isNotEmpty()) {
            Glide.with(this).load(logo).placeholder(R.drawable.ic_channel_placeholder).into(ivPoster)
        }

        btnBack.setOnClickListener { finish() }

        val isSeries = group.lowercase().let { it.contains("serie") || it.contains("series") }

        if (isSeries) {
            btnPlay.text = "☰  EPISÓDIOS"
            btnPlay.setOnClickListener {
                val id = streamId.ifEmpty { extractIdFromUrl(url) }
                startActivity(Intent(this, EpisodesActivity::class.java).apply {
                    putExtra("series_name", name); putExtra("series_id", id)
                })
            }
        } else {
            btnPlay.text = "▶  ASSISTIR"
            btnPlay.setOnClickListener {
                val savedPos = ProgressManager.getProgress(this, streamId)
                if (savedPos > 30000) { // Se tiver mais de 30 segundos salvos
                    showResumeDialog(url, name, logo, qualityJson, streamId, savedPos)
                } else {
                    startPlayer(url, name, logo, qualityJson, streamId, 0L)
                }
            }
        }

        val id = streamId.ifEmpty { extractIdFromUrl(url) }
        if (id.isNotEmpty()) fetchDetails(id, isSeries, tvYear, tvRating, tvPlot)
    }

    private fun showResumeDialog(url: String, name: String, logo: String, qJson: String, sId: String, pos: Long) {
        val minutes = (pos / 1000 / 60).toInt()
        val seconds = (pos / 1000 % 60).toInt()
        
        AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("Continuar Assistindo?")
            .setMessage("Você parou em ${String.format("%02d:%02d", minutes, seconds)}. Deseja continuar de onde parou?")
            .setPositiveButton("CONTINUAR") { _, _ ->
                startPlayer(url, name, logo, qJson, sId, pos)
            }
            .setNegativeButton("DO INÍCIO") { _, _ ->
                ProgressManager.clearProgress(this, sId)
                startPlayer(url, name, logo, qJson, sId, 0L)
            }
            .show()
    }

    private fun startPlayer(url: String, name: String, logo: String, qJson: String, sId: String, pos: Long) {
        startActivity(Intent(this, PlayerActivity::class.java).apply {
            putExtra("stream_url", url); putExtra("channel_name", name)
            putExtra("channel_logo", logo); putExtra("quality_urls", qJson)
            putExtra("stream_id", sId); putExtra("start_pos", pos)
        })
    }

    private fun extractIdFromUrl(url: String): String {
        return try { url.split("/").last().substringBeforeLast(".").filter { it.isDigit() } } catch (e: Exception) { "" }
    }

    private fun fetchDetails(streamId: String, isSeries: Boolean, tvYear: TextView, tvRating: TextView, tvPlot: TextView) {
        val prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val host = prefs.getString("host", null) ?: return
        val user = prefs.getString("username", null) ?: return
        val pass = prefs.getString("password", null) ?: return
        val action = if (isSeries) "get_series_info&series_id=$streamId" else "get_vod_info&vod_id=$streamId"
        
        client.newCall(Request.Builder().url("$host/player_api.php?username=$user&password=$pass&action=$action").build()).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {}
            override fun onResponse(call: Call, response: Response) {
                val body = response.body?.string() ?: return; response.close()
                try {
                    val json = JSONObject(body); val info = json.optJSONObject("info") ?: json.optJSONObject("movie_data") ?: return
                    val year = info.optString("releasedate", "").take(4).ifEmpty { info.optString("year", "") }
                    val rating = info.optString("rating", "").ifEmpty { info.optString("rating_5based", "") }
                    val plot = info.optString("plot", "").ifEmpty { info.optString("description", "") }
                    runOnUiThread { if (year.isNotEmpty()) tvYear.text = year; if (rating.isNotEmpty()) tvRating.text = "★ $rating"; if (plot.isNotEmpty()) tvPlot.text = plot }
                } catch (e: Exception) {}
            }
        })
    }
}
