package com.example.bluetv

/**
 * Singleton simples para passar a lista de canais para o PlayerActivity 
 * sem sobrecarregar o Intent (que tem limite de tamanho).
 */
object ChannelData {
    var currentList: List<Channel> = emptyList()
    var currentIndex: Int = 0

    fun getNext(): Channel? {
        if (currentList.isEmpty()) return null
        currentIndex = (currentIndex + 1) % currentList.size
        return currentList[currentIndex]
    }

    fun getPrev(): Channel? {
        if (currentList.isEmpty()) return null
        currentIndex = if (currentIndex - 1 < 0) currentList.size - 1 else currentIndex - 1
        return currentList[currentIndex]
    }

    fun getCurrent(): Channel? {
        if (currentList.isEmpty() || currentIndex !in currentList.indices) return null
        return currentList[currentIndex]
    }
}
