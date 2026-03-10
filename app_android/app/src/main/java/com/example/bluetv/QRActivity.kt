package com.example.bluetv

import android.graphics.Bitmap
import android.os.Bundle
import android.widget.Button
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import com.google.zxing.BarcodeFormat
import com.journeyapps.barcodescanner.BarcodeEncoder

class QRActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_qr)
        val iv = findViewById<ImageView>(R.id.ivQR)
        val tv = findViewById<TextView>(R.id.tvCopy)
        val btn = findViewById<Button>(R.id.btnSimulate)
        val amount = intent.getDoubleExtra("amount", 39.90)
        val payload = "BIPA-SANDBOX|amount=$amount|to=YOUR_CUSTODY_ADDRESS|note=BlueTV"

        tv.text = "Copia e Cola: $payload"

        try {
            val barcodeEncoder = BarcodeEncoder()
            val bitmap: Bitmap = barcodeEncoder.encodeBitmap(payload, BarcodeFormat.QR_CODE, 400, 400)
            iv.setImageBitmap(bitmap)
        } catch (e: Exception) {
            e.printStackTrace()
        }

        btn.setOnClickListener {
            Toast.makeText(this, "Pagamento simulado. Ativando...", Toast.LENGTH_SHORT).show()
            startActivity(android.content.Intent(this, PlayerActivity::class.java))
        }
    }
}
