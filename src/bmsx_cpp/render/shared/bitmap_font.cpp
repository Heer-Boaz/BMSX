/*
 * font.cpp - Bitmap font support
 */

#include "font.h"
#include "core/utf8.h"
#include <memory>
#include <stdexcept>

namespace bmsx {
namespace {

class RuntimeBitmapFontSource final : public BitmapFontSource {
public:
	explicit RuntimeBitmapFontSource(RuntimeRomPackage& romPackage)
		: m_romPackage(romPackage) {
	}

	const ImgMeta& glyphMeta(const std::string& imgid) const override {
		const ImgAsset* entry = m_romPackage.getImg(imgid);
		if (!entry) {
			throw BMSX_RUNTIME_ERROR("[BFont] Image '" + imgid + "' was not found.");
		}
		return entry->meta;
	}

	ImageAtlasRect glyphRect(const std::string& imgid) const override {
		return resolveImageAtlasRectFromPackage(m_romPackage, imgid);
	}

private:
	RuntimeRomPackage& m_romPackage;
};

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

BFont::BFont(RuntimeRomPackage& romPackage, i32 advancePadding)
	: BFont(romPackage, buildKonamiGlyphMap(), advancePadding) {
}

BFont::BFont(RuntimeRomPackage& romPackage, GlyphMap glyphmap, i32 advancePadding)
	: BFont(std::make_shared<RuntimeBitmapFontSource>(romPackage), std::move(glyphmap), advancePadding) {
}

BFont::BFont(std::shared_ptr<const BitmapFontSource> source, GlyphMap glyphmap, i32 advancePadding)
	: m_source(std::move(source))
	, m_letter_to_img(std::move(glyphmap))
	, m_advance_padding(advancePadding) {
	if (!m_source) {
		throw BMSX_RUNTIME_ERROR("[BFont] Font source is missing.");
	}
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
	return m_letter_to_img.at(static_cast<u32>('?'));
}

const FontGlyph& BFont::getGlyph(u32 codepoint) {
	auto it = m_glyphs.find(codepoint);
	if (it != m_glyphs.end()) {
		return it->second;
	}
	if (codepoint == static_cast<u32>('\t') && m_letter_to_img.find(codepoint) == m_letter_to_img.end()) {
		const FontGlyph& space = getGlyph(static_cast<u32>(' '));
		FontGlyph glyph;
		glyph.imgid = space.imgid;
		glyph.rect = space.rect;
		glyph.width = space.advance * TAB_SPACES;
		glyph.height = space.height;
		glyph.advance = glyph.width;
		auto tabResult = m_glyphs.emplace(codepoint, std::move(glyph));
		return tabResult.first->second;
	}

	const std::string& imgid = char_to_img(codepoint);
	const ImgMeta& meta = m_source->glyphMeta(imgid);
	FontGlyph glyph;
	glyph.imgid = imgid;
	glyph.rect = m_source->glyphRect(imgid);
	glyph.width = meta.width;
	glyph.height = meta.height;
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
		if (codepoint == static_cast<u32>('\n')) {
			continue;
		}
		width += advance(codepoint);
	}
	return width;
}

} // namespace bmsx
