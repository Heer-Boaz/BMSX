#pragma once

#include "render/shared/bitmap_font.h"
#include "render/shared/submissions.h"
#include "common/utf8.h"

namespace bmsx {

template<typename Fn>
void forEachBatchBlitGlyph(const GlyphRenderSubmission& submission, Fn&& fn) {
	BFont& font = *submission.font;
	const i32 start = submission.item_start;
	const i32 end = submission.item_end;
	f32 y = submission.y;
	for (const std::string& line : submission.items) {
		f32 x = submission.x;
		size_t byteIndex = 0;
		i32 itemIndex = 0;
		while (byteIndex < line.size()) {
			const u32 codepoint = readUtf8Codepoint(line, byteIndex);
			if (itemIndex >= end) {
				break;
			}
			if (itemIndex < start) {
				itemIndex += 1;
				continue;
			}
			if (codepoint == '\n') {
				x = submission.x;
				y += static_cast<f32>(font.lineHeight());
				itemIndex += 1;
				continue;
			}
			if (codepoint == '\t') {
				x += static_cast<f32>(font.advance(' ') * TAB_SPACES);
				itemIndex += 1;
				continue;
			}
			const FontGlyph& item = font.getGlyph(codepoint);
			fn(item, x, y, submission.z, submission.color);
			x += static_cast<f32>(item.advance);
			itemIndex += 1;
		}
		y += static_cast<f32>(font.lineHeight());
	}
}

} // namespace bmsx
