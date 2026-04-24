#include "render/shared/hardware/lighting.h"

namespace bmsx {
namespace {

std::unordered_map<std::string, AmbientLight> s_ambientLights;
std::unordered_map<std::string, DirectionalLight> s_directionalLights;
std::unordered_map<std::string, PointLight> s_pointLights;
bool s_hardwareLightingDirty = false;

} // namespace

void putHardwareAmbientLight(const std::string& id, const AmbientLight& light) {
	s_ambientLights[id] = light;
	s_hardwareLightingDirty = true;
}

void putHardwareDirectionalLight(const std::string& id, const DirectionalLight& light) {
	s_directionalLights[id] = light;
	s_hardwareLightingDirty = true;
}

void putHardwarePointLight(const std::string& id, const PointLight& light) {
	s_pointLights[id] = light;
	s_hardwareLightingDirty = true;
}

void clearHardwareLighting() {
	const bool hadLights = !s_ambientLights.empty() || !s_directionalLights.empty() || !s_pointLights.empty();
	s_ambientLights.clear();
	s_directionalLights.clear();
	s_pointLights.clear();
	if (hadLights) {
		s_hardwareLightingDirty = true;
	}
}

bool consumeHardwareLightingDirty() {
	if (!s_hardwareLightingDirty) {
		return false;
	}
	s_hardwareLightingDirty = false;
	return true;
}

const std::unordered_map<std::string, AmbientLight>& getHardwareAmbientLights() {
	return s_ambientLights;
}

const std::unordered_map<std::string, DirectionalLight>& getHardwareDirectionalLights() {
	return s_directionalLights;
}

const std::unordered_map<std::string, PointLight>& getHardwarePointLights() {
	return s_pointLights;
}

std::optional<AmbientLight> resolveHardwareAmbientLight() {
	if (s_ambientLights.empty()) {
		return std::nullopt;
	}
	f32 totalIntensity = 0.0f;
	f32 accumR = 0.0f;
	f32 accumG = 0.0f;
	f32 accumB = 0.0f;
	for (const auto& entry : s_ambientLights) {
		const AmbientLight& light = entry.second;
		totalIntensity += light.intensity;
		accumR += light.color[0] * light.intensity;
		accumG += light.color[1] * light.intensity;
		accumB += light.color[2] * light.intensity;
	}
	if (totalIntensity <= 0.0f) {
		return std::nullopt;
	}
	return AmbientLight{
		{
			accumR / totalIntensity,
			accumG / totalIntensity,
			accumB / totalIntensity,
		},
		totalIntensity,
	};
}

} // namespace bmsx
