#include "render/backend/pass/framebuffer_execution.h"

#include "render/backend/pass/library.h"

namespace bmsx {

void configureVdpFrameBufferExecutionPass(RenderPassDef& desc) {
	desc.id = "vdp_framebuffer_execution";
	desc.name = "VDPFrameBufferExecution";
	desc.stateOnly = true;
	desc.graph = RenderPassDef::RenderPassGraphDef{};
	desc.graph->skip = true;
}

} // namespace bmsx
