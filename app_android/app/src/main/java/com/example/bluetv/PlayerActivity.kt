package com.example.bluetv

import android.net.Uri
import android.os.Bundle
import android.view.View
import android.widget.ProgressBar
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import com.google.android.exoplayer2.ExoPlayer
import com.google.android.exoplayer2.MediaItem
import com.google.android.exoplayer2.PlaybackException
import com.google.android.exoplayer2.Player
import com.google.android.exoplayer2.ui.StyledPlayerView

class PlayerActivity : AppCompatActivity() {

    private var player: ExoPlayer? = null
    private lateinit var playerView: StyledPlayerView
    private lateinit var progressBar: ProgressBar
    private lateinit var tvError: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_player)

        playerView = findViewById(R.id.playerView)
        progressBar = findViewById(R.id.progressBar)
        tvError = findViewById(R.id.tvError)

        val m3uUrl = intent.getStringExtra("m3u_url")
        if (m3uUrl.isNullOrEmpty()) {
            tvError.text = "URL M3U não encontrada"
            tvError.visibility = View.VISIBLE
            return
        }

        initPlayer(m3uUrl)
    }

    private fun initPlayer(url: String) {
        player = ExoPlayer.Builder(this).build()
        playerView.player = player

        val mediaItem = MediaItem.fromUri(Uri.parse(url))
        player?.apply {
            setMediaItem(mediaItem)
            prepare()
            playWhenReady = true
            addListener(object : Player.Listener {
                override fun onPlaybackStateChanged(state: Int) {
                    when (state) {
                        Player.STATE_BUFFERING -> {
                            progressBar.visibility = View.VISIBLE
                        }
                        Player.STATE_READY -> {
                            progressBar.visibility = View.GONE
                            tvError.visibility = View.GONE
                        }
                        Player.STATE_ENDED -> {
                            progressBar.visibility = View.GONE
                        }
                        Player.STATE_IDLE -> {
                            progressBar.visibility = View.GONE
                        }
                    }
                }
                override fun onPlayerError(error: PlaybackException) {
                    progressBar.visibility = View.GONE
                    tvError.text = "Erro ao reproduzir stream.\nVerifique a sua ligação."
                    tvError.visibility = View.VISIBLE
                }
            })
        }
    }

    override fun onPause() {
        super.onPause()
        player?.pause()
    }

    override fun onResume() {
        super.onResume()
        player?.play()
    }

    override fun onDestroy() {
        super.onDestroy()
        player?.release()
        player = null
    }
}
