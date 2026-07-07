#include "render/backend/software/gx_gpu.h"

#include "render/backend/backend.h"
#include "render/backend/pass/library.h"
#include "render/backend/software/gx_gpu_commands.h"
#include "render/backend/software/gx_gpu_scanout.h"
#include "render/backend/software/gx_gpu_vram.h"

namespace bmsx {
namespace {

size_t g_gxGpuSoftwareProcessedCommandCount = 0u;
u32 g_gxGpuSoftwareProcessedCommandSerial = 0u;

void executeGxGpuSoftwarePass(GPUBackend* backend, GameView*, void*, RenderPassStateStorage& stateStorage, void*) {
	auto& typedBackend = *static_cast<SoftwareBackend*>(backend);
	renderGxGpuSoftwareFrame(typedBackend, stateStorage.gxGpu);
}

} // namespace

void renderGxGpuSoftwareFrame(SoftwareBackend& backend, const GxGpuPipelineState& state) {
	if (g_gxGpuSoftwareProcessedCommandSerial != state.commandBuffer->serial) {
		resetGxGpuSoftwareVram();
		g_gxGpuSoftwareProcessedCommandCount = 0u;
		g_gxGpuSoftwareProcessedCommandSerial = state.commandBuffer->serial;
	}
	g_gxGpuSoftwareProcessedCommandCount = executeGxGpuSoftwareCommands(*state.commandBuffer, g_gxGpuSoftwareProcessedCommandCount);
	scanoutGxGpuSoftwareVram(backend, state);
}

void registerGxGpuPassSoftware(RenderPassLibrary& registry) {
	RenderPassDef desc;
	desc.id = "gx_gpu";
	desc.name = "GXGPU";
	setGxGpuGraph(desc);
	desc.exec = executeGxGpuSoftwarePass;
	registry.registerPass(desc);
}

} // namespace bmsx
