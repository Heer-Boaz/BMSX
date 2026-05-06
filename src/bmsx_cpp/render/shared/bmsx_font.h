/*
 * font.h - font variants
 */

#ifndef BMSX_BMSX_FONT_H
#define BMSX_BMSX_FONT_H

#include "render/shared/bitmap_font.h"

namespace bmsx {

enum class FontVariant {
	Msx,
	Tiny
};

constexpr FontVariant DEFAULT_FONT_VARIANT = FontVariant::Msx;

class Font : public BFont {
public:
	explicit Font(FontVariant variant = DEFAULT_FONT_VARIANT);
};

} // namespace bmsx

#endif // BMSX_BMSX_FONT_H
