/*
 * font.h - Bitmap font support
 */

#ifndef BMSX_FONT_H
#define BMSX_FONT_H

#include "common/primitives.h"
#include <string>
#include <unordered_map>

namespace bmsx {

using GlyphMap = std::unordered_map<u32, std::string>;

struct ImageAtlasRect {
	u32 u = 0;
	u32 v = 0;
	u32 w = 0;
	u32 h = 0;
};

struct BitmapFontSourceGlyph {
	f32 width = 0;
	f32 height = 0;
	f32 advance = 0;
	f32 offsetX = 0;
	f32 offsetY = 0;
	u32 u = 0;
	u32 v = 0;
	u32 w = 0;
	u32 h = 0;
};

struct FontGlyph {
	std::string imgid;
	ImageAtlasRect rect;
	f32 width = 0;
	f32 height = 0;
	f32 advance = 0;
	f32 offsetX = 0;
	f32 offsetY = 0;
};

constexpr int TAB_SPACES = 2;
enum class FontSampling { Nearest, Linear };
enum class FontRaster { Bitmap, Msdf };
struct FontRendering {
	FontRaster raster = FontRaster::Bitmap;
	FontSampling sampling = FontSampling::Nearest;
	f32 lineHeight = 0;
	f32 distanceRange = 0;
};

class BitmapFontSource {
public:
	virtual ~BitmapFontSource() = default;
	virtual BitmapFontSourceGlyph resolveGlyph(const std::string& imgid) const = 0;
};

class BFont {
public:
	BFont(const BitmapFontSource& source, GlyphMap itemmap, f32 advancePadding = 0, FontRendering rendering = {});
	const FontSampling sampling;
	const FontRaster raster;
	const f32 distanceRange;

	f32 char_width(char c);
	f32 char_height(char c);
	f32 char_width(u32 codepoint);
	f32 char_height(u32 codepoint);

	const std::string& char_to_img(u32 codepoint) const;
	const FontGlyph& getGlyph(u32 codepoint);

	f32 advance(char c);
	f32 advance(u32 codepoint);

	f32 lineHeight() const { return m_line_height; }
	const GlyphMap& itemMap() const { return m_letter_to_img; }
	f32 advancePadding() const { return m_advance_padding; }
	f32 measure(const std::string& text);

private:
	const BitmapFontSource& m_source;
	GlyphMap m_letter_to_img;
	std::unordered_map<u32, FontGlyph> m_items;
	f32 m_advance_padding = 0;
	f32 m_line_height = 0;
};

} // namespace bmsx

#endif // BMSX_FONT_H
