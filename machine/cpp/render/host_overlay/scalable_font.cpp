#include "render/host_overlay/scalable_font.h"
#include <algorithm>

namespace bmsx {
namespace {
class ScalableFontSource final : public BitmapFontSource {
public:
	const HostAtlas& atlas() const override { return SCALABLE_FONT_ATLAS; }
	BitmapFontSourceGlyph resolveGlyph(const std::string& id) const override {
		const auto glyphs = SCALABLE_FONT_ATLAS.glyphs;
		return std::lower_bound(glyphs.begin(), glyphs.end(), id,
			[](const ScalableFontGlyph& glyph, std::string_view key) { return glyph.id < key; })->metrics;
	}
};
const ScalableFontSource SOURCE;
}

const BitmapFontSource& scalableFontSource() { return SOURCE; }

GlyphMap scalableFontMap(bool italic) {
	GlyphMap result;
	for (const auto& glyph : SCALABLE_FONT_ATLAS.glyphs) {
		if (glyph.italic == italic) result.emplace(glyph.codepoint, glyph.id);
	}
	return result;
}

} // namespace bmsx
