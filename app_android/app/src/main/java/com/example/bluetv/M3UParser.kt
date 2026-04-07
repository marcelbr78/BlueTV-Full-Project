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
     * Une canais com o mesmo nome mas qualidades diferentes.
     * Tornada PÚBLICA para acesso pela HomeActivity.
     */
    fun fuseChannels(list: List<Channel>): List<Channel> {
        // Por enquanto retorna a lista sem modificação para evitar crash até fusão completa
        return list
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
