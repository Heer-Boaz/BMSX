/*
 * font.cpp - font variants
 */

#include "render/shared/bmsx_font.h"

#include "rompack/host_system_atlas.h"

#include <utility>

namespace bmsx {
namespace {

class HostSystemBitmapFontSource final : public BitmapFontSource {
public:
	BitmapFontSourceGlyph resolveGlyph(const std::string& imgid) const override {
		const HostSystemAtlasGeneratedImage& image = hostSystemAtlasImage(imgid);
		return BitmapFontSourceGlyph{
			image.width,
			image.height,
			image.u,
			image.v,
			image.w,
			image.h,
		};
	}
};

const HostSystemBitmapFontSource HOST_SYSTEM_FONT_SOURCE;

void addDigitAndLetterGlyphs(GlyphMap& map, const std::string& prefix) {
	auto withPrefix = [&](const std::string& suffix) {
		return prefix + "_" + suffix;
	};
	for (int i = 0; i < 10; ++i) {
		char digit = static_cast<char>('0' + i);
		map[static_cast<u32>(digit)] = withPrefix(std::string(1, digit));
	}
	for (char c = 'a'; c <= 'z'; ++c) {
		map[static_cast<u32>(c)] = withPrefix(std::string("low_") + c);
	}
	for (char c = 'A'; c <= 'Z'; ++c) {
		char lower = static_cast<char>(c - 'A' + 'a');
		map[static_cast<u32>(c)] = withPrefix(std::string(1, lower));
	}
}

GlyphMap buildMsxCharMap() {
	const std::string prefix = "msx_6b_font";
	auto withPrefix = [&](const std::string& suffix) {
		return prefix + "_" + suffix;
	};

	GlyphMap map;
	map[static_cast<u32>(' ')] = withPrefix("space");
	map[static_cast<u32>('!')] = withPrefix("exclamation");
	map[static_cast<u32>('\"')] = withPrefix("code_0x22");
	map[static_cast<u32>('#')] = withPrefix("code_0x23");
	map[static_cast<u32>('$')] = withPrefix("code_0x24");
	map[static_cast<u32>('%')] = withPrefix("percent");
	map[static_cast<u32>('&')] = withPrefix("code_0x26");
	map[static_cast<u32>('\'')] = withPrefix("apostroph");
	map[static_cast<u32>('(')] = withPrefix("code_0x28");
	map[static_cast<u32>(')')] = withPrefix("code_0x29");
	map[static_cast<u32>('*')] = withPrefix("code_0x2a");
	map[static_cast<u32>('+')] = withPrefix("code_0x2b");
	map[static_cast<u32>(',')] = withPrefix("comma");
	map[static_cast<u32>('-')] = withPrefix("streep");
	map[0x2013] = withPrefix("streep");
	map[static_cast<u32>('.')] = withPrefix("dot");
	map[static_cast<u32>('/')] = withPrefix("slash");
	map[static_cast<u32>(':')] = withPrefix("colon");
	map[static_cast<u32>(';')] = withPrefix("code_0x3b");
	map[static_cast<u32>('<')] = withPrefix("code_0x3c");
	map[static_cast<u32>('=')] = withPrefix("code_0x3d");
	map[static_cast<u32>('>')] = withPrefix("code_0x3e");
	map[static_cast<u32>('?')] = withPrefix("question");
	map[static_cast<u32>('@')] = withPrefix("at_sign");
	map[static_cast<u32>('[')] = withPrefix("code_0x5b");
	map[static_cast<u32>('\\')] = withPrefix("code_0x5c");
	map[static_cast<u32>(']')] = withPrefix("code_0x5d");
	map[static_cast<u32>('^')] = withPrefix("code_0x5e");
	map[static_cast<u32>('_')] = withPrefix("line");
	map[static_cast<u32>('`')] = withPrefix("code_0x60");
	map[static_cast<u32>('{')] = withPrefix("code_0x7b");
	map[static_cast<u32>('|')] = withPrefix("code_0x7c");
	map[static_cast<u32>('}')] = withPrefix("code_0x7d");
	map[static_cast<u32>('~')] = withPrefix("code_0x7e");
	map[static_cast<u32>(L'█')] = withPrefix("code_0xc8");

	map[0x2014] = withPrefix("ctrl_etb"); // etb = "extended dash/break" and the associated ASCII control code is 0x17
	// map[0x2022] = withPrefix("ctrl_bel");
	map[0x00A1] = withPrefix("code_0x80");

	addDigitAndLetterGlyphs(map, prefix);

	return map;
}

GlyphMap buildTinyCharMap() {
	constexpr char HEX_DIGITS[] = "0123456789abcdef";
	const std::string prefix = "tiny_3b_font";
	auto withPrefix = [&](const std::string& suffix) {
		return prefix + "_" + suffix;
	};

	GlyphMap map;
	for (u32 codepoint = 0x20; codepoint <= 0x7e; ++codepoint) {
		std::string id = prefix + "_code_0x00";
		id[id.size() - 2] = HEX_DIGITS[(codepoint >> 4u) & 0x0fu];
		id[id.size() - 1] = HEX_DIGITS[codepoint & 0x0fu];
		map[codepoint] = std::move(id);
	}
	map[0x2013] = withPrefix("code_0x2d");
	map[0x2014] = withPrefix("code_0x2d");
	map[0x2022] = withPrefix("bullet");
	map[0x2588] = withPrefix("code_0x5f");
	map[0x00A1] = withPrefix("inverted_exclamation");
	map[0x00A4] = withPrefix("flower");
	map[0x00A6] = withPrefix("brokenbar");
	map[0x00A7] = withPrefix("section");
	map[0x00A3] = withPrefix("pound");
	map[0x00A5] = withPrefix("yen");
	map[0x20AC] = withPrefix("euro");
	map[0x00B5] = withPrefix("euler");
	map[0x0133] = withPrefix("low_ij");
	map[0x0132] = withPrefix("ij");

	return map;
}

} // namespace

Font::Font(FontVariant variant)
	: BFont(HOST_SYSTEM_FONT_SOURCE, variant == FontVariant::Tiny ? buildTinyCharMap() : buildMsxCharMap()) {
}

} // namespace bmsx
