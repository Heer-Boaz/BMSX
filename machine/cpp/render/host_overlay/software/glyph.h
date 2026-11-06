#pragma once
#include "common/primitives.h"

namespace bmsx {
class SoftwareBackend;
struct FontGlyph;
void drawLinearHostGlyph(SoftwareBackend& backend, const FontGlyph& item, f32 x, f32 y, u32 color);
}
