#include "render/shared/bmsx_font.h"
#include "render/shared/glyph_runs.h"
#include <array>
#include <iostream>
#include <stdexcept>

int main() {
	using namespace bmsx;
	for (const auto variant : {FontVariant::Msx, FontVariant::Tiny}) {
		Font font(variant);
		GlyphRenderSubmission submission;
		submission.x = 11;
		submission.y = 17;
		submission.items = {"_A\tB\nC_"};
		submission.item_start = 1;
		submission.item_end = 6;
		submission.font = &font;
		const std::array<std::array<f32, 2>, 3> expected{{
			{11, 17},
			{11.0F + font.advance('A') + TAB_SPACES * font.advance(' '), 17},
			{11, 17.0F + font.lineHeight()},
		}};
		std::size_t index = 0;
		forEachBatchBlitGlyph(submission, index, [&](std::size_t& glyphIndex, const FontGlyph& glyph, f32 x, f32 y) {
			if (glyphIndex >= expected.size() || x != expected[glyphIndex][0] || y != expected[glyphIndex][1]) {
				throw std::runtime_error("glyph range must use top-left coordinates and explicit tab/newline advances");
			}
			if (&glyph != &font.getGlyph('A' + static_cast<u32>(glyphIndex))) {
				throw std::runtime_error("glyph range emitted the wrong character");
			}
			++glyphIndex;
		});
		if (index != expected.size()) throw std::runtime_error("glyph range emitted the wrong number of glyphs");
	}
	std::cout << "GLYPH-RUNS:PASS\n";
}
