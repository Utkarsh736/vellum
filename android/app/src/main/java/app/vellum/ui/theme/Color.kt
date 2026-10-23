package app.vellum.ui.theme

import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.graphics.Color

/**
 * Paper Design tokens as *static* Material 3 color schemes.
 *
 * The product spec forbids dynamic color (wallpaper-derived palettes): the
 * brand look must be identical on every device. Light and dark are logical
 * inverses of the same palette.
 *
 * Contrast (WCAG 2.2 AA, verified):
 *  - light: onSurface #111111 on surface #FFFFFF ≈ 18:1; secondary #6D28D9
 *    on white ≈ 6.6:1; error #B91C1C on white ≈ 5.9:1
 *  - dark : onSurface #F4F4F5 on surface #141417 ≈ 15:1; secondary #A78BFA
 *    on #141417 ≈ 6.4:1; error #F87171 on #141417 ≈ 6.0:1
 */
val PaperLightColors = lightColorScheme(
    primary = Color(0xFF111111),          // Paper Primary (ink)
    onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFE8E8EA),
    onPrimaryContainer = Color(0xFF111111),
    secondary = Color(0xFF6D28D9),        // text-safe violet
    onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFEDE9FE),
    onSecondaryContainer = Color(0xFF4C1D95),
    tertiary = Color(0xFF047857),
    onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFD1FAE5),
    onTertiaryContainer = Color(0xFF064E3B),
    background = Color(0xFFF7F7F8),
    onBackground = Color(0xFF111111),
    surface = Color(0xFFFFFFFF),
    onSurface = Color(0xFF111111),
    surfaceVariant = Color(0xFFF0F0F2),
    onSurfaceVariant = Color(0xFF52525B), // 7:1 on surfaceVariant
    surfaceContainer = Color(0xFFFFFFFF),
    surfaceContainerHigh = Color(0xFFF5F5F7),
    outline = Color(0xFF71717A),
    outlineVariant = Color(0xFFE5E7EB),
    error = Color(0xFFB91C1C),            // Paper Danger, AA-safe
    onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFEE2E2),
    onErrorContainer = Color(0xFF7F1D1D),
)

val PaperDarkColors = darkColorScheme(
    primary = Color(0xFFF4F4F5),          // inverted Paper Primary
    onPrimary = Color(0xFF111111),
    primaryContainer = Color(0xFF26262B),
    onPrimaryContainer = Color(0xFFF4F4F5),
    secondary = Color(0xFFA78BFA),        // lighter violet for dark surfaces
    onSecondary = Color(0xFF141417),
    secondaryContainer = Color(0xFF2E1E5E),
    onSecondaryContainer = Color(0xFFEDE9FE),
    tertiary = Color(0xFF34D399),
    onTertiary = Color(0xFF062B21),
    tertiaryContainer = Color(0xFF0C3B2E),
    onTertiaryContainer = Color(0xFFD1FAE5),
    background = Color(0xFF0B0B0D),
    onBackground = Color(0xFFF4F4F5),
    surface = Color(0xFF141417),
    onSurface = Color(0xFFF4F4F5),
    surfaceVariant = Color(0xFF1D1D22),
    onSurfaceVariant = Color(0xFFA1A1AA),
    surfaceContainer = Color(0xFF1B1B20),
    surfaceContainerHigh = Color(0xFF222227),
    outline = Color(0xFF8B8B94),
    outlineVariant = Color(0xFF26262B),
    error = Color(0xFFF87171),            // Paper Danger, dark-mode tuned
    onError = Color(0xFF210505),
    errorContainer = Color(0xFF3A1414),
    onErrorContainer = Color(0xFFFECACA),
)

/** Paper Secondary #8B5CF6 — fills, progress bars, badges (non-text). */
val PaperViolet = Color(0xFF8B5CF6)
