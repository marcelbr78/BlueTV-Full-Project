package com.example.bluetv

import android.content.Context
import android.content.SharedPreferences

object ProgressManager {
    private const val PREF_NAME = "bluetv_progress"

    private fun getPrefs(context: Context): SharedPreferences {
        return context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
    }

    /**
     * Salva o progresso de um vídeo (em milissegundos).
     * @param streamId O ID único do filme ou episódio.
     * @param position A posição atual em milissegundos.
     */
    fun saveProgress(context: Context, streamId: String, position: Long) {
        if (streamId.isEmpty()) return
        getPrefs(context).edit().putLong("pos_$streamId", position).apply()
    }

    /**
     * Retorna o progresso salvo para um vídeo.
     * @return Posição em milissegundos ou 0 se não houver.
     */
    fun getProgress(context: Context, streamId: String): Long {
        if (streamId.isEmpty()) return 0L
        return getPrefs(context).getLong("pos_$streamId", 0L)
    }

    /**
     * Limpa o progresso (ex: quando o filme termina).
     */
    fun clearProgress(context: Context, streamId: String) {
        getPrefs(context).edit().remove("pos_$streamId").apply()
    }
}
