package com.example.bluetv

object M3UParser {

    fun parse(content: String): List<Channel> {
        val channels = mutableListOf<Channel>()
        val lines = content.lines()
        var i = 0
        while (i < lines.size) {
            val line = lines[i].trim()
            if (line.startsWith("#EXTINF")) {
                val name = extractName(line)
                val logo = extractAttr(line, "tvg-logo")
                val group = extractAttr(line, "group-title")
                val id = extractAttr(line, "tvg-id")
                val url = if (i + 1 < lines.size) lines[i + 1].trim() else ""
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

    // Agrupa canais SD/HD/FHD/UHD do mesmo canal em um só
    fun groupByQuality(channels: List<Channel>): List<Channel> {
        val seen = mutableMapOf<String, Channel>()
        val qualityRegex = Regex("""\s*(SD|HD|FHD|UHD|4K|\d{3,4}p)\s*$""", RegexOption.IGNORE_CASE)
        for (ch in channels) {
            val baseName = ch.name.replace(qualityRegex, "").trim()
            val existing = seen[baseName.lowercase()]
            if (existing == null) {
                seen[baseName.lowercase()] = ch.copy(name = baseName)
            } else {
                // Prefere HD > SD
                val existingQuality = getQualityScore(existing.name + " " + ch.name)
                val newQuality = getQualityScore(ch.name)
                if (newQuality > existingQuality) {
                    seen[baseName.lowercase()] = ch.copy(name = baseName)
                }
            }
        }
        return seen.values.toList()
    }

    private fun getQualityScore(name: String): Int {
        val upper = name.uppercase()
        return when {
            upper.contains("4K") || upper.contains("UHD") -> 4
            upper.contains("FHD") || upper.contains("1080") -> 3
            upper.contains("HD") || upper.contains("720") -> 2
            upper.contains("SD") -> 1
            else -> 2
        }
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
