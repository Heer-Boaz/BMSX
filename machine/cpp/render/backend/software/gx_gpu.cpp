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
size_t g_gxGpuSoftwareProcessedTransferCount = 0u;
u32 g_gxGpuSoftwareProcessedTransferSerial = 0u;
u64 g_gxGpuSoftwareVramSnapshotSerial = 0u;
std::array<u8, GX_GPU_VRAM_BYTE_COUNT> g_gxGpuSoftwareVramSnapshotScratch{};

void executeGxGpuSoftwarePass(GPUBackend* backend, GameView*, void*, RenderPassStateStorage& stateStorage, void*) {
	renderGxGpuSoftwareFrame(static_cast<SoftwareBackend&>(*backend), stateStorage.gxGpu);
}

void executeGxGpuSoftwareVramTransfers(const GxGpuSystemVramPort& transfer) {
	if (g_gxGpuSoftwareProcessedTransferSerial != transfer.serial) {
		g_gxGpuSoftwareProcessedTransferCount = 0u;
		g_gxGpuSoftwareProcessedTransferSerial = transfer.serial;
	}
	for (size_t commandIndex = g_gxGpuSoftwareProcessedTransferCount; commandIndex < transfer.presentCommandCount; commandIndex += 1u) {
		const u32 positionWord = transfer.commandPositionWord[commandIndex];
		const u32 width = gxGpuSystemVramWidth(transfer.commandSizeWord[commandIndex]);
		const u32 height = gxGpuSystemVramHeight(transfer.commandSizeWord[commandIndex]);
		const size_t payloadWordStart = transfer.commandWordStart[commandIndex];
		u32 pixelIndex = 0u;
		for (u32 row = 0u; row < height; row += 1u) {
			const u32 rowY = gxGpuSystemVramRowY(positionWord, row);
			for (u32 column = 0u; column < width; column += 1u) {
				const u32 payloadWord = transfer.words[payloadWordStart + (pixelIndex >> 1u)];
				g_gxGpuSoftwareVram[gxGpuSoftwareVramIndex(static_cast<i32>(gxGpuSystemVramColumnX(positionWord, column)), static_cast<i32>(rowY))] = static_cast<u16>(gxGpuTransferPixelWord(payloadWord, pixelIndex));
				pixelIndex += 1u;
			}
		}
	}
	g_gxGpuSoftwareProcessedTransferCount = transfer.presentCommandCount;
}

void executeGxGpuSoftwareVramCommands(const GxGpuCommandBuffer& commandBuffer, const GxGpuSystemVramPort& systemVramPort, GxGpuReadbackPort& readback, const std::array<u8, GX_GPU_VRAM_BYTE_COUNT>& snapshotBytes, u64 snapshotSerial) {
	const u32 commandSerial = commandBuffer.serial;
	if (g_gxGpuSoftwareVramSnapshotSerial != snapshotSerial) {
		loadGxGpuSoftwareVramBytes(snapshotBytes.data());
		g_gxGpuSoftwareProcessedCommandCount = 0u;
		g_gxGpuSoftwareProcessedCommandSerial = commandSerial;
		g_gxGpuSoftwareProcessedTransferCount = 0u;
		g_gxGpuSoftwareProcessedTransferSerial = systemVramPort.serial;
		g_gxGpuSoftwareVramSnapshotSerial = snapshotSerial;
	} else if (g_gxGpuSoftwareProcessedCommandSerial != commandSerial) {
		g_gxGpuSoftwareProcessedCommandCount = 0u;
		g_gxGpuSoftwareProcessedCommandSerial = commandSerial;
	}
	g_gxGpuSoftwareProcessedCommandCount = executeGxGpuSoftwareCommands(commandBuffer, g_gxGpuSoftwareProcessedCommandCount);
	executeGxGpuSoftwareVramTransfers(systemVramPort);
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

void renderGxGpuSoftwareFrame(SoftwareBackend& backend, const GxGpuPipelineState& state) {
	executeGxGpuSoftwareVramCommands(*state.commandBuffer, *state.systemVramPort, *state.readbackPort, *state.vramSnapshotBytes, state.vramSnapshotSerial);
	scanoutGxGpuSoftwareVram(backend, state);
}

void SoftwareBackend::captureGxGpuVramSnapshot(GxGpu& gxGpu) {
	const GxGpuDeviceOutput& output = gxGpu.readDeviceOutput();
	executeGxGpuSoftwareVramCommands(output.commandBuffer, output.systemVramPort, output.readbackPort, output.vramSnapshotBytes, output.vramSnapshotSerial);
	for (size_t wordIndex = 0u; wordIndex < kGxGpuSoftwareVramWords; wordIndex += 1u) {
		const size_t byteIndex = wordIndex << 1u;
		const u16 word = g_gxGpuSoftwareVram[wordIndex];
		g_gxGpuSoftwareVramSnapshotScratch[byteIndex] = static_cast<u8>(word & 0xffu);
		g_gxGpuSoftwareVramSnapshotScratch[byteIndex + 1u] = static_cast<u8>(word >> 8u);
	}
	g_gxGpuSoftwareVramSnapshotSerial = gxGpu.commitRenderedVramSnapshotBytes(g_gxGpuSoftwareVramSnapshotScratch.data());
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
