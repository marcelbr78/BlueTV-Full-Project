package com.example.bluetv

import android.content.Context
import okhttp3.OkHttpClient
import okhttp3.Request
import java.util.regex.Pattern

object M3UParser {
    private val client = OkHttpClient()

    fun loadFromPrefs(ctx: Context): List<Map<String,String>> {
        val prefs = ctx.getSharedPreferences("bluetv", Context.MODE_PRIVATE)
        val url = prefs.getString("m3u_url", null) ?: return emptyList()
        return try {
            val req = Request.Builder().url(url).build()
            val resp = client.newCall(req).execute()
            val body = resp.body?.string() ?: ""
            parseM3U(body)
        } catch (e: Exception) {
            emptyList()
        }
    }

    fun parseM3U(text: String): List<Map<String,String>> {
        val lines = text.split('\n')
        val items = mutableListOf<Map<String,String>>()
        var name = ""
        var group = ""
        val gid = Pattern.compile("group-title=\"(.*?)\"")
        for (ln in lines) {
            val line = ln.trim()
            if (line.startsWith("#EXTINF")) {
                val parts = line.split(",")
                name = parts.last().trim()
                val m = gid.matcher(line)
                group = if (m.find()) m.group(1) else "Unknown"
            } else if (line.startsWith("http")) {
                items.add(mapOf("name" to name, "group" to group, "url" to line))
            }
        }
        return items
    }
}
