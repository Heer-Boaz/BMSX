#pragma once

#include "render/shared/bitmap_font.h"
#include "render/shared/submissions.h"
#include "common/utf8.h"

namespace bmsx {

template<typename Fn>
void forEachGlyphRunGlyph(const GlyphRenderSubmission& submission, Fn&& fn) {
	BFont& font = *submission.font;
	const i32 start = submission.glyph_start;
	const i32 end = submission.glyph_end;
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
			fn(glyph, x, y, submission.z, submission.color);
			x += static_cast<f32>(glyph.advance);
			glyphIndex += 1;
		}
		y += static_cast<f32>(font.lineHeight());
	}
}

} // namespace bmsx
