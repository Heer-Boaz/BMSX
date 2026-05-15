#pragma once

#include "render/backend/backend.h"

namespace bmsx {

class GameView;
class RenderPassLibrary;

void registerSoftwareScenePasses(RenderPassLibrary& registry);
void renderSoftwareSkybox(SoftwareBackend& backend, const GameView& view);
void renderSoftwareParticles(SoftwareBackend& backend, const GameView& view);
void renderSoftwareMeshes(SoftwareBackend& backend, const GameView& view);

} // namespace bmsx
