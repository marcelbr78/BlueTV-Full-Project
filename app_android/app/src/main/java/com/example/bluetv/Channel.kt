package com.example.bluetv

data class Channel(
    val id: String,
    val name: String,
    val url: String,           // URL principal (melhor qualidade disponível)
    val logo: String,
    val group: String,
    val streamId: String = "",
    // Todas as qualidades disponíveis: "UHD" -> url, "FHD" -> url, "HD" -> url, "SD" -> url
    val qualityUrls: Map<String, String> = emptyMap()
) {
    // Retorna lista de URLs ordenadas da melhor para a pior qualidade
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
