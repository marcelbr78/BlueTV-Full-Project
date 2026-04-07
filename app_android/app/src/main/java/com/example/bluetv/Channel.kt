package com.example.bluetv

data class Channel(
    val id: String,
    val name: String,
    val url: String,
    val logo: String,
    val group: String,
    val streamId: String = "",
    val qualityUrls: Map<String, String> = emptyMap(),
    var epgTitle: String = "",
    var epgStart: Long = 0,
    var epgEnd: Long = 0,
    var epgDesc: String = "",
    var year: String = "" // Ano de lançamento para VOD
) {
    fun getEpgProgress(): Int {
        if (epgStart == 0L || epgEnd == 0L) return 0
        val now = System.currentTimeMillis() / 1000
        if (now < epgStart) return 0
        if (now > epgEnd) return 100
        val total = epgEnd - epgStart
        val passed = now - epgStart
        return ((passed.toDouble() / total.toDouble()) * 100).toInt()
    }

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
