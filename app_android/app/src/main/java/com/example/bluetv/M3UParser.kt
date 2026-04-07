package com.example.bluetv

import java.util.Locale

object M3UParser {

    private val qualityRegex = Regex(
        """\s*(4K|UHD|FHD|1080[pi]?|HD|720[pi]?|SD|480[pi]?)\s*$""",
        RegexOption.IGNORE_CASE
    )

    private val QUALITY_ORDER = listOf("UHD", "4K", "FHD", "1080", "HD", "720", "SD", "480")

    fun parse(content: String): List<Channel> {
        val rawChannels = mutableListOf<Channel>()
        val lines = content.lines()
        var i = 0
        while (i < lines.size) {
            val line = lines[i].trim()
            if (line.startsWith("#EXTINF")) {
                val name  = extractName(line)
                val logo  = extractAttr(line, "tvg-logo")
                val group = extractAttr(line, "group-title")
                val id    = extractAttr(line, "tvg-id")
                
                var nextLineIndex = i + 1
                while (nextLineIndex < lines.size && (lines[nextLineIndex].isBlank() || lines[nextLineIndex].startsWith("#"))) {
                    nextLineIndex++
                }
                
                if (nextLineIndex < lines.size) {
                    val url = lines[nextLineIndex].trim()
                    if (url.isNotEmpty()) {
                        rawChannels.add(Channel(id, name, url, logo, group))
                    }
                    i = nextLineIndex + 1
                } else { i++ }
            } else { i++ }
        }
        
        return fuseChannels(rawChannels)
    }

    /**
     * Une canais com o mesmo nome mas qualidades diferentes em um único objeto.
     * Estilo Netflix: O usuário vê apenas um canal, o app gere a qualidade.
     */
    fun fuseChannels(channels: List<Channel>): List<Channel> {
        val entries = LinkedHashMap<String, MutableMap<String, String>>()
        val metadata = mutableMapOf<String, Triple<String, String, String>>() // Key -> Name, Logo, Group

        for (ch in channels) {
            val match = qualityRegex.find(ch.name)
            val baseName = if (match != null) ch.name.substring(0, match.range.first).trim() else ch.name
            val quality = match?.groupValues?.get(1)?.uppercase(Locale.ROOT) ?: "HD"
            val key = baseName.lowercase(Locale.ROOT) + "_" + ch.group.lowercase(Locale.ROOT)

            val qualities = entries.getOrPut(key) { mutableMapOf() }
            qualities[quality] = ch.url
            metadata[key] = Triple(baseName, ch.logo, ch.group)
        }

        return entries.map { (key, qualities) ->
            val meta = metadata[key]!!
            val bestUrl = getBestUrl(qualities)
            Channel(
                id = key,
                name = meta.first,
                url = bestUrl,
                logo = meta.second,
                group = meta.third,
                qualityUrls = qualities.toMap()
            )
        }
    }

    private fun getBestUrl(qualities: Map<String, String>): String {
        for (q in QUALITY_ORDER) {
            val match = qualities.entries.firstOrNull { it.key.contains(q, ignoreCase = true) }
            if (match != null) return match.value
        }
        return qualities.values.firstOrNull() ?: ""
    }

    private fun extractName(line: String): String {
        val comma = line.lastIndexOf(',')
        return if (comma >= 0) line.substring(comma + 1).trim() else "Canal"
    }

    private fun extractAttr(line: String, attr: String): String {
        val key = "$attr=\""
        val start = line.indexOf(key)
        if (start == -1) return ""
        val valueStart = start + key.length
        val end = line.indexOf("\"", valueStart)
        if (end == -1) return ""
        return line.substring(valueStart, end)
    }
}
