package com.example.bluetv

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.animation.DecelerateInterpolator
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity

class SplashActivity : AppCompatActivity() {

    private val handler = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_splash)

        val layoutLogo = findViewById<View>(R.id.layoutLogo)
        val tvBlue     = findViewById<TextView>(R.id.tvBlue)
        val tvTv       = findViewById<TextView>(R.id.tvTv)
        val tvTagline  = findViewById<TextView>(R.id.tvTagline)
        val interp     = DecelerateInterpolator(2f)

        // "Blue" entra da esquerda
        tvBlue.translationX = -200f
        // "TV" entra da direita
        tvTv.translationX = 200f
        layoutLogo.alpha = 0f

        // Inicia animação após 300ms
        handler.postDelayed({
            if (isFinishing || isDestroyed) return@postDelayed

            // Fade in + slide do logo
            layoutLogo.animate()
                .alpha(1f)
                .setDuration(700)
                .setInterpolator(interp)
                .start()

            tvBlue.animate()
                .translationX(0f)
                .setDuration(700)
                .setInterpolator(interp)
                .start()

            tvTv.animate()
                .translationX(0f)
                .setDuration(700)
                .setInterpolator(interp)
                .start()

            // Tagline aparece depois
            handler.postDelayed({
                if (isFinishing || isDestroyed) return@postDelayed
                tvTagline.animate().alpha(1f).setDuration(500).start()
            }, 800)

        }, 300)

        // Navega após 2.5s
        handler.postDelayed({
            if (isFinishing || isDestroyed) return@postDelayed
            navigate()
        }, 2500)
    }

    private fun navigate() {
        val prefs  = getSharedPreferences("bluetv_prefs", Context.MODE_PRIVATE)
        val status = prefs.getString("status", "pending")
        val dest   = if (status == "ok") HomeActivity::class.java
                     else ActivationActivity::class.java
        startActivity(Intent(this, dest))
        finish()
    }

    override fun onDestroy() {
        super.onDestroy()
        handler.removeCallbacksAndMessages(null)
    }
}
