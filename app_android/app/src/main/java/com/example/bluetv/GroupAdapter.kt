package com.example.bluetv

import android.graphics.Color
import android.view.LayoutInflater
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView

class GroupAdapter(
    private val groups: List<String>,
    private var selected: String,
    private val onSelect: (String) -> Unit
) : RecyclerView.Adapter<GroupAdapter.VH>() {

    inner class VH(val tv: TextView) : RecyclerView.ViewHolder(tv)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val tv = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_group, parent, false) as TextView
        return VH(tv)
    }

    override fun onBindViewHolder(holder: VH, position: Int) {
        val group = groups[position]
        holder.tv.text = group
        val active = group == selected
        holder.tv.setTextColor(if (active) Color.WHITE else 0xFF888899.toInt())
        holder.tv.setBackgroundColor(if (active) 0xFF1565C0.toInt() else Color.TRANSPARENT)
        holder.tv.setOnClickListener {
            if (group == selected) return@setOnClickListener
            val prev = selected
            selected = group
            notifyItemChanged(groups.indexOf(prev))
            notifyItemChanged(position)
            onSelect(group)
        }
        holder.tv.setOnFocusChangeListener { v, hasFocus ->
            v.scaleX = if (hasFocus) 1.03f else 1f
            v.scaleY = if (hasFocus) 1.03f else 1f
        }
    }

    override fun getItemCount() = groups.size
}
