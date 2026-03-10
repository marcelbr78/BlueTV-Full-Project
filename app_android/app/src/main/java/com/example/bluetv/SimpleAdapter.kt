package com.example.bluetv

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView

class SimpleAdapter(private var items: MutableList<Map<String,String>>) : RecyclerView.Adapter<SimpleAdapter.VH>() {

    class VH(view: View): RecyclerView.ViewHolder(view) {
        val t1: TextView = view.findViewById(android.R.id.text1)
        val t2: TextView = view.findViewById(android.R.id.text2)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val v = LayoutInflater.from(parent.context).inflate(android.R.layout.simple_list_item_2, parent, false)
        return VH(v)
    }

    override fun onBindViewHolder(holder: VH, position: Int) {
        val item = items[position]
        holder.t1.text = item["name"]
        holder.t2.text = item["group"]
    }

    override fun getItemCount(): Int = items.size

    fun update(newItems: List<Map<String,String>>) {
        items.clear()
        items.addAll(newItems)
        notifyDataSetChanged()
    }
}
