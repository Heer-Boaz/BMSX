/*
 * font.h - Bitmap font support
 */

#ifndef BMSX_FONT_H
#define BMSX_FONT_H

#include "rompack/assets.h"
#include "primitives.h"
#include <string>
#include <unordered_map>

namespace bmsx {

using GlyphMap = std::unordered_map<u32, std::string>;

struct FontGlyph {
	std::string imgid;
	ImageAtlasRect rect;
	i32 width = 0;
	i32 height = 0;
	i32 advance = 0;
};

constexpr int TAB_SPACES = 2;

class BFont {
public:
	explicit BFont(RuntimeAssets& assets, i32 advancePadding = 0);
	BFont(RuntimeAssets& assets, GlyphMap glyphmap, i32 advancePadding = 0);

	i32 char_width(char c);
	i32 char_height(char c);
	i32 char_width(u32 codepoint);
	i32 char_height(u32 codepoint);

	const std::string& char_to_img(u32 codepoint) const;
	const FontGlyph& getGlyph(u32 codepoint);

	i32 advance(char c);
	i32 advance(u32 codepoint);

	i32 lineHeight() const { return m_line_height; }
	const GlyphMap& glyphMap() const { return m_letter_to_img; }
	i32 advancePadding() const { return m_advance_padding; }
	i32 measure(const std::string& text);

private:
	RuntimeAssets& m_assets;
	GlyphMap m_letter_to_img;
	std::unordered_map<u32, FontGlyph> m_glyphs;
	i32 m_advance_padding = 0;
	i32 m_line_height = 0;
};

GlyphMap buildKonamiGlyphMap();

} // namespace bmsx

#endif // BMSX_FONT_H
