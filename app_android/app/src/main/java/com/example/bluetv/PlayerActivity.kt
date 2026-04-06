package com.example.bluetv

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.google.android.exoplayer2.*
import com.google.android.exoplayer2.ui.StyledPlayerView

class PlayerActivity : AppCompatActivity() {

    private lateinit var player: ExoPlayer
    private lateinit var playerView: StyledPlayerView
    private lateinit var tvChannelName: TextView
    private lateinit var tvQuality: TextView
    private lateinit var tvBuffering: TextView

    // Lista de qualidades: [("UHD", url), ("HD", url), ("SD", url)]
    private var qualityList: List<Pair<String, String>> = emptyList()
    private var currentQualityIndex = 0

    // Controle de fallback: só tenta próxima qualidade se der erro persistente
    private val fallbackHandler = Handler(Looper.getMainLooper())
    private var fallbackRunnable: Runnable? = null
    private val FALLBACK_DELAY_MS = 8000L  // 8 segundos bufferizando → tenta qualidade inferior

    private var isBuffering = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_player)

        tvChannelName = findViewById(R.id.tvChannelName)
        tvQuality     = findViewById(R.id.tvQuality)
        tvBuffering   = findViewById(R.id.tvBuffering)

        val name     = intent.getStringExtra("channel_name") ?: ""
        val mainUrl  = intent.getStringExtra("stream_url") ?: return
        val qualJson = intent.getStringExtra("quality_urls") ?: ""

        tvChannelName.text = name

        // Montar lista de qualidades a partir do extra (JSON simples key:url)
        qualityList = parseQualityUrls(qualJson, mainUrl)
        currentQualityIndex = 0

        playerView = findViewById(R.id.playerView)
        buildAndPlay()

        playerView.setOnClickListener {
            val controls = findViewById<View>(R.id.layoutControls)
            controls.visibility = if (controls.visibility == View.VISIBLE) View.GONE else View.VISIBLE
        }
    }

    private fun parseQualityUrls(json: String, fallbackUrl: String): List<Pair<String, String>> {
        if (json.isEmpty()) return listOf("AUTO" to fallbackUrl)
        return try {
            val obj = org.json.JSONObject(json)
            val order = listOf("UHD", "4K", "FHD", "1080", "HD", "720", "SD", "480")
            val all = mutableListOf<Pair<String, String>>()
            for (key in obj.keys()) {
                all.add(key to obj.getString(key))
            }
            // Ordenar da melhor para pior
            all.sortedBy { pair ->
                val idx = order.indexOfFirst { pair.first.uppercase().contains(it) }
                if (idx == -1) order.size else idx
            }.ifEmpty { listOf("AUTO" to fallbackUrl) }
        } catch (e: Exception) {
            listOf("AUTO" to fallbackUrl)
        }
    }

    private fun buildAndPlay() {
        player.release()
        val (quality, url) = qualityList[currentQualityIndex]

        player = ExoPlayer.Builder(this).build()
        playerView.player = player

        updateQualityLabel(quality)

        val mediaItem = MediaItem.fromUri(url)
        player.setMediaItem(mediaItem)
        player.prepare()
        player.playWhenReady = true

        player.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                when (state) {
                    Player.STATE_BUFFERING -> {
                        isBuffering = true
                        tvBuffering.visibility = View.VISIBLE
                        scheduleFallback()
                    }
                    Player.STATE_READY -> {
                        isBuffering = false
                        tvBuffering.visibility = View.GONE
                        cancelFallback()
                    }
                    Player.STATE_ENDED, Player.STATE_IDLE -> {
                        tvBuffering.visibility = View.GONE
                        cancelFallback()
                    }
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                // Erro imediato → tenta próxima qualidade sem esperar
                cancelFallback()
                tryNextQuality()
            }
        })
    }

    private fun scheduleFallback() {
        cancelFallback()
        fallbackRunnable = Runnable {
            if (isBuffering) tryNextQuality()
        }
        fallbackHandler.postDelayed(fallbackRunnable!!, FALLBACK_DELAY_MS)
    }

    private fun cancelFallback() {
        fallbackRunnable?.let { fallbackHandler.removeCallbacks(it) }
        fallbackRunnable = null
    }

    private fun tryNextQuality() {
        if (currentQualityIndex < qualityList.size - 1) {
            currentQualityIndex++
            buildAndPlay()
        } else {
            // Já está na pior qualidade, não tem para onde cair
            tvBuffering.text = "Sem sinal"
        }
    }

    private fun updateQualityLabel(quality: String) {
        tvQuality.text = quality
        tvQuality.visibility = View.VISIBLE
    }

    override fun onPause() {
        super.onPause()
        player.pause()
        cancelFallback()
    }

    override fun onDestroy() {
        super.onDestroy()
        cancelFallback()
        player.release()
    }
}
