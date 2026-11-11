#include "render/backend/software/gx_gpu.h"
#include "render/gx_gpu_presentation.h"

#include "render/backend/backend.h"
#include "render/backend/pass/library.h"
#include "render/backend/software/gx_gpu_execution.h"
#include "render/backend/software/gx_gpu_scanout.h"
#include "machine/devices/gx/gpu.h"

namespace bmsx {
namespace {

void executeGxGpuSoftwarePass(
	GPUBackend* backend,
	VideoPresenter*,
	void*,
	RenderPassStateStorage& stateStorage,
	void*,
	const GxGpuPresentation& output
) {
	renderGxGpuSoftwareFrame(static_cast<SoftwareBackend&>(*backend), stateStorage.gxGpu, output);
}

} // namespace

void renderGxGpuSoftwareFrame(
	SoftwareBackend& backend,
	const GxGpuPipelineState& state,
	const GxGpuPresentation& output
) {
	scanoutGxGpuSoftwareVram(
		backend.m_gx_gpu_software,
		backend.framebuffer(),
		backend.pitch() / static_cast<i32>(sizeof(u32)),
		state,
		output.pcrtcScanout,
		output.vramReplacementSerial);
}

void SoftwareBackend::executeGxGpuPresentation(const GxGpuDeviceOutput& output) {
	executeGxGpuSoftwareVramCommands(m_gx_gpu_software, output, output.commandBuffer.presentCommandCount);
}

void SoftwareBackend::executeGxGpuReadback(GxGpu& gxGpu) {
	const GxGpuDeviceOutput& output = gxGpu.readDeviceOutput();
	executeGxGpuSoftwareVramCommands(
		m_gx_gpu_software,
		output,
		output.readbackPort.fenceCommandCount());
}

void SoftwareBackend::executeGxGpuCommandDrain(GxGpu& gxGpu) {
	const GxGpuDeviceOutput& output = gxGpu.readDeviceOutput();
	executeGxGpuSoftwareVramCommands(
		m_gx_gpu_software,
		output,
		output.commandBuffer.executedCommandCount);
	gxGpu.retireExecutedCommands();
}

void SoftwareBackend::finishGxGpuReadbacks() {
	// GPUREAD completes synchronously on this backend.
}

void SoftwareBackend::captureGxGpuVramSnapshot(GxGpu& gxGpu) {
	captureGxGpuSoftwareVramSnapshot(m_gx_gpu_software, gxGpu);
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
