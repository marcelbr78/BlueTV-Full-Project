package com.example.bluetv

data class Channel(
    val id: String,
    val name: String,
    val url: String,
    val logo: String,
    val group: String,
    val streamId: String = ""
)
