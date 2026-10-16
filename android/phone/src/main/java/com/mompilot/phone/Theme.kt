package com.mompilot.phone

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color as AndroidColor
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter

val Coral = Color(0xFFEE6549)
val CoralDark = Color(0xFFC94B32)
val Good = Color(0xFF23855B)
val Warn = Color(0xFFB7791F)
val Bad = Color(0xFFC2412D)
val AppColors = mapOf("youtube" to Color(0xFFE53935), "netflix" to Color(0xFF141414), "prime" to Color(0xFF1A98FF))

@Composable
fun MomPilotTheme(content: @Composable () -> Unit) {
    val colors = if (isSystemInDarkTheme()) {
        darkColorScheme(primary = Coral, onPrimary = Color.White, secondary = Coral)
    } else {
        lightColorScheme(
            primary = Coral, onPrimary = Color.White, secondary = CoralDark,
            background = Color(0xFFFBF6F1), surface = Color(0xFFFBF6F1), surfaceContainer = Color.White,
            surfaceContainerLow = Color.White, onSurface = Color(0xFF2B2220), onSurfaceVariant = Color(0xFF74655F),
            outlineVariant = Color(0xFFEADFD8), primaryContainer = Color(0xFFFDE7E1), onPrimaryContainer = Color(0xFF2B2220),
        )
    }
    MaterialTheme(colorScheme = colors, content = content)
}

fun qrImage(content: String, size: Int = 640): ImageBitmap {
    val matrix = QRCodeWriter().encode(content, BarcodeFormat.QR_CODE, size, size, mapOf(EncodeHintType.MARGIN to 1))
    val pixels = IntArray(size * size) { index -> if (matrix[index % size, index / size]) AndroidColor.BLACK else AndroidColor.WHITE }
    return Bitmap.createBitmap(pixels, size, size, Bitmap.Config.RGB_565).asImageBitmap()
}

/** Opens Google's QR scanner (no camera permission needed) and returns the code's text. */
fun scanQr(context: Context, onResult: (String) -> Unit, onError: (String) -> Unit) {
    val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
    GmsBarcodeScanning.getClient(context, options).startScan()
        .addOnSuccessListener { barcode -> barcode.rawValue?.let(onResult) }
        .addOnFailureListener { error -> onError(error.message ?: "Couldn’t open the scanner.") }
}
