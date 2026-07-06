#include "machine/devices/gx/gpu.h"
#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/memory/memory.h"
#include "machine/model_registry.h"

#include <array>
#include <cstdint>
#include <stdexcept>

namespace {

struct GpuHarness {
	std::array<uint8_t, 1> emptyRom{{0}};
	bmsx::Memory memory;
	bmsx::GxGpu gpu;

	GpuHarness()
		: memory(bmsx::MemoryInit{ { emptyRom.data(), 0u }, { emptyRom.data(), 0u } })
		, gpu(memory) {
		gpu.reset();
	}
};

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

void testGp1DisplayModeOwnsPalNtsc() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;

	require(gpu.readDisplayModeWord() == bmsx::PSX_GPU_DISPLAY_MODE_PAL_WORD, "GX-GPU reset PAL display mode");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_PAL_MODE) == bmsx::GX_GPU_STATUS_PAL_MODE, "GX-GPU reset GPUSTAT PAL bit");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_RESET_WORD) == bmsx::GX_GPU_STATUS_RESET_WORD, "GX-GPU reset GPUSTAT base bits");

	require(gpu.writeGp1((bmsx::GX_GPU_GP1_SET_DISPLAY_MODE << 24u) | 0x00000000u) == bmsx::GX_GPU_GP1_SET_DISPLAY_MODE, "GX-GPU GP1 display opcode");

	require(gpu.readDisplayModeWord() == 0u, "GX-GPU GP1 display NTSC payload");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_PAL_MODE) == 0u, "GX-GPU GP1 clears GPUSTAT PAL bit");
}

void testGp1ResetRestoresPalDisplayStatus() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;

	gpu.writeGp1((bmsx::GX_GPU_GP1_SET_DISPLAY_MODE << 24u) | 0x00000000u);
	require(gpu.readDisplayModeWord() == 0u, "GX-GPU GP1 display NTSC before reset");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_PAL_MODE) == 0u, "GX-GPU GP1 PAL bit clear before reset");

	require(gpu.writeGp1(bmsx::GX_GPU_GP1_RESET << 24u) == bmsx::GX_GPU_GP1_RESET, "GX-GPU GP1 reset opcode");

	require(gpu.readDisplayModeWord() == bmsx::PSX_GPU_DISPLAY_MODE_PAL_WORD, "GX-GPU GP1 reset display mode");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_PAL_MODE) == bmsx::GX_GPU_STATUS_PAL_MODE, "GX-GPU GP1 reset PAL bit");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_RESET_WORD) == bmsx::GX_GPU_STATUS_RESET_WORD, "GX-GPU GP1 reset base bits");
}

void testDisplayModeStatusBits() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;

	gpu.writeGp1((bmsx::GX_GPU_GP1_SET_DISPLAY_MODE << 24u) | 0x000000ffu);

	const uint32_t statusBits = bmsx::GX_GPU_STATUS_REVERSE_FLAG
		| bmsx::GX_GPU_STATUS_HORIZONTAL_RESOLUTION_2
		| bmsx::GX_GPU_STATUS_VERTICAL_RESOLUTION
		| bmsx::GX_GPU_STATUS_PAL_MODE
		| bmsx::GX_GPU_STATUS_DISPLAY_AREA_COLOR_DEPTH_24
		| bmsx::GX_GPU_STATUS_VERTICAL_INTERLACE;
	require((gpu.readStatus() & statusBits) == statusBits, "GX-GPU display mode GPUSTAT single-bit fields");
	require((gpu.readStatus() & (0x3u << 17u)) == (0x3u << 17u), "GX-GPU display mode GPUSTAT horizontal resolution");
}

void testDisplayDisableAndDmaDirectionStatusBits() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;

	gpu.writeGp1(bmsx::GX_GPU_GP1_SET_DISPLAY_DISABLE << 24u);
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_DISPLAY_DISABLE) == 0u, "GX-GPU GP1 display enable clears display-disable bit");

	gpu.writeGp1((bmsx::GX_GPU_GP1_SET_DISPLAY_DISABLE << 24u) | 1u);
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_DISPLAY_DISABLE) == bmsx::GX_GPU_STATUS_DISPLAY_DISABLE, "GX-GPU GP1 display disable bit");

	gpu.writeGp1((bmsx::GX_GPU_GP1_SET_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_DMA_DIRECTION_MASK) == (bmsx::GX_GPU_DMA_DIRECTION_CPU_TO_GP0 << bmsx::GX_GPU_STATUS_DMA_DIRECTION_SHIFT), "GX-GPU GP1 DMA CPU-to-GP0 direction");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_DMA_DATA_REQUEST) == bmsx::GX_GPU_STATUS_DMA_DATA_REQUEST, "GX-GPU GP1 DMA request follows receive readiness");

	gpu.writeGp1((bmsx::GX_GPU_GP1_SET_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU);
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_DMA_DIRECTION_MASK) == (bmsx::GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU << bmsx::GX_GPU_STATUS_DMA_DIRECTION_SHIFT), "GX-GPU GP1 DMA GPUREAD-to-CPU direction");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_DMA_DATA_REQUEST) == 0u, "GX-GPU GP1 DMA request follows send readiness");
}

void testGp1CrtcRangeRegistersLatchMaskedRawWords() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;

	gpu.writeGp1((bmsx::GX_GPU_GP1_SET_DISPLAY_START << 24u) | 0x00ffffffu);
	gpu.writeGp1((bmsx::GX_GPU_GP1_SET_HORIZONTAL_DISPLAY_RANGE << 24u) | 0x00ffffffu);
	gpu.writeGp1((bmsx::GX_GPU_GP1_SET_VERTICAL_DISPLAY_RANGE << 24u) | 0x00ffffffu);
	gpu.writeGp1((bmsx::GX_GPU_GP1_SET_TEXTURE_DISABLE_MASK << 24u) | 0x00ffffffu);

	require(gpu.readDisplayStartWord() == bmsx::GX_GPU_DISPLAY_START_MASK, "GX-GPU GP1 display start mask");
	require(gpu.readHorizontalDisplayRangeWord() == bmsx::GX_GPU_HORIZONTAL_DISPLAY_RANGE_MASK, "GX-GPU GP1 horizontal display range mask");
	require(gpu.readVerticalDisplayRangeWord() == bmsx::GX_GPU_VERTICAL_DISPLAY_RANGE_MASK, "GX-GPU GP1 vertical display range mask");
	require(gpu.readTextureDisableMaskWord() == 1u, "GX-GPU GP1 texture-disable mask latch");
}

void testGp0IrqRequestAndGp1Acknowledge() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;

	gpu.writeGp0(bmsx::GX_GPU_GP0_IRQ_REQUEST << 24u);
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_INTERRUPT_REQUEST) == bmsx::GX_GPU_STATUS_INTERRUPT_REQUEST, "GX-GPU GP0 IRQ request bit");

	gpu.writeGp1(bmsx::GX_GPU_GP1_ACK_INTERRUPT << 24u);
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_INTERRUPT_REQUEST) == 0u, "GX-GPU GP1 IRQ acknowledge clears request bit");
}

void testMmioGp0Gp1() {
	GpuHarness harness;
	bmsx::Memory& memory = harness.memory;

	memory.writeMappedU32LE(bmsx::IO_GX_GPU_GP0, 0x12345678u);
	memory.writeMappedU32LE(bmsx::IO_GX_GPU_GP1, (bmsx::GX_GPU_GP1_SET_DISPLAY_MODE << 24u) | 0x00000000u);

	require(memory.readMappedU32LE(bmsx::IO_GX_GPU_GP0) == 0x12345678u, "GX-GPU GP0 MMIO");
	require((memory.readMappedU32LE(bmsx::IO_GX_GPU_GP1) & bmsx::GX_GPU_STATUS_READY_TO_RECEIVE_DMA) == bmsx::GX_GPU_STATUS_READY_TO_RECEIVE_DMA, "GX-GPU GP1 GPUSTAT receive-ready bit");
	require((memory.readMappedU32LE(bmsx::IO_GX_GPU_GP1) & bmsx::GX_GPU_STATUS_PAL_MODE) == 0u, "GX-GPU GP1 MMIO GPUSTAT PAL bit");
}

} // namespace

int main() {
	testGp1DisplayModeOwnsPalNtsc();
	testGp1ResetRestoresPalDisplayStatus();
	testDisplayModeStatusBits();
	testDisplayDisableAndDmaDirectionStatusBits();
	testGp1CrtcRangeRegistersLatchMaskedRawWords();
	testGp0IrqRequestAndGp1Acknowledge();
	testMmioGp0Gp1();
	return 0;
}
