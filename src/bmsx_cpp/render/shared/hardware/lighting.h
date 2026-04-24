#pragma once

#include "core/primitives.h"
#include <array>
#include <optional>
#include <string>
#include <unordered_map>

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

void putHardwareAmbientLight(const std::string& id, const AmbientLight& light);
void putHardwareDirectionalLight(const std::string& id, const DirectionalLight& light);
void putHardwarePointLight(const std::string& id, const PointLight& light);
void clearHardwareLighting();
bool consumeHardwareLightingDirty();
const std::unordered_map<std::string, AmbientLight>& getHardwareAmbientLights();
const std::unordered_map<std::string, DirectionalLight>& getHardwareDirectionalLights();
const std::unordered_map<std::string, PointLight>& getHardwarePointLights();
std::optional<AmbientLight> resolveHardwareAmbientLight();

} // namespace bmsx
