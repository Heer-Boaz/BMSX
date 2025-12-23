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

void renderGlyphs(GameView* view, const GlyphRenderSubmission& submission, BFont* font);
f32 calculateCenteredBlockX(const std::vector<std::string>& lines, i32 charWidth, i32 blockWidth);
std::vector<std::string> wrapGlyphs(const std::string& text, i32 maxLineLength);

} // namespace bmsx

#endif // BMSX_GLYPHS_H
