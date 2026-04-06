package com.example.bluetv

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.bumptech.glide.load.resource.drawable.DrawableTransitionOptions

class ChannelAdapter(
    private val channels: List<Channel>,
    private val displayMode: Int = MODE_LIVE,
    private val onClick: (Channel) -> Unit
) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {

    companion object {
        const val MODE_LIVE = 0   // lista vertical: logo + nome + grupo
        const val MODE_GRID = 1   // grid: poster grande + título
    }

    // ViewHolder para LIVE / ESPORTES
    inner class LiveVH(v: View) : RecyclerView.ViewHolder(v) {
        val ivLogo: ImageView = v.findViewById(R.id.ivLogo)
        val tvName: TextView = v.findViewById(R.id.tvName)
        val tvGroup: TextView = v.findViewById(R.id.tvGroup)
        val viewDot: View = v.findViewById(R.id.viewLiveIndicator)
    }

    // ViewHolder para FILMES / SÉRIES / KIDS / ANIME
    inner class GridVH(v: View) : RecyclerView.ViewHolder(v) {
        val ivPoster: ImageView = v.findViewById(R.id.ivPoster)
        val tvName: TextView = v.findViewById(R.id.tvName)
    }

    override fun getItemViewType(position: Int) = displayMode

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
        return if (viewType == MODE_LIVE) {
            val v = LayoutInflater.from(parent.context)
                .inflate(R.layout.item_channel_live, parent, false)
            LiveVH(v)
        } else {
            val v = LayoutInflater.from(parent.context)
                .inflate(R.layout.item_channel_grid, parent, false)
            GridVH(v)
        }
    }

    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
        val ch = channels[position]
        when (holder) {
            is LiveVH -> bindLive(holder, ch)
            is GridVH -> bindGrid(holder, ch)
        }
    }

    private fun bindLive(holder: LiveVH, ch: Channel) {
        holder.tvName.text = ch.name
        holder.tvGroup.text = ch.group.ifEmpty { "TV ao Vivo" }

        if (ch.logo.isNotEmpty()) {
            Glide.with(holder.itemView.context)
                .load(ch.logo)
                .placeholder(R.drawable.ic_channel_placeholder)
                .error(R.drawable.ic_channel_placeholder)
                .transition(DrawableTransitionOptions.withCrossFade())
                .into(holder.ivLogo)
        } else {
            holder.ivLogo.setImageResource(R.drawable.ic_channel_placeholder)
        }

        holder.itemView.setOnClickListener { onClick(ch) }
        holder.itemView.setOnFocusChangeListener { _, hasFocus ->
            holder.itemView.scaleX = if (hasFocus) 1.03f else 1.0f
            holder.itemView.scaleY = if (hasFocus) 1.03f else 1.0f
        }
    }

    private fun bindGrid(holder: GridVH, ch: Channel) {
        holder.tvName.text = ch.name

        if (ch.logo.isNotEmpty()) {
            Glide.with(holder.itemView.context)
                .load(ch.logo)
                .placeholder(R.drawable.ic_channel_placeholder)
                .error(R.drawable.ic_channel_placeholder)
                .transition(DrawableTransitionOptions.withCrossFade())
                .centerCrop()
                .into(holder.ivPoster)
        } else {
            holder.ivPoster.setImageResource(R.drawable.ic_channel_placeholder)
        }

        holder.itemView.setOnClickListener { onClick(ch) }
        holder.itemView.setOnFocusChangeListener { _, hasFocus ->
            holder.itemView.scaleX = if (hasFocus) 1.05f else 1.0f
            holder.itemView.scaleY = if (hasFocus) 1.05f else 1.0f
        }
    }

    override fun getItemCount() = channels.size
}
