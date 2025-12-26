/*
 * glyphs.h - Glyph rendering utilities
 *
 * Mirrors TypeScript render/glyphs.ts.
 */

#ifndef BMSX_GLYPHS_H
#define BMSX_GLYPHS_H

#include "render_types.h"
#include <string>
#include <vector>

namespace bmsx {

class BFont;
class GameView;

void renderGlyphs(GameView* view,
                  f32 x,
                  f32 y,
                  const std::vector<std::string>& lines,
                  std::optional<i32> start,
                  std::optional<i32> end,
                  f32 z,
                  BFont* font,
                  const std::optional<Color>& color,
                  const std::optional<Color>& backgroundColor,
                  const std::optional<RenderLayer>& layer);
f32 calculateCenteredBlockX(const std::vector<std::string>& lines, i32 charWidth, i32 blockWidth);
std::vector<std::string> wrapGlyphs(const std::string& text, i32 maxLineLength);

} // namespace bmsx

#endif // BMSX_GLYPHS_H
