package com.example.bluetv

data class Channel(
    val id: String,
    val name: String,
    val url: String,
    val logo: String,
    val group: String,
    val streamId: String = "",
    // Para múltiplas qualidades (usado pelo M3UParser)
    val qualityUrls: Map<String, String> = emptyMap(),
    // Para o Guia de Programação (EPG)
    var epgTitle: String = "",
    var epgStart: Long = 0,
    var epgEnd: Long = 0,
    var epgDesc: String = ""
) {
    /**
     * Retorna a porcentagem de conclusão do programa atual (0-100)
     */
    fun getEpgProgress(): Int {
        if (epgStart == 0L || epgEnd == 0L) return 0
        val now = System.currentTimeMillis() / 1000
        if (now < epgStart) return 0
        if (now > epgEnd) return 100
        val total = epgEnd - epgStart
        val passed = now - epgStart
        return ((passed.toDouble() / total.toDouble()) * 100).toInt()
    }

    /**
     * Retorna lista de URLs ordenadas da melhor para a pior qualidade
     */
    fun urlsByQuality(): List<Pair<String, String>> {
        if (qualityUrls.isEmpty()) return listOf("AUTO" to url)
        val order = listOf("UHD", "4K", "FHD", "1080", "HD", "720", "SD", "480")
        return qualityUrls.entries
            .sortedBy { entry ->
                val idx = order.indexOfFirst { entry.key.uppercase().contains(it) }
                if (idx == -1) order.size else idx
            }
            .map { it.key to it.value }
    }
}
