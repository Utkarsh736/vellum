package app.vellum.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable

/**
 * App theme: **static** Paper Design tokens (no dynamicColorScheme — the
 * spec mandates deterministic brand colors), switching only on light/dark.
 */
@Composable
fun VellumTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) PaperDarkColors else PaperLightColors,
        typography = PaperTypography,
        content = content,
    )
}
