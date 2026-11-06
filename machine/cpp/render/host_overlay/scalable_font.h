#pragma once

#include "render/shared/bitmap_font.h"
#include "render/host_overlay/atlas.h"
#include <span>
#include <string_view>

namespace bmsx {

struct ScalableFontGlyph {
	std::string_view id;
	u32 codepoint;
	bool italic;
	BitmapFontSourceGlyph metrics;
};

// Linear RGB signed distances, separate from the host-image atlas.
struct ScalableFontAtlas : HostAtlas {
	f32 lineHeight, distanceRange;
	std::span<const ScalableFontGlyph> glyphs;
};

extern const ScalableFontAtlas SCALABLE_FONT_ATLAS;
const BitmapFontSource& scalableFontSource();
GlyphMap scalableFontMap(bool italic);

} // namespace bmsx
