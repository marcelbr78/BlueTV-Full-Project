package com.example.bluetv

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.util.AttributeSet
import android.view.View
import kotlin.math.sin
import kotlin.random.Random

class StarfieldView @JvmOverloads constructor(
    context: Context, attrs: AttributeSet? = null
) : View(context, attrs) {

    private data class Star(var x: Float, var y: Float, val r: Float, val speed: Float, val phase: Float)

    private val stars = mutableListOf<Star>()
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
    private var tick = 0f
    private var initialized = false

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        if (!initialized && w > 0 && h > 0) {
            stars.clear()
            repeat(120) {
                stars.add(Star(
                    x = Random.nextFloat() * w,
                    y = Random.nextFloat() * h,
                    r = Random.nextFloat() * 1.8f + 0.4f,
                    speed = Random.nextFloat() * 0.02f + 0.005f,
                    phase = Random.nextFloat() * Math.PI.toFloat() * 2
                ))
            }
            initialized = true
        }
    }

    override fun onDraw(canvas: Canvas) {
        tick += 0.04f
        for (star in stars) {
            val alpha = ((sin((tick * star.speed * 30 + star.phase).toDouble()) + 1) / 2 * 200 + 55).toInt()
            paint.alpha = alpha
            canvas.drawCircle(star.x, star.y, star.r, paint)
        }
        postInvalidateDelayed(50)
    }
}
