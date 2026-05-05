#pragma once

#include "render/backend/backend.h"
#include "render/host_overlay/pipeline.h"
#include "render/shared/queues.h"

namespace bmsx {

void beginHostOverlaySoftware(SoftwareBackend& backend, const Host2DPipelineState& state);
void renderHost2DEntrySoftware(SoftwareBackend& backend, const RenderQueues::Host2DEntry& entry);
void endHostOverlaySoftware(SoftwareBackend& backend);

} // namespace bmsx
