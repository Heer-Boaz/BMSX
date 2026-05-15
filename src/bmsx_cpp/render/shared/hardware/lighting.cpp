#include "render/shared/hardware/lighting.h"

#include <unordered_map>

namespace bmsx {
namespace {

std::vector<AmbientLight> s_ambientLights;
std::vector<DirectionalLight> s_directionalLights;
std::vector<PointLight> s_pointLights;
std::unordered_map<std::string, size_t> s_ambientLightIndices;
std::unordered_map<std::string, size_t> s_directionalLightIndices;
std::unordered_map<std::string, size_t> s_pointLightIndices;
bool s_hardwareLightingDirty = false;

template<typename Light>
void putHardwareLight(std::vector<Light>& lights, std::unordered_map<std::string, size_t>& indices, const std::string& id, const Light& light) {
	const auto it = indices.find(id);
	if (it == indices.end()) {
		indices[id] = lights.size();
		lights.push_back(light);
	} else {
		lights[it->second] = light;
	}
}

void markHardwareLightingDirty() {
	s_hardwareLightingDirty = true;
}

} // namespace

void putHardwareAmbientLight(const std::string& id, const AmbientLight& light) {
	putHardwareLight(s_ambientLights, s_ambientLightIndices, id, light);
	markHardwareLightingDirty();
}

void putHardwareDirectionalLight(const std::string& id, const DirectionalLight& light) {
	putHardwareLight(s_directionalLights, s_directionalLightIndices, id, light);
	markHardwareLightingDirty();
}

void putHardwarePointLight(const std::string& id, const PointLight& light) {
	putHardwareLight(s_pointLights, s_pointLightIndices, id, light);
	markHardwareLightingDirty();
}

void clearHardwareLighting() {
	const bool hadLights = !s_ambientLights.empty() || !s_directionalLights.empty() || !s_pointLights.empty();
	s_ambientLights.clear();
	s_directionalLights.clear();
	s_pointLights.clear();
	s_ambientLightIndices.clear();
	s_directionalLightIndices.clear();
	s_pointLightIndices.clear();
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

const std::vector<AmbientLight>& getHardwareAmbientLights() {
	return s_ambientLights;
}

const std::vector<DirectionalLight>& getHardwareDirectionalLights() {
	return s_directionalLights;
}

const std::vector<PointLight>& getHardwarePointLights() {
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
	for (const AmbientLight& light : s_ambientLights) {
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
