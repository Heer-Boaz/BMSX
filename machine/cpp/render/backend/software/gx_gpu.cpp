#include "render/backend/software/gx_gpu.h"

#include "render/backend/backend.h"
#include "render/backend/pass/library.h"
#include "render/backend/software/gx_gpu_commands.h"
#include "render/backend/software/gx_gpu_scanout.h"
#include "render/backend/software/gx_gpu_vram.h"
#include "machine/devices/gx/gpu.h"

#include <span>

namespace bmsx {
namespace {

void executeGxGpuSoftwarePass(
	GPUBackend* backend,
	VideoPresenter*,
	void*,
	RenderPassStateStorage& stateStorage,
	void*,
	const GxGpuDeviceOutput& output
) {
	renderGxGpuSoftwareFrame(static_cast<SoftwareBackend&>(*backend), stateStorage.gxGpu, output);
}

void executeGxGpuSoftwareVramCommands(
	GxGpuSoftwareState& software,
	const GxGpuCommandBuffer& commandBuffer,
	GxGpuReadbackPort& readback,
	std::span<const u8> snapshotBytes,
	u64 snapshotSerial,
	size_t commandLimit) {
	const u32 commandSerial = commandBuffer.serial;
	if (software.vramSnapshotSerial != snapshotSerial) {
		loadGxGpuSoftwareVramBytes(software, snapshotBytes);
		software.processedCommandCount = 0u;
		software.processedCommandSerial = commandSerial;
		software.vramSnapshotSerial = snapshotSerial;
	} else if (software.processedCommandSerial != commandSerial) {
		software.processedCommandCount = 0u;
		software.processedCommandSerial = commandSerial;
	}
	software.processedCommandCount = executeGxGpuSoftwareCommands(
		software,
		commandBuffer,
		software.processedCommandCount,
		commandLimit);
	if (readback.claimReadback(commandLimit)) {
		const u32 readbackToken = readback.token();
		u8* const readbackPixelBytes = readback.pixelBytes();
		size_t pixel = 0u;
		for (u32 row = 0u; row < readback.height(); row += 1u) {
			const u32 y = gxGpuVramYAddress(readback.y() + row, readback.vramYAddressExtensionWord());
			for (u32 column = 0u; column < readback.width(); column += 1u) {
				const u32 x = (readback.x() + column) & (GX_GPU_VRAM_X_ADDRESS_PERIOD - 1u);
				const u16 word = software.vram[
					(static_cast<size_t>(y) * GX_GPU_VRAM_X_ADDRESS_PERIOD + x)
					& software.vramWordMask];
				readbackPixelBytes[pixel * 2u] = static_cast<u8>(word & 0xffu);
				readbackPixelBytes[pixel * 2u + 1u] = static_cast<u8>(word >> 8u);
				pixel += 1u;
			}
		}
		readback.completeReadback(readbackToken);
	}
}

} // namespace

void renderGxGpuSoftwareFrame(
	SoftwareBackend& backend,
	const GxGpuPipelineState& state,
	const GxGpuDeviceOutput& output
) {
	executeGxGpuSoftwareVramCommands(
		backend.m_gx_gpu_software,
		output.commandBuffer,
		output.readbackPort,
		output.vramSnapshotBytes,
		output.vramSnapshotSerial,
		output.commandBuffer.presentCommandCount);
	scanoutGxGpuSoftwareVram(
		backend.m_gx_gpu_software,
		backend,
		state,
		output.pcrtcScanout,
		output.vramReplacementSerial);
}

void SoftwareBackend::executeGxGpuReadback(GxGpu& gxGpu) {
	const GxGpuDeviceOutput& output = gxGpu.readDeviceOutput();
	executeGxGpuSoftwareVramCommands(
		m_gx_gpu_software,
		output.commandBuffer,
		output.readbackPort,
		output.vramSnapshotBytes,
		output.vramSnapshotSerial,
		output.readbackPort.fenceCommandCount());
}

void SoftwareBackend::executeGxGpuCommandDrain(GxGpu& gxGpu) {
	const GxGpuDeviceOutput& output = gxGpu.readDeviceOutput();
	executeGxGpuSoftwareVramCommands(
		m_gx_gpu_software,
		output.commandBuffer,
		output.readbackPort,
		output.vramSnapshotBytes,
		output.vramSnapshotSerial,
		output.commandBuffer.executedCommandCount);
	gxGpu.retireExecutedCommands();
}

void SoftwareBackend::captureGxGpuVramSnapshot(GxGpu& gxGpu) {
	const GxGpuDeviceOutput& output = gxGpu.readDeviceOutput();
	executeGxGpuSoftwareVramCommands(
		m_gx_gpu_software,
		output.commandBuffer,
		output.readbackPort,
		output.vramSnapshotBytes,
		output.vramSnapshotSerial,
		output.commandBuffer.executedCommandCount);
	for (size_t wordIndex = 0u; wordIndex < m_gx_gpu_software.vram.size(); wordIndex += 1u) {
		const size_t byteIndex = wordIndex << 1u;
		const u16 word = m_gx_gpu_software.vram[wordIndex];
		m_gx_gpu_software.vramSnapshotScratch[byteIndex] = static_cast<u8>(word & 0xffu);
		m_gx_gpu_software.vramSnapshotScratch[byteIndex + 1u] = static_cast<u8>(word >> 8u);
	}
	m_gx_gpu_software.vramSnapshotSerial = gxGpu.commitRenderedVramSnapshotBytes(
		m_gx_gpu_software.vramSnapshotScratch,
		m_gx_gpu_software.processedCommandCount);
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
