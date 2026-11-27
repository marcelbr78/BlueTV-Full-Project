package com.example.bluetv

import android.view.LayoutInflater
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView

class KeyboardAdapter(
    private val onKeyClick: (String) -> Unit
) : RecyclerView.Adapter<KeyboardAdapter.VH>() {

    private val keys = listOf(
        "A", "B", "C", "D", "E", "F",
        "G", "H", "I", "J", "K", "L",
        "M", "N", "O", "P", "Q", "R",
        "S", "T", "U", "V", "W", "X",
        "Y", "Z", "0", "1", "2", "3",
        "4", "5", "6", "7", "8", "9",
        "Espaço", "Apagar", "Limpar"
    )

    inner class VH(val tv: TextView) : RecyclerView.ViewHolder(tv)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val tv = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_category, parent, false) as TextView
        return VH(tv)
    }

    override fun onBindViewHolder(holder: VH, position: Int) {
        val key = keys[position]
        holder.tv.text = key
        holder.tv.setOnClickListener {
            val value = when(key) {
                "Espaço" -> " "
                "Apagar" -> "BACKSPACE"
                "Limpar" -> "CLEAR"
                else -> key
            }
            onKeyClick(value)
        }
        
        holder.tv.setOnFocusChangeListener { view, hasFocus ->
            view.scaleX = if (hasFocus) 1.1f else 1.0f
            view.scaleY = if (hasFocus) 1.1f else 1.0f
        }
    }

    override fun getItemCount() = keys.size
}
