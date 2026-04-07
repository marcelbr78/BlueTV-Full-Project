package com.example.bluetv

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import okhttp3.*
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException

class AdminActivity : AppCompatActivity() {

    private val BACKEND_URL = "https://bluetv-full-project.onrender.com"
    private val API_KEY     = "btv_k8x2mP9qL4wN7vR3jY6cT1hB5fA0eZ"
    private val client      = OkHttpClient()

    private lateinit var rvAdminClients: RecyclerView
    private lateinit var tvAdminStatus:  TextView
    private lateinit var pbAdmin:        ProgressBar

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_admin)

        rvAdminClients = findViewById(R.id.rvAdminClients)
        tvAdminStatus  = findViewById(R.id.tvAdminStatus)
        pbAdmin        = findViewById(R.id.pbAdmin)
        
        rvAdminClients.layoutManager = LinearLayoutManager(this)
        
        findViewById<TextView>(R.id.btnAdminBack).setOnClickListener { finish() }
        
        fetchAdminData()
    }

    private fun fetchAdminData() {
        // Xtream/Backend endpoint: /admin/clients
        val req = Request.Builder()
            .url("$BACKEND_URL/admin/clients")
            .addHeader("x-api-key", API_KEY)
            .build()

        client.newCall(req).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                runOnUiThread {
                    pbAdmin.visibility = View.GONE
                    tvAdminStatus.text = "Erro ao conectar com o servidor."
                }
            }
            override fun onResponse(call: Call, response: Response) {
                val body = response.body?.string(); response.close()
                runOnUiThread {
                    pbAdmin.visibility = View.GONE
                    if (body.isNullOrEmpty() || !body.startsWith("[")) {
                        tvAdminStatus.text = "Nenhum cliente encontrado ou erro na resposta."
                        return@runOnUiThread
                    }
                    try {
                        val arr = JSONArray(body)
                        tvAdminStatus.text = "Total de clientes: ${arr.length()}"
                        rvAdminClients.adapter = AdminAdapter(arr)
                    } catch (e: Exception) {
                        tvAdminStatus.text = "Erro ao processar dados."
                    }
                }
            }
        })
    }

    inner class AdminAdapter(private val clients: JSONArray) : RecyclerView.Adapter<AdminAdapter.VH>() {
        inner class VH(v: View) : RecyclerView.ViewHolder(v) {
            val tvCode:   TextView = v.findViewById(R.id.tvAdminClientCode)
            val tvExp:    TextView = v.findViewById(R.id.tvAdminClientExp)
            val tvStatus: TextView = v.findViewById(R.id.tvAdminClientStatus)
        }
        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
            val v = LayoutInflater.from(parent.context).inflate(R.layout.item_admin_client, parent, false)
            return VH(v)
        }
        override fun onBindViewHolder(holder: VH, position: Int) {
            val o = clients.getJSONObject(position)
            val code = o.optString("client_code", "—")
            val exp  = o.optString("validade", "—")
            val isActive = o.optBoolean("active", true)

            holder.tvCode.text = "CÓDIGO: $code"
            holder.tvExp.text  = "EXPIRA: $exp"
            holder.tvStatus.text = if (isActive) "ATIVO" else "BLOQUEADO"
            holder.tvStatus.setBackgroundColor(if (isActive) 0xFF2E7D32.toInt() else 0xFFC62828.toInt())
            
            holder.itemView.setOnClickListener {
                Toast.makeText(this@AdminActivity, "Opções de gestão para $code em breve!", Toast.LENGTH_SHORT).show()
            }
        }
        override fun getItemCount() = clients.length()
    }
}
