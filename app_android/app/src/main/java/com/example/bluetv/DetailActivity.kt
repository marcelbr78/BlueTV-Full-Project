package com.example.bluetv

import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import com.bumptech.glide.Glide
import com.example.bluetv.databinding.ActivityDetailBinding
import okhttp3.*
import org.json.JSONObject
import java.io.IOException

class DetailActivity : AppCompatActivity() {

    private lateinit var binding: ActivityDetailBinding
    private val PREFS_NAME = "bluetv_prefs"
    private val client = OkHttpClient()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityDetailBinding.inflate(layoutInflater)
        setContentView(binding.root)

        val name        = intent.getStringExtra("channel_name") ?: ""
        val logo        = intent.getStringExtra("channel_logo") ?: ""
        val url         = intent.getStringExtra("stream_url") ?: ""
        val group       = intent.getStringExtra("channel_group") ?: ""
        val streamId    = intent.getStringExtra("stream_id") ?: ""
        val qualityJson = intent.getStringExtra("quality_urls") ?: ""

        binding.tvTitle.text    = name
        binding.tvCategory.text = group

        if (logo.isNotEmpty()) {
            Glide.with(this).load(logo).placeholder(R.drawable.ic_channel_placeholder).into(binding.ivPoster)
        }

        binding.btnBack.setOnClickListener { finish() }

        val isSeries = group.lowercase().let { it.contains("serie") || it.contains("series") }

        if (isSeries) {
            binding.btnPlay.text = "☰  EPISÓDIOS"
            binding.btnPlay.setOnClickListener {
                val id = streamId.ifEmpty { extractIdFromUrl(url) }
                startActivity(Intent(this, EpisodesActivity::class.java).apply {
                    putExtra("series_name", name); putExtra("series_id", id)
                })
            }
        } else {
            binding.btnPlay.text = "▶  ASSISTIR"
            binding.btnPlay.setOnClickListener {
                val savedPos = ProgressManager.getProgress(this, streamId)
                if (savedPos > 30000) {
                    showResumeDialog(url, name, logo, qualityJson, streamId, savedPos)
                } else {
                    startPlayer(url, name, logo, qualityJson, streamId, 0L)
                }
            }
        }

        val id = streamId.ifEmpty { extractIdFromUrl(url) }
        if (id.isNotEmpty()) fetchDetails(id, isSeries)
    }

    private fun showResumeDialog(url: String, name: String, logo: String, qJson: String, sId: String, pos: Long) {
        val minutes = (pos / 1000 / 60).toInt()
        val seconds = (pos / 1000 % 60).toInt()
        
        AlertDialog.Builder(this, android.R.style.Theme_DeviceDefault_Dialog_Alert)
            .setTitle("Continuar Assistindo?")
            .setMessage("Você parou em ${String.format("%02d:%02d", minutes, seconds)}. Deseja continuar?")
            .setPositiveButton("CONTINUAR") { _, _ -> startPlayer(url, name, logo, qJson, sId, pos) }
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

    private fun fetchDetails(streamId: String, isSeries: Boolean) {
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
                    runOnUiThread { 
                        if (year.isNotEmpty()) binding.tvYear.text = year
                        if (rating.isNotEmpty()) binding.tvRating.text = "★ $rating"
                        if (plot.isNotEmpty()) binding.tvPlot.text = plot 
                    }
                } catch (e: Exception) {}
            }
        })
    }
}
