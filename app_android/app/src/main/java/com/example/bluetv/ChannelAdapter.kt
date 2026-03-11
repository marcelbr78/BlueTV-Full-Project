package com.example.bluetv

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide

class ChannelAdapter(
    private val channels: List<Channel>,
    private val onClick: (Channel) -> Unit
) : RecyclerView.Adapter<ChannelAdapter.VH>() {

    inner class VH(v: View) : RecyclerView.ViewHolder(v) {
        val ivLogo: ImageView = v.findViewById(R.id.ivLogo)
        val tvName: TextView = v.findViewById(R.id.tvName)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val v = LayoutInflater.from(parent.context).inflate(R.layout.item_channel, parent, false)
        return VH(v)
    }

    override fun onBindViewHolder(holder: VH, position: Int) {
        val ch = channels[position]
        holder.tvName.text = ch.name
        if (ch.logo.isNotEmpty()) {
            Glide.with(holder.itemView.context)
                .load(ch.logo)
                .placeholder(R.drawable.ic_channel_placeholder)
                .error(R.drawable.ic_channel_placeholder)
                .into(holder.ivLogo)
        } else {
            holder.ivLogo.setImageResource(R.drawable.ic_channel_placeholder)
        }
        holder.itemView.setOnClickListener { onClick(ch) }
        holder.itemView.setOnFocusChangeListener { _, hasFocus ->
            holder.itemView.scaleX = if (hasFocus) 1.1f else 1.0f
            holder.itemView.scaleY = if (hasFocus) 1.1f else 1.0f
        }
    }

    override fun getItemCount() = channels.size
}
