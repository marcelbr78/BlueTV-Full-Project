package com.example.bluetv

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

class SettingsActivity : AppCompatActivity() {

    private val PREFS_NAME = "bluetv_prefs"
    private var adminClickCount = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_settings)

        val prefs    = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val clientId = prefs.getString("client_id", "—") ?: "—"
        val host     = prefs.getString("host", "—") ?: "—"
        val username = prefs.getString("username", "—") ?: "—"
        val password = prefs.getString("password", "—") ?: "—"
        val validade = prefs.getString("validade", null).let {
            if (it.isNullOrEmpty() || it == "null") "—" else it
        }

        val maskedPass = if (password.length > 3)
            password.take(3) + "*".repeat(password.length - 3)
        else password

        val tvId = findViewById<TextView>(R.id.tvClientId)
        tvId.text = clientId
        
        // ── ACESSO AO PAINEL DO ADMIN (5 Cliques) ──
        tvId.setOnClickListener {
            adminClickCount++
            if (adminClickCount >= 5) {
                adminClickCount = 0
                startActivity(Intent(this, AdminActivity::class.java))
            } else if (adminClickCount > 2) {
                Toast.makeText(this, "Faltam ${5 - adminClickCount} toques para o Painel", Toast.LENGTH_SHORT).show()
            }
        }

        findViewById<TextView>(R.id.tvHost).text      = host
        findViewById<TextView>(R.id.tvUsername).text  = username
        findViewById<TextView>(R.id.tvPassword).text  = maskedPass
        findViewById<TextView>(R.id.tvValidade).text  = validade

        findViewById<TextView>(R.id.btnBack).setOnClickListener { finish() }

        findViewById<TextView>(R.id.btnReactivate).setOnClickListener {
            prefs.edit().putString("status", "pending").apply()
            startActivity(Intent(this, ActivationActivity::class.java))
            finish()
        }
    }
}
