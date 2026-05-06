#pragma once

#include "render/3d/light.h"
#include <optional>
#include <string>
#include <unordered_map>

namespace bmsx {

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
