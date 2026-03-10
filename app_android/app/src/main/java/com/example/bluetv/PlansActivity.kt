package com.example.bluetv

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.RadioGroup
import androidx.appcompat.app.AppCompatActivity

class PlansActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_plans)
        val rg = findViewById<RadioGroup>(R.id.rgPlans)
        findViewById<Button>(R.id.btnProceed).setOnClickListener {
            val id = rg.checkedRadioButtonId
            val days = when(id) {
                R.id.rb30 -> 30
                R.id.rb90 -> 90
                R.id.rb365 -> 365
                else -> 30
            }
            val intent = Intent(this, FormActivity::class.java)
            intent.putExtra("plan_days", days)
            startActivity(intent)
        }
    }
}
