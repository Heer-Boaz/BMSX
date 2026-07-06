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

void testGp0DrawModeAndMaskBitEnvironmentCommands() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;

	gpu.writeGp0((bmsx::GX_GPU_GP0_SET_DRAW_MODE << 24u) | 0x00ffffffu);

	require(gpu.readDrawModeWord() == bmsx::GX_GPU_DRAW_MODE_MASK, "GX-GPU GP0 draw-mode word mask");
	require((gpu.readStatus() & bmsx::GX_GPU_DRAW_MODE_GPUSTAT_MASK) == bmsx::GX_GPU_DRAW_MODE_GPUSTAT_MASK, "GX-GPU GP0 draw-mode GPUSTAT bits");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_TEXTURE_DISABLE) == 0u, "GX-GPU GP0 texture-disable bit stays masked off");

	gpu.writeGp1((bmsx::GX_GPU_GP1_SET_TEXTURE_DISABLE_MASK << 24u) | 1u);
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_TEXTURE_DISABLE) == bmsx::GX_GPU_STATUS_TEXTURE_DISABLE, "GX-GPU GP1 permits GP0 texture-disable status bit");

	gpu.writeGp0((bmsx::GX_GPU_GP0_SET_MASK_BIT << 24u) | 0x00000003u);
	require(gpu.readMaskBitModeWord() == 3u, "GX-GPU GP0 mask-bit raw word");
	require((gpu.readStatus() & ((1u << 11u) | (1u << 12u))) == (3u << 11u), "GX-GPU GP0 mask-bit GPUSTAT bits");
	require((gpu.readDrawModeWord() & bmsx::GX_GPU_DRAW_MODE_TEXTURE_DISABLE) == bmsx::GX_GPU_DRAW_MODE_TEXTURE_DISABLE, "GX-GPU GP0 draw-mode texture-disable source bit");
}

void testGp0EnvironmentRegistersAndGpuInfoQueries() {
	GpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	bmsx::GxGpu& gpu = harness.gpu;

	gpu.writeGp0((bmsx::GX_GPU_GP0_SET_TEXTURE_WINDOW << 24u) | 0x00ffffffu);
	gpu.writeGp0((bmsx::GX_GPU_GP0_SET_DRAWING_AREA_TOP_LEFT << 24u) | 0x00ffffffu);
	gpu.writeGp0((bmsx::GX_GPU_GP0_SET_DRAWING_AREA_BOTTOM_RIGHT << 24u) | 0x00abcdefu);
	gpu.writeGp0((bmsx::GX_GPU_GP0_SET_DRAWING_OFFSET << 24u) | 0x00ffffffu);

	require(gpu.readTextureWindowWord() == bmsx::GX_GPU_TEXTURE_WINDOW_MASK, "GX-GPU GP0 texture-window word mask");
	require(gpu.readDrawingAreaTopLeftWord() == bmsx::GX_GPU_DRAWING_AREA_MASK, "GX-GPU GP0 drawing-area top-left mask");
	require(gpu.readDrawingAreaBottomRightWord() == (0x00abcdefu & bmsx::GX_GPU_DRAWING_AREA_MASK), "GX-GPU GP0 drawing-area bottom-right mask");
	require(gpu.readDrawingOffsetWord() == bmsx::GX_GPU_DRAWING_OFFSET_MASK, "GX-GPU GP0 drawing-offset mask");

	gpu.writeGp1((bmsx::GX_GPU_GP1_GET_GPU_INFO << 24u) | 0x02u);
	require(gpu.readGpuReadWord() == bmsx::GX_GPU_TEXTURE_WINDOW_MASK, "GX-GPU GP1 info texture-window query");
	require(memory.readMappedU32LE(bmsx::IO_GX_GPU_GP0) == bmsx::GX_GPU_TEXTURE_WINDOW_MASK, "GX-GPU GPUREAD MMIO returns texture-window query");
	gpu.writeGp1((bmsx::GX_GPU_GP1_GET_GPU_INFO << 24u) | 0x03u);
	require(gpu.readGpuReadWord() == bmsx::GX_GPU_DRAWING_AREA_MASK, "GX-GPU GP1 info drawing-area top-left query");
	gpu.writeGp1((bmsx::GX_GPU_GP1_GET_GPU_INFO << 24u) | 0x04u);
	require(gpu.readGpuReadWord() == (0x00abcdefu & bmsx::GX_GPU_DRAWING_AREA_MASK), "GX-GPU GP1 info drawing-area bottom-right query");
	gpu.writeGp1((bmsx::GX_GPU_GP1_GET_GPU_INFO << 24u) | 0x05u);
	require(gpu.readGpuReadWord() == bmsx::GX_GPU_DRAWING_OFFSET_MASK, "GX-GPU GP1 info drawing-offset query");
}

void testMmioGp0Gp1() {
	GpuHarness harness;
	bmsx::Memory& memory = harness.memory;

	memory.writeMappedU32LE(bmsx::IO_GX_GPU_GP0, 0x12345678u);
	memory.writeMappedU32LE(bmsx::IO_GX_GPU_GP1, (bmsx::GX_GPU_GP1_SET_DISPLAY_MODE << 24u) | 0x00000000u);

	require(memory.readMappedU32LE(bmsx::IO_GX_GPU_GP0) == 0x00000400u, "GX-GPU GP0 read returns GPUREAD latch");
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
	testGp0DrawModeAndMaskBitEnvironmentCommands();
	testGp0EnvironmentRegistersAndGpuInfoQueries();
	testMmioGp0Gp1();
	return 0;
}
