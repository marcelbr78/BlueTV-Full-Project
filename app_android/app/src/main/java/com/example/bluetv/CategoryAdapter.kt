package com.example.bluetv

import android.view.LayoutInflater
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView

class CategoryAdapter(
    private val categories: List<String>,
    private var selected: String,
    private val onSelect: (String) -> Unit
) : RecyclerView.Adapter<CategoryAdapter.VH>() {

    inner class VH(val tv: TextView) : RecyclerView.ViewHolder(tv)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): VH {
        val tv = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_category, parent, false) as TextView
        return VH(tv)
    }

    override fun onBindViewHolder(holder: VH, position: Int) {
        val cat = categories[position]
        holder.tv.text = cat
        
        // Define o estado 'selected' para o seletor XML funcionar
        holder.tv.isSelected = (cat == selected)

        holder.tv.setOnClickListener {
            if (cat == selected) return@setOnClickListener
            val prev = selected
            selected = cat
            notifyDataSetChanged() 
            onSelect(cat)
        }

        // Efeito de escala e elevação para TV
        holder.tv.setOnFocusChangeListener { view, hasFocus ->
            view.scaleX = if (hasFocus) 1.1f else 1.0f
            view.scaleY = if (hasFocus) 1.1f else 1.0f
            view.translationZ = if (hasFocus) 8f else 0f
            if (hasFocus) {
                // Ao focar na categoria, já podemos mostrar os canais dela (opcional)
                // onSelect(cat) 
            }
        }
    }

    fun setSelected(cat: String) {
        selected = cat
        notifyDataSetChanged()
    }

    override fun getItemCount() = categories.size
}
