/*
 * font.cpp - Bitmap font support
 */

#include "render/shared/bitmap_font.h"
#include "common/utf8.h"
#include <utility>

namespace bmsx {
BFont::BFont(const BitmapFontSource& source, GlyphMap itemmap, f32 advancePadding, FontRendering rendering)
	: atlas(source.atlas())
	, sampling(rendering.raster == FontRaster::Msdf ? FontSampling::Linear : rendering.sampling)
	, raster(rendering.raster)
	, distanceRange(rendering.distanceRange)
	, m_source(source)
	, m_letter_to_img(std::move(itemmap))
	, m_advance_padding(advancePadding) {
	m_line_height = raster == FontRaster::Msdf ? rendering.lineHeight : char_height('A');
}

f32 BFont::char_width(char c) {
	return char_width(static_cast<u32>(static_cast<unsigned char>(c)));
}

f32 BFont::char_height(char c) {
	return char_height(static_cast<u32>(static_cast<unsigned char>(c)));
}

f32 BFont::char_width(u32 codepoint) {
	return getGlyph(codepoint).width;
}

f32 BFont::char_height(u32 codepoint) {
	return getGlyph(codepoint).height;
}

const std::string& BFont::char_to_img(u32 codepoint) const {
	auto it = m_letter_to_img.find(codepoint);
	if (it != m_letter_to_img.end()) {
		return it->second;
	}
	return m_letter_to_img.at(static_cast<u32>('?'));
}

const FontGlyph& BFont::getGlyph(u32 codepoint) {
	const auto bound = m_characters.find(codepoint);
	if (bound != m_characters.end()) return m_glyphs[bound->second];
	const auto binding = m_letter_to_img.find(codepoint);
	if (binding == m_letter_to_img.end() && codepoint == static_cast<u32>('\t')) {
		const FontGlyph& space = getGlyph(static_cast<u32>(' '));
		FontGlyph item;
		item.imgid = space.imgid;
		item.rect = space.rect;
		item.width = space.advance * TAB_SPACES;
		item.height = space.height;
		item.advance = item.width;
		item.offsetX = space.offsetX;
		item.offsetY = space.offsetY;
		m_characters.emplace(codepoint, m_glyphs.size());
		m_glyphs.push_back(std::move(item));
		return m_glyphs.back();
	}

	if (binding == m_letter_to_img.end()) return m_glyphs[resolveGlyph(m_letter_to_img.at(static_cast<u32>('?')))];
	const size_t index = resolveGlyph(binding->second);
	m_characters.emplace(codepoint, index);
	return m_glyphs[index];
}

size_t BFont::resolveGlyph(const std::string& imgid) {
	const auto found = m_image_glyphs.find(imgid);
	if (found != m_image_glyphs.end()) return found->second;
	const BitmapFontSourceGlyph sourceGlyph = m_source.resolveGlyph(imgid);
	FontGlyph item;
	item.imgid = imgid;
	item.rect = ImageAtlasRect{ sourceGlyph.u, sourceGlyph.v, sourceGlyph.w, sourceGlyph.h };
	item.width = sourceGlyph.width;
	item.height = sourceGlyph.height;
	item.advance = sourceGlyph.advance + m_advance_padding;
	item.offsetX = sourceGlyph.offsetX;
	item.offsetY = sourceGlyph.offsetY;

	const size_t index = m_glyphs.size();
	m_image_glyphs.emplace(imgid, index);
	m_glyphs.push_back(std::move(item));
	return index;
}

f32 BFont::advance(char c) {
	return advance(static_cast<u32>(static_cast<unsigned char>(c)));
}

f32 BFont::advance(u32 codepoint) {
	return getGlyph(codepoint).advance;
}

f32 BFont::measure(const std::string& text) {
	f32 width = 0;
	size_t index = 0;
	while (index < text.size()) {
		u32 codepoint = readUtf8Codepoint(text, index);
		if (codepoint == static_cast<u32>('\n')) {
			continue;
		}
		width += advance(codepoint);
	}
	return width;
}

} // namespace bmsx
