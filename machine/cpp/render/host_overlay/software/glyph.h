#pragma once
#include "common/primitives.h"

namespace bmsx {
class SoftwareBackend;
struct FontGlyph;
struct HostAtlas;
enum class FontRaster;
void drawFilteredHostGlyph(SoftwareBackend& backend, const HostAtlas& atlas, const FontGlyph& item, f32 x, f32 y, u32 color, FontRaster raster, f32 screenRange);
}
