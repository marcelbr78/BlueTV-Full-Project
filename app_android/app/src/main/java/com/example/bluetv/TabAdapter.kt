package com.example.bluetv

import android.graphics.Color
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView

class TabAdapter(
    private val tabs: List<String>,
    private var selected: Int,
    private val onClick: (Int) -> Unit
) : RecyclerView.Adapter<TabAdapter.VH>() {

    inner class VH(v: View) : RecyclerView.ViewHolder(v) {
        val tv: TextView = v.findViewById(R.id.tvTab)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val v = LayoutInflater.from(parent.context).inflate(R.layout.item_tab, parent, false)
        return VH(v)
    }

    override fun onBindViewHolder(holder: VH, position: Int) {
        holder.tv.text = tabs[position]
        if (position == selected) {
            holder.tv.setTextColor(Color.parseColor("#e50914"))
            holder.tv.textSize = 16f
            holder.tv.alpha = 1f
        } else {
            holder.tv.setTextColor(Color.WHITE)
            holder.tv.textSize = 14f
            holder.tv.alpha = 0.7f
        }
        holder.itemView.setOnClickListener {
            selected = position
            notifyDataSetChanged()
            onClick(position)
        }
    }

    override fun getItemCount() = tabs.size
}
