package com.example.bluetv

import android.view.LayoutInflater
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView

class SidebarAdapter(
    private val items: List<String>,
    private var selectedIndex: Int,
    private val onSelect: (Int) -> Unit
) : RecyclerView.Adapter<SidebarAdapter.VH>() {

    inner class VH(val tv: TextView) : RecyclerView.ViewHolder(tv)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val tv = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_sidebar, parent, false) as TextView
        return VH(tv)
    }

    override fun onBindViewHolder(holder: VH, position: Int) {
        val item = items[position]
        holder.tv.text = item
        
        val isSelected = position == selectedIndex
        holder.tv.isSelected = isSelected
        holder.tv.setTextColor(if (isSelected) 0xFF4499FF.toInt() else 0xFF888899.toInt())
        holder.tv.setBackgroundResource(if (isSelected) R.drawable.bg_search_edittext else 0)

        holder.tv.setOnClickListener {
            if (position == selectedIndex) return@setOnClickListener
            val prev = selectedIndex
            selectedIndex = position
            notifyItemChanged(prev)
            notifyItemChanged(selectedIndex)
            onSelect(position)
        }

        holder.tv.setOnFocusChangeListener { view, hasFocus ->
            view.scaleX = if (hasFocus) 1.1f else 1.0f
            view.scaleY = if (hasFocus) 1.1f else 1.0f
            if (hasFocus) {
                // Opcional: já seleciona ao focar (estilo TV avançado)
                // holder.tv.performClick()
            }
        }
    }

    override fun getItemCount() = items.size
}
