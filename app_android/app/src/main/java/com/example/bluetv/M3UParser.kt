package com.example.bluetv

object M3UParser {

    private val qualityRegex = Regex(
        """\s*(4K|UHD|FHD|1080[pi]?|HD|720[pi]?|SD|480[pi]?)\s*$""",
        RegexOption.IGNORE_CASE
    )

    fun parse(content: String): List<Channel> {
        val channels = mutableListOf<Channel>()
        val lines = content.lines()
        var i = 0
        while (i < lines.size) {
            val line = lines[i].trim()
            if (line.startsWith("#EXTINF")) {
                val name  = extractName(line)
                val logo  = extractAttr(line, "tvg-logo")
                val group = extractAttr(line, "group-title")
                val id    = extractAttr(line, "tvg-id")
                val url   = if (i + 1 < lines.size) lines[i + 1].trim() else ""
                if (url.isNotEmpty() && !url.startsWith("#")) {
                    channels.add(Channel(id, name, url, logo, group))
                }
                i += 2
            } else {
                i++
            }
        }
        return channels
    }

    /**
     * Agrupa canais com mesmo nome base (ex: "Premiere 1 HD", "Premiere 1 SD", "Premiere 1 UHD")
     * em um único Channel, mantendo TODAS as qualidades em qualityUrls.
     * A URL principal fica sendo a de maior qualidade.
     */
    fun groupByQuality(channels: List<Channel>): List<Channel> {
        // key = nome base lowercase -> acumula qualidades
        data class Entry(
            val baseName: String,
            val logo: String,
            val group: String,
            val id: String,
            val qualities: MutableMap<String, String> = mutableMapOf()
        )

        val entries = linkedMapOf<String, Entry>()

        for (ch in channels) {
            val rawQuality = qualityRegex.find(ch.name)?.groupValues?.get(1)?.uppercase() ?: "HD"
            val baseName = ch.name.replace(qualityRegex, "").trim()
            val key = baseName.lowercase()

            val entry = entries.getOrPut(key) {
                Entry(baseName, ch.logo, ch.group, ch.id)
            }
            // Se essa qualidade ainda não está registrada, adiciona
            entry.qualities[rawQuality] = ch.url
        }

        // Converter para Channel — URL principal = melhor qualidade
        return entries.values.map { entry ->
            val bestUrl = getBestUrl(entry.qualities)
            Channel(
                id          = entry.id,
                name        = entry.baseName,
                url         = bestUrl,
                logo        = entry.logo,
                group       = entry.group,
                qualityUrls = entry.qualities.toMap()
            )
        }
    }

    private fun getBestUrl(qualities: Map<String, String>): String {
        val order = listOf("UHD", "4K", "FHD", "1080", "HD", "720", "SD", "480")
        for (q in order) {
            val match = qualities.entries.firstOrNull { it.key.uppercase().contains(q) }
            if (match != null) return match.value
        }
        return qualities.values.first()
    }

    private fun extractName(line: String): String {
        val comma = line.lastIndexOf(',')
        return if (comma >= 0) line.substring(comma + 1).trim() else "Canal"
    }

    private fun extractAttr(line: String, attr: String): String {
        val regex = Regex("""$attr="([^"]*)"""")
        return regex.find(line)?.groupValues?.get(1) ?: ""
    }
}
