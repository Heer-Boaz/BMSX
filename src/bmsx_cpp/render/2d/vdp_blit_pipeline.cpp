#include "render/2d/vdp_blit_pipeline.h"

#include "render/backend/backend.h"
#include "render/backend/pass/framebuffer_execution.h"
#include "render/backend/pass/library.h"
#include <any>

namespace bmsx {

void registerVdpFrameBufferExecutionPass(RenderPassLibrary& registry) {
	RenderPassDef desc;
	configureVdpFrameBufferExecutionPass(desc);
	desc.exec = [](GPUBackend* backend, void*, std::any& state) {
		auto& executionState = std::any_cast<VdpFrameBufferExecutionPassState&>(state);
		backend->executeVdp2DBlit(executionState);
	};
	registry.registerPass(desc);
}

} // namespace bmsx
