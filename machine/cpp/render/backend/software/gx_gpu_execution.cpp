#include "render/backend/software/gx_gpu_execution.h"

#include "machine/devices/gx/gpu.h"
#include "render/backend/software/gx_gpu_commands.h"
#include "render/backend/software/gx_gpu_vram.h"

namespace bmsx {

void replaceGxGpuSoftwareVramSnapshot(GxGpuSoftwareState& software, std::span<const u8> bytes, u64 serial) {
	if (software.vramSnapshotSerial == serial) return;
	loadGxGpuSoftwareVramBytes(software, bytes);
	software.processedCommandCount = 0u;
	software.processedCommandSerial = 0u;
	software.vramSnapshotSerial = serial;
}

void executeGxGpuSoftwareCommandPrefix(GxGpuSoftwareState& software, const GxGpuCommandStorage& commands, size_t limit) {
	if (software.processedCommandSerial != commands.serial) {
		software.processedCommandCount = 0u;
		software.processedCommandSerial = commands.serial;
	}
	software.processedCommandCount = executeGxGpuSoftwareCommands(software, commands, software.processedCommandCount, limit);
}

void readGxGpuSoftwareVram(const GxGpuSoftwareState& software, const GxGpuReadbackRequest& request, u8* pixels) {
	size_t pixel = 0u;
	for (u32 row = 0u; row < request.height; ++row) {
		const u32 y = gxGpuVramYAddress(request.y + row, request.vramYAddressExtensionWord);
		for (u32 column = 0u; column < request.width; ++column) {
			const u32 x = (request.x + column) & (GX_GPU_VRAM_X_ADDRESS_PERIOD - 1u);
			const u16 word = software.vram[(static_cast<size_t>(y) * GX_GPU_VRAM_X_ADDRESS_PERIOD + x) & software.vramWordMask];
			pixels[pixel * 2u] = static_cast<u8>(word);
			pixels[pixel * 2u + 1u] = static_cast<u8>(word >> 8u);
			++pixel;
		}
	}
}

void executeGxGpuSoftwareVramCommands(GxGpuSoftwareState& software, const GxGpuDeviceOutput& output, size_t limit) {
	replaceGxGpuSoftwareVramSnapshot(software, output.vramSnapshotBytes, output.vramSnapshotSerial);
	executeGxGpuSoftwareCommandPrefix(software, output.commandBuffer, limit);
	auto& readback = output.readbackPort;
	if (readback.claimReadback(limit)) {
		const u32 token = readback.token();
		const GxGpuReadbackRequest request{readback.x(), readback.y(), readback.width(), readback.height(), readback.vramYAddressExtensionWord()};
		readGxGpuSoftwareVram(software, request, readback.pixelBytes());
		readback.completeReadback(token);
	}
}

void captureGxGpuSoftwareVramSnapshot(GxGpuSoftwareState& software, GxGpu& gxGpu) {
	const GxGpuDeviceOutput& output = gxGpu.readDeviceOutput();
	executeGxGpuSoftwareVramCommands(software, output, output.commandBuffer.executedCommandCount);
	for (size_t wordIndex = 0u; wordIndex < software.vram.size(); ++wordIndex) {
		const u16 word = software.vram[wordIndex];
		software.vramSnapshotScratch[wordIndex * 2u] = static_cast<u8>(word);
		software.vramSnapshotScratch[wordIndex * 2u + 1u] = static_cast<u8>(word >> 8u);
	}
	software.vramSnapshotSerial = gxGpu.commitRenderedVramSnapshotBytes(software.vramSnapshotScratch, software.processedCommandCount);
}

} // namespace bmsx
