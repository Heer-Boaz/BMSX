#pragma once

#include "render/3d/light.h"
#include <optional>
#include <string>
#include <vector>

namespace bmsx {

void putHardwareAmbientLight(const std::string& id, const AmbientLight& light);
void putHardwareDirectionalLight(const std::string& id, const DirectionalLight& light);
void putHardwarePointLight(const std::string& id, const PointLight& light);
void clearHardwareLighting();
bool consumeHardwareLightingDirty();
const std::vector<AmbientLight>& getHardwareAmbientLights();
const std::vector<DirectionalLight>& getHardwareDirectionalLights();
const std::vector<PointLight>& getHardwarePointLights();
std::optional<AmbientLight> resolveHardwareAmbientLight();

} // namespace bmsx
