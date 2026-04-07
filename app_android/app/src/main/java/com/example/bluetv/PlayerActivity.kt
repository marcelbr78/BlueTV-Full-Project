package com.example.bluetv

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.google.android.exoplayer2.*
import com.google.android.exoplayer2.ui.StyledPlayerView
import com.google.android.exoplayer2.source.DefaultMediaSourceFactory
import com.google.android.exoplayer2.upstream.DefaultHttpDataSource

class PlayerActivity : AppCompatActivity() {

    private var player: ExoPlayer? = null
    private lateinit var playerView: StyledPlayerView
    private lateinit var tvChannelName: TextView
    private lateinit var tvQuality: TextView
    private lateinit var tvPlayerEpg: TextView
    private lateinit var tvBuffering: LinearLayout
    private lateinit var layoutControls: View

    private var currentStreamId = ""
    private var retryCount = 0
    private val MAX_RETRIES = 5
    private val retryHandler = Handler(Looper.getMainLooper())
    private val hideControlsHandler = Handler(Looper.getMainLooper())
    private val HIDE_DELAY = 5000L

    // SALVAMENTO DE PROGRESSO
    private val progressHandler = Handler(Looper.getMainLooper())
    private val SAVE_INTERVAL = 10000L // Salva a cada 10 segundos

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_player)

        bindViews()
        
        currentStreamId = intent.getStringExtra("stream_id") ?: ""
        val startPos    = intent.getLongExtra("start_pos", 0L)
        
        val ch = ChannelData.getCurrent()
        if (ch == null) {
            val url  = intent.getStringExtra("stream_url") ?: ""
            val name = intent.getStringExtra("channel_name") ?: ""
            tvChannelName.text = name
            tvPlayerEpg.text = "Guia indisponível"
            initPlayer(startPos)
            playUrl(url)
        } else {
            currentStreamId = ch.id
            updateUi(ch)
            initPlayer(startPos)
            playUrl(ch.url)
        }
        
        showControls()
        startProgressSaver()
    }

    private fun bindViews() {
        tvChannelName  = findViewById(R.id.tvChannelName)
        tvQuality      = findViewById(R.id.tvQuality)
        tvPlayerEpg    = findViewById(R.id.tvPlayerEpg)
        tvBuffering    = findViewById(R.id.tvBuffering)
        playerView     = findViewById(R.id.playerView)
        layoutControls = findViewById(R.id.layoutControls)
    }

    private fun updateUi(ch: Channel) {
        tvChannelName.text = ch.name
        tvPlayerEpg.text = if (ch.epgTitle.isNotEmpty()) "Now: ${ch.epgTitle}" else "Sem programação disponível"
    }

    private fun initPlayer(startPos: Long) {
        val dataSourceFactory = DefaultHttpDataSource.Factory()
            .setAllowCrossProtocolRedirects(true)
            .setConnectTimeoutMs(15000)
            .setReadTimeoutMs(15000)

        player = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(dataSourceFactory))
            .build()
            
        playerView.player = player
        
        if (startPos > 0) {
            player?.seekTo(startPos)
            Toast.makeText(this, "Continuando de onde você parou...", Toast.LENGTH_SHORT).show()
        }

        player?.addListener(object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                when (state) {
                    Player.STATE_BUFFERING -> tvBuffering.visibility = View.VISIBLE
                    Player.STATE_READY -> {
                        tvBuffering.visibility = View.GONE
                        retryCount = 0
                        detectQuality()
                    }
                    Player.STATE_ENDED -> {
                        if (currentStreamId.isNotEmpty()) ProgressManager.clearProgress(this@PlayerActivity, currentStreamId)
                        retryPlayback()
                    }
                }
            }
            override fun onPlayerError(error: PlaybackException) {
                tvBuffering.visibility = View.VISIBLE
                retryPlayback()
            }
        })
    }

    private fun playUrl(url: String) {
        if (url.isEmpty()) return
        val mediaItem = MediaItem.fromUri(url)
        player?.setMediaItem(mediaItem)
        player?.prepare()
        player?.playWhenReady = true
    }

    private fun startProgressSaver() {
        progressHandler.postDelayed(object : Runnable {
            override fun run() {
                saveCurrentProgress()
                progressHandler.postDelayed(this, SAVE_INTERVAL)
            }
        }, SAVE_INTERVAL)
    }

    private fun saveCurrentProgress() {
        if (player?.isPlaying == true && currentStreamId.isNotEmpty()) {
            val pos = player?.currentPosition ?: 0L
            val dur = player?.duration ?: 0L
            // Só salva se não estiver no finalzinho do filme
            if (pos > 10000 && (dur - pos) > 60000) { 
                ProgressManager.saveProgress(this, currentStreamId, pos)
            }
        }
    }

    private fun retryPlayback() {
        if (retryCount < MAX_RETRIES) {
            retryCount++; retryHandler.postDelayed({ player?.prepare(); player?.play() }, 3000)
        }
    }

    private fun changeChannel(direction: Int) {
        saveCurrentProgress() // Salva antes de trocar
        val nextCh = if (direction > 0) ChannelData.getNext() else ChannelData.getPrev()
        if (nextCh != null) {
            currentStreamId = nextCh.id
            updateUi(nextCh)
            tvQuality.visibility = View.GONE
            playUrl(nextCh.url)
            showControls()
        }
    }

    private fun detectQuality() {
        val format = player?.videoFormat
        if (format != null) {
            val h = format.height
            val quality = when { h >= 2160 -> "4K"; h >= 1080 -> "FHD"; h >= 720 -> "HD"; h > 0 -> "SD"; else -> "" }
            if (quality.isNotEmpty()) { tvQuality.text = quality; tvQuality.visibility = View.VISIBLE }
        }
    }

    private fun showControls() {
        layoutControls.visibility = View.VISIBLE
        hideControlsHandler.removeCallbacksAndMessages(null)
        hideControlsHandler.postDelayed({ layoutControls.visibility = View.GONE }, HIDE_DELAY)
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        showControls()
        return when (keyCode) {
            KeyEvent.KEYCODE_DPAD_UP -> { changeChannel(1); true }
            KeyEvent.KEYCODE_DPAD_DOWN -> { changeChannel(-1); true }
            KeyEvent.KEYCODE_DPAD_CENTER, KeyEvent.KEYCODE_ENTER -> { if (player?.isPlaying == true) player?.pause() else player?.play(); true }
            KeyEvent.KEYCODE_BACK -> { finish(); true }
            else -> super.onKeyDown(keyCode, event)
        }
    }

    override fun onPause() {
        super.onPause()
        saveCurrentProgress()
        player?.pause()
    }

    override fun onDestroy() {
        super.onDestroy()
        saveCurrentProgress()
        retryHandler.removeCallbacksAndMessages(null)
        progressHandler.removeCallbacksAndMessages(null)
        player?.release()
    }
}
