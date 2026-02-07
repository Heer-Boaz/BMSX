/*
 * font.cpp - Bitmap font support
 */

#include "font.h"
#include <iostream>
#include <stdexcept>

namespace bmsx {
namespace {

u32 readUtf8Codepoint(const std::string& text, size_t& index) {
	u8 c0 = static_cast<u8>(text.at(index++));
	if (c0 < 0x80) {
		return c0;
	}
	if ((c0 & 0xE0) == 0xC0) {
		u8 c1 = static_cast<u8>(text.at(index++));
		return ((c0 & 0x1F) << 6) | (c1 & 0x3F);
	}
	if ((c0 & 0xF0) == 0xE0) {
		u8 c1 = static_cast<u8>(text.at(index++));
		u8 c2 = static_cast<u8>(text.at(index++));
		return ((c0 & 0x0F) << 12) | ((c1 & 0x3F) << 6) | (c2 & 0x3F);
	}
	u8 c1 = static_cast<u8>(text.at(index++));
	u8 c2 = static_cast<u8>(text.at(index++));
	u8 c3 = static_cast<u8>(text.at(index++));
	return ((c0 & 0x07) << 18) | ((c1 & 0x3F) << 12) | ((c2 & 0x3F) << 6) | (c3 & 0x3F);
}

} // namespace

GlyphMap buildKonamiGlyphMap() {
	GlyphMap map;

	map[static_cast<u32>('0')] = "letter_0";
	map[static_cast<u32>('1')] = "letter_1";
	map[static_cast<u32>('2')] = "letter_2";
	map[static_cast<u32>('3')] = "letter_3";
	map[static_cast<u32>('4')] = "letter_4";
	map[static_cast<u32>('5')] = "letter_5";
	map[static_cast<u32>('6')] = "letter_6";
	map[static_cast<u32>('7')] = "letter_7";
	map[static_cast<u32>('8')] = "letter_8";
	map[static_cast<u32>('9')] = "letter_9";

	for (char c = 'a'; c <= 'z'; ++c) {
		map[static_cast<u32>(c)] = std::string("letter_") + c;
	}
	for (char c = 'A'; c <= 'Z'; ++c) {
		map[static_cast<u32>(c)] = std::string("letter_") + static_cast<char>(c - 'A' + 'a');
	}

	map[0x00A1] = "letter_ij";
	map[static_cast<u32>(',')] = "letter_comma";
	map[static_cast<u32>('.')] = "letter_dot";
	map[static_cast<u32>('!')] = "letter_exclamation";
	map[static_cast<u32>('?')] = "letter_question";
	map[static_cast<u32>('\'')] = "letter_apostroph";
	map[static_cast<u32>(' ')] = "letter_space";
	map[static_cast<u32>(':')] = "letter_colon";
	map[static_cast<u32>('-')] = "letter_streep";
	map[0x2013] = "letter_streep";
	map[0x2014] = "letter_streep";
	map[static_cast<u32>('_')] = "letter_line";
	map[0x2588] = "letter_line";
	map[static_cast<u32>('/')] = "letter_slash";
	map[static_cast<u32>('%')] = "letter_percent";
	map[static_cast<u32>('[')] = "letter_speakstart";
	map[static_cast<u32>(']')] = "letter_speakend";
	map[static_cast<u32>('(')] = "letter_haakjeopen";
	map[static_cast<u32>(')')] = "letter_haakjesluit";
	map[static_cast<u32>('+')] = "letter_question";

	return map;
}

BFont::BFont(RuntimeAssets& assets, i32 advancePadding)
	: BFont(assets, buildKonamiGlyphMap(), advancePadding) {
}

BFont::BFont(RuntimeAssets& assets, GlyphMap glyphmap, i32 advancePadding)
	: m_assets(assets)
	, m_letter_to_img(std::move(glyphmap))
	, m_advance_padding(advancePadding) {
	m_space_advance = advance(' ');
	m_line_height = char_height('A');
}

i32 BFont::char_width(char c) {
	return char_width(static_cast<u32>(static_cast<unsigned char>(c)));
}

i32 BFont::char_height(char c) {
	return char_height(static_cast<u32>(static_cast<unsigned char>(c)));
}

i32 BFont::char_width(u32 codepoint) {
	return getGlyph(codepoint).width;
}

i32 BFont::char_height(u32 codepoint) {
	return getGlyph(codepoint).height;
}

const std::string& BFont::char_to_img(u32 codepoint) const {
	auto it = m_letter_to_img.find(codepoint);
	if (it != m_letter_to_img.end()) {
		return it->second;
	}
	std::cerr << "[BFont] Character codepoint " << codepoint << " not found in letter_to_img map. Using fallback '?'."
				<< std::endl;
	auto fallbackIt = m_letter_to_img.find(static_cast<u32>('?'));
	if (fallbackIt == m_letter_to_img.end()) {
		throw BMSX_RUNTIME_ERROR("[BFont] Fallback character '?' not found in letter_to_img map.");
	}
	return fallbackIt->second;
}

const FontGlyph& BFont::getGlyph(u32 codepoint) {
	auto it = m_glyphs.find(codepoint);
	if (it != m_glyphs.end()) {
		return it->second;
	}

	const std::string& imgid = char_to_img(codepoint);
	ImgAsset* entry = m_assets.getImg(imgid);
	FontGlyph glyph;
	glyph.imgid = imgid;
	glyph.width = entry->meta.width;
	glyph.height = entry->meta.height;
	glyph.advance = glyph.width + m_advance_padding;

	auto result = m_glyphs.emplace(codepoint, std::move(glyph));
	return result.first->second;
}

i32 BFont::advance(char c) {
	return advance(static_cast<u32>(static_cast<unsigned char>(c)));
}

i32 BFont::advance(u32 codepoint) {
	return getGlyph(codepoint).advance;
}

i32 BFont::measure(const std::string& text) {
	i32 width = 0;
	size_t index = 0;
	while (index < text.size()) {
		u32 codepoint = readUtf8Codepoint(text, index);
		if (codepoint == static_cast<u32>('\t')) {
			width += m_space_advance * TAB_SPACES;
			continue;
		}
		width += advance(codepoint);
	}
	return width;
}

} // namespace bmsx
