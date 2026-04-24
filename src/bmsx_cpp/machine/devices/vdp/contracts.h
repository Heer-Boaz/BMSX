#pragma once

#include "core/primitives.h"
#include <cstddef>
#include <string>

namespace bmsx {

enum class Layer2D : u8 {
	World = 0,
	UI = 1,
	IDE = 2,
};

struct SkyboxImageIds {
	std::string posx;
	std::string negx;
	std::string posy;
	std::string negy;
	std::string posz;
	std::string negz;
};

constexpr size_t SKYBOX_FACE_COUNT = 6;

} // namespace bmsx
