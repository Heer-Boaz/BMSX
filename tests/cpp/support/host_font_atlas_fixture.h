#pragma once
#include "render/host_overlay/atlas.h"
#include "render/shared/bitmap_font.h"
#include <vector>

namespace bmsx::test {

// Same glyph id/metrics, distinct atlas dimensions and ink. Storage outlives the renderer cache.
class HostFontAtlasFixture final : public BitmapFontSource {
	std::vector<u8> pixels;
	HostAtlas image;
	u32 origin;
public:
	HostFontAtlasFixture(bool msdf, bool inverse)
		: pixels((inverse ? 8 * 6 : 4 * 4) * 4), image{inverse ? 8u : 4u, inverse ? 6u : 4u, pixels, false}, origin(inverse ? 2u : 1u) {
		for (u32 y = 0; y < 2; y++) for (u32 x = 0; x < 2; x++) {
			const auto offset = ((origin + y) * image.width + origin + x) * 4;
			const u8 coverage = (x == y) != inverse ? 255 : 0;
			pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = msdf ? coverage : 255;
			pixels[offset + 3] = msdf ? 255 : coverage;
		}
	}
	const HostAtlas& atlas() const override { return image; }
	BitmapFontSourceGlyph resolveGlyph(const std::string&) const override {
		return {2, 2, 3, 0, 0, origin, origin, 2, 2};
	}
};

} // namespace bmsx::test
