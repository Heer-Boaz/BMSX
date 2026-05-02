#pragma once

#include "render/backend/backend.h"

namespace bmsx {

class GameView;
class Runtime;
class RenderPassLibrary;

void registerSoftwareScenePasses(RenderPassLibrary& registry);
void renderSoftwareSkybox(SoftwareBackend& backend, const GameView& view, Runtime& runtime);
void renderSoftwareParticles(SoftwareBackend& backend, const GameView& view, Runtime& runtime);

} // namespace bmsx
