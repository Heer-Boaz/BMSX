#pragma once

#include "common/primitives.h"
#include <array>

namespace bmsx {

struct AmbientLight {
	std::array<f32, 3> color = {0.0f, 0.0f, 0.0f};
	f32 intensity = 0.0f;
};

struct DirectionalLight {
	std::array<f32, 3> color = {0.0f, 0.0f, 0.0f};
	f32 intensity = 0.0f;
	std::array<f32, 3> orientation = {0.0f, 0.0f, 1.0f};
};

struct PointLight {
	std::array<f32, 3> color = {0.0f, 0.0f, 0.0f};
	f32 intensity = 0.0f;
	Vec3 pos{};
	f32 range = 0.0f;
};

struct SpotLight {
	std::array<f32, 3> color = {0.0f, 0.0f, 0.0f};
	f32 intensity = 0.0f;
	Vec3 pos{};
	std::array<f32, 3> orientation = {0.0f, 0.0f, 1.0f};
	f32 angle = 0.0f;
	f32 range = 0.0f;
};

struct AreaLight {
	std::array<f32, 3> color = {0.0f, 0.0f, 0.0f};
	f32 intensity = 0.0f;
	Vec3 pos{};
	std::array<f32, 2> size = {0.0f, 0.0f};
	std::array<f32, 3> normal = {0.0f, 0.0f, 1.0f};
};

} // namespace bmsx
