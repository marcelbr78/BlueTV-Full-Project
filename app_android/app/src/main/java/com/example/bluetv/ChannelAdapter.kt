package com.example.bluetv

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import com.bumptech.glide.load.resource.drawable.DrawableTransitionOptions

class ChannelAdapter(
    private val channels: List<Channel>,
    private val displayMode: Int = MODE_LIVE,
    private val favoriteIds: Set<String> = emptySet(),
    private val onFavoriteToggle: ((Channel) -> Unit)? = null,
    private val onClick: (Channel) -> Unit
) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {

    companion object {
        const val MODE_LIVE = 0
        const val MODE_GRID = 1
    }

    private var selectedPosition = -1

    inner class LiveVH(v: View) : RecyclerView.ViewHolder(v) {
        val tvNumber:    TextView  = v.findViewById(R.id.tvNumber)
        val ivLogo:      ImageView = v.findViewById(R.id.ivLogo)
        val tvName:      TextView  = v.findViewById(R.id.tvName)
        val tvFavorite:  TextView  = v.findViewById(R.id.tvFavorite)
    }

    inner class GridVH(v: View) : RecyclerView.ViewHolder(v) {
        val ivPoster:   ImageView = v.findViewById(R.id.ivPoster)
        val tvName:     TextView  = v.findViewById(R.id.tvName)
        val tvFavorite: TextView  = v.findViewById(R.id.tvFavorite)
    }

    override fun getItemViewType(position: Int) = displayMode

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
        return if (viewType == MODE_LIVE) {
            LiveVH(LayoutInflater.from(parent.context)
                .inflate(R.layout.item_channel_live, parent, false))
        } else {
            GridVH(LayoutInflater.from(parent.context)
                .inflate(R.layout.item_channel_grid, parent, false))
        }
    }

    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
        val ch = channels[position]
        when (holder) {
            is LiveVH -> bindLive(holder, ch, position)
            is GridVH -> bindGrid(holder, ch)
        }
    }

    private fun bindLive(holder: LiveVH, ch: Channel, position: Int) {
        holder.tvNumber.text = (position + 1).toString()
        holder.tvName.text   = ch.name

        val isSelected = position == selectedPosition
        holder.itemView.isSelected = isSelected // Para o seletor XML de background

        // Favorito
        val isFav = favoriteIds.contains(ch.id)
        holder.tvFavorite.text      = if (isFav) "★" else "☆"
        holder.tvFavorite.setTextColor(
            if (isFav) 0xFFFFB300.toInt() else 0xFF444466.toInt()
        )

        // Logo
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

        holder.itemView.setOnClickListener {
            val prev = selectedPosition
            selectedPosition = holder.adapterPosition
            notifyItemChanged(prev)
            notifyItemChanged(selectedPosition)
            onClick(ch)
        }

        // ── FAVORITAR COM CLIQUE LONGO (Para TV) ──
        holder.itemView.setOnLongClickListener {
            onFavoriteToggle?.invoke(ch)
            val msg = if (favoriteIds.contains(ch.id)) "Removido dos favoritos" else "Adicionado aos favoritos"
            Toast.makeText(holder.itemView.context, msg, Toast.LENGTH_SHORT).show()
            true
        }

        holder.itemView.setOnFocusChangeListener { _, hasFocus ->
            holder.itemView.scaleX = if (hasFocus) 1.04f else 1.0f
            holder.itemView.scaleY = if (hasFocus) if (displayMode == MODE_LIVE) 1.08f else 1.04f else 1.0f
            holder.itemView.translationZ = if (hasFocus) 8f else 0f
        }
    }

    private fun bindGrid(holder: GridVH, ch: Channel) {
        holder.tvName.text = ch.name

        // Favorito
        val isFav = favoriteIds.contains(ch.id)
        holder.tvFavorite.text = if (isFav) "★" else "" // Em grid fica mais limpo sem estrela vazia
        holder.tvFavorite.setTextColor(0xFFFFB300.toInt())

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

        // ── FAVORITAR COM CLIQUE LONGO (Para TV) ──
        holder.itemView.setOnLongClickListener {
            onFavoriteToggle?.invoke(ch)
            true
        }

        holder.itemView.setOnFocusChangeListener { _, hasFocus ->
            holder.itemView.scaleX = if (hasFocus) 1.1f else 1.0f
            holder.itemView.scaleY = if (hasFocus) 1.1f else 1.0f
            holder.itemView.translationZ = if (hasFocus) 10f else 0f
            // Muda a cor da borda ou elevação se quiser, mas escala já ajuda muito
        }
    }

    override fun getItemCount() = channels.size
}
