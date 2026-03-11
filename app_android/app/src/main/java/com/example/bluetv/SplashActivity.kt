package com.example.bluetv

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.appcompat.app.AppCompatActivity

class SplashActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_splash)

        Handler(Looper.getMainLooper()).postDelayed({
            val prefs = getSharedPreferences("bluetv_prefs", Context.MODE_PRIVATE)
            val status = prefs.getString("status", "pending")
            if (status == "ok") {
                startActivity(Intent(this, HomeActivity::class.java))
            } else {
                startActivity(Intent(this, ActivationActivity::class.java))
            }
            finish()
        }, 2000)
    }
}
