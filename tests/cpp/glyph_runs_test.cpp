#include "render/shared/bmsx_font.h"
#include "render/shared/glyph_runs.h"
#include "render/host_overlay/atlas.h"
#include <array>
#include <cstdlib>
#include <iostream>
#include <new>
#include <stdexcept>

namespace {
size_t allocations = 0;
}

// The font lookup contract includes no allocations for unsupported text once
// the shared missing glyph is resident. Observe the allocator only in this test.
void* operator new(std::size_t size) {
	++allocations;
	if (void* memory = std::malloc(size)) return memory;
	throw std::bad_alloc();
}
void operator delete(void* memory) noexcept { std::free(memory); }
void operator delete(void* memory, std::size_t) noexcept { std::free(memory); }

namespace {

class CountingFontSource final : public bmsx::BitmapFontSource {
	const std::array<bmsx::u8, 4> pixels{255, 255, 255, 255};
	const bmsx::HostAtlas image{1, 1, pixels, false};
public:
	mutable std::unordered_map<std::string, size_t> resolutions;
	const bmsx::HostAtlas& atlas() const override { return image; }
	bmsx::BitmapFontSourceGlyph resolveGlyph(const std::string& id) const override {
		++resolutions[id];
		return {1, 2, 3, -0.5F, 0.25F, 0, 0, 1, 1};
	}
};

void testGlyphStorage() {
	using namespace bmsx;
	for (const FontRendering mode : {FontRendering{}, FontRendering{FontRaster::Msdf, FontSampling::Linear, 4, 2}}) {
		CountingFontSource source;
		BFont font(source, {{'A', "letter"}, {'a', "letter"}, {'?', "question"}, {' ', "space"}}, 1, mode);
		const auto& upper = font.getGlyph('A');
		if (&upper != &font.getGlyph('a') || source.resolutions.at("letter") != 1)
			throw std::runtime_error("character aliases must share one resolved source glyph");
		const auto& missing = font.getGlyph('?');
		const size_t before = allocations;
		for (u32 codepoint = 0x10000; codepoint < 0x11000; ++codepoint) {
			if (&font.getGlyph(codepoint) != &missing)
				throw std::runtime_error("unsupported characters must not allocate glyph records");
		}
		if (allocations != before) throw std::runtime_error("unsupported text must not grow font resources or character indexes");
		if (source.resolutions.at("question") != 1 || font.advance('A') != 4)
			throw std::runtime_error("source resolution and advance padding belong to each unique glyph");
		const auto& space = font.getGlyph(' ');
		const auto& tab = font.getGlyph('\t');
		if (&tab == &space || &tab != &font.getGlyph('\t') || tab.advance != space.advance * TAB_SPACES
			|| tab.width != tab.advance || tab.offsetX != space.offsetX || tab.offsetY != space.offsetY || source.resolutions.at("space") != 1)
			throw std::runtime_error("synthetic tab retains its own layout without duplicating the space resource");
		BFont copy(font);
		if (&copy.getGlyph('a') == &upper || &copy.getGlyph('a') != &copy.getGlyph('A')
			|| &copy.getGlyph('\t') == &tab || copy.advance('\t') != tab.advance)
			throw std::runtime_error("copied font cache must own its records, not pointers into another font");
	}
	CountingFontSource source;
	const GlyphMap map{{'A', "letter"}, {'?', "question"}, {' ', "space"}, {'\t', "letter"}};
	BFont a(source, map), b(source, map, 2);
	if (&a.getGlyph('\t') != &a.getGlyph('A') || &a.getGlyph('A') == &b.getGlyph('A')
		|| b.advance('A') - a.advance('A') != 2 || source.resolutions.at("letter") != 2)
		throw std::runtime_error("explicit tab binding and per-font advances must survive glyph sharing");
	for (const auto variant : {FontVariant::Mono, FontVariant::Msx, FontVariant::Tiny}) {
		for (const auto style : {FontStyle::Normal, FontStyle::Italic}) {
			Font builtin(variant, style);
			std::unordered_map<std::string, const FontGlyph*> seen;
			for (const auto& [codepoint, id] : builtin.itemMap()) {
				const auto& glyph = builtin.getGlyph(codepoint);
				const auto [entry, inserted] = seen.emplace(id, &glyph);
				if (!inserted && entry->second != &glyph)
					throw std::runtime_error("built-in fonts must share source glyphs across declared character aliases");
			}
			const auto& missing = builtin.getGlyph('?');
			for (u32 codepoint = 0x10000; codepoint < 0x10100; ++codepoint) {
				if (&builtin.getGlyph(codepoint) != &missing)
					throw std::runtime_error("built-in fonts must reuse their missing glyph");
			}
		}
	}
}

} // namespace

int main() {
	using namespace bmsx;
	testGlyphStorage();
	for (const auto variant : {FontVariant::Mono, FontVariant::Msx, FontVariant::Tiny}) {
		Font font(variant);
		GlyphRenderSubmission submission;
		submission.x = 0; submission.y = 0;
		submission.items = {"_A😀\t🐉B_"};
		// Native submission ranges index decoded codepoints, not UTF-8 bytes.
		submission.item_start = 1; submission.item_end = 6; submission.font = &font;
		size_t count = 0; f32 end = 0;
		forEachBatchBlitGlyph(submission, count, [&](size_t& count, const FontGlyph& glyph, f32 x, f32) {
			end = x + glyph.advance; ++count;
		});
		if (count != 4 || std::abs(end - font.measure("A😀\t🐉B")) > 0.0001F)
			throw std::runtime_error("native measured and rendered widths must consume whole Unicode codepoints");
	}
	for (const auto variant : {FontVariant::Msx, FontVariant::Tiny}) {
		Font font(variant);
		for (const f32 phase : {0.0F, 0.25F, 0.5F, 0.75F}) {
			GlyphRenderSubmission submission;
			submission.x = 11 + phase;
			submission.y = 17 + phase;
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
	}
	std::cout << "GLYPH-RUNS:PASS\n";
}
