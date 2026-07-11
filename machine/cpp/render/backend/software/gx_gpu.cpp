#include "render/backend/software/gx_gpu.h"

#include "render/backend/backend.h"
#include "render/backend/pass/library.h"
#include "render/backend/software/gx_gpu_commands.h"
#include "render/backend/software/gx_gpu_scanout.h"
#include "render/backend/software/gx_gpu_vram.h"
#include "machine/devices/gx/gpu.h"

#include <array>

namespace bmsx {
namespace {

size_t g_gxGpuSoftwareProcessedCommandCount = 0u;
u32 g_gxGpuSoftwareProcessedCommandSerial = 0u;
u32 g_gxGpuSoftwareVramClearSerial = 0u;
u32 g_gxGpuSoftwareVramSnapshotSerial = 0u;
std::array<u8, GX_GPU_VRAM_BYTE_COUNT> g_gxGpuSoftwareVramSnapshotScratch{};

void executeGxGpuSoftwarePass(GPUBackend*, GameView*, void*, RenderPassStateStorage& stateStorage, void*) {
	renderGxGpuSoftwareFrame(stateStorage.gxGpu);
}

void executeGxGpuSoftwareVramCommands(const GxGpuCommandBuffer& commandBuffer, GxGpuReadbackPort& readback, const std::array<u8, GX_GPU_VRAM_BYTE_COUNT>& snapshotBytes, u32 snapshotSerial) {
	const u32 commandSerial = commandBuffer.serial;
	const u32 vramClearSerial = commandBuffer.vramClearSerial;
	if (g_gxGpuSoftwareVramSnapshotSerial != snapshotSerial) {
		loadGxGpuSoftwareVramBytes(snapshotBytes.data());
		g_gxGpuSoftwareProcessedCommandCount = 0u;
		g_gxGpuSoftwareProcessedCommandSerial = commandSerial;
		g_gxGpuSoftwareVramClearSerial = vramClearSerial;
		g_gxGpuSoftwareVramSnapshotSerial = snapshotSerial;
	} else if (g_gxGpuSoftwareVramClearSerial != vramClearSerial) {
		g_gxGpuSoftwareVram.fill(0u);
		g_gxGpuSoftwareProcessedCommandCount = 0u;
		g_gxGpuSoftwareProcessedCommandSerial = commandSerial;
		g_gxGpuSoftwareVramClearSerial = vramClearSerial;
	} else if (g_gxGpuSoftwareProcessedCommandSerial != commandSerial) {
		g_gxGpuSoftwareProcessedCommandCount = 0u;
		g_gxGpuSoftwareProcessedCommandSerial = commandSerial;
	}
	g_gxGpuSoftwareProcessedCommandCount = executeGxGpuSoftwareCommands(commandBuffer, g_gxGpuSoftwareProcessedCommandCount);
	if (readback.claimReadback(commandBuffer.presentCommandCount)) {
		const u32 readbackToken = readback.token();
		u8* const readbackPixelBytes = readback.pixelBytes();
		size_t pixel = 0u;
		for (u32 row = 0u; row < readback.height(); row += 1u) {
			const u32 y = (readback.y() + row) & (GX_GPU_VRAM_HEIGHT - 1u);
			for (u32 column = 0u; column < readback.width(); column += 1u) {
				const u32 x = (readback.x() + column) & (GX_GPU_VRAM_WIDTH - 1u);
				const u16 word = g_gxGpuSoftwareVram[static_cast<size_t>(y) * GX_GPU_VRAM_WIDTH + x];
				readbackPixelBytes[pixel * 2u] = static_cast<u8>(word & 0xffu);
				readbackPixelBytes[pixel * 2u + 1u] = static_cast<u8>(word >> 8u);
				pixel += 1u;
			}
		}
		readback.completeReadback(readbackToken);
	}
}

} // namespace

void renderGxGpuSoftwareFrame(const GxGpuPipelineState& state) {
	executeGxGpuSoftwareVramCommands(*state.commandBuffer, *state.readbackPort, *state.vramSnapshotBytes, state.vramSnapshotSerial);
	scanoutGxGpuSoftwareVram(state);
}

void SoftwareBackend::captureGxGpuVramSnapshot(GxGpu& gxGpu) {
	const GxGpuDeviceOutput& output = gxGpu.readDeviceOutput();
	executeGxGpuSoftwareVramCommands(*output.commandBuffer, *output.readbackPort, *output.vramSnapshotBytes, output.vramSnapshotSerial);
	for (size_t wordIndex = 0u; wordIndex < kGxGpuSoftwareVramWords; wordIndex += 1u) {
		const size_t byteIndex = wordIndex << 1u;
		const u16 word = g_gxGpuSoftwareVram[wordIndex];
		g_gxGpuSoftwareVramSnapshotScratch[byteIndex] = static_cast<u8>(word & 0xffu);
		g_gxGpuSoftwareVramSnapshotScratch[byteIndex + 1u] = static_cast<u8>(word >> 8u);
	}
	g_gxGpuSoftwareVramSnapshotSerial = gxGpu.commitRenderedVramSnapshotBytes(g_gxGpuSoftwareVramSnapshotScratch.data());
}

void registerGxGpuPassSoftware(RenderPassLibrary& registry, SoftwareBackend& backend) {
	bindGxGpuSoftwareScanoutBackend(backend);
	RenderPassDef desc;
	desc.id = "gx_gpu";
	desc.name = "GXGPU";
	setGxGpuGraph(desc);
	desc.exec = executeGxGpuSoftwarePass;
	registry.registerPass(desc);
}

} // namespace bmsx
