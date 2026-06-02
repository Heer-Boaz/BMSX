/*
 * items.h - Glyph rendering utilities
 */

#ifndef BMSX_GLYPHS_H
#define BMSX_GLYPHS_H

#include "common/primitives.h"
#include <string>
#include <utility>
#include <vector>

namespace bmsx {

class GameView;

f32 calculateCenteredBlockX(const std::vector<std::string>& lines, i32 charWidth, i32 blockWidth);
std::vector<std::string> wrapGlyphs(const std::string& text, i32 maxLineLength);

} // namespace bmsx

#endif // BMSX_GLYPHS_H
