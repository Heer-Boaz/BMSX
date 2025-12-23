/*
 * font.h - VM font variants
 *
 * Mirrors TypeScript vm/font.ts.
 */

#ifndef BMSX_VM_FONT_H
#define BMSX_VM_FONT_H

#include "../core/font.h"

namespace bmsx {

enum class VMFontVariant {
    Msx,
    Tiny
};

constexpr VMFontVariant DEFAULT_VM_FONT_VARIANT = VMFontVariant::Msx;

class VMFont : public BFont {
public:
    explicit VMFont(RuntimeAssets& assets, VMFontVariant variant = DEFAULT_VM_FONT_VARIANT);
};

} // namespace bmsx

#endif // BMSX_VM_FONT_H
