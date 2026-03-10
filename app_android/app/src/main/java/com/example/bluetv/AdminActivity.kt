package com.example.bluetv

import android.os.Bundle
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.ListView
import androidx.appcompat.app.AppCompatActivity

class AdminActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_admin)

        val etM3u = findViewById<EditText>(R.id.etM3UUrl)
        val btnSave = findViewById<Button>(R.id.btnSaveM3U)
        val etClientName = findViewById<EditText>(R.id.etClientName)
        val etClientId = findViewById<EditText>(R.id.etClientId)
        val btnAdd = findViewById<Button>(R.id.btnAddClient)
        val listClients = findViewById<ListView>(R.id.listClients)

        val prefs = getSharedPreferences("bluetv", MODE_PRIVATE)
        etM3u.setText(prefs.getString("m3u_url", ""))

        btnSave.setOnClickListener {
            prefs.edit().putString("m3u_url", etM3u.text.toString()).apply()
        }

        val clients = mutableListOf<String>()
        val adapter = ArrayAdapter(this, android.R.layout.simple_list_item_1, clients)
        listClients.adapter = adapter

        btnAdd.setOnClickListener {
            val name = etClientName.text.toString().trim()
            val id = etClientId.text.toString().trim()
            if (name.isNotEmpty() && id.isNotEmpty()) {
                clients.add(0, "$name - $id")
                adapter.notifyDataSetChanged()
                etClientName.text.clear()
                etClientId.text.clear()
            }
        }
    }
}
