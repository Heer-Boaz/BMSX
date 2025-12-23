/*
 * spritecomponent.h - Sprite component for 2D rendering
 *
 * Mirrors TypeScript SpriteComponent data fields used by SpriteObject.
 */

#ifndef BMSX_SPRITECOMPONENT_H
#define BMSX_SPRITECOMPONENT_H

#include "component.h"
#include "../render/render_types.h"

namespace bmsx {

struct SpriteComponentOptions : ComponentAttachOptions {
	std::string imgid = "none";
	Vec2 scale{1.0f, 1.0f};
	FlipOptions flip;
	Color colorize{1.0f, 1.0f, 1.0f, 1.0f};
};

class SpriteComponent : public Component {
public:
	static const char* typeName() { return "SpriteComponent"; }

	explicit SpriteComponent(const SpriteComponentOptions& opts);

	std::string imgid;
	Vec2 scale;
	FlipOptions flip;
	Color colorize;
};

} // namespace bmsx

#endif // BMSX_SPRITECOMPONENT_H
