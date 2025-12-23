/*
 * spritecomponent.cpp - Sprite component implementation
 */

#include "spritecomponent.h"

namespace bmsx {

SpriteComponent::SpriteComponent(const SpriteComponentOptions& opts)
	: Component(opts)
	, imgid(opts.imgid)
	, scale(opts.scale)
	, flip(opts.flip)
	, colorize(opts.colorize)
{
}

} // namespace bmsx
