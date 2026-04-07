package com.example.bluetv

object M3UParser {

    // Sufixos de qualidade: FHD², HD², SD², 4K, UHD, etc. (² = U+00B2)
    private val sufRe = Regex(
        """[\s\-_]*(4K|UHD|FHD|1080[pi]?|HD|720[pi]?|SD|480[pi]?)[\u00B2\u00B3]?\s*$""",
        RegexOption.IGNORE_CASE
    )

    /**
     * Agrupa canais com mesmo nome base (ex: "Premiere 1 FHD²", "Premiere 1 HD²", "Premiere 1 SD²")
     * e mantém apenas a versão de maior qualidade.
     */
    fun fuseChannels(list: List<Channel>): List<Channel> {
        fun rank(name: String): Int {
            val m = sufRe.find(name) ?: return 0
            return when (m.groupValues[1].uppercase().take(3)) {
                "4K", "UHD" -> 5
                "FHD", "108" -> 4
                "HD",  "720" -> 3
                "SD",  "480" -> 2
                else         -> 1
            }
        }

        fun base(name: String) = sufRe.replace(name, "").trim()

        // chave: base name → Pair(channel_com_nome_base, melhor_rank)
        val best = LinkedHashMap<String, Pair<Channel, Int>>()
        for (ch in list) {
            val b = base(ch.name)
            val r = rank(ch.name)
            val cur = best[b]
            if (cur == null || r > cur.second) {
                best[b] = Pair(ch.copy(name = b), r)
            }
        }
        return best.values.map { it.first }
    }

    // ── M3U parser (mantido para compatibilidade) ──────────────────────────

    fun parse(content: String): List<Channel> {
        val raw = mutableListOf<Channel>()
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
        val e = line.indexOf("\"", vs)
        if (e == -1) return ""
        return line.substring(vs, e)
    }
}
