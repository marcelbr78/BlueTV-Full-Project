package com.example.bluetv

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

class FormActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_form)
        val etName = findViewById<EditText>(R.id.etName)
        val etCPF = findViewById<EditText>(R.id.etCPF)
        val etWhats = findViewById<EditText>(R.id.etWhats)
        val etAddr = findViewById<EditText>(R.id.etAddress)
        val cb = findViewById<CheckBox>(R.id.cbTerms)
        val btn = findViewById<Button>(R.id.btnGenerateQR)
        val days = intent.getIntExtra("plan_days", 30)

        btn.setOnClickListener {
            if (etName.text.isNullOrBlank() || etCPF.text.isNullOrBlank() || etWhats.text.isNullOrBlank() || etAddr.text.isNullOrBlank()) {
                Toast.makeText(this, "Todos os campos são obrigatórios", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            if (!cb.isChecked) {
                Toast.makeText(this, "Você precisa aceitar os termos", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            val prefs = getSharedPreferences("bluetv", MODE_PRIVATE)
            val order = "name=${etName.text}&cpf=${etCPF.text}&whats=${etWhats.text}&addr=${etAddr.text}&days=$days"
            prefs.edit().putString("last_order", order).apply()
            val intent = Intent(this, QRActivity::class.java)
            intent.putExtra("amount", when(days){
                30->39.90
                90->99.90
                365->269.90
                else->39.90
            })
            startActivity(intent)
        }
    }
}
