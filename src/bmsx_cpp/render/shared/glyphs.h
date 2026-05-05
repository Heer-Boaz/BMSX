/*
 * glyphs.h - Glyph rendering utilities
 */

#ifndef BMSX_GLYPHS_H
#define BMSX_GLYPHS_H

#include "submissions.h"
#include "core/font.h"
#include "core/utf8.h"
#include <string>
#include <utility>
#include <vector>

namespace bmsx {

class GameView;

template<typename Fn>
void forEachGlyphImage(const GlyphRenderSubmission& submission, Fn&& fn) {
	BFont& font = *submission.font;
	const i32 start = *submission.glyph_start;
	const i32 end = *submission.glyph_end;
	const f32 z = *submission.z;
	const Color& color = *submission.color;
	f32 y = submission.y;
	for (const std::string& line : submission.glyphs) {
		f32 x = submission.x;
		size_t byteIndex = 0;
		i32 glyphIndex = 0;
		while (byteIndex < line.size()) {
			const u32 codepoint = readUtf8Codepoint(line, byteIndex);
			if (glyphIndex >= end) {
				break;
			}
			if (glyphIndex < start) {
				glyphIndex += 1;
				continue;
			}
			if (codepoint == '\n') {
				x = submission.x;
				y += static_cast<f32>(font.lineHeight());
				glyphIndex += 1;
				continue;
			}
			if (codepoint == '\t') {
				x += static_cast<f32>(font.advance(' ') * TAB_SPACES);
				glyphIndex += 1;
				continue;
			}
			const FontGlyph& glyph = font.getGlyph(codepoint);
			fn(glyph, x, y, z, color);
			x += static_cast<f32>(glyph.advance);
			glyphIndex += 1;
		}
		y += static_cast<f32>(font.lineHeight());
	}
}
f32 calculateCenteredBlockX(const std::vector<std::string>& lines, i32 charWidth, i32 blockWidth);
std::vector<std::string> wrapGlyphs(const std::string& text, i32 maxLineLength);

} // namespace bmsx

#endif // BMSX_GLYPHS_H
