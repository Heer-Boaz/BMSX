#pragma once

#include "render/backend/backend.h"
#include "render/host_overlay/pipeline.h"
#include "render/host_overlay/commands.h"

namespace bmsx {

void beginHostOverlaySoftware(SoftwareBackend& backend, const Host2DPipelineState& state);
void renderHost2DEntrySoftware(SoftwareBackend& backend, Host2DKind kind, Host2DRef ref);
void endHostOverlaySoftware(SoftwareBackend& backend);

} // namespace bmsx
