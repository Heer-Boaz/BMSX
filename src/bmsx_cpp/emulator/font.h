/*
 * font.h - font variants
 *
 * Mirrors TypeScript emulator/font.ts.
 */

#ifndef BMSX_FONT_H
#define BMSX_FONT_H

#include "../core/font.h"

namespace bmsx {

enum class FontVariant {
	Msx,
	Tiny
};

constexpr FontVariant DEFAULT_FONT_VARIANT = FontVariant::Msx;

class Font : public BFont {
public:
	explicit Font(RuntimeAssets& assets, FontVariant variant = DEFAULT_FONT_VARIANT);
};

} // namespace bmsx

#endif // BMSX_FONT_H
