#pragma once

#include "render/backend/backend.h"
#include "render/host_overlay/pipeline.h"
#include "render/shared/queues.h"

namespace bmsx {

void beginHostOverlaySoftware(SoftwareBackend& backend, const Host2DPipelineState& state);
void renderHost2DEntrySoftware(SoftwareBackend& backend, RenderQueues::Host2DKind kind, RenderQueues::Host2DRef ref);
void endHostOverlaySoftware(SoftwareBackend& backend);

} // namespace bmsx
