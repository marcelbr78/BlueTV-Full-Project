package com.example.bluetv

import android.content.Intent
import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import android.widget.Button
import kotlinx.coroutines.*

class MainActivity : AppCompatActivity() {
    private lateinit var recycler: RecyclerView
    private val adapter = SimpleAdapter(mutableListOf())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        recycler = findViewById(R.id.recycler)
        recycler.layoutManager = LinearLayoutManager(this)
        recycler.adapter = adapter

        findViewById<Button>(R.id.btnPlans).setOnClickListener {
            startActivity(Intent(this, PlansActivity::class.java))
        }
        findViewById<Button>(R.id.btnAdmin).setOnClickListener {
            startActivity(Intent(this, AdminActivity::class.java))
        }

        GlobalScope.launch(Dispatchers.Main) {
            val items = withContext(Dispatchers.IO) { M3UParser.loadFromPrefs(this@MainActivity) }
            adapter.update(items)
        }
    }
}
