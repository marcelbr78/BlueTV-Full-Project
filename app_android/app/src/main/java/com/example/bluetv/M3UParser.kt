package com.example.bluetv

import java.util.Locale

object M3UParser {

    /**
     * Regex que reconhece sufixos de qualidade no final do nome do canal.
     * Trata: FHD², HD², SD², 4K, UHD, 1080p, 720p, 480p
     * O [\u00B2\u00B3\u00B9]? captura ² ³ ¹ (superscript comuns em provedores brasileiros)
     * O [\s\-_]* antes tolera espaço, traço ou underscore antes do sufixo
     */
    private val qualityRegex = Regex(
        """[\s\-_]*(4K|UHD|FHD|1080[pi]?|HD|720[pi]?|SD|480[pi]?)[\u00B2\u00B3\u00B9]?\s*$""",
        RegexOption.IGNORE_CASE
    )

    private val QUALITY_ORDER = listOf("UHD", "4K", "FHD", "1080", "HD", "720", "SD", "480")

    /**
     * Une variantes de qualidade do mesmo canal em um único objeto.
     * Ex: "ESPN FHD²", "ESPN HD²", "ESPN SD²" → "ESPN" com qualityUrls = {FHD→url1, HD→url2, SD→url3}
     * URL principal = melhor qualidade disponível.
     *
     * Chave de agrupamento: apenas o nome base (sem grupo), pois variantes do mesmo canal
     * podem estar em grupos ligeiramente diferentes ("Esportes Premium" vs "Esportes HD").
     */
    fun fuseChannels(channels: List<Channel>): List<Channel> {
        // key → mutableMap<qualityTag, url>
        val urlsMap  = LinkedHashMap<String, MutableMap<String, String>>()
        // key → canal de maior qualidade (para metadados: nome, logo, grupo)
        val bestChan = LinkedHashMap<String, Pair<Channel, Int>>()

        for (ch in channels) {
            val match    = qualityRegex.find(ch.name)
            val baseName = if (match != null) ch.name.substring(0, match.range.first).trim() else ch.name
            val qualTag  = match?.groupValues?.get(1)?.uppercase(Locale.ROOT) ?: "AUTO"
            val rank     = rankOf(qualTag)

            // Chave = nome base normalizado (sem grupo, para fundir cross-grupo)
            val key = baseName.lowercase(Locale.ROOT).trim()

            urlsMap.getOrPut(key) { mutableMapOf() }[qualTag] = ch.url

            val cur = bestChan[key]
            if (cur == null || rank < cur.second) {          // menor índice = maior qualidade
                bestChan[key] = Pair(ch.copy(name = baseName), rank)
            }
        }

        return bestChan.map { (key, pair) ->
            val ch       = pair.first
            val qualities = urlsMap[key] ?: emptyMap()
            val bestUrl  = getBestUrl(qualities)
            ch.copy(url = bestUrl, qualityUrls = qualities.toMap())
        }
    }

    /** Retorna o índice de prioridade (menor = melhor) */
    private fun rankOf(quality: String): Int {
        QUALITY_ORDER.forEachIndexed { i, q -> if (quality.contains(q, ignoreCase = true)) return i }
        return QUALITY_ORDER.size
    }

    private fun getBestUrl(qualities: Map<String, String>): String {
        for (q in QUALITY_ORDER) {
            val match = qualities.entries.firstOrNull { it.key.contains(q, ignoreCase = true) }
            if (match != null) return match.value
        }
        return qualities.values.firstOrNull() ?: ""
    }

    // ── Parser M3U (mantido para compatibilidade) ──────────────────

    fun parse(content: String): List<Channel> {
        val raw   = mutableListOf<Channel>()
        val lines = content.lines()
        var i = 0
        while (i < lines.size) {
            val line = lines[i].trim()
            if (line.startsWith("#EXTINF")) {
                val name  = extractName(line)
                val logo  = extractAttr(line, "tvg-logo")
                val group = extractAttr(line, "group-title")
                val id    = extractAttr(line, "tvg-id")
                var next  = i + 1
                while (next < lines.size && (lines[next].isBlank() || lines[next].startsWith("#"))) next++
                if (next < lines.size) {
                    val url = lines[next].trim()
                    if (url.isNotEmpty()) raw.add(Channel(id, name, url, logo, group))
                    i = next + 1
                } else i++
            } else i++
        }
        return fuseChannels(raw)
    }

    private fun extractName(line: String): String {
        val c = line.lastIndexOf(',')
        return if (c >= 0) line.substring(c + 1).trim() else "Canal"
    }

    private fun extractAttr(line: String, attr: String): String {
        val key = "$attr=\""
        val s = line.indexOf(key)
        if (s == -1) return ""
        val vs = s + key.length
        val e  = line.indexOf("\"", vs)
        if (e == -1) return ""
        return line.substring(vs, e)
    }
}
