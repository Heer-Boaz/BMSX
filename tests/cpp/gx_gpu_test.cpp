#include "machine/devices/gx/gpu.h"
#include "machine/devices/gx/gpu_pcrtc.h"
#include "machine/devices/dma/controller.h"
#include "machine/devices/irq/controller.h"
#include "render/backend/gx_gpu_render_rules.h"
#include "spec/bmsx/io.h"
#include "machine/cpu/cpu.h"
#include "machine/memory/memory.h"
#include "spec/bmsx/model.h"
#include "machine/scheduler/device.h"
#include "render/backend/backend.h"
#include "render/backend/pass/library.h"
#include "render/backend/software/gx_gpu.h"
#include "render/backend/software/gx_gpu_scanout.h"
#include "render/backend/software/gx_gpu_state.h"
#include "render/backend/software/gx_gpu_commands.h"
#include "render/backend/software/gx_gpu_vram.h"
#include "support/cartridge_fixture.h"

#include <algorithm>
#include <array>
#include <cstdint>
#include <limits>
#include <memory>
#include <span>
#include <stdexcept>
#include <vector>

namespace {

struct GpuHarness {
	std::array<uint8_t, 1> emptyRom{{0}};
	bmsx::Memory memory;
	bmsx::IrqController irq;
	bmsx::ExecutionAddressSpace executionAddressSpace;
	bmsx::CPU cpu;
	bmsx::DeviceScheduler scheduler;
	bmsx::DmaController dma;
	bmsx::GxGpu gpu;

	GpuHarness()
		: memory(
			bmsx::MemoryInit{ { emptyRom.data(), 0u }, bmsx::test::cartridgeSlots() },
			bmsx::PSX_MACHINE_SPEC.ramBytes)
		, irq(memory)
		, executionAddressSpace(memory)
		, cpu(memory, irq, executionAddressSpace)
		, scheduler(cpu)
		, dma(memory, cpu, irq, scheduler)
		, gpu(memory, cpu, irq, scheduler, dma, bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes) {
		memory.cartridgeController().connect(memory, irq, dma);
		dma.reset();
		memory.cartridgeController().reset();
		gpu.reset();
		irq.reset();
	}
};

struct CommandBufferDmaHarness {
	std::array<uint8_t, 1> emptyRom{{0}};
	bmsx::Memory memory;
	bmsx::IrqController irq;
	bmsx::ExecutionAddressSpace executionAddressSpace;
	bmsx::CPU cpu;
	bmsx::DeviceScheduler scheduler;
	bmsx::DmaController dma;

	CommandBufferDmaHarness()
		: memory(
			bmsx::MemoryInit{ { emptyRom.data(), 0u }, bmsx::test::cartridgeSlots() },
			bmsx::PSX_MACHINE_SPEC.ramBytes)
		, irq(memory)
		, executionAddressSpace(memory)
		, cpu(memory, irq, executionAddressSpace)
		, scheduler(cpu)
		, dma(memory, cpu, irq, scheduler) {
		memory.cartridgeController().connect(memory, irq, dma);
		dma.reset();
		memory.cartridgeController().reset();
		irq.reset();
	}
};

CommandBufferDmaHarness commandBufferDmaHarness;

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

void completeGpuCommands(GpuHarness& harness) {
	harness.gpu.onService(std::numeric_limits<bmsx::i64>::max() >> 1u);
}

void stopPcrtc(GpuHarness& harness) {
	const bmsx::u32 address = bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_SMODE1_LOW);
	harness.memory.writeMappedU32LE(address, harness.memory.readMappedU32LE(address) | bmsx::GX_GPU_PCRTC_SMODE1_SINT);
	harness.gpu.onService(harness.scheduler.currentNowCycles());
}

bmsx::u32 runGpuAtNextDeadline(GpuHarness& harness) {
	const bmsx::i64 deadline = harness.scheduler.nextDeadline();
	harness.scheduler.advanceTo(deadline);
	return harness.gpu.onService(deadline);
}

bmsx::u32 gxGpuVramDigest(std::span<const bmsx::u8> bytes) {
	bmsx::u32 digest = 0x811c9dc5u;
	for (const bmsx::u8 byte : bytes) {
		digest = (digest ^ byte) * 0x01000193u;
	}
	return digest;
}

void testPcrtcSintStopsBeamAndReleaseStartsFreshLineEpoch() {
	bmsx::GxGpuPcrtc pcrtc;
	pcrtc.reset(0);
	pcrtc.setCpuHz(5'000'000, 0);
	const bmsx::u32 runningSMode1 = pcrtc.readRegisterWord(bmsx::GX_GPU_PCRTC_SMODE1_LOW);

	require(pcrtc.nextDeadlineCycle() == 320, "GX-GPU PCRTC reset schedules the first HSync edge");
	pcrtc.service(320);
	require((pcrtc.readCsr() & bmsx::GX_GPU_PCRTC_CSR_HSINT) != 0u, "GX-GPU PCRTC HSync edge raises HSINT");
	pcrtc.writeConfigWord(bmsx::GX_GPU_PCRTC_SMODE1_LOW, runningSMode1 | bmsx::GX_GPU_PCRTC_SMODE1_SINT, 320);
	pcrtc.writeCsr(bmsx::GX_GPU_PCRTC_CSR_HSINT, 320);
	require(pcrtc.nextDeadlineCycle() == -1, "GX-GPU PCRTC SINT stops the beam without a deadline");

	pcrtc.writeConfigWord(bmsx::GX_GPU_PCRTC_SMODE1_LOW, runningSMode1, 500);
	require(pcrtc.nextDeadlineCycle() == 820, "GX-GPU PCRTC SINT release starts a fresh line epoch");
}

void testPcrtcAcceptsCycleZeroAndCoalescesSubCycleFields() {
	bmsx::GxGpuPcrtc pcrtc;
	pcrtc.reset(0);
	pcrtc.writeConfigWord(bmsx::GX_GPU_PCRTC_SMODE1_LOW, 0x00000009u, 0);
	pcrtc.writeConfigWord(bmsx::GX_GPU_PCRTC_SMODE1_HIGH, 0u, 0);
	pcrtc.writeConfigWord(bmsx::GX_GPU_PCRTC_SYNCH1_LOW, 1u, 0);
	pcrtc.writeConfigWord(bmsx::GX_GPU_PCRTC_SYNCH1_HIGH, 0u, 0);
	pcrtc.writeConfigWord(bmsx::GX_GPU_PCRTC_SYNCH2_LOW, 0u, 0);
	pcrtc.writeConfigWord(bmsx::GX_GPU_PCRTC_SYNCH2_HIGH, 0u, 0);
	pcrtc.writeConfigWord(bmsx::GX_GPU_PCRTC_SYNCV_LOW, 0u, 0);
	pcrtc.writeConfigWord(bmsx::GX_GPU_PCRTC_SYNCV_HIGH, 1u << 21u, 0);
	pcrtc.setCpuHz(5'000'000, 0);

	require(pcrtc.timing.totalHalfLines == 1u, "GX-GPU PCRTC raw one-half-line field timing");
	require(pcrtc.timing.activeDisplayHalfLines == 0u, "GX-GPU PCRTC raw zero-active-line field timing");
	require(pcrtc.nextDeadlineCycle() == 0, "GX-GPU PCRTC accepts an absolute cycle-zero deadline");
	require((pcrtc.service(0) & bmsx::GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_BEGIN) != 0u, "GX-GPU PCRTC cycle-zero field emits VBlank begin");
	require(pcrtc.nextDeadlineCycle() == 1, "GX-GPU PCRTC advances a sub-cycle field to the next machine cycle");
	require((pcrtc.service(1) & bmsx::GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_BEGIN) != 0u, "GX-GPU PCRTC coalesces repeated sub-cycle fields into one runtime edge");
	require(pcrtc.nextDeadlineCycle() == 2, "GX-GPU PCRTC preserves the next physical deadline after event batching");
	require(pcrtc.field() == 1u, "GX-GPU PCRTC event batching preserves final field parity");
}

void testPcrtcRetainsFrameBudgetsAboveSignedCpuSlice() {
	bmsx::GxGpuPcrtc pcrtc;
	pcrtc.reset(0);
	pcrtc.setCpuHz(110'000'000'000, 0);
	require(pcrtc.timing.nextVblankCycleBudget > 0x7fffffff, "GX-GPU PCRTC retains a 64-bit next-VBlank cycle budget");
}

void testPcrtcAdvancesExactRawHalfLinesBeyondDoubleProductPrecision() {
	bmsx::GxGpuPcrtc pcrtc;
	pcrtc.reset(0);
	pcrtc.writeConfigWord(bmsx::GX_GPU_PCRTC_SMODE1_LOW, 0x0000082fu, 0);
	pcrtc.writeConfigWord(bmsx::GX_GPU_PCRTC_SMODE1_HIGH, 0x00000010u, 0);
	pcrtc.writeConfigWord(bmsx::GX_GPU_PCRTC_SYNCH1_LOW, 0x000ed724u, 0);
	pcrtc.writeConfigWord(bmsx::GX_GPU_PCRTC_SYNCH1_HIGH, 0x07b4c800u, 0);
	pcrtc.writeConfigWord(bmsx::GX_GPU_PCRTC_SYNCH2_LOW, 0x07d79334u, 0);
	pcrtc.writeConfigWord(bmsx::GX_GPU_PCRTC_SYNCH2_HIGH, 0u, 0);
	pcrtc.writeConfigWord(bmsx::GX_GPU_PCRTC_SYNCV_LOW, 0xc1611944u, 0);
	pcrtc.writeConfigWord(bmsx::GX_GPU_PCRTC_SYNCV_HIGH, 0x40661eceu, 0);
	pcrtc.setCpuHz(50'000'000, 0);

	for (const bmsx::i64 deadline : std::array<bmsx::i64, 3>{2'029'892, 793'687'425, 1'593'464'523}) {
		require(pcrtc.nextDeadlineCycle() == deadline, "GX-GPU PCRTC raw precision vector reaches its exact intermediate deadline");
		pcrtc.service(deadline);
	}
	require(pcrtc.nextDeadlineCycle() == 10'376'803'360, "GX-GPU PCRTC raw precision vector reaches its exact field deadline");
	require(pcrtc.currentHalfLine(10'376'803'359) == 10'223u, "GX-GPU PCRTC raw precision vector stays before the field edge one cycle early");
	require(pcrtc.currentHalfLine(10'376'803'360) == 10'224u, "GX-GPU PCRTC raw precision vector reaches the exact field half-line");
	require((pcrtc.service(10'376'803'360) & bmsx::GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_END) != 0u, "GX-GPU PCRTC raw precision vector publishes the exact field-end edge");
	const bmsx::GxGpuPcrtcState state = pcrtc.captureState(10'376'803'360);
	require(state.beamCycleOffset == 0, "GX-GPU PCRTC raw precision vector retains the exact beam cycle");
	require(state.beamRemainder == 0u, "GX-GPU PCRTC raw precision vector retains the exact beam remainder");
	require(state.beamHalfLine == 0u, "GX-GPU PCRTC raw precision vector starts the next field at half-line zero");
}

void testGp0RawDrawWordDecoders() {
	require(bmsx::gxGpuSigned11(0x000003ffu) == 1023, "GX-GPU signed 11-bit positive coordinate");
	require(bmsx::gxGpuSigned11(0x00000400u) == -1024, "GX-GPU signed 11-bit minimum coordinate");
	require(bmsx::gxGpuSigned11(0x000007ffu) == -1, "GX-GPU signed 11-bit negative coordinate");

	require(bmsx::gxGpuSigned11(0x000007ffu) == -1, "GX-GPU vertex x decode");
	require(bmsx::gxGpuVertexY(0x07ff0000u) == -1, "GX-GPU vertex y decode");
	require(bmsx::gxGpuDisplayStartX(123u | (456u << 10u)) == 123u, "GX-GPU display start x decode");
	require(bmsx::gxGpuDisplayStartY(123u | (456u << 10u), 0u) == 456u, "GX-GPU display start y decode");
	require(bmsx::gxGpuScanoutField(bmsx::GX_GPU_STATUS_INTERLACED_FIELD) == 0u, "GX-GPU GPUSTAT field zero decode");
	require(bmsx::gxGpuScanoutField(0u) == 1u, "GX-GPU GPUSTAT field one decode");
	require(bmsx::gxGpuScanoutSourceLineStep(0u) == 0u, "GX-GPU progressive scanout line step");
	require(bmsx::gxGpuScanoutSourceLineStep(bmsx::GX_GPU_DISPLAY_MODE_VERTICAL_INTERLACE_BIT) == 1u, "GX-GPU low-resolution interlaced scanout line step");
	require(bmsx::gxGpuScanoutSourceLineStep(bmsx::GX_GPU_DISPLAY_MODE_VERTICAL_INTERLACE_BIT | bmsx::GX_GPU_DISPLAY_MODE_VERTICAL_RESOLUTION_BIT) == 2u, "GX-GPU 480i scanout line step");
	require(bmsx::gxGpuDisplayModeScreenWidth(0u) == 256u, "GX-GPU 256-wide display mode");
	require(bmsx::gxGpuDisplayModeScreenWidth(1u) == 320u, "GX-GPU 320-wide display mode");
	require(bmsx::gxGpuDisplayModeScreenWidth(2u) == 512u, "GX-GPU 512-wide display mode");
	require(bmsx::gxGpuDisplayModeScreenWidth(3u) == 640u, "GX-GPU 640-wide display mode");
	require(bmsx::gxGpuDisplayModeScreenWidth(0x40u) == 368u, "GX-GPU 368-wide display mode");
	require(bmsx::gxGpuDisplayModeScreenWidth(0x41u) == 368u, "GX-GPU 368-wide override display mode");
	require(bmsx::GX_GPU_RESET_HORIZONTAL_DISPLAY_RANGE_WORD == 0x00c60260u, "GX-GPU reset keeps the PSX horizontal timing window");
	require(bmsx::gxGpuVerticalDisplayRangeStart((227u << 10u) | 35u) == 35u, "GX-GPU vertical display start decode");
	require(bmsx::gxGpuVerticalDisplayRangeEnd((227u << 10u) | 35u) == 227u, "GX-GPU vertical display end decode");
	require(bmsx::gxGpuVerticalVisibleLines((227u << 10u) | 35u, 0x08u) == 192, "GX-GPU progressive 192-line display range");
	require(bmsx::gxGpuVerticalVisibleLines((275u << 10u) | 35u, 0x08u) == 240, "GX-GPU progressive 240-line display range");
	require(bmsx::gxGpuVerticalVisibleLines((275u << 10u) | 35u, 0x28u) == 480, "GX-GPU interlaced display range line count");
	require(bmsx::gxGpuVerticalVisibleLines((35u << 10u) | 227u, 0x08u) == -192, "GX-GPU inverted vertical range remains signed datapath state");
	require(bmsx::gxGpuDisplayModeScreenWidth(bmsx::GX_GPU_RESET_DISPLAY_MODE_WORD) == 320u, "GX-GPU reset display mode exposes 320 columns");
	require(bmsx::gxGpuVerticalVisibleLines(bmsx::GX_GPU_RESET_VERTICAL_DISPLAY_RANGE_WORD, bmsx::GX_GPU_RESET_DISPLAY_MODE_WORD) == 240, "GX-GPU reset vertical range exposes 240 lines");
	require(bmsx::gxGpuDrawingOffsetY(0x003ff800u) == -1, "GX-GPU drawing offset y decode");

	require(bmsx::gxGpuCommandRectangleWidth(bmsx::GX_GPU_GP0_RECTANGLE_FIRST, 0x012c03ffu) == 1023u, "GX-GPU variable rectangle width");
	require(bmsx::gxGpuCommandRectangleHeight(bmsx::GX_GPU_GP0_RECTANGLE_FIRST, 0x012c03ffu) == 300u, "GX-GPU variable rectangle height");
	require(bmsx::gxGpuCommandRectangleWidth(bmsx::GX_GPU_GP0_RECTANGLE_FIRST | 0x08u, 0u) == 1u, "GX-GPU 1x1 rectangle width");
	require(bmsx::gxGpuCommandRectangleHeight(bmsx::GX_GPU_GP0_RECTANGLE_FIRST | 0x08u, 0u) == 1u, "GX-GPU 1x1 rectangle height");
	require(bmsx::gxGpuCommandRectangleWidth(bmsx::GX_GPU_GP0_RECTANGLE_FIRST | 0x10u, 0u) == 8u, "GX-GPU 8x8 rectangle width");
	require(bmsx::gxGpuCommandRectangleHeight(bmsx::GX_GPU_GP0_RECTANGLE_FIRST | 0x10u, 0u) == 8u, "GX-GPU 8x8 rectangle height");
	require(bmsx::gxGpuCommandRectangleWidth(bmsx::GX_GPU_GP0_RECTANGLE_FIRST | 0x18u, 0u) == 16u, "GX-GPU 16x16 rectangle width");
	require(bmsx::gxGpuCommandRectangleHeight(bmsx::GX_GPU_GP0_RECTANGLE_FIRST | 0x18u, 0u) == 16u, "GX-GPU 16x16 rectangle height");
	require(bmsx::gxGpuFillX(0x01ff03ffu) == 0x03f0u, "GX-GPU fill X rounds down to 16-pixel unit");
	require(bmsx::gxGpuFillWidth(0u) == 0u, "GX-GPU zero fill width stays zero");
	require(bmsx::gxGpuFillHeight(0u) == 0u, "GX-GPU zero fill height stays zero");
	require(bmsx::gxGpuFillWidth(1u) == 16u, "GX-GPU fill width rounds up to 16-pixel unit");
	require(bmsx::gxGpuFillWidth(0x03f0u) == 1008u, "GX-GPU aligned fill width");
	require(bmsx::gxGpuFillWidth(0x03f1u) == 1024u, "GX-GPU fill width can round up to full VRAM width");
	require(bmsx::gxGpuFillHeight(0x01ff0000u) == 511u, "GX-GPU fill height decode");
	require(bmsx::gxGpuVramWrappedWidth(1000u, 12u) == 12u, "GX-GPU non-wrapped VRAM width run");
	require(bmsx::gxGpuVramWrappedWidth(1008u, 1024u) == 16u, "GX-GPU wrapped VRAM width first run");
	require(bmsx::gxGpuVramWrappedWidth(0u, 1008u) == 1008u, "GX-GPU full-start VRAM width run");
	require(bmsx::gxGpuVramWrappedHeight(500u, 12u, 0u, bmsx::GX_GPU_VRAM_Y_ADDRESS_PERIOD - 1u) == 12u, "GX-GPU non-wrapped VRAM height run");
	require(bmsx::gxGpuVramWrappedHeight(511u, 511u, 0u, bmsx::GX_GPU_VRAM_Y_ADDRESS_PERIOD - 1u) == 1u, "GX-GPU wrapped VRAM height first run");
	require(bmsx::gxGpuVramWrappedHeight(0u, 511u, 0u, bmsx::GX_GPU_VRAM_Y_ADDRESS_PERIOD - 1u) == 511u, "GX-GPU full-start VRAM height run");
	require(bmsx::gxGpuVramLogicalAreaOverlapsBounds(1008u, 500u, 32u, 24u, 0, 0, 8, 8, 0u, bmsx::GX_GPU_VRAM_Y_ADDRESS_PERIOD - 1u), "GX-GPU wrapped VRAM area overlaps low corner bounds");
	require(!bmsx::gxGpuVramLogicalAreaOverlapsBounds(1008u, 500u, 32u, 24u, 512, 256, 520, 264, 0u, bmsx::GX_GPU_VRAM_Y_ADDRESS_PERIOD - 1u), "GX-GPU wrapped VRAM area excludes separated bounds");
	require(bmsx::gxGpuVramLogicalAreaOverlapsBounds(60u, 8u, 1u, 1u, 60, 520, 61, 521, 0u, bmsx::GX_GPU_VRAM_Y_ADDRESS_PERIOD - 1u), "GX-GPU logical rows alias when the Y gate is closed");
	require(bmsx::gxGpuVramCopyNeedsChunking(10u, 20u, 12u, 24u, 32u, 16u, 1u, bmsx::GX_GPU_VRAM_Y_ADDRESS_PERIOD - 1u), "GX-GPU diagonal overlapping copy chunks");
	require(bmsx::gxGpuVramCopyChunkHeight(20u, 24u, 16u, 1u, bmsx::GX_GPU_VRAM_Y_ADDRESS_PERIOD - 1u) == 4u, "GX-GPU diagonal overlapping copy chunk height");
	require(bmsx::gxGpuVramCopyNeedsChunking(10u, 20u, 10u, 24u, 32u, 16u, 1u, bmsx::GX_GPU_VRAM_Y_ADDRESS_PERIOD - 1u), "GX-GPU vertical-only overlapping copy chunks");
	require(!bmsx::gxGpuVramCopyNeedsChunking(10u, 20u, 12u, 20u, 32u, 16u, 1u, bmsx::GX_GPU_VRAM_Y_ADDRESS_PERIOD - 1u), "GX-GPU horizontal-only copy is not chunked");
	require(!bmsx::gxGpuVramCopyNeedsChunking(10u, 20u, 50u, 24u, 32u, 16u, 1u, bmsx::GX_GPU_VRAM_Y_ADDRESS_PERIOD - 1u), "GX-GPU separated X copy is not chunked");
	require(!bmsx::gxGpuVramCopyNeedsChunking(10u, 20u, 12u, 40u, 32u, 16u, 1u, bmsx::GX_GPU_VRAM_Y_ADDRESS_PERIOD - 1u), "GX-GPU separated Y copy is not chunked");
	require(bmsx::gxGpuVramCopyChunkHeight(20u, 80u, 16u, 1u, bmsx::GX_GPU_VRAM_Y_ADDRESS_PERIOD - 1u) == 16u, "GX-GPU non-overlapping row distance clamps to height");
	std::array<bmsx::u32, 2u * bmsx::GX_GPU_TRIANGLE_ATTRIBUTE_PLANE_PHASES> uvPlane{1, 2, 17, 2, 1, 18};
	bmsx::gxGpuTriangleAttributePlane(uvPlane.data(), 0u, 2u, 256, 0, 0, 16, 0, 0, 16);
	require(uvPlane == std::array<bmsx::u32, 6u>{6144, 10240, 4096, 0, 0, 4096}, "GX-GPU attribute plane retains raw base and step words");
	require(((uvPlane[0] & bmsx::GX_GPU_TRIANGLE_ATTRIBUTE_ACCUMULATOR_MASK) >> bmsx::GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS) == 1, "GX-GPU fixed attribute first vertex decode");
	require((((uvPlane[0] + uvPlane[2] * 16) & bmsx::GX_GPU_TRIANGLE_ATTRIBUTE_ACCUMULATOR_MASK) >> bmsx::GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS) == 17, "GX-GPU fixed attribute second vertex decode");
	require((((uvPlane[1] + uvPlane[5] * 16) & bmsx::GX_GPU_TRIANGLE_ATTRIBUTE_ACCUMULATOR_MASK) >> bmsx::GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS) == 18, "GX-GPU fixed attribute third vertex decode");

	require(bmsx::gxGpuTransferX(0x01ff03ffu) == 1023u, "GX-GPU transfer x decode");
	require(bmsx::gxGpuTransferY(0x01ff03ffu, 0u) == 511u, "GX-GPU transfer y decode");
	require(bmsx::gxGpuTransferWidth(0u) == 1024u, "GX-GPU zero transfer width means full VRAM row");
	require(bmsx::gxGpuTransferHeight(0u) == 512u, "GX-GPU zero transfer height means full VRAM height");
	require(bmsx::gxGpuTransferWidth(0x012c0007u) == 7u, "GX-GPU transfer width decode");
	require(bmsx::gxGpuTransferHeight(0x012c0007u) == 300u, "GX-GPU transfer height decode");
	require(bmsx::gxGpuTransferPixelWord(0x89abcdefu, 0u) == 0xcdefu, "GX-GPU transfer low pixel word");
	require(bmsx::gxGpuTransferPixelWord(0x89abcdefu, 1u) == 0x89abu, "GX-GPU transfer high pixel word");
	require(bmsx::gxGpuTransferPayloadPixelCount(3u) == 0u, "GX-GPU transfer header has no payload pixels");
	require(bmsx::gxGpuTransferPayloadPixelCount(5u) == 4u, "GX-GPU transfer payload pixel count");
	require(bmsx::gxGpuTransferEmittedPixelCount(3u, 2u, 4u) == 2u, "GX-GPU partial transfer one payload word");
	require(bmsx::gxGpuTransferEmittedPixelCount(3u, 2u, 5u) == 4u, "GX-GPU partial transfer two payload words");
	require(bmsx::gxGpuTransferEmittedPixelCount(3u, 2u, 6u) == 6u, "GX-GPU complete transfer clamps to area");
	require(bmsx::gxGpuTransferEmittedPixelCount(3u, 1u, 5u) == 3u, "GX-GPU odd transfer clamps padding pixel");

	require(bmsx::gxGpuCommandRawTextureEnabled(0x25u), "GX-GPU raw texture bit enabled");
	require(!bmsx::gxGpuCommandRawTextureEnabled(0x24u), "GX-GPU raw texture bit disabled");
	require(bmsx::gxGpuCommandSemiTransparencyEnabled(0x22u), "GX-GPU semi-transparency bit enabled");
	require(!bmsx::gxGpuCommandSemiTransparencyEnabled(0x20u), "GX-GPU semi-transparency bit disabled");
	require(bmsx::gxGpuCommandTextureEnabled(0x24u), "GX-GPU textured opcode draws texture");
	require(!bmsx::gxGpuCommandTextureEnabled(0x20u), "GX-GPU untextured opcode does not draw texture");
	require(bmsx::gxGpuDrawModeTexturePageBaseY(bmsx::GX_GPU_DRAW_MODE_TEXTURE_PAGE_Y_HIGH, 0u) == 0u, "GX-GPU closed Y gate suppresses texture page bit 9");
	require(bmsx::gxGpuDrawModeTexturePageBaseY(bmsx::GX_GPU_DRAW_MODE_TEXTURE_PAGE_Y_HIGH, 1u) == 512u, "GX-GPU open Y gate retains texture page bit 9");
	require(bmsx::gxGpuDrawModeDitherEnabled(bmsx::GX_GPU_DRAW_MODE_DITHER_ENABLED), "GX-GPU dither bit enabled");
	require(!bmsx::gxGpuDrawModeDitherEnabled(0u), "GX-GPU dither bit disabled");
	require(bmsx::gxGpuDitheredPolygon(bmsx::GX_GPU_DRAW_MODE_DITHER_ENABLED, bmsx::GX_GPU_GP0_POLYGON_FIRST | bmsx::GX_GPU_GP0_RENDER_GOURAUD_BIT), "GX-GPU Gouraud polygon dithered");
	require(!bmsx::gxGpuDitheredPolygon(bmsx::GX_GPU_DRAW_MODE_DITHER_ENABLED, bmsx::GX_GPU_GP0_POLYGON_FIRST), "GX-GPU flat untextured polygon not dithered");
	require(bmsx::gxGpuDitheredPolygon(bmsx::GX_GPU_DRAW_MODE_DITHER_ENABLED, bmsx::GX_GPU_GP0_POLYGON_FIRST | bmsx::GX_GPU_GP0_RENDER_TEXTURE_BIT), "GX-GPU blended textured polygon dithered");
	require(bmsx::gxGpuDitheredPolygon(bmsx::GX_GPU_DRAW_MODE_DITHER_ENABLED | bmsx::GX_GPU_DRAW_MODE_TEXTURE_PAGE_Y_HIGH, bmsx::GX_GPU_GP0_POLYGON_FIRST | bmsx::GX_GPU_GP0_RENDER_TEXTURE_BIT), "GX-GPU high-page flat polygon remains textured and dithered");
	require(bmsx::gxGpuDitheredPolygon(bmsx::GX_GPU_DRAW_MODE_DITHER_ENABLED | bmsx::GX_GPU_DRAW_MODE_TEXTURE_PAGE_Y_HIGH, bmsx::GX_GPU_GP0_POLYGON_FIRST | bmsx::GX_GPU_GP0_RENDER_TEXTURE_BIT | bmsx::GX_GPU_GP0_RENDER_GOURAUD_BIT), "GX-GPU high-page Gouraud polygon remains textured and dithered");
	require(!bmsx::gxGpuDitheredPolygon(bmsx::GX_GPU_DRAW_MODE_DITHER_ENABLED, bmsx::GX_GPU_GP0_POLYGON_FIRST | bmsx::GX_GPU_GP0_RENDER_TEXTURE_BIT | 0x01u), "GX-GPU raw textured polygon not dithered");
	require(!bmsx::gxGpuDitheredPolygon(0u, bmsx::GX_GPU_GP0_POLYGON_FIRST | bmsx::GX_GPU_GP0_RENDER_GOURAUD_BIT), "GX-GPU dither disabled by draw mode");
	require(bmsx::gxGpuDrawModeTextureRectangleXFlip(bmsx::GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP), "GX-GPU textured rectangle X flip bit enabled");
	require(!bmsx::gxGpuDrawModeTextureRectangleXFlip(bmsx::GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_Y_FLIP), "GX-GPU textured rectangle X flip bit disabled");
	require(bmsx::gxGpuDrawModeTextureRectangleYFlip(bmsx::GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_Y_FLIP), "GX-GPU textured rectangle Y flip bit enabled");
	require(!bmsx::gxGpuDrawModeTextureRectangleYFlip(bmsx::GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP), "GX-GPU textured rectangle Y flip bit disabled");
	require(!bmsx::gxGpuSegmentExceedsPrimitiveSize(0, 0, 1023, 0), "GX-GPU primitive-size line accepts 1024-pixel width");
	require(bmsx::gxGpuSegmentExceedsPrimitiveSize(0, 0, 1024, 0), "GX-GPU primitive-size line rejects 1025-pixel width");
	require(!bmsx::gxGpuSegmentExceedsPrimitiveSize(0, 0, 0, 511), "GX-GPU primitive-size line accepts 512-pixel height");
	require(bmsx::gxGpuSegmentExceedsPrimitiveSize(0, 0, 0, 512), "GX-GPU primitive-size line rejects 513-pixel height");
	require(!bmsx::gxGpuTriangleExceedsPrimitiveSize(0, 0, 1023, 0, 0, 511), "GX-GPU primitive-size triangle accepts full bounds");
	require(bmsx::gxGpuTriangleExceedsPrimitiveSize(0, 0, 1024, 0, 0, 511), "GX-GPU primitive-size triangle rejects wide bounds");
	require(bmsx::gxGpuTriangleExceedsPrimitiveSize(0, 0, 1023, 0, 0, 512), "GX-GPU primitive-size triangle rejects tall bounds");
	require(!bmsx::gxGpuTriangleExceedsPrimitiveSize(-512, -256, 511, 255, 0, 0), "GX-GPU primitive-size triangle accepts signed full bounds");
	require(bmsx::gxGpuTriangleExceedsPrimitiveSize(-513, -256, 511, 255, 0, 0), "GX-GPU primitive-size triangle rejects signed wide bounds");
	require(bmsx::gxGpuTriangleRasterShift(-1025, -1024, -1) == 2048, "GX-GPU triangle raster stage shifts the negative signed-coordinate bucket");
	require(bmsx::gxGpuTriangleRasterShift(-1024, 0, 1024) == 0, "GX-GPU triangle raster stage preserves the positive exclusive edge");
	require(bmsx::gxGpuTriangleEdgeCoverageMinimum(1, -4) == 0, "GX-GPU descending edge is inclusive");
	require(bmsx::gxGpuTriangleEdgeCoverageMinimum(0, 4) == 0, "GX-GPU horizontal top edge is inclusive");
	require(bmsx::gxGpuTriangleEdgeCoverageMinimum(-1, 4) == 1, "GX-GPU ascending edge is exclusive");
	require(bmsx::gxGpuTriangleEdgeCoverageMinimum(0, -4) == 1, "GX-GPU horizontal bottom edge is exclusive");
	require(bmsx::gxGpuTextureU(0x01c3ab56u) == 0x56u, "GX-GPU texture U decode");
	require(bmsx::gxGpuTextureV(0x01c3ab56u) == 0xabu, "GX-GPU texture V decode");
	require(bmsx::gxGpuTextureAttribute(0x01c3ab56u) == 0x01c3u, "GX-GPU texture attribute decode");
	require(bmsx::gxGpuTextureClutBaseX(0x01c3ab56u) == 48u, "GX-GPU CLUT X base decode");
	require(bmsx::gxGpuTextureClutBaseY(0x01c3ab56u, 0u) == 7u, "GX-GPU CLUT Y base decode");
	require(bmsx::gxGpuDrawModeTexturePageBaseX(0x0013u) == 192u, "GX-GPU texture page X base decode");
	require(bmsx::gxGpuDrawModeTexturePageBaseY(0x0013u, 0u) == 256u, "GX-GPU texture page Y base decode");
	require(bmsx::gxGpuDrawModeTexturePageBaseY(0x0810u, 0u) == 256u, "GX-GPU closed Y gate suppresses the high texture-page bank bit");
	require(bmsx::gxGpuDrawModeTextureMode(0x0100u) == bmsx::GX_GPU_TEXTURE_MODE_DIRECT16, "GX-GPU texture mode decode");
	require(bmsx::gxGpuDrawModeTransparencyMode(0x0060u) == 3u, "GX-GPU transparency mode decode");
	require(bmsx::gxGpuTexturedBatchDrawModeWord(0x3b83u, false) == 0x0180u, "GX-GPU textured batch state excludes retained page, flip and inactive blend bits");
	require(bmsx::gxGpuTexturedBatchDrawModeWord(0x3be3u, true) == 0x01e0u, "GX-GPU textured batch state retains active texture and blend modes");
	require(bmsx::gxGpuPolygonTexturePageWordIndex(0x24u) == 4u, "GX-GPU flat textured polygon texpage word index");
	require(bmsx::gxGpuPolygonTexturePageWordIndex(0x34u) == 5u, "GX-GPU Gouraud textured polygon texpage word index");
	require(bmsx::gxGpuPolygonDrawModeWord(0x1fffu, 0x0000u) == 0x1600u, "GX-GPU polygon texpage preserves non-texpage draw bits");
	require(bmsx::gxGpuPolygonDrawModeWord(0x0000u, 0x0183u) == 0x0183u, "GX-GPU polygon texpage writes page bits");
	const uint32_t textureWindowWord = 0x00010000u | 0x00000c00u | 0x00000060u | 0x00000002u;
	require(bmsx::gxGpuTextureWindowAndX(textureWindowWord) == 239u, "GX-GPU texture window AND X");
	require(bmsx::gxGpuTextureWindowAndY(textureWindowWord) == 231u, "GX-GPU texture window AND Y");
	require(bmsx::gxGpuTextureWindowOrX(textureWindowWord) == 16u, "GX-GPU texture window OR X");
	require(bmsx::gxGpuTextureWindowOrY(textureWindowWord) == 16u, "GX-GPU texture window OR Y");
	require(bmsx::gxGpuMaskBitSetWhileDrawing(0x03u), "GX-GPU mask write bit enabled");
	require(!bmsx::gxGpuMaskBitSetWhileDrawing(0x02u), "GX-GPU mask write bit disabled");
	require(bmsx::gxGpuMaskBitCheckBeforeDraw(0x03u), "GX-GPU mask check bit enabled");
	require(!bmsx::gxGpuMaskBitCheckBeforeDraw(0x01u), "GX-GPU mask check bit disabled");

	require(bmsx::gxGpuDrawingAreaX(12u | (34u << 10u)) == 12u, "GX-GPU drawing area x decode");
	require(bmsx::gxGpuDrawingAreaY(12u | (34u << 10u)) == 34u, "GX-GPU drawing area y decode");
	require(bmsx::gxGpuDrawingAreaLeft(12u | (34u << 10u), 20u | (40u << 10u)) == 12u, "GX-GPU drawing area left");
	require(bmsx::gxGpuDrawingAreaTop(12u | (34u << 10u), 20u | (40u << 10u), 0u) == 34u, "GX-GPU drawing area top");
	require(bmsx::gxGpuDrawingAreaRightExclusive(12u | (34u << 10u), 20u | (40u << 10u)) == 21u, "GX-GPU drawing area right exclusive");
	require(bmsx::gxGpuDrawingAreaBottomExclusive(12u | (34u << 10u), 20u | (40u << 10u), 0u) == 41u, "GX-GPU drawing area bottom exclusive");
	require(bmsx::gxGpuDrawingAreaLeft(20u | (34u << 10u), 12u | (40u << 10u)) == 0u, "GX-GPU invalid drawing area left");
	require(bmsx::gxGpuDrawingAreaRightExclusive(20u | (34u << 10u), 12u | (40u << 10u)) == 0u, "GX-GPU invalid drawing area right");
	require(bmsx::gxGpuDrawingAreaTop(12u | (40u << 10u), 20u | (34u << 10u), 0u) == 0u, "GX-GPU invalid drawing area top");
	require(bmsx::gxGpuDrawingAreaBottomExclusive(12u | (40u << 10u), 20u | (34u << 10u), 0u) == 0u, "GX-GPU invalid drawing area bottom");
	require(bmsx::gxGpuDrawingAreaTop(12u | (600u << 10u), 20u | (700u << 10u), 1u) == 600u, "GX-GPU drawing area preserves raw 10-bit top");
	require(bmsx::gxGpuDrawingAreaBottomExclusive(12u | (600u << 10u), 20u | (700u << 10u), 1u) == 701u, "GX-GPU drawing area preserves raw 10-bit bottom");
}

void testPcrtcDecodesNativePsxAndPs2OutputResolutions() {
	std::array<bmsx::u32, bmsx::GX_GPU_PCRTC_CONFIG_WORD_COUNT> words{};
	words[bmsx::GX_GPU_PCRTC_PMODE_LOW] = 0x0000ff21u;
	words[bmsx::GX_GPU_PCRTC_SMODE1_HIGH] = 0x00000007u;
	words[bmsx::GX_GPU_PCRTC_SYNCH1_LOW] = 0x1fc83030u;
	words[bmsx::GX_GPU_PCRTC_SYNCH1_HIGH] = 0x0007f5c2u;
	words[bmsx::GX_GPU_PCRTC_SYNCH2_LOW] = 0x003484bcu;
	words[bmsx::GX_GPU_PCRTC_SYNCV_HIGH] = 0x00a90005u;
	bmsx::GxGpuPcrtcTiming timing;
	bmsx::GxGpuPcrtcScanout scanout;
	struct OutputMode {
		bmsx::u32 width;
		bmsx::u32 height;
		bmsx::u32 signalStep;
		bmsx::u32 interlaced;
	};
	constexpr std::array<OutputMode, 12> modes{{
		{256u, 240u, 4u, 0u},
		{320u, 240u, 4u, 0u},
		{368u, 240u, 4u, 0u},
		{512u, 240u, 4u, 0u},
		{640u, 240u, 4u, 0u},
		{640u, 480u, 4u, 1u},
		{640u, 448u, 4u, 1u},
		{640u, 512u, 4u, 1u},
		{720u, 480u, 2u, 0u},
		{656u, 576u, 2u, 0u},
		{1280u, 720u, 1u, 0u},
		{1920u, 1080u, 1u, 1u},
	}};

	for (const OutputMode& mode : modes) {
		words[bmsx::GX_GPU_PCRTC_SMODE1_LOW] = (0x40806504u & ~(0x0fu << 21u)) | (mode.signalStep << 21u);
		words[bmsx::GX_GPU_PCRTC_SMODE2_LOW] = mode.interlaced * bmsx::GX_GPU_PCRTC_SMODE2_INT;
		words[bmsx::GX_GPU_PCRTC_SYNCV_LOW] = mode.interlaced != 0u ? 0x02101401u : 0x02101404u;
		words[bmsx::GX_GPU_PCRTC_DISPLAY1_LOW] = (mode.signalStep - 1u) << 23u;
		words[bmsx::GX_GPU_PCRTC_DISPLAY1_HIGH] = (mode.width * mode.signalStep - 1u) | ((mode.height - 1u) << 12u);
		timing.update(words);
		scanout.update(words, timing);
		require(scanout.outputActive, "GX-GPU PCRTC standard output mode should be active");
		require(scanout.outputWidth == mode.width, "GX-GPU PCRTC standard output mode should retain its native width");
		require(scanout.outputHeight == mode.height, "GX-GPU PCRTC standard output mode should retain its native height");
		require(scanout.interlaced == (mode.interlaced != 0u), "GX-GPU PCRTC standard output mode should retain its scan structure");
		require(scanout.circuits[0u].sourceAdvanceX == 1u, "GX-GPU PCRTC standard output mode should consume native source columns");
	}

	words[bmsx::GX_GPU_PCRTC_PMODE_LOW] = 0x0000ff23u;
	words[bmsx::GX_GPU_PCRTC_SMODE1_LOW] = 0x40206504u;
	words[bmsx::GX_GPU_PCRTC_SMODE2_LOW] = 0u;
	words[bmsx::GX_GPU_PCRTC_DISPLAY1_LOW] = 0u;
	words[bmsx::GX_GPU_PCRTC_DISPLAY1_HIGH] = 0u;
	words[bmsx::GX_GPU_PCRTC_DISPLAY2_LOW] = 0x0fffu | (0x07ffu << 12u);
	words[bmsx::GX_GPU_PCRTC_DISPLAY2_HIGH] = 0x0fffu | (0x07ffu << 12u);
	timing.update(words);
	scanout.update(words, timing);
	require(scanout.outputWidth == 8191u, "GX-GPU PCRTC dual circuits should expose the full raw horizontal composition bound");
	require(scanout.outputHeight == 4095u, "GX-GPU PCRTC dual circuits should expose the full raw vertical composition bound");
}

void testGp1DisplayModeOwnsPalNtsc() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;

	require(gpu.readDisplayModeWord() == bmsx::GX_GPU_RESET_DISPLAY_MODE_WORD, "GX-GPU reset 320-wide PAL display mode");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_PAL_MODE) == bmsx::GX_GPU_STATUS_PAL_MODE, "GX-GPU reset GPUSTAT PAL bit");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_RESET_WORD) == bmsx::GX_GPU_STATUS_RESET_WORD, "GX-GPU reset GPUSTAT base bits");

	require(gpu.writeGp1((bmsx::GX_GPU_GP1_DISPLAY_MODE << 24u) | 0x00000000u) == bmsx::GX_GPU_GP1_DISPLAY_MODE, "GX-GPU GP1 display opcode");

	require(gpu.readDisplayModeWord() == 0u, "GX-GPU GP1 display NTSC payload");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_PAL_MODE) == 0u, "GX-GPU GP1 clears GPUSTAT PAL bit");
}

void testGp1ResetRestoresRegistersAndPreservesAcceptedGpuWork() {
	bmsx::GxGpuSoftwareState software(bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes, 0u);
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;
	const bmsx::GxGpuCommandBuffer& commandBuffer = gpu.readDeviceOutput().commandBuffer;
	const uint32_t commandSerial = commandBuffer.serial;
	const bmsx::u64 vramSnapshotSerial = gpu.readVramSnapshotSerial();

	gpu.writeGp1((bmsx::GX_GPU_GP1_VRAM_Y_ADDRESS_EXTENSION << 24u) | 1u);
	gpu.writeGp1((bmsx::GX_GPU_GP1_DISPLAY_MODE << 24u) | 0x00000000u);
	gpu.writeGp0((bmsx::GX_GPU_GP0_DRAWING_AREA_TOP_LEFT << 24u) | 0x00054321u);
	gpu.writeGp1((bmsx::GX_GPU_GP1_GET_GPU_INFO << 24u) | 0x03u);
	gpu.writeGp0((bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u) | 0x0000ffu);
	gpu.writeGp0(0u);
	gpu.writeGp0((1u << 16u) | 1u);
	gpu.writeGp0(bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24u);
	gpu.writeGp0(32u);
	gpu.writeGp0((1u << 16u) | 4u);
	gpu.writeGp0(0x03e0001fu);
	completeGpuCommands(harness);
	require(gpu.readDisplayModeWord() == 0u, "GX-GPU GP1 display NTSC before reset");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_PAL_MODE) == 0u, "GX-GPU GP1 PAL bit clear before reset");
	require(commandBuffer.commandCount == 1u, "GX-GPU GP1 reset test has a queued command");

	require(gpu.writeGp1(bmsx::GX_GPU_GP1_RESET << 24u) == bmsx::GX_GPU_GP1_RESET, "GX-GPU GP1 reset opcode");

	require(commandBuffer.commandCount == 2u, "GX-GPU GP1 reset preserves accepted commands and received upload payload");
	require(commandBuffer.serial == commandSerial, "GX-GPU GP1 reset preserves stable accepted command revision");
	require(gpu.readVramSnapshotSerial() == vramSnapshotSerial, "GX-GPU GP1 reset preserves backend VRAM revision");
	require(gpu.readGp0() == 0x00054321u, "GX-GPU GP1 reset preserves the GPUREAD data latch");
	require(gpu.readVramYAddressExtensionWord() == 1u, "GX-GPU GP1 reset preserves VRAM Y-address extension latch");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_TEXTURE_PAGE_Y_HIGH) == 0u, "GX-GPU GP1 reset clears texture-page Y-high status bit");
	require(gpu.readDisplayModeWord() == bmsx::GX_GPU_RESET_DISPLAY_MODE_WORD, "GX-GPU GP1 reset display mode");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_PAL_MODE) == bmsx::GX_GPU_STATUS_PAL_MODE, "GX-GPU GP1 reset PAL bit");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_RESET_WORD) == bmsx::GX_GPU_STATUS_RESET_WORD, "GX-GPU GP1 reset completes accepted execution at the reset boundary");
	gpu.writeGp0((bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | bmsx::GX_GPU_DRAW_MODE_TEXTURE_PAGE_Y_HIGH);
	completeGpuCommands(harness);
	require((gpu.readDrawModeWord() & bmsx::GX_GPU_DRAW_MODE_TEXTURE_PAGE_Y_HIGH) == bmsx::GX_GPU_DRAW_MODE_TEXTURE_PAGE_Y_HIGH, "GX-GPU draw mode retains texture-page Y-high after GP1 reset");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_TEXTURE_PAGE_Y_HIGH) == bmsx::GX_GPU_STATUS_TEXTURE_PAGE_Y_HIGH, "GX-GPU texture-page Y-high mirrors to GPUSTAT");
	gpu.presentReadyFrameOnVblankEdge();
	std::fill(software.vram.begin(), software.vram.end(), 0u);
	require(bmsx::executeGxGpuSoftwareCommands(software, commandBuffer, 0u, commandBuffer.presentCommandCount) == 2u, "GX-GPU GP1 reset publishes accepted pre-reset work");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 0, 0)] == 0x001fu, "GX-GPU GP1 reset preserves accepted fill");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 32, 0)] == 0x001fu, "GX-GPU GP1 reset preserves first received upload pixel");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 33, 0)] == 0x03e0u, "GX-GPU GP1 reset preserves second received upload pixel");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 34, 0)] == 0u, "GX-GPU GP1 reset does not invent missing upload payload");

	gpu.reset();
	require(commandBuffer.commandCount == 0u, "GX-GPU device reset clears retained commands");
	require(gpu.readVramSnapshotSerial() > vramSnapshotSerial, "GX-GPU device reset publishes a newer VRAM snapshot");
	require(gpu.readGp0() == 0u, "GX-GPU device reset clears the GPUREAD data latch");
}

void testDisplayModeStatusBits() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;

	gpu.writeGp1((bmsx::GX_GPU_GP1_DISPLAY_MODE << 24u) | 0x00ffffffu);

	require(gpu.readDisplayModeWord() == bmsx::GX_GPU_DISPLAY_MODE_MASK, "GX-GPU GP1 display mode latches low byte");
	const uint32_t statusBits = bmsx::GX_GPU_STATUS_HORIZONTAL_RESOLUTION_2
		| bmsx::GX_GPU_STATUS_VERTICAL_RESOLUTION
		| bmsx::GX_GPU_STATUS_PAL_MODE
		| bmsx::GX_GPU_STATUS_DISPLAY_AREA_COLOR_DEPTH_24
		| bmsx::GX_GPU_STATUS_VERTICAL_INTERLACE;
	require((gpu.readStatus() & statusBits) == statusBits, "GX-GPU type-2 display mode GPUSTAT single-bit fields");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_REVERSE_FLAG) == 0u, "GX-GPU type-2 display mode ignores the reverse flag");
	require((gpu.readStatus() & (0x3u << 17u)) == (0x3u << 17u), "GX-GPU display mode GPUSTAT horizontal resolution");
}

void testInterlacedScanoutStatusBits() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;
	harness.memory.writeMappedU32LE(
		bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_SYNCV_LOW),
		0x02101401u);
	gpu.setTiming(5'000'000, 0);
	gpu.onService(0);
	gpu.writeGp1((bmsx::GX_GPU_GP1_DISPLAY_MODE << 24u) | 0x00000000u);
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_DISPLAY_LINE_LSB) == 0u, "GX-GPU scanout starts on even line");

	harness.scheduler.advanceTo(320);
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_DISPLAY_LINE_LSB) == bmsx::GX_GPU_STATUS_DISPLAY_LINE_LSB, "GX-GPU GPUSTAT line LSB follows current scanline");
	gpu.writeGp1((bmsx::GX_GPU_GP1_DISPLAY_START << 24u) | (7u << 10u));
	gpu.writeGp1((bmsx::GX_GPU_GP1_DISPLAY_MODE << 24u) | 0x00000024u);
	gpu.onService(320);
	runGpuAtNextDeadline(harness);
	gpu.presentReadyFrameOnVblankEdge();
	require(gpu.lastFrameCommitted(), "GX-GPU first interlaced field commits a presentation frame");
	runGpuAtNextDeadline(harness);
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_INTERLACED_FIELD) == 0u, "GX-GPU GPUSTAT interlaced field toggles at VSync");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_DISPLAY_LINE_LSB) == bmsx::GX_GPU_STATUS_DISPLAY_LINE_LSB, "GX-GPU VSync display line bit uses display start");
	runGpuAtNextDeadline(harness);
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_INTERLACED_FIELD) == 0u, "GX-GPU active display keeps the current interlaced field");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_DISPLAY_LINE_LSB) == 0u, "GX-GPU active display line bit follows the display field");

	runGpuAtNextDeadline(harness);
	gpu.presentReadyFrameOnVblankEdge();
	require(gpu.lastFrameCommitted(), "GX-GPU next interlaced field commits a presentation frame");

	gpu.reset();
	const bmsx::u32 scanoutMask = bmsx::GX_GPU_STATUS_INTERLACED_FIELD | bmsx::GX_GPU_STATUS_DISPLAY_LINE_LSB;
	require((gpu.readStatus() & scanoutMask) == bmsx::GX_GPU_STATUS_INTERLACED_FIELD, "GX-GPU machine reset initializes physical scanout phase");
	require(gpu.readDeviceOutput().displayModeWord == bmsx::GX_GPU_RESET_DISPLAY_MODE_WORD, "GX-GPU machine reset initializes presented display mode");
	require(!gpu.lastFrameCommitted(), "GX-GPU machine reset initializes the VBLANK result");
}

void testStateRestorePreservesInterlacedFieldLatches() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;
	const bmsx::GxGpuCommandBuffer& commands = gpu.readDeviceOutput().commandBuffer;
	const bmsx::u32 scanoutMask = bmsx::GX_GPU_STATUS_INTERLACED_FIELD | bmsx::GX_GPU_STATUS_DISPLAY_LINE_LSB;
	harness.memory.writeMappedU32LE(
		bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_SYNCV_LOW),
		0x02101401u);
	gpu.setTiming(5'000'000, 0);
	gpu.onService(0);
	gpu.writeGp1((bmsx::GX_GPU_GP1_DISPLAY_START << 24u) | (7u << 10u));
	gpu.writeGp1((bmsx::GX_GPU_GP1_DISPLAY_MODE << 24u) | 0x00000024u);
	runGpuAtNextDeadline(harness);
	runGpuAtNextDeadline(harness);
	runGpuAtNextDeadline(harness);
	const bmsx::GxGpuState saved = gpu.captureState();
	require((gpu.readStatus() & scanoutMask) == bmsx::GX_GPU_STATUS_DISPLAY_LINE_LSB, "GX-GPU captured interlaced field phase");

	runGpuAtNextDeadline(harness);
	runGpuAtNextDeadline(harness);
	runGpuAtNextDeadline(harness);
	require((gpu.readStatus() & scanoutMask) == scanoutMask, "GX-GPU interlaced field phase mutates before restore");

	gpu.restoreState(saved);
	gpu.writeGp0((bmsx::GX_GPU_GP0_POLYGON_FIRST << 24u) | 0x00010203u);
	gpu.writeGp0(0u);
	gpu.writeGp0(1u);
	gpu.writeGp0(2u);
	require(commands.commandSkippedLineParity[0] == 0u, "GX-GPU restored active line parity tags the next draw");
	require((gpu.readStatus() & scanoutMask) == bmsx::GX_GPU_STATUS_DISPLAY_LINE_LSB, "GX-GPU restore reinstates interlaced status phase");
}

void testInterlacedRenderCommandWords() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;
	const bmsx::GxGpuCommandBuffer& commands = gpu.readDeviceOutput().commandBuffer;

	gpu.writeGp1((bmsx::GX_GPU_GP1_DISPLAY_START << 24u) | (7u << 10u));
	gpu.writeGp1((bmsx::GX_GPU_GP1_DISPLAY_MODE << 24u) | 0x00000024u);
	gpu.writeGp0((bmsx::GX_GPU_GP0_POLYGON_FIRST << 24u) | 0x00010203u);
	gpu.writeGp0(0x00000000u);
	gpu.writeGp0(0x00000001u);
	gpu.writeGp0(0x00000002u);

	require(commands.commandCount == 1u, "GX-GPU records first interlaced polygon command");
	require(commands.commandSkippedLineParity[0] == 1u, "GX-GPU command captures interlaced active line");
	completeGpuCommands(harness);

	gpu.writeGp0((bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | (1u << 10u));
	gpu.writeGp0((bmsx::GX_GPU_GP0_POLYGON_FIRST << 24u) | 0x00010203u);
	gpu.writeGp0(0x00000000u);
	gpu.writeGp0(0x00000001u);
	gpu.writeGp0(0x00000002u);
	completeGpuCommands(harness);

	require(commands.commandCount == 2u, "GX-GPU records second interlaced polygon command");
	require(commands.commandSkippedLineParity[1] == bmsx::GX_GPU_SKIPPED_LINE_NONE, "GX-GPU command clears interlaced active-line discard when drawing to displayed field");
}

void testCommandLogIsPresentableOnlyAfterVblankFrameSeal() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;
	const bmsx::GxGpuCommandBuffer& commands = gpu.readDeviceOutput().commandBuffer;

	gpu.writeGp0((bmsx::GX_GPU_GP0_POLYGON_FIRST << 24u) | 0x00010203u);
	gpu.writeGp0(0x00000000u);
	gpu.writeGp0(0x00000001u);
	gpu.writeGp0(0x00000002u);

	require(commands.commandCount == 1u, "GX-GPU records pending command before presentation publish");
	require(commands.presentCommandCount == 0u, "GX-GPU keeps pending command off the presentable command stream");
	require(!gpu.lastFrameCommitted(), "GX-GPU does not report a committed frame before VBLANK frame seal");

	completeGpuCommands(harness);
	gpu.presentReadyFrameOnVblankEdge();
	require(commands.commandCount == 1u, "GX-GPU retains command after presentation publish");
	require(commands.presentCommandCount == 1u, "GX-GPU publishes command count for presentation");
	require(gpu.lastFrameCommitted(), "GX-GPU reports committed frame after VBLANK frame seal");

	gpu.retirePresentedCommands();
	require(commands.commandCount == 0u, "GX-GPU retires presented command from the live queue");
	require(commands.presentCommandCount == 0u, "GX-GPU clears sealed prefix after retire");
	completeGpuCommands(harness);
	gpu.presentReadyFrameOnVblankEdge();
	require(!gpu.lastFrameCommitted(), "GX-GPU reports no committed frame after command retire");

	gpu.writeGp0((bmsx::GX_GPU_GP0_POLYGON_FIRST << 24u) | 0x00040506u);
	gpu.writeGp0(0x00000003u);
	gpu.writeGp0(0x00000004u);
	gpu.writeGp0(0x00000005u);

	require(commands.commandCount == 1u, "GX-GPU appends next-frame command after retire");
	require(commands.presentCommandCount == 0u, "GX-GPU keeps next-frame command off the presentable stream until publish");
	completeGpuCommands(harness);
	gpu.presentReadyFrameOnVblankEdge();
	require(commands.presentCommandCount == 1u, "GX-GPU seals next-frame command on the next VBLANK frame boundary");
}

void testPartialPresentationSnapshotDoesNotExposeQueuedCommands() {
	bmsx::GxGpuSoftwareState software(bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes, 0u);
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;

	gpu.writeGp0((bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u) | 0x0000ffu);
	gpu.writeGp0(0u);
	gpu.writeGp0((1u << 16u) | 1u);

	const bmsx::GxGpuDeviceOutput& output = gpu.readDeviceOutput();
	const bmsx::GxGpuCommandBuffer& commands = output.commandBuffer;
	require(commands.commandCount == 1u, "GX-GPU partial presentation snapshot keeps queued command");
	require(commands.presentCommandCount == 0u, "GX-GPU partial presentation snapshot exposes no presentable command");

	std::fill(software.vram.begin(), software.vram.end(), 0u);
	require(bmsx::executeGxGpuSoftwareCommands(software, commands, 0u, commands.presentCommandCount) == 0u, "GX-GPU software renderer ignores partial presentation command queue");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 0, 0)] == 0u, "GX-GPU software VRAM is unchanged by partial presentation");
	require(commands.commandCount == 1u, "GX-GPU partial presentation does not retire queued command");
	require(commands.presentCommandCount == 0u, "GX-GPU partial presentation does not publish queued command");

	completeGpuCommands(harness);
	gpu.presentReadyFrameOnVblankEdge();
	require(bmsx::executeGxGpuSoftwareCommands(software, commands, 0u, commands.presentCommandCount) == 1u, "GX-GPU software renderer consumes committed presentation command");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 0, 0)] == 0x001fu, "GX-GPU software VRAM receives committed presentation fill");

	gpu.retirePresentedCommands();
	require(commands.commandCount == 0u, "GX-GPU committed presentation retires from the live queue");
	require(commands.presentCommandCount == 0u, "GX-GPU committed presentation clears sealed prefix");
}

void testRetirePreservesCommandsAppendedAfterSealedVblankSnapshot() {
	bmsx::GxGpuSoftwareState software(bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes, 0u);
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;
	const bmsx::GxGpuCommandBuffer& commands = gpu.readDeviceOutput().commandBuffer;

	gpu.writeGp0((bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u) | 0x0000ffu);
	gpu.writeGp0(0u);
	gpu.writeGp0((1u << 16u) | 1u);
	completeGpuCommands(harness);
	gpu.presentReadyFrameOnVblankEdge();

	gpu.writeGp0((bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u) | 0x00ff00u);
	gpu.writeGp0(32u);
	gpu.writeGp0((1u << 16u) | 1u);

	std::fill(software.vram.begin(), software.vram.end(), 0u);
	require(bmsx::executeGxGpuSoftwareCommands(software, commands, 0u, commands.presentCommandCount) == 1u, "GX-GPU software renderer consumes only the sealed command prefix");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 0, 0)] == 0x001fu, "GX-GPU software VRAM receives sealed fill");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 32, 0)] == 0u, "GX-GPU software VRAM ignores post-seal command before next VBLANK");

	gpu.retirePresentedCommands();
	require(commands.commandCount == 1u, "GX-GPU retire preserves post-seal command");
	require(commands.presentCommandCount == 0u, "GX-GPU retire clears sealed prefix");
	completeGpuCommands(harness);
	gpu.presentReadyFrameOnVblankEdge();
	require(bmsx::executeGxGpuSoftwareCommands(software, commands, 0u, commands.presentCommandCount) == 1u, "GX-GPU software renderer consumes preserved command after next VBLANK");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 32, 0)] == 0x03e0u, "GX-GPU software VRAM receives preserved next-frame fill");
}

void testDisplayDisableAndDmaDirectionStatusBits() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;

	gpu.writeGp1(bmsx::GX_GPU_GP1_DISPLAY_DISABLE << 24u);
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_DISPLAY_DISABLE) == 0u, "GX-GPU GP1 display enable clears display-disable bit");
	const bmsx::GxGpuDeviceOutput& output = gpu.readDeviceOutput();
	require((output.statusWord & bmsx::GX_GPU_STATUS_DISPLAY_DISABLE) == bmsx::GX_GPU_STATUS_DISPLAY_DISABLE, "GX-GPU output keeps reset display-disable status before VBLANK");
	completeGpuCommands(harness);
	gpu.presentReadyFrameOnVblankEdge();
	gpu.readDeviceOutput();
	require((output.statusWord & bmsx::GX_GPU_STATUS_DISPLAY_DISABLE) == 0u, "GX-GPU output display enable status");

	gpu.writeGp1((bmsx::GX_GPU_GP1_DISPLAY_DISABLE << 24u) | 1u);
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_DISPLAY_DISABLE) == bmsx::GX_GPU_STATUS_DISPLAY_DISABLE, "GX-GPU GP1 display disable bit");
	gpu.readDeviceOutput();
	require((output.statusWord & bmsx::GX_GPU_STATUS_DISPLAY_DISABLE) == 0u, "GX-GPU output keeps display status latched until VBLANK");
	completeGpuCommands(harness);
	gpu.presentReadyFrameOnVblankEdge();
	gpu.readDeviceOutput();
	require((output.statusWord & bmsx::GX_GPU_STATUS_DISPLAY_DISABLE) == bmsx::GX_GPU_STATUS_DISPLAY_DISABLE, "GX-GPU output display disable status");
	require(gpu.lastFrameCommitted(), "GX-GPU display status change commits a presentation frame");

	gpu.writeGp1((bmsx::GX_GPU_GP1_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_FIFO);
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_DMA_DIRECTION_MASK) == (bmsx::GX_GPU_DMA_DIRECTION_FIFO << bmsx::GX_GPU_STATUS_DMA_DIRECTION_SHIFT), "GX-GPU GP1 DMA FIFO direction");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_DMA_DATA_REQUEST) == bmsx::GX_GPU_STATUS_DMA_DATA_REQUEST, "GX-GPU GP1 FIFO request follows receive readiness");

	gpu.writeGp1((bmsx::GX_GPU_GP1_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_DMA_DIRECTION_MASK) == (bmsx::GX_GPU_DMA_DIRECTION_CPU_TO_GP0 << bmsx::GX_GPU_STATUS_DMA_DIRECTION_SHIFT), "GX-GPU GP1 DMA CPU-to-GP0 direction");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_DMA_DATA_REQUEST) == bmsx::GX_GPU_STATUS_DMA_DATA_REQUEST, "GX-GPU GP1 DMA request follows receive readiness");

	gpu.writeGp1((bmsx::GX_GPU_GP1_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU);
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_DMA_DIRECTION_MASK) == (bmsx::GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU << bmsx::GX_GPU_STATUS_DMA_DIRECTION_SHIFT), "GX-GPU GP1 DMA GPUREAD-to-CPU direction");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_DMA_DATA_REQUEST) == 0u, "GX-GPU GP1 DMA request follows send readiness");
}

void testGpustatReadinessTracksGp0PacketAssemblyAndPayloadPhases() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;
	const bmsx::GxGpuCommandBuffer& commands = gpu.readDeviceOutput().commandBuffer;

	uint32_t status = gpu.readStatus();
	require((status & bmsx::GX_GPU_STATUS_GPU_IDLE) == bmsx::GX_GPU_STATUS_GPU_IDLE, "GX-GPU GPUSTAT reset idle");
	require((status & bmsx::GX_GPU_STATUS_READY_TO_RECEIVE_DMA) == bmsx::GX_GPU_STATUS_READY_TO_RECEIVE_DMA, "GX-GPU GPUSTAT reset receive-ready");
	require((status & bmsx::GX_GPU_STATUS_READY_TO_SEND_VRAM) == 0u, "GX-GPU GPUSTAT reset not send-ready");

	gpu.writeGp1((bmsx::GX_GPU_GP1_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
	gpu.writeGp0((bmsx::GX_GPU_GP0_POLYGON_FIRST << 24u) | 0x00010203u);
	status = gpu.readStatus();
	require((status & bmsx::GX_GPU_STATUS_GPU_IDLE) == 0u, "GX-GPU GPUSTAT partial packet is not idle");
	require((status & bmsx::GX_GPU_STATUS_READY_TO_RECEIVE_DMA) == 0u, "GX-GPU polygon opcode immediately lowers DMA block readiness");
	require((status & bmsx::GX_GPU_STATUS_READY_TO_SEND_VRAM) == 0u, "GX-GPU GPUSTAT partial packet is not send-ready");
	require((status & bmsx::GX_GPU_STATUS_DMA_DATA_REQUEST) == 0u, "GX-GPU CPU-to-GP0 request follows polygon packet admission");

	gpu.writeGp1((bmsx::GX_GPU_GP1_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU);
	status = gpu.readStatus();
	require((status & bmsx::GX_GPU_STATUS_DMA_DATA_REQUEST) == 0u, "GX-GPU GPUSTAT GPUREAD DMA request stays clear without readback data");

	gpu.writeGp0(0x00000000u);
	gpu.writeGp0(0x00000001u);
	gpu.writeGp0(0x00000002u);
	gpu.writeGp1((bmsx::GX_GPU_GP1_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
	status = gpu.readStatus();
	require((status & bmsx::GX_GPU_STATUS_GPU_IDLE) == 0u, "GX-GPU polygon raster remains busy after packet dispatch");
	require((status & bmsx::GX_GPU_STATUS_READY_TO_RECEIVE_DMA) == bmsx::GX_GPU_STATUS_READY_TO_RECEIVE_DMA, "GX-GPU front end reopens after polygon dispatch");
	require((status & bmsx::GX_GPU_STATUS_DMA_DATA_REQUEST) == bmsx::GX_GPU_STATUS_DMA_DATA_REQUEST, "GX-GPU CPU-to-GP0 request is independent of downstream raster time");
	for (bmsx::u32 index = 0u; index < 4u; index += 1u) {
		gpu.writeGp0(0x03000000u);
	}
	gpu.writeGp1((bmsx::GX_GPU_GP1_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
	status = gpu.readStatus();
	require((status & bmsx::GX_GPU_STATUS_GPU_IDLE) == 0u, "GX-GPU GPUSTAT fixed packet remains busy during execution");
	require((status & bmsx::GX_GPU_STATUS_READY_TO_RECEIVE_DMA) == 0u, "GX-GPU complete queued packet lowers receive readiness");
	require((status & bmsx::GX_GPU_STATUS_DMA_DATA_REQUEST) == 0u, "GX-GPU CPU-to-GP0 request follows DMA-block readiness");
	gpu.writeGp1((bmsx::GX_GPU_GP1_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_FIFO);
	status = gpu.readStatus();
	require((status & bmsx::GX_GPU_STATUS_READY_TO_RECEIVE_DMA) == 0u, "GX-GPU queued packet keeps DMA-block readiness low");
	require((status & bmsx::GX_GPU_STATUS_DMA_DATA_REQUEST) != 0u, "GX-GPU FIFO request follows physical FIFO capacity");
	require(commands.commandCount == 1u, "GX-GPU fixed packet command emitted");
	require(commands.executedCommandCount == 0u, "GX-GPU fixed packet waits at the execution frontier");
	completeGpuCommands(harness);
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_GPU_IDLE) == bmsx::GX_GPU_STATUS_GPU_IDLE, "GX-GPU fixed packet reaches idle at completion");
	require(commands.executedCommandCount == 1u, "GX-GPU fixed packet advances the execution frontier");

	gpu.writeGp0(bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24u);
	gpu.writeGp0(0x00010002u);
	gpu.writeGp0(0x00020003u);
	status = gpu.readStatus();
	require((status & bmsx::GX_GPU_STATUS_GPU_IDLE) == 0u, "GX-GPU GPUSTAT CPU-to-VRAM payload is not idle");
	require((status & bmsx::GX_GPU_STATUS_READY_TO_RECEIVE_DMA) == bmsx::GX_GPU_STATUS_READY_TO_RECEIVE_DMA, "GX-GPU GPUSTAT CPU-to-VRAM remains receive-ready");
	gpu.writeGp0(0xaaaaaaaau);
	gpu.writeGp0(0xbbbbbbbbu);
	status = gpu.readStatus();
	require((status & bmsx::GX_GPU_STATUS_GPU_IDLE) == 0u, "GX-GPU GPUSTAT partial CPU-to-VRAM payload remains not idle");
	gpu.writeGp0(0xccccccccu);
	status = gpu.readStatus();
	require((status & bmsx::GX_GPU_STATUS_GPU_IDLE) == 0u, "GX-GPU GPUSTAT CPU-to-VRAM payload remains busy during execution");
	require(commands.commandCount == 2u, "GX-GPU CPU-to-VRAM command emitted");
	completeGpuCommands(harness);
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_GPU_IDLE) == bmsx::GX_GPU_STATUS_GPU_IDLE, "GX-GPU CPU-to-VRAM reaches idle at completion");

	gpu.writeGp1((bmsx::GX_GPU_GP1_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_CPU_TO_GP0);
	gpu.writeGp0(((bmsx::GX_GPU_GP0_LINE_FIRST | bmsx::GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT) << 24u) | 0x0000ffu);
	status = gpu.readStatus();
	require((status & bmsx::GX_GPU_STATUS_READY_TO_RECEIVE_DMA) == 0u, "GX-GPU polyline opcode lowers DMA block readiness");
	require((status & bmsx::GX_GPU_STATUS_DMA_DATA_REQUEST) == 0u, "GX-GPU CPU-to-GP0 request stays low for active polyline input");
	gpu.writeGp0(0x00010002u);
	gpu.writeGp0(0x00020003u);
	status = gpu.readStatus();
	require((status & bmsx::GX_GPU_STATUS_GPU_IDLE) == 0u, "GX-GPU GPUSTAT polyline waits for terminator");
	require((status & bmsx::GX_GPU_STATUS_READY_TO_RECEIVE_DMA) == 0u, "GX-GPU polyline payload keeps DMA block readiness low");
	gpu.writeGp0(0x50005000u);
	status = gpu.readStatus();
	require((status & bmsx::GX_GPU_STATUS_GPU_IDLE) == 0u, "GX-GPU GPUSTAT polyline remains busy during execution");
	require((status & bmsx::GX_GPU_STATUS_READY_TO_RECEIVE_DMA) == bmsx::GX_GPU_STATUS_READY_TO_RECEIVE_DMA, "GX-GPU polyline terminator reopens the command front end");
	require((status & bmsx::GX_GPU_STATUS_DMA_DATA_REQUEST) == bmsx::GX_GPU_STATUS_DMA_DATA_REQUEST, "GX-GPU CPU-to-GP0 request rises after polyline dispatch");
	require(commands.commandCount == 3u, "GX-GPU polyline command emitted");
	completeGpuCommands(harness);
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_GPU_IDLE) == bmsx::GX_GPU_STATUS_GPU_IDLE, "GX-GPU polyline reaches idle at completion");

	gpu.writeGp0(bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u);
	status = gpu.readStatus();
	require((status & bmsx::GX_GPU_STATUS_GPU_IDLE) == 0u, "GX-GPU GPUSTAT partial fill packet is not idle");
	require((status & bmsx::GX_GPU_STATUS_READY_TO_RECEIVE_DMA) == bmsx::GX_GPU_STATUS_READY_TO_RECEIVE_DMA, "GX-GPU ordinary incomplete packets remain DMA-ready");
	gpu.writeGp1(bmsx::GX_GPU_GP1_CLEAR_FIFO << 24u);
	status = gpu.readStatus();
	require((status & bmsx::GX_GPU_STATUS_GPU_IDLE) == bmsx::GX_GPU_STATUS_GPU_IDLE, "GX-GPU GP1 clear FIFO restores idle readiness");
}

void testCommandTimingGatesGpustatIdleAndVblankExecutionFrontier() {
	GpuHarness harness;
	stopPcrtc(harness);
	bmsx::GxGpu& gpu = harness.gpu;
	const bmsx::GxGpuCommandBuffer& commands = gpu.readDeviceOutput().commandBuffer;

	gpu.writeGp0((bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u) | 0x0000ffu);
	gpu.writeGp0(0u);
	gpu.writeGp0((1u << 16u) | 1u);

	require(commands.commandCount == 1u, "GX-GPU timing accepts the fill command");
	require(commands.executedCommandCount == 0u, "GX-GPU timing keeps the fill behind the execution frontier");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_GPU_IDLE) == 0u, "GX-GPU timing lowers idle during fill execution");
	require(harness.scheduler.nextDeadline() == 29, "GX-GPU 16x1 fill schedules its exact completion cycle");
	gpu.presentReadyFrameOnVblankEdge();
	require(commands.presentCommandCount == 0u, "GX-GPU VBLANK does not publish an executing fill");

	harness.scheduler.advanceTo(28);
	gpu.onService(28);
	require(commands.executedCommandCount == 0u, "GX-GPU fill remains pending one cycle before completion");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_GPU_IDLE) == 0u, "GX-GPU remains busy one cycle before fill completion");

	harness.scheduler.advanceTo(29);
	gpu.onService(29);
	require(commands.executedCommandCount == 1u, "GX-GPU fill advances the execution frontier at completion");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_GPU_IDLE) == bmsx::GX_GPU_STATUS_GPU_IDLE, "GX-GPU returns idle at fill completion");
	require(harness.scheduler.nextDeadline() == std::numeric_limits<bmsx::i64>::max(), "GX-GPU cancels its service while idle");
	gpu.presentReadyFrameOnVblankEdge();
	require(commands.presentCommandCount == 1u, "GX-GPU VBLANK publishes the completed fill");
}

void testGp0IngressBypassesOnlyNopsAndExecutesDrawingStateInFifoOrder() {
	GpuHarness harness;
	stopPcrtc(harness);

	harness.gpu.writeGp0((bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u) | 0x0000ffu);
	harness.gpu.writeGp0(0u);
	harness.gpu.writeGp0((1u << 16u) | 1u);
	harness.gpu.writeGp0((bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u) | 0x0000aau);
	harness.gpu.writeGp0((bmsx::GX_GPU_GP0_DRAWING_AREA_TOP_LEFT << 24u) | 0x00012345u);
	harness.gpu.writeGp0((1u << 16u) | 1u);
	require(harness.gpu.readDrawingAreaTopLeftWord() == 0u, "GX-GPU fixed payload remains opaque to ingress sideband decode");
	require(harness.gpu.captureState().gp0FifoWords.size() == 3u, "GX-GPU stores the queued fixed packet");
	for (size_t index = 0u; index < bmsx::GX_GPU_COMMAND_FIFO_WORD_CAPACITY * 2u; index += 1u) {
		harness.gpu.writeGp0(0u);
	}
	harness.gpu.writeGp0(0x04000000u);
	harness.gpu.writeGp0(0x1e000000u);
	harness.gpu.writeGp0(0xe0000000u);
	harness.gpu.writeGp0(0xe7000000u);
	harness.gpu.writeGp0(0xef000000u);
	harness.gpu.writeGp0((bmsx::GX_GPU_GP0_DRAWING_AREA_TOP_LEFT << 24u) | 0x00054321u);
	harness.gpu.writeGp0((bmsx::GX_GPU_GP0_DRAWING_AREA_BOTTOM_RIGHT << 24u) | 0x00023456u);
	harness.gpu.writeGp0((bmsx::GX_GPU_GP0_DRAWING_OFFSET << 24u) | 0x00345678u);
	const bmsx::GxGpuState queuedState = harness.gpu.captureState();
	require(queuedState.gp0FifoWords.size() == 6u, "GX-GPU drawing-state commands occupy FIFO slots");
	require(harness.gpu.readDrawingAreaTopLeftWord() == 0u, "GX-GPU E3 remains behind queued raster packets");
	require(harness.gpu.readDrawingAreaBottomRightWord() == 0u, "GX-GPU E4 remains behind queued raster packets");
	require(harness.gpu.readDrawingOffsetWord() == 0u, "GX-GPU E5 remains behind queued raster packets");
	require(harness.memory.mappedWriteReady(bmsx::IO_GX_GPU_GP0), "GX-GPU queued drawing state leaves remaining FIFO capacity");
	require(harness.scheduler.nextDeadline() == 29, "GX-GPU queued drawing state does not overtake the active deadline");
	for (size_t index = 6u; index < bmsx::GX_GPU_COMMAND_FIFO_WORD_CAPACITY; index += 1u) {
		harness.gpu.writeGp0(0x03000000u | static_cast<uint32_t>(index));
	}

	require(!harness.memory.mappedWriteReady(bmsx::IO_GX_GPU_GP0), "GX-GPU lowers GP0 MMIO write-ready at FIFO capacity");
	runGpuAtNextDeadline(harness);
	require(harness.memory.mappedWriteReady(bmsx::IO_GX_GPU_GP0), "GX-GPU raises GP0 MMIO write-ready at command completion");
	require(harness.gpu.readDrawingAreaTopLeftWord() == 0u, "GX-GPU keeps E3 queued while the next raster packet executes");
	runGpuAtNextDeadline(harness);
	require(harness.gpu.readDrawingAreaTopLeftWord() == (0x00054321u & bmsx::GX_GPU_DRAWING_AREA_MASK), "GX-GPU executes E3 after prior raster packets");
	require(harness.gpu.readDrawingAreaBottomRightWord() == 0u, "GX-GPU keeps E4 ordered behind E3");
	runGpuAtNextDeadline(harness);
	require(harness.gpu.readDrawingAreaBottomRightWord() == (0x00023456u & bmsx::GX_GPU_DRAWING_AREA_MASK), "GX-GPU executes E4 after E3");
	require(harness.gpu.readDrawingOffsetWord() == 0u, "GX-GPU keeps E5 ordered behind E4");
	runGpuAtNextDeadline(harness);
	require(harness.gpu.readDrawingOffsetWord() == (0x00345678u & bmsx::GX_GPU_DRAWING_OFFSET_MASK), "GX-GPU executes E5 after E4");
}

void testGp1CrtcRangeRegistersLatchMaskedRawWords() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;

	gpu.writeGp1((bmsx::GX_GPU_GP1_DISPLAY_START << 24u) | 0x00000001u);
	require(gpu.readDisplayStartWord() == 0u, "GX-GPU GP1 display start forces even address");
	gpu.writeGp1((bmsx::GX_GPU_GP1_DISPLAY_START << 24u) | 0x00ffffffu);
	gpu.writeGp1((bmsx::GX_GPU_GP1_HORIZONTAL_DISPLAY_RANGE << 24u) | 0x00ffffffu);
	gpu.writeGp1((bmsx::GX_GPU_GP1_VERTICAL_DISPLAY_RANGE << 24u) | 0x00ffffffu);
	gpu.writeGp1((bmsx::GX_GPU_GP1_VRAM_Y_ADDRESS_EXTENSION << 24u) | 0x00ffffffu);

	require(gpu.readDisplayStartWord() == bmsx::GX_GPU_DISPLAY_START_MASK, "GX-GPU GP1 display start mask");
	require(gpu.readHorizontalDisplayRangeWord() == bmsx::GX_GPU_HORIZONTAL_DISPLAY_RANGE_MASK, "GX-GPU GP1 horizontal display range mask");
	require(gpu.readVerticalDisplayRangeWord() == bmsx::GX_GPU_VERTICAL_DISPLAY_RANGE_MASK, "GX-GPU GP1 vertical display range mask");
	require(gpu.readVramYAddressExtensionWord() == 1u, "GX-GPU GP1 VRAM Y-address extension latch");

	require(gpu.readDeviceOutput().displayStartWord == 0u, "GX-GPU output display start remains latched before VBLANK");
	completeGpuCommands(harness);
	gpu.presentReadyFrameOnVblankEdge();
	const bmsx::GxGpuDeviceOutput& output = gpu.readDeviceOutput();
	require(output.statusWord == gpu.readStatus(), "GX-GPU output status word");
	require(output.displayModeWord == gpu.readDisplayModeWord(), "GX-GPU output display mode word");
	require(output.displayStartWord == bmsx::GX_GPU_DISPLAY_START_MASK, "GX-GPU output display start word");
	require(output.horizontalDisplayRangeWord == bmsx::GX_GPU_HORIZONTAL_DISPLAY_RANGE_MASK, "GX-GPU output horizontal range word");
	require(output.verticalDisplayRangeWord == bmsx::GX_GPU_VERTICAL_DISPLAY_RANGE_MASK, "GX-GPU output vertical range word");
	require(gpu.lastFrameCommitted(), "GX-GPU CRTC state change commits a presentation frame");
}

void testGp1UndefinedHighOpcodeDoesNotMirrorReset() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;

	gpu.writeGp1(bmsx::GX_GPU_GP1_DISPLAY_MODE << 24u);
	gpu.writeGp1(0x40000000u);
	require(gpu.readDisplayModeWord() == 0u, "GX-GPU GP1 40h does not mirror reset");
}

void testGp0IrqRequestAndGp1Acknowledge() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;
	bmsx::Memory& memory = harness.memory;

	gpu.writeGp0(bmsx::GX_GPU_GP0_IRQ_REQUEST << 24u);
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_INTERRUPT_REQUEST) == bmsx::GX_GPU_STATUS_INTERRUPT_REQUEST, "GX-GPU GP0 IRQ request bit");
	require((memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_GPU) == bmsx::IRQ_GPU, "GX-GPU GP0 IRQ request raises the GPU interrupt source");
	completeGpuCommands(harness);

	memory.writeMappedU32LE(bmsx::IO_IRQ_ACK, bmsx::IRQ_GPU);
	require((memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_GPU) == 0u, "GX-GPU system IRQ acknowledge clears the pending edge");
	gpu.writeGp0(bmsx::GX_GPU_GP0_IRQ_REQUEST << 24u);
	require((memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_GPU) == 0u, "GX-GPU repeated GP0 IRQ request does not retrigger an asserted source");
	completeGpuCommands(harness);

	gpu.writeGp1(bmsx::GX_GPU_GP1_ACK_INTERRUPT << 24u);
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_INTERRUPT_REQUEST) == 0u, "GX-GPU GP1 IRQ acknowledge clears request bit");

	gpu.writeGp0(bmsx::GX_GPU_GP0_IRQ_REQUEST << 24u);
	require((memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_GPU) == bmsx::IRQ_GPU, "GX-GPU GP0 IRQ request retriggers after GP1 deasserts the source");
	gpu.writeGp1(bmsx::GX_GPU_GP1_ACK_INTERRUPT << 24u);
	require((memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_GPU) == bmsx::IRQ_GPU, "GX-GPU GP1 IRQ acknowledge leaves the system pending latch for IRQ_ACK");
}

void testPcrtcOwnsLiveCsrImrAndSeparateIrqSource() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;
	bmsx::Memory& memory = harness.memory;
	gpu.setTiming(5'000'000, 0);
	gpu.onService(0);
	const bmsx::u32 csrLow = bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_CSR_LOW);
	const bmsx::u32 csrHigh = bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_CSR_HIGH);
	const bmsx::u32 imrLow = bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_IMR_LOW);
	const bmsx::u32 imrHigh = bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_IMR_HIGH);
	require(memory.readMappedU32LE(csrLow) == bmsx::GX_GPU_PCRTC_RESET_CSR_WORD, "GX-GPU PCRTC CSR reset readback");
	require(memory.readMappedU32LE(imrLow) == bmsx::GX_GPU_PCRTC_RESET_IMR_WORD, "GX-GPU PCRTC IMR reset readback");
	require(memory.readMappedU32LE(csrHigh) == 0u && memory.readMappedU32LE(imrHigh) == 0u, "GX-GPU PCRTC high halves read zero");
	memory.writeMappedU32LE(csrHigh, 0xffffffffu);
	memory.writeMappedU32LE(imrHigh, 0xffffffffu);
	memory.writeMappedU32LE(csrLow, 0xfffffc00u);
	require(memory.readMappedU32LE(csrLow) == bmsx::GX_GPU_PCRTC_RESET_CSR_WORD, "GX-GPU PCRTC CSR software cannot overwrite live status fields");
	require(memory.readMappedU32LE(imrLow) == bmsx::GX_GPU_PCRTC_RESET_IMR_WORD, "GX-GPU PCRTC high-half writes do not alter IMR");

	runGpuAtNextDeadline(harness);
	runGpuAtNextDeadline(harness);
	runGpuAtNextDeadline(harness);
	const bmsx::u32 firstVsyncCsr = memory.readMappedU32LE(csrLow);
	require((firstVsyncCsr & (bmsx::GX_GPU_PCRTC_CSR_FIELD | bmsx::GX_GPU_PCRTC_CSR_VSINT))
		== (bmsx::GX_GPU_PCRTC_CSR_FIELD | bmsx::GX_GPU_PCRTC_CSR_VSINT), "GX-GPU PCRTC VSync toggles FIELD and raises VSINT");
	require((memory.readIoU32(bmsx::IO_IRQ_FLAGS) & (bmsx::IRQ_GX_PCRTC | bmsx::IRQ_VBLANK)) == 0u, "GX-GPU PCRTC masked VSync does not raise either system IRQ source");
	const bmsx::u32 unmaskVsync = bmsx::GX_GPU_PCRTC_IMR_EVENT_MASK & ~(bmsx::GX_GPU_PCRTC_CSR_VSINT << 8u);
	memory.writeMappedU32LE(imrLow, unmaskVsync);
	require(memory.readMappedU32LE(imrLow) == (unmaskVsync | bmsx::GX_GPU_PCRTC_IMR_FIXED_BITS), "GX-GPU PCRTC IMR keeps event masks and fixed bits");
	require((memory.readIoU32(bmsx::IO_IRQ_FLAGS) & (bmsx::IRQ_GX_PCRTC | bmsx::IRQ_VBLANK)) == bmsx::IRQ_GX_PCRTC, "GX-GPU PCRTC pending-unmask raises only the explicit PCRTC IRQ source");
	memory.writeMappedU32LE(bmsx::IO_IRQ_ACK, bmsx::IRQ_GX_PCRTC);
	memory.writeMappedU32LE(imrLow, unmaskVsync);
	require((memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_GX_PCRTC) == 0u, "GX-GPU PCRTC identical IMR rewrite does not retrigger a pending event");
	const bmsx::u32 unmaskVsyncAndSignal = unmaskVsync & ~(bmsx::GX_GPU_PCRTC_CSR_SIGNAL << 8u);
	memory.writeMappedU32LE(imrLow, unmaskVsyncAndSignal);
	require((memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_GX_PCRTC) == 0u, "GX-GPU PCRTC unrelated IMR transition does not retrigger a pending event");
	memory.writeMappedU32LE(imrLow, bmsx::GX_GPU_PCRTC_IMR_EVENT_MASK);
	memory.writeMappedU32LE(imrLow, unmaskVsync);
	require((memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_GX_PCRTC) == bmsx::IRQ_GX_PCRTC, "GX-GPU PCRTC pending event retriggers only on a real masked-to-unmasked transition");
	memory.writeMappedU32LE(csrLow, bmsx::GX_GPU_PCRTC_CSR_VSINT);
	require((memory.readMappedU32LE(csrLow) & bmsx::GX_GPU_PCRTC_CSR_VSINT) == 0u, "GX-GPU PCRTC CSR event bits are write-one-to-clear");
	require((memory.readMappedU32LE(csrLow) & bmsx::GX_GPU_PCRTC_CSR_FIELD) != 0u, "GX-GPU PCRTC CSR event clear preserves FIELD");
	memory.writeMappedU32LE(bmsx::IO_IRQ_ACK, bmsx::IRQ_GX_PCRTC);
	require((memory.readIoU32(bmsx::IO_IRQ_FLAGS) & bmsx::IRQ_GX_PCRTC) == 0u, "GX-GPU PCRTC external IRQ latch acknowledges separately from CSR");
	memory.writeMappedU32LE(bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_SYNCV_LOW), 0x02101405u);
	gpu.onService(harness.scheduler.currentNowCycles());
	runGpuAtNextDeadline(harness);
	runGpuAtNextDeadline(harness);
	require((memory.readMappedU32LE(csrLow) & bmsx::GX_GPU_PCRTC_CSR_FIELD) == 0u, "GX-GPU PCRTC subsequent VSync toggles FIELD again");
	require((memory.readMappedU32LE(csrLow) & bmsx::GX_GPU_PCRTC_CSR_VSINT) != 0u, "GX-GPU PCRTC subsequent VSync raises VSINT again");
	require((memory.readIoU32(bmsx::IO_IRQ_FLAGS) & (bmsx::IRQ_GX_PCRTC | bmsx::IRQ_VBLANK)) == bmsx::IRQ_GX_PCRTC, "GX-GPU PCRTC unmasked VSync retriggers only PCRTC IRQ");
}

void testPcrtcCsrFlushAndResetExecuteOwnerActions() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;
	bmsx::Memory& memory = harness.memory;
	const bmsx::u32 csrLow = bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_CSR_LOW);
	const bmsx::u32 pmodeLow = bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_PMODE_LOW);
	gpu.presentReadyFrameOnVblankEdge();
	gpu.retirePresentedCommands();
	gpu.presentReadyFrameOnVblankEdge();
	require(!gpu.lastFrameCommitted(), "GX-GPU PCRTC reset vector starts without pending presentation work");
	gpu.writeGp0(bmsx::GX_GPU_GP0_POLYGON_FIRST << 24u);
	require(gpu.captureState().gp0CommandWordCount == 1u, "GX-GPU PCRTC FLUSH vector starts with a partial GP0 packet");
	memory.writeMappedU32LE(csrLow, bmsx::GX_GPU_PCRTC_CSR_FLUSH);
	require(gpu.captureState().gp0CommandWordCount == 0u, "GX-GPU PCRTC FLUSH clears pending GP0 ingress");
	require((memory.readMappedU32LE(csrLow) & bmsx::GX_GPU_PCRTC_CSR_FLUSH) == 0u, "GX-GPU PCRTC FLUSH is an action rather than a latch");
	memory.writeMappedU32LE(pmodeLow, bmsx::GX_GPU_PCRTC_PMODE_EN1 | bmsx::GX_GPU_PCRTC_PMODE_EN2);
	require(memory.readMappedU32LE(pmodeLow) == (bmsx::GX_GPU_PCRTC_PMODE_EN1 | bmsx::GX_GPU_PCRTC_PMODE_EN2), "GX-GPU PCRTC reset vector changes active PMODE");
	memory.writeMappedU32LE(csrLow, bmsx::GX_GPU_PCRTC_CSR_RESET);
	require(memory.readMappedU32LE(pmodeLow) == 0u, "GX-GPU PCRTC RESET restores active PMODE");
	require(memory.readMappedU32LE(csrLow) == bmsx::GX_GPU_PCRTC_RESET_CSR_WORD, "GX-GPU PCRTC RESET restores CSR");
	require(memory.readMappedU32LE(bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_IMR_LOW)) == bmsx::GX_GPU_PCRTC_RESET_IMR_WORD, "GX-GPU PCRTC RESET restores IMR");
	require(!gpu.readDeviceOutput().pcrtcScanout.outputActive, "GX-GPU PCRTC RESET publishes inactive output while both circuits are disabled");
	require(gpu.readDeviceOutput().pcrtcScanout.outputWidth == 0u && gpu.readDeviceOutput().pcrtcScanout.outputHeight == 0u, "GX-GPU PCRTC RESET publishes no scanout while both circuits are disabled");
	gpu.presentReadyFrameOnVblankEdge();
	require(gpu.lastFrameCommitted(), "GX-GPU PCRTC RESET publishes the reset scanout at the next VBlank edge");
	gpu.retirePresentedCommands();
	gpu.presentReadyFrameOnVblankEdge();
	require(!gpu.lastFrameCommitted(), "GX-GPU PCRTC RESET presentation latch clears after publication");
}

void testGp0DrawModeAndMaskBitEnvironmentCommands() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;

	gpu.writeGp0((bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | 0x00ffffffu);
	completeGpuCommands(harness);

	require(gpu.readDrawModeWord() == bmsx::GX_GPU_DRAW_MODE_MASK, "GX-GPU GP0 draw-mode latches texture-page Y-high independently of GP1 gate");
	require((gpu.readStatus() & bmsx::GX_GPU_DRAW_MODE_GPUSTAT_MASK) == bmsx::GX_GPU_DRAW_MODE_GPUSTAT_MASK, "GX-GPU GP0 draw-mode GPUSTAT bits");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_TEXTURE_PAGE_Y_HIGH) == bmsx::GX_GPU_STATUS_TEXTURE_PAGE_Y_HIGH, "GX-GPU texture-page Y-high mirrors to GPUSTAT before GP1 gate opens");
	require((gpu.readDrawModeWord() & bmsx::GX_GPU_DRAW_MODE_DITHER_ENABLED) == bmsx::GX_GPU_DRAW_MODE_DITHER_ENABLED, "GX-GPU GP0 dither source bit");
	require((gpu.readDrawModeWord() & bmsx::GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP) == bmsx::GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP, "GX-GPU GP0 textured rectangle X flip source bit");
	require((gpu.readDrawModeWord() & bmsx::GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_Y_FLIP) == bmsx::GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_Y_FLIP, "GX-GPU GP0 textured rectangle Y flip source bit");

	gpu.writeGp1((bmsx::GX_GPU_GP1_VRAM_Y_ADDRESS_EXTENSION << 24u) | 1u);
	require(gpu.readVramYAddressExtensionWord() == 1u, "GX-GPU GP1 VRAM Y-address extension raw word");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_TEXTURE_PAGE_Y_HIGH) == bmsx::GX_GPU_STATUS_TEXTURE_PAGE_Y_HIGH, "GX-GPU GP1 gate does not alter texture-page Y-high GPUSTAT");
	gpu.writeGp0((bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | 0x00ffffffu);
	completeGpuCommands(harness);
	require(gpu.readDrawModeWord() == bmsx::GX_GPU_DRAW_MODE_MASK, "GX-GPU GP0 draw-mode remains latched after opening the VRAM Y gate");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_TEXTURE_PAGE_Y_HIGH) == bmsx::GX_GPU_STATUS_TEXTURE_PAGE_Y_HIGH, "GX-GPU texture-page Y-high remains mirrored after opening the VRAM Y gate");

	gpu.writeGp0((bmsx::GX_GPU_GP0_MASK_BIT << 24u) | 0x00000003u);
	completeGpuCommands(harness);
	require(gpu.readMaskBitModeWord() == 3u, "GX-GPU GP0 mask-bit raw word");
	require((gpu.readStatus() & ((1u << 11u) | (1u << 12u))) == (3u << 11u), "GX-GPU GP0 mask-bit GPUSTAT bits");
	require((gpu.readDrawModeWord() & bmsx::GX_GPU_DRAW_MODE_TEXTURE_PAGE_Y_HIGH) == bmsx::GX_GPU_DRAW_MODE_TEXTURE_PAGE_Y_HIGH, "GX-GPU GP0 draw-mode texture-page Y-high source bit");
}

void testGp0EnvironmentRegistersAndGpuInfoQueries() {
	GpuHarness harness;
	bmsx::Memory& memory = harness.memory;
	bmsx::GxGpu& gpu = harness.gpu;

	gpu.writeGp0((bmsx::GX_GPU_GP0_TEXTURE_WINDOW << 24u) | 0x00ffffffu);
	gpu.writeGp0((bmsx::GX_GPU_GP0_DRAWING_AREA_TOP_LEFT << 24u) | 0x00ffffffu);
	gpu.writeGp0((bmsx::GX_GPU_GP0_DRAWING_AREA_BOTTOM_RIGHT << 24u) | 0x00abcdefu);
	gpu.writeGp0((bmsx::GX_GPU_GP0_DRAWING_OFFSET << 24u) | 0x00ffffffu);
	completeGpuCommands(harness);

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
	gpu.writeGp1((bmsx::GX_GPU_GP1_GET_GPU_INFO_LAST << 24u) | 0x02u);
	require(gpu.readGpuReadWord() == bmsx::GX_GPU_TEXTURE_WINDOW_MASK, "GX-GPU GP1 10h-1fh info opcode range");
	gpu.writeGp1((bmsx::GX_GPU_GP1_GET_GPU_INFO << 24u) | 0x12u);
	require(gpu.readGpuReadWord() == bmsx::GX_GPU_TEXTURE_WINDOW_MASK, "GX-GPU GP1 info selector mirrors low nibble");
	gpu.writeGp1((bmsx::GX_GPU_GP1_GET_GPU_INFO << 24u) | 0x07u);
	require(gpu.readGpuReadWord() == bmsx::GX_GPU_INFO_GPU_TYPE_V2, "GX-GPU GP1 info GPU type query");
	gpu.writeGp1((bmsx::GX_GPU_GP1_GET_GPU_INFO << 24u) | 0x0au);
	require(gpu.readGpuReadWord() == bmsx::GX_GPU_INFO_GPU_TYPE_V2, "GX-GPU GP1 info high index keeps latch");
	gpu.writeGp1((bmsx::GX_GPU_GP1_GET_GPU_INFO << 24u) | 0x08u);
	require(gpu.readGpuReadWord() == 0u, "GX-GPU GP1 info unknown query");
	gpu.writeGp1((bmsx::GX_GPU_GP1_GET_GPU_INFO_LAST << 24u) | 0x07u);
	require(gpu.readGpuReadWord() == bmsx::GX_GPU_INFO_GPU_TYPE_V2, "GX-GPU GP1 info mirrored opcode GPU type query");
	gpu.writeGp1((bmsx::GX_GPU_GP1_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU);
	gpu.writeGp1((bmsx::GX_GPU_GP1_GET_GPU_INFO << 24u) | 0x07u);
	const uint32_t status = gpu.readStatus();
	require((status & bmsx::GX_GPU_STATUS_READY_TO_SEND_VRAM) == 0u, "GX-GPU GP1 info does not mark VRAM readback ready");
	require((status & bmsx::GX_GPU_STATUS_DMA_DATA_REQUEST) == 0u, "GX-GPU GP1 info does not request GPUREAD DMA");
}

void testGp0FixedLengthRenderAndBlitPacketAssembly() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;
	const bmsx::GxGpuCommandBuffer& commands = harness.gpu.readDeviceOutput().commandBuffer;

	gpu.writeGp0((bmsx::GX_GPU_GP0_POLYGON_FIRST << 24u) | 0x0000ffu);
	gpu.writeGp0((bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | 0x123456u);
	gpu.writeGp0(0x00020003u);

	require(commands.commandCount == 0u, "GX-GPU GP0 partial polygon has no emitted command");
	require(gpu.readDrawModeWord() == 0u, "GX-GPU GP0 partial polygon payload does not execute draw mode");

	gpu.writeGp0(0x00040005u);
	require(commands.commandCount == 1u, "GX-GPU GP0 flat triangle emitted command count");
	require(commands.commandKind[0] == bmsx::GX_GPU_COMMAND_DRAW_POLYGON, "GX-GPU GP0 flat triangle command kind");
	require(commands.commandOpcode[0] == bmsx::GX_GPU_GP0_POLYGON_FIRST, "GX-GPU GP0 flat triangle opcode");
	require(commands.commandWordCount[0] == 4u, "GX-GPU GP0 flat triangle command words");
	require(commands.words[commands.commandWordStart[0] + 1u] == ((bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | 0x123456u), "GX-GPU GP0 flat triangle raw payload word");
	require(gpu.readDrawModeWord() == 0u, "GX-GPU GP0 completed polygon payload does not execute draw mode");
	completeGpuCommands(harness);

	const uint32_t texturedGouraudQuad = bmsx::GX_GPU_GP0_POLYGON_FIRST
		| bmsx::GX_GPU_GP0_RENDER_TEXTURE_BIT
		| bmsx::GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT
		| bmsx::GX_GPU_GP0_RENDER_GOURAUD_BIT;
	gpu.writeGp0(texturedGouraudQuad << 24u);
	for (uint32_t index = 1u; index < 12u; index += 1u) {
		gpu.writeGp0(index == 5u ? 0x01830055u : index == 6u ? ((bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | 0x000345u) : index);
	}
	completeGpuCommands(harness);
	require(commands.commandCount == 2u, "GX-GPU GP0 textured Gouraud quad emitted command count");
	require(commands.commandKind[1] == bmsx::GX_GPU_COMMAND_DRAW_POLYGON, "GX-GPU GP0 textured Gouraud quad command kind");
	require(commands.commandOpcode[1] == texturedGouraudQuad, "GX-GPU GP0 textured Gouraud quad opcode");
	require(commands.commandWordCount[1] == 12u, "GX-GPU GP0 textured Gouraud quad command words");
	require(commands.commandDrawModeWord[1] == 0x0183u, "GX-GPU textured polygon captures texpage draw mode");
	require(gpu.readDrawModeWord() == 0x0183u, "GX-GPU textured polygon writes texpage draw mode");

	gpu.writeGp0(bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u);
	gpu.writeGp0((bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | 0x000222u);
	require(commands.commandCount == 2u, "GX-GPU GP0 fill rectangle waits for size word");
	gpu.writeGp0(0x000c000du);
	completeGpuCommands(harness);
	require(commands.commandCount == 3u, "GX-GPU GP0 fill rectangle emitted command count");
	require(commands.commandKind[2] == bmsx::GX_GPU_COMMAND_FILL_RECTANGLE, "GX-GPU GP0 fill rectangle command kind");
	require(commands.commandWordCount[2] == 3u, "GX-GPU GP0 fill rectangle command words");

	gpu.writeGp0((bmsx::GX_GPU_GP0_RECTANGLE_FIRST | bmsx::GX_GPU_GP0_RENDER_TEXTURE_BIT) << 24u);
	gpu.writeGp0((bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | 0x000333u);
	gpu.writeGp0(0x00030004u);
	gpu.writeGp0(0x00050006u);
	completeGpuCommands(harness);
	require(commands.commandCount == 4u, "GX-GPU GP0 textured variable rectangle emitted command count");
	require(commands.commandKind[3] == bmsx::GX_GPU_COMMAND_DRAW_RECTANGLE, "GX-GPU GP0 textured variable rectangle command kind");
	require(commands.commandWordCount[3] == 4u, "GX-GPU GP0 textured variable rectangle command words");

	gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_VRAM_FIRST << 24u);
	gpu.writeGp0((bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | 0x000444u);
	gpu.writeGp0(0x00030004u);
	gpu.writeGp0(0x00050006u);
	completeGpuCommands(harness);
	require(commands.commandCount == 5u, "GX-GPU GP0 VRAM-to-VRAM emitted command count");
	require(commands.commandKind[4] == bmsx::GX_GPU_COMMAND_COPY_VRAM_TO_VRAM, "GX-GPU GP0 VRAM-to-VRAM command kind");
	require(commands.commandWordCount[4] == 4u, "GX-GPU GP0 VRAM-to-VRAM command words");

	gpu.writeGp0((bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | 0x0007ffu);
	completeGpuCommands(harness);
	require(commands.commandCount == 5u, "GX-GPU GP0 environment command does not emit GPU command");
	require(gpu.readDrawModeWord() == 0x0007ffu, "GX-GPU GP0 command processing resumes after fixed packets");

	gpu.writeGp0(0x40u << 24u);
	gpu.writeGp0(0x00010002u);
	gpu.writeGp0(0x00030004u);
	completeGpuCommands(harness);
	require(commands.commandCount == 6u, "GX-GPU GP0 line emitted command count");
	require(commands.commandKind[5] == bmsx::GX_GPU_COMMAND_DRAW_LINE, "GX-GPU GP0 line command kind");
	require(commands.commandDrawModeWord[5] == 0x0007ffu, "GX-GPU GP0 line captures draw mode state");
}

void testGp0CpuToVramImagePayloadConsumption() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;
	const bmsx::GxGpuCommandBuffer& commands = gpu.readDeviceOutput().commandBuffer;

	gpu.writeGp0(bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24u);
	gpu.writeGp0(0x00010002u);
	gpu.writeGp0(0x00020003u);
	require(commands.commandCount == 0u, "GX-GPU GP0 CPU-to-VRAM header waits for payload");

	gpu.writeGp0((bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | 0x000111u);
	gpu.writeGp0((bmsx::GX_GPU_GP0_MASK_BIT << 24u) | 0x000003u);
	require(commands.commandCount == 0u, "GX-GPU GP0 CPU-to-VRAM partial payload has no command");
	gpu.writeGp0((bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | 0x000222u);
	require(commands.commandCount == 1u, "GX-GPU GP0 CPU-to-VRAM emitted command count");
	require(commands.commandKind[0] == bmsx::GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, "GX-GPU GP0 CPU-to-VRAM command kind");
	require(commands.commandOpcode[0] == bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST, "GX-GPU GP0 CPU-to-VRAM opcode");
	require(commands.commandWordCount[0] == 6u, "GX-GPU GP0 CPU-to-VRAM command words");
	require(commands.words[commands.commandWordStart[0] + 3u] == ((bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | 0x000111u), "GX-GPU GP0 CPU-to-VRAM first payload word");
	require(commands.words[commands.commandWordStart[0] + 5u] == ((bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | 0x000222u), "GX-GPU GP0 CPU-to-VRAM final payload word");
	require(gpu.readDrawModeWord() == 0u, "GX-GPU GP0 image payload words do not execute draw mode");
	require(gpu.readMaskBitModeWord() == 0u, "GX-GPU GP0 image payload words do not execute mask bit");
	completeGpuCommands(harness);

	gpu.writeGp0((bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | 0x0007ffu);
	completeGpuCommands(harness);
	require(commands.commandCount == 1u, "GX-GPU GP0 post-transfer environment command does not emit GPU command");
	require(gpu.readDrawModeWord() == 0x0007ffu, "GX-GPU GP0 command processing resumes after image transfer");
}

void testSupervisorContextPreservesPartialCpuToVramPacket() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;
	constexpr bmsx::u32 commandWord = bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24u;
	constexpr bmsx::u32 destinationWord = 0x00010002u;
	constexpr bmsx::u32 sizeWord = 4u | (1u << 16u);
	constexpr bmsx::u32 firstPayloadWord = 0x22221111u;
	constexpr bmsx::u32 finalPayloadWord = 0x44443333u;
	gpu.writeGp0(commandWord);
	gpu.writeGp0(destinationWord);
	gpu.writeGp0(sizeWord);
	gpu.writeGp0(firstPayloadWord);
	const bmsx::GxGpuState partial = gpu.captureState();
	require(partial.gp0ImageLoadWordsRemaining == 1u, "GX-GPU partial upload retains one payload word");
	require(partial.commandBuffer.commandCount == 0u, "GX-GPU partial upload has no committed command");
	require(partial.commandBuffer.words == std::vector<bmsx::u32>{commandWord, destinationWord, sizeWord, firstPayloadWord}, "GX-GPU partial upload retains its exact words");

	gpu.beginSupervisorControlQuiesce();
	gpu.beginSupervisorQuiesce();
	require(gpu.supervisorQuiescent(), "GX-GPU partial upload reaches the supervisor fence");
	gpu.enterSupervisorContext();
	require(gpu.captureState().commandBuffer.wordCount == 0u, "GX-GPU supervisor gets an empty ingress context");
	gpu.leaveSupervisorContext();

	const bmsx::GxGpuState restored = gpu.captureState();
	require(restored.gp0IngressPhase == partial.gp0IngressPhase, "GX-GPU restores the partial upload ingress phase");
	require(restored.gp0ImageLoadWordsRemaining == partial.gp0ImageLoadWordsRemaining, "GX-GPU restores the partial upload word count");
	require(restored.gp0ImageLoadCommandWordStart == partial.gp0ImageLoadCommandWordStart, "GX-GPU restores the partial upload command start");
	require(restored.gp0ImageLoadCommandWordCount == partial.gp0ImageLoadCommandWordCount, "GX-GPU restores the partial upload command word count");
	require(restored.gp0ImageLoadCommandOpcode == partial.gp0ImageLoadCommandOpcode, "GX-GPU restores the partial upload opcode");
	require(restored.commandBuffer.words == partial.commandBuffer.words, "GX-GPU restores the partial upload words");

	gpu.writeGp0(finalPayloadWord);
	const bmsx::GxGpuCommandBuffer& commands = gpu.readDeviceOutput().commandBuffer;
	require(commands.commandCount == 1u, "GX-GPU completes the restored upload");
	require(commands.commandKind[0] == bmsx::GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, "GX-GPU restored upload keeps its command kind");
	require(commands.commandWordCount[0] == 5u, "GX-GPU restored upload keeps its word count");
	const size_t start = commands.commandWordStart[0];
	require(commands.words[start] == commandWord, "GX-GPU restored upload keeps its command word");
	require(commands.words[start + 1u] == destinationWord, "GX-GPU restored upload keeps its destination");
	require(commands.words[start + 2u] == sizeWord, "GX-GPU restored upload keeps its dimensions");
	require(commands.words[start + 3u] == firstPayloadWord, "GX-GPU restored upload keeps its first payload word");
	require(commands.words[start + 4u] == finalPayloadWord, "GX-GPU restored upload accepts its final payload word");
}

void testGp0PolylineConsumesPayloadUntilTerminator() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;
	const bmsx::GxGpuCommandBuffer& commands = gpu.readDeviceOutput().commandBuffer;

	gpu.writeGp0((0x48u << 24u) | 0x0000ffu);
	gpu.writeGp0(0x00010002u);
	gpu.writeGp0(0x00020003u);
	require(commands.commandCount == 0u, "GX-GPU GP0 polyline waits for terminator");
	gpu.writeGp0(0x50005000u);
	completeGpuCommands(harness);
	require(commands.commandCount == 1u, "GX-GPU GP0 polyline emitted command count");
	require(commands.commandKind[0] == bmsx::GX_GPU_COMMAND_DRAW_POLYLINE, "GX-GPU GP0 polyline command kind");
	require(commands.commandOpcode[0] == 0x48u, "GX-GPU GP0 polyline opcode");
	require(commands.commandWordCount[0] == 3u, "GX-GPU GP0 polyline command words");
	require(commands.words[commands.commandWordStart[0] + 1u] == 0x00010002u, "GX-GPU GP0 polyline first vertex word");
	require(gpu.readDrawModeWord() == 0u, "GX-GPU GP0 polyline payload does not execute draw mode");

	gpu.writeGp0((bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | 0x000222u);
	completeGpuCommands(harness);
	require(commands.commandCount == 1u, "GX-GPU GP0 post-polyline environment command does not emit GPU command");
	require(gpu.readDrawModeWord() == 0x000222u, "GX-GPU GP0 command processing resumes after polyline terminator");

	gpu.writeGp0(((0x40u | bmsx::GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT | bmsx::GX_GPU_GP0_RENDER_GOURAUD_BIT) << 24u) | 0x0000ffu);
	gpu.writeGp0(0x00010002u);
	gpu.writeGp0(0x00010000u);
	gpu.writeGp0(0x00020003u);
	require(commands.commandCount == 1u, "GX-GPU GP0 shaded polyline waits for terminator");
	gpu.writeGp0(0x50005000u);
	completeGpuCommands(harness);
	require(commands.commandCount == 2u, "GX-GPU GP0 shaded polyline emitted command count");
	require(commands.commandKind[1] == bmsx::GX_GPU_COMMAND_DRAW_POLYLINE, "GX-GPU GP0 shaded polyline command kind");
	require(commands.commandOpcode[1] == 0x58u, "GX-GPU GP0 shaded polyline opcode");
	require(commands.commandWordCount[1] == 4u, "GX-GPU GP0 shaded polyline command words");
	require(commands.words[commands.commandWordStart[1] + 2u] == 0x00010000u, "GX-GPU GP0 shaded polyline second color word");

	gpu.writeGp0((bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | 0x000333u);
	completeGpuCommands(harness);
	require(commands.commandCount == 2u, "GX-GPU GP0 post-shaded-polyline environment command does not emit GPU command");
	require(gpu.readDrawModeWord() == 0x000333u, "GX-GPU GP0 command processing resumes after shaded polyline terminator");
}

void testSaveStateRestoresPartialFixedGp0Command() {
	GpuHarness packetHarness;
	bmsx::GxGpu& packetGpu = packetHarness.gpu;
	packetGpu.writeGp0((bmsx::GX_GPU_GP0_POLYGON_FIRST << 24u) | 0x0000ffu);
	packetGpu.writeGp0(0x00010002u);
	packetGpu.writeGp0(0x00030004u);

	GpuHarness restoredPacketHarness;
	bmsx::GxGpu& restoredPacketGpu = restoredPacketHarness.gpu;
	restoredPacketGpu.restoreState(packetGpu.captureState());
	restoredPacketGpu.writeGp0(0x00050006u);
	const bmsx::GxGpuCommandBuffer& packetCommands = restoredPacketGpu.readDeviceOutput().commandBuffer;
	require(packetCommands.commandCount == 1u, "GX-GPU save-state restores partial fixed GP0 command");
	require(packetCommands.commandKind[0] == bmsx::GX_GPU_COMMAND_DRAW_POLYGON, "GX-GPU restored fixed GP0 command kind");
	require(packetCommands.commandWordCount[0] == 4u, "GX-GPU restored fixed GP0 command word count");
	require(packetCommands.words[packetCommands.commandWordStart[0] + 2u] == 0x00030004u, "GX-GPU restored fixed GP0 command keeps middle word");
}

void testSaveStateRestoresPartialCpuToVramUpload() {
	GpuHarness imageHarness;
	bmsx::GxGpu& imageGpu = imageHarness.gpu;
	imageGpu.writeGp0(bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24u);
	imageGpu.writeGp0((bmsx::GX_GPU_GP0_DRAWING_AREA_TOP_LEFT << 24u) | 0x00123456u);
	imageGpu.writeGp0((2u << 16u) | 2u);
	imageGpu.writeGp0((bmsx::GX_GPU_GP0_DRAWING_AREA_BOTTOM_RIGHT << 24u) | 0x001f03e0u);
	require(imageGpu.readDrawingAreaTopLeftWord() == 0u, "GX-GPU image header remains opaque to ingress sideband decode");
	require(imageGpu.readDrawingAreaBottomRightWord() == 0u, "GX-GPU image payload remains opaque to ingress sideband decode");

	GpuHarness restoredImageHarness;
	bmsx::GxGpu& restoredImageGpu = restoredImageHarness.gpu;
	restoredImageGpu.restoreState(imageGpu.captureState());
	restoredImageGpu.writeGp0((bmsx::GX_GPU_GP0_DRAWING_OFFSET << 24u) | 0x0000ffffu);
	const bmsx::GxGpuCommandBuffer& imageCommands = restoredImageGpu.readDeviceOutput().commandBuffer;
	require(imageCommands.commandCount == 1u, "GX-GPU save-state restores partial CPU-to-VRAM upload");
	require(imageCommands.commandKind[0] == bmsx::GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, "GX-GPU restored upload command kind");
	require(imageCommands.commandWordCount[0] == 5u, "GX-GPU restored upload command word count");
	require(imageCommands.words[imageCommands.commandWordStart[0] + 3u] == ((bmsx::GX_GPU_GP0_DRAWING_AREA_BOTTOM_RIGHT << 24u) | 0x001f03e0u), "GX-GPU restored upload keeps first payload word");
	require(imageCommands.words[imageCommands.commandWordStart[0] + 4u] == ((bmsx::GX_GPU_GP0_DRAWING_OFFSET << 24u) | 0x0000ffffu), "GX-GPU restored upload accepts final payload word");
	require(restoredImageGpu.readDrawingAreaTopLeftWord() == 0u, "GX-GPU restored image header does not mutate E3 latch");
	require(restoredImageGpu.readDrawingAreaBottomRightWord() == 0u, "GX-GPU restored image payload does not mutate E4 latch");
	require(restoredImageGpu.readDrawingOffsetWord() == 0u, "GX-GPU restored image payload does not mutate E5 latch");
}

void testSaveStateRestoresPartialPolylineCommand() {
	GpuHarness polylineHarness;
	bmsx::GxGpu& polylineGpu = polylineHarness.gpu;
	polylineGpu.writeGp0((0x48u << 24u) | 0x0000ffu);
	polylineGpu.writeGp0(0x00010002u);
	polylineGpu.writeGp0(0x00020003u);

	GpuHarness restoredPolylineHarness;
	bmsx::GxGpu& restoredPolylineGpu = restoredPolylineHarness.gpu;
	restoredPolylineGpu.restoreState(polylineGpu.captureState());
	restoredPolylineGpu.writeGp0(0x50005000u);
	const bmsx::GxGpuCommandBuffer& polylineCommands = restoredPolylineGpu.readDeviceOutput().commandBuffer;
	require(polylineCommands.commandCount == 1u, "GX-GPU save-state restores partial polyline command");
	require(polylineCommands.commandKind[0] == bmsx::GX_GPU_COMMAND_DRAW_POLYLINE, "GX-GPU restored polyline command kind");
	require(polylineCommands.commandWordCount[0] == 3u, "GX-GPU restored polyline command word count");
	require(polylineCommands.words[polylineCommands.commandWordStart[0] + 2u] == 0x00020003u, "GX-GPU restored polyline keeps last vertex word");
}

void testSaveStateRestoresGouraudPolylineIngressPhase() {
	GpuHarness gouraudPolylineHarness;
	bmsx::GxGpu& gouraudPolylineGpu = gouraudPolylineHarness.gpu;
	gouraudPolylineGpu.writeGp0((0x58u << 24u) | 0x0000ffu);
	gouraudPolylineGpu.writeGp0(0x00010002u);
	gouraudPolylineGpu.writeGp0(0x00010203u);
	gouraudPolylineGpu.writeGp0(0x00020003u);
	gouraudPolylineGpu.writeGp0(0x00040506u);

	GpuHarness restoredGouraudPolylineHarness;
	bmsx::GxGpu& restoredGouraudPolylineGpu = restoredGouraudPolylineHarness.gpu;
	restoredGouraudPolylineGpu.restoreState(gouraudPolylineGpu.captureState());
	restoredGouraudPolylineGpu.writeGp0(0x50005000u);
	require(restoredGouraudPolylineGpu.readDeviceOutput().commandBuffer.commandCount == 0u, "GX-GPU restored Gouraud coordinate phase keeps terminator-shaped data");
	restoredGouraudPolylineGpu.writeGp0(0x50005000u);
	const bmsx::GxGpuCommandBuffer& gouraudPolylineCommands = restoredGouraudPolylineGpu.readDeviceOutput().commandBuffer;
	require(gouraudPolylineCommands.commandCount == 1u, "GX-GPU restored Gouraud color phase accepts terminator");
	require(gouraudPolylineCommands.commandKind[0] == bmsx::GX_GPU_COMMAND_DRAW_POLYLINE, "GX-GPU restored Gouraud polyline command kind");
	require(gouraudPolylineCommands.commandWordCount[0] == 6u, "GX-GPU restored Gouraud polyline retains phase-one coordinate");
	require(gouraudPolylineCommands.words[gouraudPolylineCommands.commandWordStart[0] + 5u] == 0x50005000u, "GX-GPU restored Gouraud coordinate stores terminator-shaped word");
}

void testSaveStateRestoresCommandTimeAndFifoSuffixRelativeToSchedulerTime() {
	GpuHarness harness;
	stopPcrtc(harness);
	harness.gpu.writeGp0((bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u) | 0x0000ffu);
	harness.gpu.writeGp0(0u);
	harness.gpu.writeGp0((1u << 16u) | 1u);
	harness.gpu.writeGp0((bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | 0x000123u);
	harness.scheduler.advanceTo(10);
	const bmsx::GxGpuState state = harness.gpu.captureState();
	require(state.gp0FifoWords.size() == 1u, "GX-GPU save-state captures the queued FIFO suffix count");
	require(state.gp0FifoWords[0] == ((bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | 0x000123u), "GX-GPU save-state captures the queued FIFO suffix word");
	require(state.pendingCommandCycles == 19, "GX-GPU save-state captures remaining command cycles");
	require(state.commandBuffer.executedCommandCount == 0u, "GX-GPU save-state preserves the pending execution frontier");

	GpuHarness restored;
	restored.scheduler.advanceTo(100);
	restored.gpu.restoreState(state);
	restored.gpu.onService(100);
	require(restored.scheduler.nextDeadline() == 119, "GX-GPU restore schedules remaining command time relative to current time");
	restored.scheduler.advanceTo(118);
	restored.gpu.onService(118);
	require(restored.gpu.readDrawModeWord() == 0u, "GX-GPU restore keeps the FIFO suffix queued before completion");
	restored.scheduler.advanceTo(119);
	restored.gpu.onService(119);
	require(restored.gpu.readDrawModeWord() == 0x000123u, "GX-GPU restore consumes the FIFO suffix at prior command completion");
	require(restored.gpu.readDeviceOutput().commandBuffer.executedCommandCount == 1u, "GX-GPU restore advances the restored execution frontier");
	require(restored.scheduler.nextDeadline() == 120, "GX-GPU restore schedules the FIFO suffix command");
	restored.scheduler.advanceTo(120);
	restored.gpu.onService(120);
	require((restored.gpu.readStatus() & bmsx::GX_GPU_STATUS_GPU_IDLE) == bmsx::GX_GPU_STATUS_GPU_IDLE, "GX-GPU restore becomes idle after the FIFO suffix completes");
}

void testGp1ClearCompletesAcceptedDrawsAndCutsC0AtExecutionFrontier() {
	GpuHarness active;
	stopPcrtc(active);
	bmsx::DeviceScheduler& activeScheduler = active.scheduler;
	active.gpu.writeGp1((bmsx::GX_GPU_GP1_GET_GPU_INFO << 24u) | 0x07u);
	active.gpu.writeGp0((bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u) | 0x0000ffu);
	active.gpu.writeGp0(0u);
	active.gpu.writeGp0((1u << 16u) | 1u);
	active.gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24u);
	active.gpu.writeGp0(0u);
	active.gpu.writeGp0((1u << 16u) | 1u);
	const bmsx::i64 fillDeadline = activeScheduler.nextDeadline();
	activeScheduler.advanceTo(fillDeadline);
	active.gpu.onService(fillDeadline);
	const bmsx::GxGpuCommandBuffer& activeCommands = active.gpu.readDeviceOutput().commandBuffer;
	require(activeCommands.commandCount == 2u, "GX-GPU active C0 clear test retains fill and C0 before clear");
	require(activeCommands.executedCommandCount == 1u, "GX-GPU active C0 clear test executes its fill prefix");
	require(activeCommands.readback.phase() == bmsx::GX_GPU_READBACK_IDLE, "GX-GPU active C0 waits for its execution deadline");
	require(activeScheduler.nextDeadline() == fillDeadline + 1, "GX-GPU active C0 owns the next deadline");

	active.gpu.writeGp1(bmsx::GX_GPU_GP1_CLEAR_FIFO << 24u);
	require(activeCommands.commandCount == 1u, "GX-GPU GP1 clear removes the active C0 marker");
	require(activeCommands.executedCommandCount == 1u, "GX-GPU GP1 clear preserves the executed fill prefix");
	require(activeCommands.wordCount == 3u, "GX-GPU GP1 clear truncates active C0 words");
	require(activeCommands.readback.phase() == bmsx::GX_GPU_READBACK_IDLE, "GX-GPU GP1 clear keeps the pre-activation readback idle");
	require(activeScheduler.nextDeadline() == std::numeric_limits<bmsx::i64>::max(), "GX-GPU GP1 clear cancels the removed C0 deadline");
	require(active.gpu.readGp0() == bmsx::GX_GPU_INFO_GPU_TYPE_V2, "GX-GPU GP1 clear preserves the GPUREAD latch before C0 activation");
	const bmsx::u32 status = active.gpu.readStatus();
	require((status & bmsx::GX_GPU_STATUS_GPU_IDLE) != 0u, "GX-GPU GP1 clear restores idle after removing active C0");
	require((status & bmsx::GX_GPU_STATUS_READY_TO_SEND_VRAM) == 0u, "GX-GPU removed C0 never becomes send-ready");
	require((status & bmsx::GX_GPU_STATUS_READY_TO_RECEIVE_DMA) != 0u, "GX-GPU removed C0 restores receive-ready");

	GpuHarness queued;
	stopPcrtc(queued);
	queued.gpu.writeGp0((bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u) | 0x0000ffu);
	queued.gpu.writeGp0(0u);
	queued.gpu.writeGp0((1u << 16u) | 1u);
	queued.gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24u);
	queued.gpu.writeGp0(0u);
	queued.gpu.writeGp0((1u << 16u) | 1u);
	queued.gpu.writeGp1(bmsx::GX_GPU_GP1_CLEAR_FIFO << 24u);
	const bmsx::GxGpuCommandBuffer& queuedCommands = queued.gpu.readDeviceOutput().commandBuffer;
	require(queuedCommands.commandCount == 1u, "GX-GPU GP1 clear preserves an active fill");
	require(queuedCommands.executedCommandCount == 1u, "GX-GPU GP1 clear completes its accepted fill frontier");
	require(queued.gpu.captureState().gp0FifoWords.size() == 0u, "GX-GPU GP1 clear discards C0 still queued behind a draw");
	require(queued.scheduler.nextDeadline() == std::numeric_limits<bmsx::i64>::max(), "GX-GPU GP1 clear cancels its prior draw deadline");
	require(queuedCommands.readback.phase() == bmsx::GX_GPU_READBACK_IDLE, "GX-GPU queued C0 never activates after GP1 clear");
	require((queued.gpu.readStatus() & bmsx::GX_GPU_STATUS_GPU_IDLE) != 0u, "GX-GPU GP1 clear becomes idle at its accepted fill frontier");
}

void testGp1ResetCancelsRestoredActiveC0Deadline() {
	GpuHarness source;
	stopPcrtc(source);
	source.gpu.writeGp1((bmsx::GX_GPU_GP1_GET_GPU_INFO << 24u) | 0x07u);
	source.gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24u);
	source.gpu.writeGp0(0u);
	source.gpu.writeGp0((1u << 16u) | 1u);
	const bmsx::GxGpuState saved = source.gpu.captureState();
	require(saved.commandBuffer.commandCount == 1u, "GX-GPU active C0 save-state captures its command marker");
	require(saved.commandBuffer.executedCommandCount == 0u, "GX-GPU active C0 save-state remains before its execution frontier");

	GpuHarness restored;
	restored.scheduler.advanceTo(100);
	restored.gpu.restoreState(saved);
	restored.gpu.onService(100);
	const bmsx::u64 snapshotSerial = restored.gpu.readVramSnapshotSerial();
	require(restored.scheduler.nextDeadline() == 101, "GX-GPU restore rearms the active C0 deadline");
	restored.gpu.writeGp1(bmsx::GX_GPU_GP1_RESET << 24u);
	const bmsx::GxGpuState reset = restored.gpu.captureState();
	require(reset.commandBuffer.commandCount == 0u, "GX-GPU GP1 reset removes a restored active C0 marker");
	require(reset.commandBuffer.executedCommandCount == 0u, "GX-GPU GP1 reset leaves no restored C0 execution frontier");
	require(reset.commandBuffer.readbackPhase == bmsx::GX_GPU_READBACK_IDLE, "GX-GPU GP1 reset leaves restored C0 readback idle");
	require(restored.scheduler.nextDeadline() == std::numeric_limits<bmsx::i64>::max(), "GX-GPU GP1 reset cancels a restored C0 deadline");
	require(restored.gpu.readGp0() == bmsx::GX_GPU_INFO_GPU_TYPE_V2, "GX-GPU GP1 reset preserves the restored GPUREAD latch");
	require(restored.gpu.readVramSnapshotSerial() == snapshotSerial, "GX-GPU GP1 reset preserves restored raw VRAM");
	require((restored.gpu.readStatus() & bmsx::GX_GPU_STATUS_RESET_WORD) == bmsx::GX_GPU_STATUS_RESET_WORD, "GX-GPU GP1 reset becomes idle after removing restored C0");
}

void testGp1ClearFifoClearsPartialGp0PacketsAndFlushesPartialCpuToVramUploads() {
	GpuHarness harness;
	stopPcrtc(harness);
	harness.gpu.writeGp0((bmsx::GX_GPU_GP0_POLYGON_FIRST << 24u) | 0x0000ffu);
	harness.gpu.writeGp0((bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | 0x000111u);
	bmsx::GxGpu& gpu = harness.gpu;
	const bmsx::GxGpuCommandBuffer& commands = harness.gpu.readDeviceOutput().commandBuffer;

	gpu.writeGp1(bmsx::GX_GPU_GP1_CLEAR_FIFO << 24u);
	require(commands.commandCount == 0u, "GX-GPU GP1 clear FIFO does not emit abandoned partial GP0 command");
	require(commands.wordCount == 0u, "GX-GPU GP1 clear FIFO leaves no words for abandoned partial GP0 command");
	gpu.writeGp0((bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | 0x000222u);
	completeGpuCommands(harness);
	require(gpu.readDrawModeWord() == 0x000222u, "GX-GPU GP1 clear FIFO clears partial GP0 command");

	gpu.writeGp0(bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24u);
	gpu.writeGp0(0x00010002u);
	gpu.writeGp0(0x00020003u);
	gpu.writeGp1(bmsx::GX_GPU_GP1_CLEAR_FIFO << 24u);
	require(commands.commandCount == 0u, "GX-GPU GP1 clear FIFO does not emit abandoned CPU-to-VRAM command");
	require(commands.wordCount == 0u, "GX-GPU GP1 clear FIFO discards abandoned CPU-to-VRAM header words");
	gpu.writeGp0((bmsx::GX_GPU_GP0_MASK_BIT << 24u) | 0x000003u);
	completeGpuCommands(harness);
	require(gpu.readMaskBitModeWord() == 3u, "GX-GPU GP1 clear FIFO clears image transfer state");

	gpu.writeGp0(bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24u);
	gpu.writeGp0(0x00010002u);
	gpu.writeGp0(0x00020003u);
	gpu.writeGp0((bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | 0x000111u);
	gpu.writeGp0((bmsx::GX_GPU_GP0_MASK_BIT << 24u) | 0x000002u);
	gpu.writeGp1(bmsx::GX_GPU_GP1_CLEAR_FIFO << 24u);
	require(commands.commandCount == 1u, "GX-GPU GP1 clear FIFO emits partial CPU-to-VRAM command");
	require(commands.commandKind[0] == bmsx::GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, "GX-GPU partial CPU-to-VRAM command kind");
	require(commands.commandOpcode[0] == bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST, "GX-GPU partial CPU-to-VRAM opcode");
	require(commands.commandWordCount[0] == 5u, "GX-GPU partial CPU-to-VRAM command words");
	require(commands.wordCount == 5u, "GX-GPU partial CPU-to-VRAM retains only committed command words");
	require(commands.words[commands.commandWordStart[0] + 3u] == ((bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | 0x000111u), "GX-GPU partial CPU-to-VRAM first payload word");
	require(commands.words[commands.commandWordStart[0] + 4u] == ((bmsx::GX_GPU_GP0_MASK_BIT << 24u) | 0x000002u), "GX-GPU partial CPU-to-VRAM final payload word");
	require(gpu.readDrawModeWord() == 0x000222u, "GX-GPU partial CPU-to-VRAM payload does not execute draw mode");
	require(gpu.readMaskBitModeWord() == 3u, "GX-GPU partial CPU-to-VRAM payload does not execute mask bit");
	require(commands.executedCommandCount == 1u, "GX-GPU GP1 clear FIFO completes the flushed CPU-to-VRAM frontier");
	require(harness.scheduler.nextDeadline() == std::numeric_limits<bmsx::i64>::max(), "GX-GPU GP1 clear FIFO cancels the flushed upload deadline");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_GPU_IDLE) == bmsx::GX_GPU_STATUS_GPU_IDLE, "GX-GPU partial CPU-to-VRAM is idle at the reset boundary");

	gpu.writeGp0((0x48u << 24u) | 0x0000ffu);
	gpu.writeGp0(0x00010002u);
	gpu.writeGp0(0x00020003u);
	gpu.writeGp0(0x00030004u);
	require(commands.wordCount == 9u, "GX-GPU partial polyline appends uncommitted command words");
	gpu.writeGp1(bmsx::GX_GPU_GP1_CLEAR_FIFO << 24u);
	require(commands.commandCount == 1u, "GX-GPU GP1 clear FIFO preserves committed commands before partial polyline");
	require(commands.wordCount == 5u, "GX-GPU GP1 clear FIFO discards partial polyline words");

	gpu.writeGp0((bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u) | 0x0000ffu);
	gpu.writeGp0(32u);
	gpu.writeGp0((1u << 16u) | 1u);
	require(commands.commandCount == 2u, "GX-GPU command processing resumes after partial polyline discard");
	require(commands.commandWordStart[1] == 5u, "GX-GPU next command reuses discarded polyline suffix");

	gpu.writeGp0((bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | 0x000444u);
	require(commands.commandCount == 2u, "GX-GPU GP0 command processing resumes after FIFO reset");
	completeGpuCommands(harness);
	require(gpu.readDrawModeWord() == 0x000444u, "GX-GPU GP0 draw mode resumes after partial CPU-to-VRAM flush");
}

constexpr uint32_t GX_GPU_SOFTWARE_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD = 1023u | (511u << 10u);

template<size_t N>
void pushSoftwareCommand(
	bmsx::GxGpuCommandBuffer& commandBuffer,
	const std::array<uint32_t, N>& words,
	size_t wordCount,
	uint8_t kind,
	uint8_t opcode,
	uint32_t drawModeWord = 0u,
	uint32_t textureWindowWord = 0u,
	uint32_t drawingAreaTopLeftWord = 0u,
	uint32_t drawingAreaBottomRightWord = GX_GPU_SOFTWARE_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD,
	uint32_t drawingOffsetWord = 0u,
	uint32_t maskBitModeWord = 0u,
	uint8_t skippedLineParity = bmsx::GX_GPU_SKIPPED_LINE_NONE,
	uint8_t vramYAddressExtensionWord = 0u) {
	const size_t wordStart = commandBuffer.appendWords(words.data(), wordCount);
	commandBuffer.pushCommand(
		kind,
		opcode,
		wordStart,
		static_cast<uint32_t>(wordCount),
		drawModeWord,
		vramYAddressExtensionWord,
		textureWindowWord,
		drawingAreaTopLeftWord,
		drawingAreaBottomRightWord,
		drawingOffsetWord,
		maskBitModeWord,
		skippedLineParity);
	commandBuffer.completeCommandExecution(commandBuffer.commandCount);
	commandBuffer.sealCommandsForPresentation();
}

void pushSoftwareVramUpload(
	bmsx::GxGpuCommandBuffer& commandBuffer,
	uint32_t targetWord,
	uint32_t sizeWord,
	uint32_t payloadWord) {
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 4>{
			bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24u,
			targetWord,
			sizeWord,
			payloadWord,
		},
		4u,
		bmsx::GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
		bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST);
}

void requireArgbPixel(const uint32_t* pixels, uint32_t x, uint32_t y, uint32_t color, const char* message) {
	const size_t pixelIndex = static_cast<size_t>(y) * 256u + x;
	require(pixels[pixelIndex] == color, message);
}

template<size_t N>
void requireFramebuffer(const uint32_t* pixels, const std::array<uint32_t, N>& expected, const char* message) {
	require(std::equal(expected.begin(), expected.end(), pixels), message);
}

constexpr std::array<bmsx::u32, bmsx::GX_GPU_PCRTC_CONFIG_WORD_COUNT> kSoftwareTestPcrtcWords{
	0x0000ff21u, 0u,
	(16u << 9u) | (bmsx::GX_GPU_PSMGX16 << 15u), 0u,
	3u << 23u, 1023u | (255u << 12u),
	0u, 0u,
	0u, 0u,
	0u, 0u,
	0x40806504u, 0x00000007u,
	0u, 0u,
	0x1fc83030u, 0x0007f5c2u,
	0x003484bcu, 0u,
	0x02101404u, 0x00a90005u,
};

struct SoftwareFrameHarness {
	std::unique_ptr<std::array<bmsx::u8, bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes>> vramSnapshot = std::make_unique<std::array<bmsx::u8, bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes>>();
	std::array<bmsx::u32, bmsx::GX_GPU_PCRTC_CONFIG_WORD_COUNT> pcrtcWords = kSoftwareTestPcrtcWords;
	bmsx::GxGpuPcrtcTiming pcrtcTiming{};
	bmsx::GxGpuPcrtcScanout pcrtcScanout{};
	bmsx::SoftwareBackend backend;
	uint32_t* framebuffer = nullptr;
	bmsx::GxGpuPipelineState state;
	bmsx::GxGpuDeviceOutput output;

	SoftwareFrameHarness(const bmsx::GxGpuCommandBuffer& commandBuffer, bmsx::GxGpuReadbackPort& readback)
		: backend(256, 256, bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes)
		, output(
			commandBuffer,
			readback,
			pcrtcWords,
			pcrtcTiming,
			pcrtcScanout,
			*vramSnapshot) {
		backend.resizePresentationTarget(256, 256);
		framebuffer = backend.framebuffer();
		state.width = 256;
		state.height = 256;
		output.statusWord = 0u;
		output.displayModeWord = bmsx::PSX_GPU_DISPLAY_MODE_PAL_WORD;
		output.displayStartWord = 0u;
		pcrtcTiming.update(pcrtcWords);
		pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	}
};

void testPowerOnVramResetSaveStateAndMachineRecreation() {
	bmsx::u64 firstSerial = 0u;
	bmsx::u64 firstReplacementSerial = 0u;
	{
		GpuHarness harness;
		bmsx::GxGpu& first = harness.gpu;
		const auto& bytes = first.readVramSnapshotBytes();
		firstSerial = first.readVramSnapshotSerial();
		firstReplacementSerial = first.readVramReplacementSerial();

		require(bytes[0u] == 38u, "GX-GPU power-on VRAM first byte");
		require(bytes[31u] == 144u, "GX-GPU power-on VRAM block boundary low byte");
		require(bytes[32u] == 185u, "GX-GPU power-on VRAM block boundary high byte");
		require(bytes[255u] == 162u, "GX-GPU power-on VRAM row boundary low byte");
		require(bytes[256u] == 51u, "GX-GPU power-on VRAM row boundary high byte");
		require(bytes[4095u] == 83u, "GX-GPU power-on VRAM page boundary low byte");
		require(bytes[4096u] == 130u, "GX-GPU power-on VRAM page boundary high byte");
		require(bytes[65535u] == 92u, "GX-GPU power-on VRAM macro boundary low byte");
		require(bytes[65536u] == 58u, "GX-GPU power-on VRAM macro boundary high byte");
		require(bytes[bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes - 1u] == 187u, "GX-GPU power-on VRAM final byte");
		require(gxGpuVramDigest(bytes) == 0xb3ba77eau, "GX-GPU power-on VRAM full digest");

		const bmsx::GxGpuDeviceOutput& output = first.readDeviceOutput();
		SoftwareFrameHarness frame(output.commandBuffer, output.readbackPort);
		std::copy(
			output.vramSnapshotBytes.begin(),
			output.vramSnapshotBytes.end(),
			frame.vramSnapshot->begin());
		frame.output.vramSnapshotSerial = output.vramSnapshotSerial;
		bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state, frame.output);

		first.writeGp0(bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24u);
		first.writeGp0(0u);
		first.writeGp0((1u << 16u) | 1u);
		first.writeGp0(0x00001234u);
		completeGpuCommands(harness);
		first.presentReadyFrameOnVblankEdge();
		bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state, frame.output);
	}

	{
		GpuHarness harness;
		bmsx::GxGpu& second = harness.gpu;
		require(second.readVramSnapshotSerial() > firstSerial, "GX-GPU recreated machine publishes a newer VRAM snapshot revision");
		require(second.readVramReplacementSerial() > firstReplacementSerial, "GX-GPU recreated machine publishes a newer raw VRAM replacement revision");
		const bmsx::GxGpuDeviceOutput& output = second.readDeviceOutput();
		SoftwareFrameHarness frame(output.commandBuffer, output.readbackPort);
		std::copy(
			output.vramSnapshotBytes.begin(),
			output.vramSnapshotBytes.end(),
			frame.vramSnapshot->begin());
		frame.output.vramSnapshotSerial = output.vramSnapshotSerial;
		bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state, frame.output);

		const bmsx::u64 gp1Serial = second.readVramSnapshotSerial();
		const bmsx::u64 gp1ReplacementSerial = second.readVramReplacementSerial();
		second.writeGp1(bmsx::GX_GPU_GP1_RESET << 24u);
		require(second.readVramSnapshotSerial() == gp1Serial, "GX-GPU GP1 reset preserves VRAM snapshot revision");
		require(second.readVramReplacementSerial() == gp1ReplacementSerial, "GX-GPU GP1 reset preserves raw VRAM replacement revision");
		require(gxGpuVramDigest(second.readVramSnapshotBytes()) == 0xb3ba77eau, "GX-GPU GP1 reset preserves power-on VRAM bytes");
		second.reset();
		require(second.readVramSnapshotSerial() > gp1Serial, "GX-GPU device reset publishes a newer VRAM snapshot revision");
		require(second.readVramReplacementSerial() > gp1ReplacementSerial, "GX-GPU device reset publishes a newer raw VRAM replacement revision");
		require(gxGpuVramDigest(second.readVramSnapshotBytes()) == 0xb3ba77eau, "GX-GPU device reset reproduces power-on VRAM bytes");

		auto restoredBytes = std::make_unique<std::array<bmsx::u8, bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes>>();
		const std::span<const bmsx::u8> secondVramBytes = second.readVramSnapshotBytes();
		std::copy(secondVramBytes.begin(), secondVramBytes.end(), restoredBytes->begin());
		constexpr size_t upperByteIndex = bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes / 2u;
		(*restoredBytes)[0u] = 0x5au;
		(*restoredBytes)[upperByteIndex] = 0xa5u;
		second.replaceVramSnapshotBytes(*restoredBytes);
		const bmsx::GxGpuSaveState saveState = second.captureSaveState();
		const bmsx::u64 savedSerial = second.readVramSnapshotSerial();
		const bmsx::u64 savedReplacementSerial = second.readVramReplacementSerial();
		second.reset();
		second.restoreSaveState(saveState);
		require(second.readVramSnapshotSerial() > savedSerial, "GX-GPU save-state restore publishes a newer VRAM snapshot revision");
		require(second.readVramReplacementSerial() > savedReplacementSerial, "GX-GPU save-state restore publishes a newer raw VRAM replacement revision");
		require(second.readVramSnapshotBytes()[0u] == 0x5au, "GX-GPU save-state restore uses saved raw VRAM bytes");
		require(second.readVramSnapshotBytes()[upperByteIndex] == 0xa5u, "GX-GPU save-state restore preserves installed upper VRAM bytes");
	}
}

void testSoftwareTextureModulationMath() {
	require(bmsx::gxGpuSoftwareTextureModulationPreDither(31u, 128u) == 248u, "GX-GPU software texture modulation pre-dither half intensity");
	require(bmsx::gxGpuSoftwareTextureModulationChannel5(31u, 128u, 0) == 31u, "GX-GPU software texture modulation half intensity preserves white");
	require(bmsx::gxGpuSoftwareTextureModulationChannel5(31u, 255u, 3) == 31u, "GX-GPU software texture modulation saturates high dither");
	require(bmsx::gxGpuSoftwareTextureModulationChannel5(1u, 16u, -4) == 0u, "GX-GPU software texture modulation clamps low dither");
	require(bmsx::gxGpuSoftwareTextureModulationChannel5(12u, 96u, 0) == 9u, "GX-GPU software texture modulation divides by 128");
}

void testSoftwarePackedRgb555BlendMath() {
	constexpr std::array<bmsx::u32, 8> destinationWords{
		0x0000u,
		0x0001u,
		0x001fu,
		0x03e0u,
		0x7c00u,
		0x7fffu,
		0x8000u,
		0xffffu,
	};
	for (bmsx::u32 source = 0u; source < 0x8000u; source += 1u) {
		for (size_t destinationIndex = 0u; destinationIndex <= destinationWords.size(); destinationIndex += 1u) {
			const bmsx::u32 destination = destinationIndex < destinationWords.size()
				? destinationWords[destinationIndex]
				: ((source * 1103515245u + 12345u) >> 8u) & 0xffffu;
			for (bmsx::u32 mode = 0u; mode < 4u; mode += 1u) {
				bmsx::u32 expected = 0u;
				for (bmsx::u32 shift = 0u; shift <= 10u; shift += 5u) {
					const bmsx::u32 sourceChannel = (source >> shift) & 0x1fu;
					const bmsx::u32 destinationChannel = (destination >> shift) & 0x1fu;
					bmsx::u32 channel;
					switch (mode) {
						case 0u:
							channel = (sourceChannel + destinationChannel) >> 1u;
							break;
						case 1u: {
							const bmsx::u32 sum = sourceChannel + destinationChannel;
							channel = sum < 31u ? sum : 31u;
							break;
						}
						case 2u:
							channel = destinationChannel > sourceChannel ? destinationChannel - sourceChannel : 0u;
							break;
						default: {
							const bmsx::u32 sum = destinationChannel + (sourceChannel >> 2u);
							channel = sum < 31u ? sum : 31u;
							break;
						}
					}
					expected |= channel << shift;
				}
				require(bmsx::gxGpuSoftwareBlendRgb555(source, destination, mode) == expected, "GX-GPU packed RGB555 blend matches independent channel arithmetic");
			}
		}
	}
}

void testGpureadFencesBackendWorkAndPacksWrappedOddPixels() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;
	const uint32_t positionWord = (511u << 16u) | 1023u;
	const uint32_t sizeWord = (1u << 16u) | 3u;
	gpu.writeGp0(bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24u);
	gpu.writeGp0(positionWord);
	gpu.writeGp0(sizeWord);
	gpu.writeGp0(0x22221111u);
	gpu.writeGp0(0x00003333u);
	gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24u);
	gpu.writeGp0(positionWord);
	gpu.writeGp0(sizeWord);
	gpu.writeGp1((bmsx::GX_GPU_GP1_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU);
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_READY_TO_SEND_VRAM) == 0u, "GX-GPU GPUREAD stays unready before backend completion");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_READY_TO_RECEIVE_DMA) == 0u, "GX-GPU GPUREAD blocks command DMA while active");
	completeGpuCommands(harness);
	const bmsx::GxGpuDeviceOutput& output = gpu.readDeviceOutput();
	require(output.commandBuffer.presentCommandCount == 0u, "GX-GPU GPUREAD backend fence is independent of VBLANK presentation");
	SoftwareFrameHarness frame(output.commandBuffer, output.readbackPort);
	frame.backend.executeGxGpuReadback(gpu);
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_READY_TO_SEND_VRAM) != 0u, "GX-GPU GPUREAD becomes ready after backend completion");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_DMA_DATA_REQUEST) != 0u, "GX-GPU GPUREAD raises DMA request in read direction");
	require(gpu.readGp0() == 0x22221111u, "GX-GPU GPUREAD packs the first wrapped pixel pair");
	const bmsx::GxGpuState saved = gpu.captureState();
	require(gpu.readGp0() == 0x00003333u, "GX-GPU GPUREAD zero-fills an odd final high pixel");
	gpu.restoreState(saved);
	require(gpu.readGp0() == 0x00003333u, "GX-GPU GPUREAD restores the retained transfer bytes and cursor");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_READY_TO_SEND_VRAM) == 0u, "GX-GPU GPUREAD clears ready after final word");
	require(gpu.readGp0() == 0x00003333u, "GX-GPU GPUREAD retains its final latch");
}

void testGpureadPreservesRowMajorOrderAcrossXAndYWrap() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;
	const uint32_t positionWord = (1023u << 16u) | 1023u;
	const uint32_t sizeWord = (2u << 16u) | 2u;
	auto vramBytes = std::make_unique<std::array<bmsx::u8, bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes>>();
	size_t byteIndex = (1023u * bmsx::GX_GPU_VRAM_X_ADDRESS_PERIOD + 1023u) << 1u;
	(*vramBytes)[byteIndex] = 0x11u;
	(*vramBytes)[byteIndex + 1u] = 0x11u;
	byteIndex = (1023u * bmsx::GX_GPU_VRAM_X_ADDRESS_PERIOD) << 1u;
	(*vramBytes)[byteIndex] = 0x22u;
	(*vramBytes)[byteIndex + 1u] = 0x22u;
	byteIndex = 1023u << 1u;
	(*vramBytes)[byteIndex] = 0x33u;
	(*vramBytes)[byteIndex + 1u] = 0x33u;
	(*vramBytes)[0u] = 0x44u;
	(*vramBytes)[1u] = 0x44u;
	gpu.replaceVramSnapshotBytes(*vramBytes);
	gpu.writeGp1((bmsx::GX_GPU_GP1_VRAM_Y_ADDRESS_EXTENSION << 24u) | 1u);
	gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24u);
	gpu.writeGp0(positionWord);
	gpu.writeGp0(sizeWord);
	completeGpuCommands(harness);
	const bmsx::GxGpuDeviceOutput& output = gpu.readDeviceOutput();
	SoftwareFrameHarness frame(output.commandBuffer, output.readbackPort);
	frame.backend.executeGxGpuReadback(gpu);
	require(gpu.readGp0() == 0x22221111u, "GX-GPU GPUREAD preserves wrapped first row");
	require(gpu.readGp0() == 0x44443333u, "GX-GPU GPUREAD preserves wrapped second row");
}

void testOpenYGateExposesInstalledUpperVramStorage() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;
	auto vramBytes = std::make_unique<std::array<bmsx::u8, bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes>>();
	(*vramBytes)[0u] = 0x34u;
	(*vramBytes)[1u] = 0x12u;
	gpu.replaceVramSnapshotBytes(*vramBytes);
	gpu.writeGp1((bmsx::GX_GPU_GP1_VRAM_Y_ADDRESS_EXTENSION << 24u) | 1u);
	gpu.writeGp0(bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24u);
	gpu.writeGp0(512u << 16u);
	gpu.writeGp0((1u << 16u) | 1u);
	gpu.writeGp0(0x0000abcdu);
	gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_VRAM_FIRST << 24u);
	gpu.writeGp0(512u << 16u);
	gpu.writeGp0(513u << 16u);
	gpu.writeGp0((1u << 16u) | 1u);
	gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24u);
	gpu.writeGp0(513u << 16u);
	gpu.writeGp0((1u << 16u) | 1u);
	completeGpuCommands(harness);
	const bmsx::GxGpuDeviceOutput& output = gpu.readDeviceOutput();
	SoftwareFrameHarness frame(output.commandBuffer, output.readbackPort);
	frame.backend.executeGxGpuReadback(gpu);
	require(gpu.readGp0() == 0xabcdu, "GX-GPU open Y gate reads installed upper VRAM");
}

void testGpureadQueuesLaterC0BehindActiveFence() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;
	const uint32_t sizeWord = (1u << 16u) | 1u;
	gpu.writeGp0(bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24u);
	gpu.writeGp0(0u);
	gpu.writeGp0((1u << 16u) | 2u);
	gpu.writeGp0(0x22221111u);
	gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24u);
	gpu.writeGp0(0u);
	gpu.writeGp0(sizeWord);
	gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24u);
	gpu.writeGp0(1u);
	gpu.writeGp0(sizeWord);
	completeGpuCommands(harness);
	const bmsx::GxGpuDeviceOutput& queuedOutput = gpu.readDeviceOutput();
	require(queuedOutput.readbackPort.x() == 0u, "GX-GPU later C0 does not overwrite active readback X");
	require(queuedOutput.readbackPort.phase() == bmsx::GX_GPU_READBACK_PENDING, "GX-GPU first queued C0 owns pending readback");

	completeGpuCommands(harness);
	gpu.presentReadyFrameOnVblankEdge();
	const bmsx::GxGpuDeviceOutput& firstOutput = gpu.readDeviceOutput();
	SoftwareFrameHarness frame(firstOutput.commandBuffer, firstOutput.readbackPort);
	std::copy(
		firstOutput.vramSnapshotBytes.begin(),
		firstOutput.vramSnapshotBytes.end(),
		frame.vramSnapshot->begin());
	frame.output.vramSnapshotSerial = firstOutput.vramSnapshotSerial;
	bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state, frame.output);
	gpu.retirePresentedCommands();
	require(gpu.readGp0() == 0x00001111u, "GX-GPU first queued C0 returns first pixel");

	completeGpuCommands(harness);
	gpu.presentReadyFrameOnVblankEdge();
	const bmsx::GxGpuDeviceOutput& secondOutput = gpu.readDeviceOutput();
	frame.output.vramSnapshotSerial = secondOutput.vramSnapshotSerial;
	bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state, frame.output);
	require(gpu.readGp0() == 0x00002222u, "GX-GPU second queued C0 runs after first transfer consumption");
}

void testGpureadDoesNotClaimC0AppendedAfterPublishedFence() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;
	gpu.writeGp0(bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24u);
	gpu.writeGp0(10u);
	gpu.writeGp0((1u << 16u) | 1u);
	gpu.writeGp0(0x0000aaaau);
	completeGpuCommands(harness);
	gpu.presentReadyFrameOnVblankEdge();

	gpu.writeGp0(bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24u);
	gpu.writeGp0(0u);
	gpu.writeGp0((1u << 16u) | 1u);
	gpu.writeGp0(0x00001234u);
	gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24u);
	gpu.writeGp0(0u);
	gpu.writeGp0((1u << 16u) | 1u);
	completeGpuCommands(harness);
	const bmsx::GxGpuDeviceOutput& firstOutput = gpu.readDeviceOutput();
	SoftwareFrameHarness frame(firstOutput.commandBuffer, firstOutput.readbackPort);
	std::copy(
		firstOutput.vramSnapshotBytes.begin(),
		firstOutput.vramSnapshotBytes.end(),
		frame.vramSnapshot->begin());
	frame.output.vramSnapshotSerial = firstOutput.vramSnapshotSerial;
	bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state, frame.output);
	require(firstOutput.readbackPort.phase() == bmsx::GX_GPU_READBACK_PENDING, "GX-GPU post-seal C0 remains pending on old frame");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_READY_TO_SEND_VRAM) == 0u, "GX-GPU post-seal C0 is not ready before its fence");
	gpu.retirePresentedCommands();
	require(firstOutput.readbackPort.fenceCommandCount() == 2u, "GX-GPU retire shifts post-seal C0 fence");

	completeGpuCommands(harness);
	gpu.presentReadyFrameOnVblankEdge();
	const bmsx::GxGpuDeviceOutput& secondOutput = gpu.readDeviceOutput();
	frame.output.vramSnapshotSerial = secondOutput.vramSnapshotSerial;
	bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state, frame.output);
	require(gpu.readGp0() == 0x00001234u, "GX-GPU post-seal C0 reads after intervening upload");
}

void testGp1ClearFifoAbortsPendingGpureadWithoutDroppingPriorCommands() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;
	gpu.writeGp1((bmsx::GX_GPU_GP1_GET_GPU_INFO << 24u) | 0x07u);
	gpu.writeGp0((bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u) | 0x0000ffu);
	gpu.writeGp0(0u);
	gpu.writeGp0((1u << 16u) | 1u);
	gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24u);
	gpu.writeGp0(0u);
	gpu.writeGp0((1u << 16u) | 1u);
	gpu.writeGp0((bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u) | 0x00ff00u);
	gpu.writeGp0(16u);
	gpu.writeGp0((1u << 16u) | 1u);
	gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24u);
	gpu.writeGp0(16u);
	gpu.writeGp0((1u << 16u) | 1u);
	completeGpuCommands(harness);
	gpu.presentReadyFrameOnVblankEdge();
	const bmsx::GxGpuDeviceOutput& output = gpu.readDeviceOutput();
	const bmsx::GxGpuCommandBuffer& commandBuffer = output.commandBuffer;
	bmsx::GxGpuReadbackPort& readback = output.readbackPort;
	const uint32_t commandSerial = commandBuffer.serial;
	const bmsx::u64 vramSnapshotSerial = output.vramSnapshotSerial;
	const uint32_t readbackToken = readback.token();
	require(commandBuffer.commandCount == 2u, "GX-GPU pending readback test queues the prior command and C0 fence");
	require(readback.phase() == bmsx::GX_GPU_READBACK_PENDING, "GX-GPU pending readback test activates C0");

	gpu.writeGp1(bmsx::GX_GPU_GP1_CLEAR_FIFO << 24u);

	require(commandBuffer.commandCount == 1u, "GX-GPU GP1 clear FIFO preserves commands before pending C0");
	require(commandBuffer.presentCommandCount == 1u, "GX-GPU GP1 clear FIFO caps the published fence to its stable prefix");
	require(commandBuffer.wordCount == 3u, "GX-GPU GP1 clear FIFO truncates pending C0 words and queued suffix");
	require(commandBuffer.serial == commandSerial, "GX-GPU pending readback abort preserves the stable command prefix revision");
	require(gpu.readVramSnapshotSerial() == vramSnapshotSerial, "GX-GPU pending readback abort preserves VRAM revision");
	require(readback.phase() == bmsx::GX_GPU_READBACK_IDLE, "GX-GPU GP1 clear FIFO idles pending readback");
	require(readback.token() != readbackToken, "GX-GPU GP1 clear FIFO invalidates pending readback token");
	require(gpu.readGp0() == bmsx::GX_GPU_INFO_GPU_TYPE_V2, "GX-GPU GP1 clear FIFO preserves GPUREAD data latch");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_GPU_IDLE) != 0u, "GX-GPU GP1 clear FIFO restores GPU idle after pending readback");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_READY_TO_RECEIVE_DMA) != 0u, "GX-GPU GP1 clear FIFO restores receive-ready after pending readback");

	completeGpuCommands(harness);
	gpu.presentReadyFrameOnVblankEdge();
	require(readback.phase() == bmsx::GX_GPU_READBACK_IDLE, "GX-GPU aborted queued C0 does not reactivate on frame seal");
	SoftwareFrameHarness frame(commandBuffer, readback);
	std::copy(
		output.vramSnapshotBytes.begin(),
		output.vramSnapshotBytes.end(),
		frame.vramSnapshot->begin());
	frame.output.vramSnapshotSerial = output.vramSnapshotSerial;
	bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state, frame.output);
}

void testGp1ClearFifoAbortsReadyGpureadAndQueuedSuffix() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;
	gpu.writeGp1((bmsx::GX_GPU_GP1_GET_GPU_INFO << 24u) | 0x07u);
	gpu.writeGp0((bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u) | 0x0000ffu);
	gpu.writeGp0(0u);
	gpu.writeGp0((1u << 16u) | 1u);
	gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24u);
	gpu.writeGp0(0u);
	gpu.writeGp0((1u << 16u) | 1u);
	gpu.writeGp0((bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u) | 0x00ff00u);
	gpu.writeGp0(16u);
	gpu.writeGp0((1u << 16u) | 1u);
	gpu.writeGp1((bmsx::GX_GPU_GP1_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU);
	completeGpuCommands(harness);
	const bmsx::GxGpuDeviceOutput& output = gpu.readDeviceOutput();
	const bmsx::GxGpuCommandBuffer& commandBuffer = output.commandBuffer;
	bmsx::GxGpuReadbackPort& readback = output.readbackPort;
	SoftwareFrameHarness frame(commandBuffer, readback);
	std::copy(
		output.vramSnapshotBytes.begin(),
		output.vramSnapshotBytes.end(),
		frame.vramSnapshot->begin());
	frame.output.vramSnapshotSerial = output.vramSnapshotSerial;
	frame.backend.executeGxGpuReadback(gpu);
	const uint32_t readbackToken = readback.token();
	require(readback.phase() == bmsx::GX_GPU_READBACK_READY, "GX-GPU ready readback test completes C0");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_READY_TO_SEND_VRAM) != 0u, "GX-GPU ready readback test exposes GPUREAD data");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_DMA_DATA_REQUEST) != 0u, "GX-GPU ready readback test raises DMA request");
	gpu.presentReadyFrameOnVblankEdge();
	require(commandBuffer.presentCommandCount == readback.fenceCommandCount(), "GX-GPU READY readback seals its fence prefix at VBLANK");
	gpu.retirePresentedCommands();
	require(commandBuffer.commandCount == 0u, "GX-GPU ready readback retire removes the completed fence prefix");
	require(readback.fenceCommandCount() == 0u, "GX-GPU ready readback retire removes executed fence");
	const uint32_t commandSerialBeforeAbort = commandBuffer.serial;
	const bmsx::u64 vramSnapshotSerial = gpu.readVramSnapshotSerial();

	gpu.writeGp1(bmsx::GX_GPU_GP1_CLEAR_FIFO << 24u);

	require(commandBuffer.commandCount == 0u, "GX-GPU GP1 clear FIFO discards the ready readback queued suffix");
	require(commandBuffer.presentCommandCount == 0u, "GX-GPU GP1 clear FIFO clears ready readback presentation count");
	require(commandBuffer.wordCount == 0u, "GX-GPU GP1 clear FIFO clears ready readback queued words");
	require(commandBuffer.serial != commandSerialBeforeAbort, "GX-GPU ready readback abort publishes command stream revision");
	require(gpu.readVramSnapshotSerial() == vramSnapshotSerial, "GX-GPU ready readback abort preserves VRAM revision");
	require(readback.phase() == bmsx::GX_GPU_READBACK_IDLE, "GX-GPU GP1 clear FIFO idles ready readback");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_READY_TO_SEND_VRAM) == 0u, "GX-GPU GP1 clear FIFO lowers GPUREAD ready");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_DMA_DATA_REQUEST) == 0u, "GX-GPU GP1 clear FIFO lowers GPUREAD DMA request");
	require(gpu.readGp0() == bmsx::GX_GPU_INFO_GPU_TYPE_V2, "GX-GPU GP1 clear FIFO preserves ready GPUREAD latch");

	gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24u);
	gpu.writeGp0(32u);
	gpu.writeGp0((1u << 16u) | 1u);
	completeGpuCommands(harness);
	gpu.presentReadyFrameOnVblankEdge();
	require(readback.claimReadback(commandBuffer.presentCommandCount), "GX-GPU new readback claims after GP1 clear FIFO");
	const uint32_t currentReadbackToken = readback.token();
	require(readback.phase() == bmsx::GX_GPU_READBACK_SUBMITTED, "GX-GPU new readback enters submitted phase");
	readback.completeReadback(readbackToken);
	require(readback.phase() == bmsx::GX_GPU_READBACK_SUBMITTED, "GX-GPU GP1 clear FIFO rejects stale readback generation");
	readback.completeReadback(currentReadbackToken);
	require(readback.phase() == bmsx::GX_GPU_READBACK_READY, "GX-GPU current readback generation completes");
	gpu.writeGp1(bmsx::GX_GPU_GP1_CLEAR_FIFO << 24u);
	require(readback.phase() == bmsx::GX_GPU_READBACK_IDLE, "GX-GPU second clear FIFO idles current readback");

	gpu.writeGp0((bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u) | 0xff0000u);
	gpu.writeGp0(32u);
	gpu.writeGp0((1u << 16u) | 1u);
	completeGpuCommands(harness);
	gpu.presentReadyFrameOnVblankEdge();
	bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state, frame.output);
}

void testGpureadRestoreRearmsSubmittedAndResetClearsRequest() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;
	auto vramBytes = std::make_unique<std::array<bmsx::u8, bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes>>();
	(*vramBytes)[0u] = 0x34u;
	(*vramBytes)[1u] = 0x12u;
	gpu.replaceVramSnapshotBytes(*vramBytes);
	gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24u);
	gpu.writeGp0(0u);
	gpu.writeGp0((1u << 16u) | 1u);
	completeGpuCommands(harness);
	gpu.presentReadyFrameOnVblankEdge();
	const bmsx::GxGpuDeviceOutput& submittedOutput = gpu.readDeviceOutput();
	const bmsx::GxGpuCommandBuffer& commandBuffer = submittedOutput.commandBuffer;
	bmsx::GxGpuReadbackPort& readback = submittedOutput.readbackPort;
	require(readback.claimReadback(commandBuffer.presentCommandCount), "GX-GPU test submits pending readback");
	require(readback.phase() == bmsx::GX_GPU_READBACK_SUBMITTED, "GX-GPU readback enters submitted phase");
	const uint32_t staleToken = readback.token();
	gpu.retirePresentedCommands();
	require(readback.fenceCommandCount() == 0u, "GX-GPU submitted retire clears executed readback fence");
	const bmsx::GxGpuState submitted = gpu.captureState();
	require(submitted.commandBuffer.readbackPhase == bmsx::GX_GPU_READBACK_PENDING, "GX-GPU capture stores submitted readback as pending");
	require(submitted.commandBuffer.readbackPixelBytes.empty(), "GX-GPU submitted readback does not serialize stale result bytes");
	gpu.restoreState(submitted);
	require(readback.phase() == bmsx::GX_GPU_READBACK_PENDING, "GX-GPU restore re-arms submitted readback");
	readback.completeReadback(staleToken);
	require(readback.phase() == bmsx::GX_GPU_READBACK_PENDING, "GX-GPU restore rejects stale readback completion");
	const bmsx::GxGpuDeviceOutput& output = gpu.readDeviceOutput();
	require(output.commandBuffer.presentCommandCount == 0u, "GX-GPU restored GPUREAD does not require a presentation fence");
	SoftwareFrameHarness frame(output.commandBuffer, output.readbackPort);
	frame.backend.executeGxGpuReadback(gpu);
	require(gpu.readGp0() == 0x00001234u, "GX-GPU restored submitted readback completes");

	gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24u);
	gpu.writeGp0(0u);
	gpu.writeGp0(0u);
	gpu.reset();
	readback.completeReadback(staleToken);
	const bmsx::GxGpuCommandBufferState resetState = gpu.captureState().commandBuffer;
	require(resetState.readbackPhase == bmsx::GX_GPU_READBACK_IDLE, "GX-GPU reset restores idle readback phase");
	require(resetState.readbackFenceCommandCount == 0u, "GX-GPU reset clears readback fence");
	require(resetState.readbackPixelCursor == 0u, "GX-GPU reset clears readback cursor");
	require(resetState.readbackWidth == 0u, "GX-GPU reset clears readback width");
	require(resetState.readbackHeight == 0u, "GX-GPU reset clears readback height");
	require(resetState.readbackPixelBytes.empty(), "GX-GPU reset captures no stale readback payload");
}

void testSoftwareBackendConsumesOnlyPresentableCommands() {
	bmsx::GxGpuSoftwareState software(bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes, 0u);
	bmsx::GxGpuCommandBuffer commandBuffer(commandBufferDmaHarness.dma);
	commandBuffer.reset();
	const std::array<uint32_t, 3> words{
		(bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u) | 0x0000ffu,
		(5u << 16u) | 4u,
		(1u << 16u) | 1u,
	};
	const size_t wordStart = commandBuffer.appendWords(words.data(), words.size());
	commandBuffer.pushCommand(
		bmsx::GX_GPU_COMMAND_FILL_RECTANGLE,
		bmsx::GX_GPU_GP0_FILL_RECTANGLE,
		wordStart,
		static_cast<uint32_t>(words.size()),
		0u,
		0u,
		0u,
		0u,
		GX_GPU_SOFTWARE_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD,
		0u,
		0u,
		bmsx::GX_GPU_SKIPPED_LINE_NONE);

	std::fill(software.vram.begin(), software.vram.end(), 0u);
	require(bmsx::executeGxGpuSoftwareCommands(software, commandBuffer, 0u, commandBuffer.presentCommandCount) == 0u, "GX-GPU software command executor ignores unpresented commands");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 4, 5)] == 0u, "GX-GPU software VRAM is unchanged before presentation publish");

	commandBuffer.completeCommandExecution(commandBuffer.commandCount);
	commandBuffer.sealCommandsForPresentation();
	require(bmsx::executeGxGpuSoftwareCommands(software, commandBuffer, 0u, commandBuffer.presentCommandCount) == 1u, "GX-GPU software command executor consumes published command");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 4, 5)] == 0x001fu, "GX-GPU software VRAM receives published fill");
}

void testSoftwareBackendCapturesMidFrameVramAndPublishesItOnce() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;
	gpu.writeGp0((bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u) | 0x0000ffu);
	gpu.writeGp0((5u << 16u) | 4u);
	gpu.writeGp0((1u << 16u) | 1u);
	completeGpuCommands(harness);
	const bmsx::GxGpuDeviceOutput& output = gpu.readDeviceOutput();
	SoftwareFrameHarness frame(output.commandBuffer, output.readbackPort);
	frame.backend.captureGxGpuVramSnapshot(gpu);
	require(output.commandBuffer.commandCount == 0u, "GX-GPU snapshot capture compacts executed mid-frame commands");
	require(output.commandBuffer.presentCommandCount == 0u, "GX-GPU snapshot capture leaves no stale presentation prefix");
	const size_t byteIndex = (5u * bmsx::GX_GPU_VRAM_X_ADDRESS_PERIOD + 4u) << 1u;
	require(gpu.readVramSnapshotBytes()[byteIndex] == 0x1fu, "GX-GPU snapshot capture stores rendered VRAM low byte");
	require(gpu.readVramSnapshotBytes()[byteIndex + 1u] == 0u, "GX-GPU snapshot capture stores rendered VRAM high byte");
	gpu.writeGp1(bmsx::GX_GPU_GP1_RESET << 24u);
	gpu.presentReadyFrameOnVblankEdge();
	require(gpu.lastFrameCommitted(), "GX-GPU compacted mid-frame VRAM publishes on the next VBLANK");
	gpu.retirePresentedCommands();
	gpu.presentReadyFrameOnVblankEdge();
	require(!gpu.lastFrameCommitted(), "GX-GPU compacted VRAM publication retires after one presentation");
}

void testSoftwareGouraudLineFixedPointRaster() {
	bmsx::GxGpuSoftwareState software(bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes, 0u);
	bmsx::GxGpuCommandBuffer commandBuffer(commandBufferDmaHarness.dma);
	commandBuffer.reset();
	constexpr uint8_t opcode = bmsx::GX_GPU_GP0_LINE_FIRST | bmsx::GX_GPU_GP0_RENDER_GOURAUD_BIT;
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 4>{
			(opcode << 24u) | 0x000008u,
			(10u << 16u) | 40u,
			0x000027u,
			(16u << 16u) | 40u,
		},
		4u,
		bmsx::GX_GPU_COMMAND_DRAW_LINE,
		opcode);

	std::fill(software.vram.begin(), software.vram.end(), 0u);
	bmsx::executeGxGpuSoftwareCommands(software, commandBuffer, 0u, commandBuffer.presentCommandCount);

	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 40, 10)] == 0x0001u, "GX-GPU software vertical Gouraud line starts from the first packet color");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 40, 13)] == 0x0002u, "GX-GPU software vertical Gouraud line keeps packet-order fixed-point rounding");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 40, 16)] == 0x0004u, "GX-GPU software vertical Gouraud line reaches the second packet color");
}

void testSoftwareLineDdaSampleWrapAndPolylineJoints() {
	bmsx::GxGpuSoftwareState software(bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes, 0u);
	bmsx::GxGpuCommandBuffer commandBuffer(commandBufferDmaHarness.dma);
	commandBuffer.reset();
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 3>{
			(bmsx::GX_GPU_GP0_LINE_FIRST << 24u) | 0x0000ffu,
			(10u << 16u) | 10u,
			(12u << 16u) | 14u,
		},
		3u,
		bmsx::GX_GPU_COMMAND_DRAW_LINE,
		bmsx::GX_GPU_GP0_LINE_FIRST);
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 3>{
			(bmsx::GX_GPU_GP0_LINE_FIRST << 24u) | 0x00ff00u,
			(10u << 16u) | 20u,
			(14u << 16u) | 22u,
		},
		3u,
		bmsx::GX_GPU_COMMAND_DRAW_LINE,
		bmsx::GX_GPU_GP0_LINE_FIRST);
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 3>{
			(bmsx::GX_GPU_GP0_LINE_FIRST << 24u) | 0x00ffffu,
			0x001d000cu,
			0x00200004u,
		},
		3u,
		bmsx::GX_GPU_COMMAND_DRAW_LINE,
		bmsx::GX_GPU_GP0_LINE_FIRST);
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 3>{
			(bmsx::GX_GPU_GP0_LINE_FIRST << 24u) | 0x0000ffu,
			0xfc00fc00u,
			0xfc02fc02u,
		},
		3u,
		bmsx::GX_GPU_COMMAND_DRAW_LINE,
		bmsx::GX_GPU_GP0_LINE_FIRST,
		0u,
		0u,
		0u,
		GX_GPU_SOFTWARE_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD,
		0x002fffffu);
	constexpr uint8_t semiTransparentPolylineOpcode = bmsx::GX_GPU_GP0_LINE_FIRST | bmsx::GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT | 0x02u;
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 4>{
			(semiTransparentPolylineOpcode << 24u) | 0x0000f8u,
			(40u << 16u) | 40u,
			(40u << 16u) | 42u,
			(42u << 16u) | 42u,
		},
		4u,
		bmsx::GX_GPU_COMMAND_DRAW_POLYLINE,
		semiTransparentPolylineOpcode);
	constexpr uint8_t polylineOpcode = bmsx::GX_GPU_GP0_LINE_FIRST | bmsx::GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT;
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 4>{
			(polylineOpcode << 24u) | 0xff0000u,
			0x0046ffffu,
			0x004603ffu,
			0x004a03fbu,
		},
		4u,
		bmsx::GX_GPU_COMMAND_DRAW_POLYLINE,
		polylineOpcode);
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 4>{
			(polylineOpcode << 24u) | 0x00ff00u,
			0xffff0032u,
			0x01ff0032u,
			0x01fb0036u,
		},
		4u,
		bmsx::GX_GPU_COMMAND_DRAW_POLYLINE,
		polylineOpcode);

	std::fill(software.vram.begin(), software.vram.end(), 0u);
	bmsx::executeGxGpuSoftwareCommands(software, commandBuffer, 0u, commandBuffer.presentCommandCount);

	constexpr std::array<std::array<int32_t, 2>, 5> shallowPixels{{ {{ 10, 10 }}, {{ 11, 11 }}, {{ 12, 11 }}, {{ 13, 12 }}, {{ 14, 12 }} }};
	for (const auto& pixel : shallowPixels) {
		require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, pixel[0], pixel[1])] == 0x001fu, "GX-GPU software shallow line DDA pixel");
	}
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 11, 10)] == 0u, "GX-GPU software shallow line rejects geometric round-nearest pixel");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 12, 12)] == 0u, "GX-GPU software shallow line owns one pixel per DDA step");
	constexpr std::array<std::array<int32_t, 2>, 5> steepPixels{{ {{ 20, 10 }}, {{ 20, 11 }}, {{ 21, 12 }}, {{ 21, 13 }}, {{ 22, 14 }} }};
	for (const auto& pixel : steepPixels) {
		require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, pixel[0], pixel[1])] == 0x03e0u, "GX-GPU software steep line DDA pixel");
	}
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 21, 11)] == 0u, "GX-GPU software steep line keeps X half-tie down");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 22, 13)] == 0u, "GX-GPU software steep line owns one pixel per DDA step");
	constexpr std::array<std::array<int32_t, 2>, 9> reversedPixels{{ {{ 11, 29 }}, {{ 12, 29 }}, {{ 8, 30 }}, {{ 9, 30 }}, {{ 10, 30 }}, {{ 6, 31 }}, {{ 7, 31 }}, {{ 4, 32 }}, {{ 5, 32 }} }};
	for (const auto& pixel : reversedPixels) {
		require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, pixel[0], pixel[1])] == 0x03ffu, "GX-GPU software reversed line preserves canonical DDA coverage");
	}
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 4, 31)] == 0u, "GX-GPU software reversed line keeps Y direction bias");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 12, 30)] == 0u, "GX-GPU software reversed line owns one pixel per DDA step");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 1023, 511)] == 0x001fu, "GX-GPU software line wraps each post-offset DDA sample to signed 11-bit");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 40, 40)] == 0x000fu, "GX-GPU software semi-transparent polyline first pixel");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 41, 40)] == 0x000fu, "GX-GPU software semi-transparent polyline first segment");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 42, 40)] == 0x0017u, "GX-GPU software polyline joint blends both inclusive endpoints");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 42, 41)] == 0x000fu, "GX-GPU software semi-transparent polyline second segment");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 42, 42)] == 0x000fu, "GX-GPU software semi-transparent polyline last pixel");
	for (int32_t step = 0; step < 5; step += 1) {
		require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 1023 - step, 70 + step)] == 0x7c00u, "GX-GPU software polyline continues after rejected segment");
	}
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 0, 70)] == 0u, "GX-GPU software rejects 1024-wide polyline segment");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 512, 70)] == 0u, "GX-GPU software rejected polyline segment does not clip into drawing area");
	for (int32_t step = 0; step < 5; step += 1) {
		require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 50 + step, 511 - step)] == 0x03e0u, "GX-GPU software polyline continues after height-rejected segment");
	}
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 50, 0)] == 0u, "GX-GPU software rejects 512-high polyline segment");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 50, 256)] == 0u, "GX-GPU software height-rejected segment does not clip into drawing area");
}

void testSoftwareBlendsUntexturedSemiTransparentRectangles() {
	bmsx::GxGpuSoftwareState software(bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes, 0u);
	bmsx::GxGpuCommandBuffer commandBuffer(commandBufferDmaHarness.dma);
	commandBuffer.reset();
	for (uint32_t column = 0u; column < 4u; column += 1u) {
		const uint32_t x = 10u + column * 10u;
		pushSoftwareCommand(
			commandBuffer,
			std::array<uint32_t, 3>{
				(bmsx::GX_GPU_GP0_RECTANGLE_FIRST << 24u) | 0xff0000u,
				(20u << 16u) | x,
				(4u << 16u) | 4u,
			},
			3u,
			bmsx::GX_GPU_COMMAND_DRAW_RECTANGLE,
			bmsx::GX_GPU_GP0_RECTANGLE_FIRST);
		pushSoftwareCommand(
			commandBuffer,
			std::array<uint32_t, 3>{
				((bmsx::GX_GPU_GP0_RECTANGLE_FIRST | 0x02u) << 24u) | 0xffffffu,
				(20u << 16u) | x,
				(4u << 16u) | 4u,
			},
			3u,
			bmsx::GX_GPU_COMMAND_DRAW_RECTANGLE,
			bmsx::GX_GPU_GP0_RECTANGLE_FIRST | 0x02u,
			column << 5u);
	}

	std::fill(software.vram.begin(), software.vram.end(), 0u);
	bmsx::executeGxGpuSoftwareCommands(software, commandBuffer, 0u, commandBuffer.presentCommandCount);

	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 10, 20)] == 0x7defu, "GX-GPU software semitrans mode 0 half blends white over blue");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 20, 20)] == 0x7fffu, "GX-GPU software semitrans mode 1 adds white over blue");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 30, 20)] == 0x0000u, "GX-GPU software semitrans mode 2 subtracts white from blue");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 40, 20)] == 0x7ce7u, "GX-GPU software semitrans mode 3 quarter-adds white over blue");
}

void testSoftwareTriangleEdgesAndQuadSeams() {
	bmsx::GxGpuSoftwareState software(bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes, 0u);
	bmsx::GxGpuCommandBuffer commandBuffer(commandBufferDmaHarness.dma);
	commandBuffer.reset();
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 4>{
			(bmsx::GX_GPU_GP0_POLYGON_FIRST << 24u) | 0x0000ffu,
			(4u << 16u) | 4u,
			(4u << 16u) | 8u,
			(8u << 16u) | 4u,
		},
		4u,
		bmsx::GX_GPU_COMMAND_DRAW_POLYGON,
		bmsx::GX_GPU_GP0_POLYGON_FIRST);
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 4>{
			(bmsx::GX_GPU_GP0_POLYGON_FIRST << 24u) | 0x00ff00u,
			(4u << 16u) | 12u,
			(8u << 16u) | 12u,
			(4u << 16u) | 16u,
		},
		4u,
		bmsx::GX_GPU_COMMAND_DRAW_POLYGON,
		bmsx::GX_GPU_GP0_POLYGON_FIRST);
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 4>{
			(bmsx::GX_GPU_GP0_POLYGON_FIRST << 24u) | 0xff0000u,
			(4u << 16u) | 32u,
			(5u << 16u) | 34u,
			(6u << 16u) | 32u,
		},
		4u,
		bmsx::GX_GPU_COMMAND_DRAW_POLYGON,
		bmsx::GX_GPU_GP0_POLYGON_FIRST);
	constexpr uint8_t semiTransparentQuadOpcode = bmsx::GX_GPU_GP0_POLYGON_FIRST | bmsx::GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT | 0x02u;
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 5>{
			(semiTransparentQuadOpcode << 24u) | 0x0000ffu,
			(20u << 16u) | 20u,
			(20u << 16u) | 24u,
			(24u << 16u) | 20u,
			(24u << 16u) | 24u,
		},
		5u,
		bmsx::GX_GPU_COMMAND_DRAW_POLYGON,
		semiTransparentQuadOpcode);
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 5>{
			(semiTransparentQuadOpcode << 24u) | 0x0000ffu,
			(30u << 16u) | 30u,
			(30u << 16u) | 34u,
			(34u << 16u) | 30u,
			(31u << 16u) | 31u,
		},
		5u,
		bmsx::GX_GPU_COMMAND_DRAW_POLYGON,
		semiTransparentQuadOpcode);

	std::fill(software.vram.begin(), software.vram.end(), 0u);
	bmsx::executeGxGpuSoftwareCommands(software, commandBuffer, 0u, commandBuffer.presentCommandCount);

	for (int32_t row = 0; row < 4; row += 1) {
		for (int32_t column = 0; column < 4 - row; column += 1) {
			require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 4 + column, 4 + row)] == 0x001fu, "GX-GPU software clockwise triangle coverage");
			require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 12 + column, 4 + row)] == 0x03e0u, "GX-GPU software counter-clockwise triangle coverage");
		}
		require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 8 - row, 4 + row)] == 0u, "GX-GPU software triangle excludes right edge");
		require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 16 - row, 4 + row)] == 0u, "GX-GPU software reversed triangle excludes right edge");
	}
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 32, 4)] == 0u, "GX-GPU software narrow triangle drops zero-width top row");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 32, 5)] == 0x7c00u, "GX-GPU software narrow triangle includes left span pixel");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 33, 5)] == 0x7c00u, "GX-GPU software narrow triangle includes right span pixel");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 34, 5)] == 0u, "GX-GPU software narrow triangle excludes zero-width apex");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 32, 6)] == 0u, "GX-GPU software narrow triangle drops zero-width bottom row");
	for (int32_t y = 20; y < 24; y += 1) {
		for (int32_t x = 20; x < 24; x += 1) {
			require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, x, y)] == 0x000fu, "GX-GPU software quad blends each pixel exactly once");
		}
	}
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 24, 20)] == 0u, "GX-GPU software quad excludes right edge");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 20, 24)] == 0u, "GX-GPU software quad excludes bottom edge");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 30, 31)] == 0x000fu, "GX-GPU software representable quad first triangle single hit");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 31, 31)] == 0x0017u, "GX-GPU software representable quad second triangle observes the first write");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 32, 31)] == 0x0017u, "GX-GPU software representable quad overlapping row blends twice");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 31, 32)] == 0x0017u, "GX-GPU software representable quad overlapping column blends twice");
}

void testSoftwareGouraudTriangleFixedColorPlane() {
	bmsx::GxGpuSoftwareState software(bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes, 0u);
	bmsx::GxGpuCommandBuffer commandBuffer(commandBufferDmaHarness.dma);
	commandBuffer.reset();
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 4>{
			bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24u,
			0u,
			(1u << 16u) | 1u,
			0x00000010u,
		},
		4u,
		bmsx::GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
		bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST);
	constexpr uint8_t gouraudOpcode = bmsx::GX_GPU_GP0_POLYGON_FIRST | bmsx::GX_GPU_GP0_RENDER_GOURAUD_BIT;
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 6>{
			gouraudOpcode << 24u,
			(10u << 16u) | 10u,
			0x0000ffu,
			(11u << 16u) | 17u,
			0u,
			(19u << 16u) | 12u,
		},
		6u,
		bmsx::GX_GPU_COMMAND_DRAW_POLYGON,
		gouraudOpcode);
	constexpr uint8_t texturedGouraudOpcode = gouraudOpcode | bmsx::GX_GPU_GP0_RENDER_TEXTURE_BIT;
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 9>{
			texturedGouraudOpcode << 24u,
			(30u << 16u) | 30u,
			0u,
			0x0000ffu,
			(31u << 16u) | 37u,
			0u,
			0u,
			(39u << 16u) | 32u,
			0u,
		},
		9u,
		bmsx::GX_GPU_COMMAND_DRAW_POLYGON,
		texturedGouraudOpcode,
		bmsx::GX_GPU_TEXTURE_MODE_DIRECT16 << 7u);

	std::fill(software.vram.begin(), software.vram.end(), 0u);
	bmsx::executeGxGpuSoftwareCommands(software, commandBuffer, 0u, commandBuffer.presentCommandCount);

	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 13, 13)] == 0x000bu, "GX-GPU software Gouraud triangle truncates the fixed-12 color plane before RGB555 storage");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 33, 33)] == 0x000bu, "GX-GPU software textured Gouraud triangle modulates from the fixed-12 color plane");
}

void testSoftwarePolygonRasterBucketWrap() {
	bmsx::GxGpuSoftwareState software(bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes, 0u);
	bmsx::GxGpuCommandBuffer commandBuffer(commandBufferDmaHarness.dma);
	commandBuffer.reset();
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 4>{
			(bmsx::GX_GPU_GP0_POLYGON_FIRST << 24u) | 0x0000ffu,
			0x000a03f8u,
			0x000a03fcu,
			0x000e03f8u,
		},
		4u,
		bmsx::GX_GPU_COMMAND_DRAW_POLYGON,
		bmsx::GX_GPU_GP0_POLYGON_FIRST,
		0u,
		0u,
		0u,
		GX_GPU_SOFTWARE_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD,
		0x00000004u);
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 5>{
			bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24u,
			0u,
			(1u << 16u) | 4u,
			0x03e0001fu,
			0x7fff7c00u,
		},
		5u,
		bmsx::GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
		bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST);
	constexpr uint8_t rawTexturedPolygonOpcode = bmsx::GX_GPU_GP0_POLYGON_FIRST | bmsx::GX_GPU_GP0_RENDER_TEXTURE_BIT | 0x01u;
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 7>{
			(rawTexturedPolygonOpcode << 24u) | 0x808080u,
			0x00140400u,
			0x00000000u,
			0x00140404u,
			0x01000004u,
			0x00180400u,
			0x00000400u,
		},
		7u,
		bmsx::GX_GPU_COMMAND_DRAW_POLYGON,
		rawTexturedPolygonOpcode,
		bmsx::GX_GPU_TEXTURE_MODE_DIRECT16 << 7u,
		0u,
		0u,
		GX_GPU_SOFTWARE_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD,
		0x000007fcu);
	constexpr uint8_t gouraudPolygonOpcode = bmsx::GX_GPU_GP0_POLYGON_FIRST | bmsx::GX_GPU_GP0_RENDER_GOURAUD_BIT;
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 6>{
			(gouraudPolygonOpcode << 24u) | 0x0000ffu,
			0x05fc000au,
			0x0000ff00u,
			0x05fc000eu,
			0x00ff0000u,
			0x0600000au,
		},
		6u,
		bmsx::GX_GPU_COMMAND_DRAW_POLYGON,
		gouraudPolygonOpcode,
		0u,
		0u,
		0x0007f40bu,
		0x0007f80cu,
		0x00200000u);

	std::fill(software.vram.begin(), software.vram.end(), 0u);
	bmsx::executeGxGpuSoftwareCommands(software, commandBuffer, 0u, commandBuffer.presentCommandCount);

	for (int32_t row = 0; row < 4; row += 1) {
		for (int32_t column = 0; column < 4 - row; column += 1) {
			require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 1020 + column, 10 + row)] == 0x001fu, "GX-GPU software polygon preserves the positive 1024 exclusive edge");
		}
	}
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 0, 10)] == 0u, "GX-GPU software polygon does not pre-wrap the positive 1024 edge");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 1020, 20)] == 0x001fu, "GX-GPU software wrapped textured polygon samples first texel");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 1021, 20)] == 0x03e0u, "GX-GPU software wrapped textured polygon samples second texel");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 1022, 20)] == 0x7c00u, "GX-GPU software wrapped textured polygon samples third texel");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 1023, 20)] == 0x7fffu, "GX-GPU software wrapped textured polygon samples fourth texel");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 0, 20)] == 0u, "GX-GPU software wrapped textured polygon stays in one raster bucket");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 11, 509)] == 0x2110u, "GX-GPU software wrapped Gouraud polygon first clipped fixed-12 color");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 12, 509)] == 0x2208u, "GX-GPU software wrapped Gouraud polygon second clipped fixed-12 color");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 11, 510)] == 0x4108u, "GX-GPU software wrapped Gouraud polygon lower clipped fixed-12 color");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 10, 509)] == 0u, "GX-GPU software wrapped Gouraud polygon clips left drawing area");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 12, 510)] == 0u, "GX-GPU software wrapped Gouraud polygon clips bottom-right drawing area");
}

void testSoftwareTexturedPolygonFixedUvGradient() {
	bmsx::GxGpuSoftwareState software(bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes, 0u);
	bmsx::GxGpuCommandBuffer commandBuffer(commandBufferDmaHarness.dma);
	commandBuffer.reset();
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 4>{
			bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24u,
			0u,
			(1u << 16u) | 2u,
			0x03e0001fu,
		},
		4u,
		bmsx::GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
		bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST);
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 4>{
			bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24u,
			0u,
			(2u << 16u) | 1u,
			0x03e0001fu,
		},
		4u,
		bmsx::GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
		bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST);
	constexpr uint8_t opcode = bmsx::GX_GPU_GP0_POLYGON_FIRST | bmsx::GX_GPU_GP0_RENDER_TEXTURE_BIT | 0x01u;
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 7>{
			(opcode << 24u) | 0x808080u,
			(10u << 16u) | 10u,
			0u,
			(10u << 16u) | 12u,
			0x01000001u,
			(12u << 16u) | 10u,
			0u,
		},
		7u,
		bmsx::GX_GPU_COMMAND_DRAW_POLYGON,
		opcode,
		bmsx::GX_GPU_TEXTURE_MODE_DIRECT16 << 7u);
	pushSoftwareCommand(commandBuffer, std::array<uint32_t, 7>{
		(opcode << 24u) | 0x808080u,
		(20u << 16u) | 20u, 0u,
		(20u << 16u) | 26u, 0x01000001u,
		(26u << 16u) | 20u, 0u,
	}, 7u, bmsx::GX_GPU_COMMAND_DRAW_POLYGON, opcode, bmsx::GX_GPU_TEXTURE_MODE_DIRECT16 << 7u);
	pushSoftwareCommand(commandBuffer, std::array<uint32_t, 7>{
		(opcode << 24u) | 0x808080u,
		(30u << 16u) | 30u, 1u,
		(30u << 16u) | 36u, 0x01000000u,
		(36u << 16u) | 30u, 1u,
	}, 7u, bmsx::GX_GPU_COMMAND_DRAW_POLYGON, opcode, bmsx::GX_GPU_TEXTURE_MODE_DIRECT16 << 7u);
	pushSoftwareCommand(commandBuffer, std::array<uint32_t, 7>{
		(opcode << 24u) | 0x808080u,
		(500u << 16u) | 1016u, 0u,
		(500u << 16u) | 1022u, 0x01000001u,
		(506u << 16u) | 1016u, 0u,
	}, 7u, bmsx::GX_GPU_COMMAND_DRAW_POLYGON, opcode, bmsx::GX_GPU_TEXTURE_MODE_DIRECT16 << 7u);
	pushSoftwareCommand(commandBuffer, std::array<uint32_t, 7>{
		(opcode << 24u) | 0x808080u,
		(500u << 16u) | 100u, 0u,
		(500u << 16u) | 106u, 0u,
		(506u << 16u) | 100u, 0x00000100u,
	}, 7u, bmsx::GX_GPU_COMMAND_DRAW_POLYGON, opcode, bmsx::GX_GPU_TEXTURE_MODE_DIRECT16 << 7u);

	std::fill(software.vram.begin(), software.vram.end(), 0u);
	bmsx::executeGxGpuSoftwareCommands(software, commandBuffer, 0u, commandBuffer.presentCommandCount);

	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 10, 10)] == 0x001fu, "GX-GPU software fixed UV plane samples the seeded texel at the first pixel");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 11, 10)] == 0x03e0u, "GX-GPU software fixed UV plane rounds the half-texel boundary up");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 10, 11)] == 0x001fu, "GX-GPU software fixed UV plane preserves the vertical sample");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 12, 10)] == 0u, "GX-GPU software fixed UV triangle excludes its right edge");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 23, 20)] == 0x001fu, "GX-GPU software fixed UV plane truncates a non-integral positive gradient");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 24, 20)] == 0x03e0u, "GX-GPU software fixed UV plane advances after the truncated boundary");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 33, 30)] == 0x03e0u, "GX-GPU software fixed UV plane preserves a descending boundary texel");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 34, 30)] == 0x001fu, "GX-GPU software fixed UV plane wraps a negative gradient accumulator");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 1019, 500)] == 0x001fu, "GX-GPU software translated fixed UV plane preserves the truncated boundary");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 1020, 500)] == 0x03e0u, "GX-GPU software translated fixed UV plane advances after the truncated boundary");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 100, 503)] == 0x001fu, "GX-GPU software vertical fixed UV plane preserves the truncated boundary");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 100, 504)] == 0x03e0u, "GX-GPU software vertical fixed UV plane advances after the truncated boundary");
}

void testSoftwareTextureWindowPageAndClutEdges() {
	bmsx::GxGpuSoftwareState software(bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes, 0u);
	bmsx::GxGpuCommandBuffer commandBuffer(commandBufferDmaHarness.dma);
	commandBuffer.reset();
	constexpr uint8_t opcode = bmsx::GX_GPU_GP0_RECTANGLE_FIRST | bmsx::GX_GPU_GP0_RENDER_TEXTURE_BIT | 0x01u;
	pushSoftwareCommand(commandBuffer, std::array<uint32_t, 4>{
		(opcode << 24u) | 0x808080u,
		(10u << 16u) | 10u,
		0x00000707u,
		(2u << 16u) | 2u,
	}, 4u, bmsx::GX_GPU_COMMAND_DRAW_RECTANGLE, opcode, bmsx::GX_GPU_TEXTURE_MODE_DIRECT16 << 7u, 0x00008421u);
	pushSoftwareCommand(commandBuffer, std::array<uint32_t, 4>{
		(opcode << 24u) | 0x808080u,
		(20u << 16u) | 20u,
		0x00001e3fu,
		(1u << 16u) | 2u,
	}, 4u, bmsx::GX_GPU_COMMAND_DRAW_RECTANGLE, opcode, (bmsx::GX_GPU_TEXTURE_MODE_DIRECT16 << 7u) | 0x0fu);
	pushSoftwareCommand(commandBuffer, std::array<uint32_t, 4>{
		(opcode << 24u) | 0x808080u,
		(30u << 16u) | 30u,
		0x0000ff05u,
		(2u << 16u) | 1u,
	}, 4u, bmsx::GX_GPU_COMMAND_DRAW_RECTANGLE, opcode, (bmsx::GX_GPU_TEXTURE_MODE_DIRECT16 << 7u) | 0x11u);
	pushSoftwareCommand(commandBuffer, std::array<uint32_t, 4>{
		(opcode << 24u) | 0x808080u,
		(40u << 16u) | 40u,
		0x0f3f3200u,
		(1u << 16u) | 2u,
	}, 4u, bmsx::GX_GPU_COMMAND_DRAW_RECTANGLE, opcode, (bmsx::GX_GPU_TEXTURE_MODE_PALETTE8 << 7u) | 0x02u);
	pushSoftwareCommand(commandBuffer, std::array<uint32_t, 4>{
		(opcode << 24u) | 0x808080u,
		(50u << 16u) | 50u,
		0x140146ffu,
		(1u << 16u) | 2u,
	}, 4u, bmsx::GX_GPU_COMMAND_DRAW_RECTANGLE, opcode, 0x0fu);
	pushSoftwareCommand(commandBuffer, std::array<uint32_t, 4>{
		(opcode << 24u) | 0x808080u,
		(600u << 16u) | 60u,
		(((100u << 6u) | (320u >> 4u)) << 16u),
		(1u << 16u) | 1u,
	}, 4u, bmsx::GX_GPU_COMMAND_DRAW_RECTANGLE, opcode, bmsx::GX_GPU_TEXTURE_MODE_PALETTE4 | bmsx::GX_GPU_DRAW_MODE_TEXTURE_PAGE_Y_HIGH, 0u, 0u, 1023u | (1023u << 10u), 0u, 0u, bmsx::GX_GPU_SKIPPED_LINE_NONE, 1u);
	pushSoftwareCommand(commandBuffer, std::array<uint32_t, 4>{
		(opcode << 24u) | 0x808080u,
		(600u << 16u) | 61u,
		(((512u << 6u) | (320u >> 4u)) << 16u),
		(1u << 16u) | 1u,
	}, 4u, bmsx::GX_GPU_COMMAND_DRAW_RECTANGLE, opcode, bmsx::GX_GPU_TEXTURE_MODE_PALETTE4 | 0x0fu, 0u, 0u, 1023u | (1023u << 10u), 0u, 0u, bmsx::GX_GPU_SKIPPED_LINE_NONE, 1u);

	std::fill(software.vram.begin(), software.vram.end(), 0u);
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 15, 15)] = 0x001fu;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 8, 15)] = 0x03e0u;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 15, 8)] = 0x7c00u;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 8, 8)] = 0x7fffu;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 1023, 30)] = 0x001fu;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 0, 30)] = 0x03e0u;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 69, 511)] = 0x001fu;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 69, 256)] = 0x03e0u;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 128, 50)] = 0x100fu;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 1023, 60)] = 0x001fu;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 0, 60)] = 0x03e0u;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 1023, 70)] = 0x1000u;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 960, 70)] = 0x0002u;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 17, 80)] = 0x001fu;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 18, 80)] = 0x03e0u;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 0, 0)] = 0x0002u;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 0, 512)] = 0x0001u;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 320, 100)] = 0x7fffu;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 321, 100)] = 0x001fu;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 322, 100)] = 0x03e0u;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 960, 0)] = 0x0002u;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 322, 512)] = 0x7c00u;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 60, 60)] = 0x03e0u;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 61, 60)] = 0x03e0u;
	bmsx::executeGxGpuSoftwareCommands(software, commandBuffer, 0u, commandBuffer.presentCommandCount);

	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 10, 10)] == 0x001fu, "GX-GPU software texture window replaces the masked U bits");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 11, 10)] == 0x03e0u, "GX-GPU software texture window preserves the unmasked U bits");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 10, 11)] == 0x7c00u, "GX-GPU software texture window replaces the masked V bits");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 11, 11)] == 0x7fffu, "GX-GPU software texture window preserves the unmasked V bits");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 20, 20)] == 0x001fu, "GX-GPU software direct16 page samples the final VRAM column");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 21, 20)] == 0x03e0u, "GX-GPU software direct16 page wraps X at the VRAM edge");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 30, 30)] == 0x001fu, "GX-GPU software direct16 page samples the final VRAM row");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 30, 31)] == 0x03e0u, "GX-GPU software direct16 page wraps V within its page");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 40, 40)] == 0x001fu, "GX-GPU software palette8 samples the low byte at the page edge");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 41, 40)] == 0x03e0u, "GX-GPU software palette8 samples the high byte and wraps the CLUT lookup horizontally");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 50, 50)] == 0x001fu, "GX-GPU software palette4 samples the high nibble at the page edge");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 51, 50)] == 0x03e0u, "GX-GPU software palette4 advances into the wrapped texture word");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 60, 60)] == 0x03e0u, "GX-GPU software upper-half draw does not alter the corresponding lower row");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 61, 60)] == 0x03e0u, "GX-GPU software upper-half CLUT draw does not alter the corresponding lower row");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 60, 600)] == 0x001fu, "GX-GPU software samples installed upper texture-page storage into an upper draw target");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 61, 600)] == 0x7c00u, "GX-GPU software samples installed upper CLUT storage into an upper draw target");
}

void testSoftwareDrawingAreaOffsetClippingAndRectangleCoordinateWrap() {
	bmsx::GxGpuSoftwareState software(bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes, 0u);
	bmsx::GxGpuCommandBuffer commandBuffer(commandBufferDmaHarness.dma);
	commandBuffer.reset();
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 4>{
			(bmsx::GX_GPU_GP0_POLYGON_FIRST << 24u) | 0x0000ffu,
			0x07fe07feu,
			0x07fe0006u,
			0x000607feu,
		},
		4u,
		bmsx::GX_GPU_COMMAND_DRAW_POLYGON,
		bmsx::GX_GPU_GP0_POLYGON_FIRST,
		0u,
		0u,
		12u | (12u << 10u),
		15u | (15u << 10u),
		12u | (12u << 11u));
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 3>{
			(bmsx::GX_GPU_GP0_RECTANGLE_FIRST << 24u) | 0x00ff00u,
			(18u << 16u) | 18u,
			(10u << 16u) | 10u,
		},
		3u,
		bmsx::GX_GPU_COMMAND_DRAW_RECTANGLE,
		bmsx::GX_GPU_GP0_RECTANGLE_FIRST,
		0u,
		0u,
		20u | (20u << 10u),
		25u | (25u << 10u));
	pushSoftwareVramUpload(commandBuffer, (2u << 16u) | 66u, (1u << 16u) | 1u, 0x0000001fu);
	pushSoftwareVramUpload(commandBuffer, (2u << 16u) | 71u, (1u << 16u) | 1u, 0x000003e0u);
	pushSoftwareVramUpload(commandBuffer, (7u << 16u) | 66u, (1u << 16u) | 1u, 0x00007c00u);
	pushSoftwareVramUpload(commandBuffer, (7u << 16u) | 71u, (1u << 16u) | 1u, 0x00007fffu);
	constexpr uint8_t texturedRectangleOpcode = bmsx::GX_GPU_GP0_RECTANGLE_FIRST | bmsx::GX_GPU_GP0_RENDER_TEXTURE_BIT | 0x01u;
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 4>{
			(texturedRectangleOpcode << 24u) | 0x808080u,
			(18u << 16u) | 28u,
			0u,
			(10u << 16u) | 10u,
		},
		4u,
		bmsx::GX_GPU_COMMAND_DRAW_RECTANGLE,
		texturedRectangleOpcode,
		(bmsx::GX_GPU_TEXTURE_MODE_DIRECT16 << 7u) | 1u,
		0u,
		30u | (20u << 10u),
		35u | (25u << 10u));
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 3>{
			(bmsx::GX_GPU_GP0_LINE_FIRST << 24u) | 0x0000ffu,
			0x07fe07feu,
			0x00080008u,
		},
		3u,
		bmsx::GX_GPU_COMMAND_DRAW_LINE,
		bmsx::GX_GPU_GP0_LINE_FIRST,
		0u,
		0u,
		40u | (20u << 10u),
		45u | (25u << 10u),
		40u | (20u << 11u));
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 3>{
			(bmsx::GX_GPU_GP0_RECTANGLE_FIRST << 24u) | 0xffffffu,
			0x04000400u,
			(1u << 16u) | 1u,
		},
		3u,
		bmsx::GX_GPU_COMMAND_DRAW_RECTANGLE,
		bmsx::GX_GPU_GP0_RECTANGLE_FIRST,
		0u,
		0u,
		0u,
		GX_GPU_SOFTWARE_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD,
		0x00200400u);
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 3>{
			(bmsx::GX_GPU_GP0_RECTANGLE_FIRST << 24u) | 0x0000ffu,
			(520u << 16u) | 60u,
			(1u << 16u) | 1u,
		},
		3u,
		bmsx::GX_GPU_COMMAND_DRAW_RECTANGLE,
		bmsx::GX_GPU_GP0_RECTANGLE_FIRST,
		0u,
		0u,
		60u | (520u << 10u),
		60u | (520u << 10u));
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 3>{
			(bmsx::GX_GPU_GP0_RECTANGLE_FIRST << 24u) | 0x00ff00u,
			(8u << 16u) | 60u,
			(1u << 16u) | 1u,
		},
		3u,
		bmsx::GX_GPU_COMMAND_DRAW_RECTANGLE,
		bmsx::GX_GPU_GP0_RECTANGLE_FIRST,
		0u,
		0u,
		60u | (520u << 10u),
		60u | (520u << 10u));
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 3>{
			(bmsx::GX_GPU_GP0_RECTANGLE_FIRST << 24u) | 0x0000ffu,
			(520u << 16u) | 61u,
			(1u << 16u) | 1u,
		},
		3u,
		bmsx::GX_GPU_COMMAND_DRAW_RECTANGLE,
		bmsx::GX_GPU_GP0_RECTANGLE_FIRST,
		0u,
		0u,
		0u,
		1023u | (1023u << 10u));
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 3>{
			(bmsx::GX_GPU_GP0_RECTANGLE_FIRST << 24u) | 0x00ff00u,
			(8u << 16u) | 61u,
			(1u << 16u) | 1u,
		},
		3u,
		bmsx::GX_GPU_COMMAND_DRAW_RECTANGLE,
		bmsx::GX_GPU_GP0_RECTANGLE_FIRST,
		0u,
		0u,
		0u,
		1023u | (1023u << 10u));
	constexpr uint8_t aliasedQuadOpcode = bmsx::GX_GPU_GP0_POLYGON_FIRST | bmsx::GX_GPU_GP0_RENDER_GOURAUD_BIT | bmsx::GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT;
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 8>{
			(aliasedQuadOpcode << 24u) | 0x0000ffu,
			(1022u << 16u) | 105u,
			0x0000ffu,
			(511u << 16u) | 100u,
			0x0000ffu,
			(511u << 16u) | 110u,
			0x00ff00u,
			105u,
		},
		8u,
		bmsx::GX_GPU_COMMAND_DRAW_POLYGON,
		aliasedQuadOpcode,
		0u,
		0u,
		0u,
		1023u | (1023u << 10u));
	constexpr uint8_t blendedAliasedQuadOpcode = aliasedQuadOpcode | 0x02u;
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 8>{
			(blendedAliasedQuadOpcode << 24u) | 0x0000ffu,
			(1022u << 16u) | 125u,
			0x0000ffu,
			(511u << 16u) | 120u,
			0x0000ffu,
			(511u << 16u) | 130u,
			0x00ff00u,
			125u,
		},
		8u,
		bmsx::GX_GPU_COMMAND_DRAW_POLYGON,
		blendedAliasedQuadOpcode,
		0u,
		0u,
		0u,
		1023u | (1023u << 10u));

	std::fill(software.vram.begin(), software.vram.end(), 0u);
	bmsx::executeGxGpuSoftwareCommands(software, commandBuffer, 0u, commandBuffer.presentCommandCount);

	for (int32_t row = 0; row < 4; row += 1) {
		for (int32_t column = 0; column < 4 - row; column += 1) {
			require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 12 + column, 12 + row)] == 0x001fu, "GX-GPU software offset triangle inside drawing area");
		}
	}
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 11, 12)] == 0u, "GX-GPU software drawing area clips triangle left");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 12, 11)] == 0u, "GX-GPU software drawing area clips triangle top");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 16, 12)] == 0u, "GX-GPU software drawing area clips triangle right");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 12, 16)] == 0u, "GX-GPU software drawing area clips triangle bottom");
	for (int32_t y = 20; y <= 25; y += 1) {
		for (int32_t x = 20; x <= 25; x += 1) {
			require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, x, y)] == 0x03e0u, "GX-GPU software inclusive drawing area clips rectangle");
		}
	}
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 19, 20)] == 0u, "GX-GPU software drawing area clips rectangle left");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 26, 25)] == 0u, "GX-GPU software drawing area clips rectangle right");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 20, 19)] == 0u, "GX-GPU software drawing area clips rectangle top");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 25, 26)] == 0u, "GX-GPU software drawing area clips rectangle bottom");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 30, 20)] == 0x001fu, "GX-GPU software clipped textured rectangle advances UV top-left");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 35, 20)] == 0x03e0u, "GX-GPU software clipped textured rectangle advances UV top-right");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 30, 25)] == 0x7c00u, "GX-GPU software clipped textured rectangle advances UV bottom-left");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 35, 25)] == 0x7fffu, "GX-GPU software clipped textured rectangle advances UV bottom-right");
	for (int32_t coord = 0; coord < 6; coord += 1) {
		require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 40 + coord, 20 + coord)] == 0x001fu, "GX-GPU software offset line inside drawing area");
	}
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 39, 19)] == 0u, "GX-GPU software drawing area clips line start");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 46, 26)] == 0u, "GX-GPU software drawing area clips line end");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 0, 0)] == 0x7fffu, "GX-GPU software rectangle wraps post-offset coordinates to signed 11-bit");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 60, 8)] == 0x03e0u, "GX-GPU closed Y gate masks drawing-area Y9 before raster clipping");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 61, 8)] == 0x03e0u, "GX-GPU closed Y gate addresses the installed lower row");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 105, 255)] == 0x020fu, "GX-GPU software preserves triangle order across aliased logical row bands");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 125, 255)] == 0x0107u, "GX-GPU closed Y gate rasterizes one installed-bank triangle sample");
}

void testSoftwareFillBypassesDrawingAreaAndMaskBitDrawingState() {
	bmsx::GxGpuSoftwareState software(bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes, 0u);
	bmsx::GxGpuCommandBuffer commandBuffer(commandBufferDmaHarness.dma);
	commandBuffer.reset();
	pushSoftwareVramUpload(commandBuffer, (30u << 16u) | 80u, (1u << 16u) | 1u, 0x0000801fu);
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 3>{
			(bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u) | 0x00ff00u,
			(30u << 16u) | 80u,
			(1u << 16u) | 1u,
		},
		3u,
		bmsx::GX_GPU_COMMAND_FILL_RECTANGLE,
		bmsx::GX_GPU_GP0_FILL_RECTANGLE,
		0u,
		0u,
		0u,
		0u,
		0u,
		3u);

	std::fill(software.vram.begin(), software.vram.end(), 0u);
	bmsx::executeGxGpuSoftwareCommands(software, commandBuffer, 0u, commandBuffer.presentCommandCount);

	for (int32_t x = 80; x < 96; x += 1) {
		require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, x, 30)] == 0x03e0u, "GX-GPU software fill ignores drawing-area and mask-bit state");
	}
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 79, 30)] == 0u, "GX-GPU software fill starts at aligned X");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 96, 30)] == 0u, "GX-GPU software fill ends at rounded width");
}

void testSoftwareScanoutConsumesTransfersAndFill() {
	bmsx::GxGpuCommandBuffer commandBuffer(commandBufferDmaHarness.dma);
	commandBuffer.reset();
	pushSoftwareVramUpload(
		commandBuffer,
		0u,
		(1u << 16u) | 2u,
		0x03e0001fu);
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 4>{
			bmsx::GX_GPU_GP0_VRAM_TO_VRAM_FIRST << 24u,
			0u,
			2u,
			(1u << 16u) | 2u,
		},
		4u,
		bmsx::GX_GPU_COMMAND_COPY_VRAM_TO_VRAM,
		bmsx::GX_GPU_GP0_VRAM_TO_VRAM_FIRST);
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 4>{
			(bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u) | 0xff0000u,
			1u << 16u,
			(1u << 16u) | 1u,
			0u,
		},
		3u,
		bmsx::GX_GPU_COMMAND_FILL_RECTANGLE,
		bmsx::GX_GPU_GP0_FILL_RECTANGLE);

	SoftwareFrameHarness frame(commandBuffer, commandBuffer.readback);

	bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state, frame.output);

	requireArgbPixel(frame.framebuffer, 0u, 0u, 0x00ff0000u, "GX-GPU software scanout CPU upload red pixel");
	requireArgbPixel(frame.framebuffer, 1u, 0u, 0x0000ff00u, "GX-GPU software scanout CPU upload green pixel");
	requireArgbPixel(frame.framebuffer, 2u, 0u, 0x00ff0000u, "GX-GPU software scanout VRAM copy red pixel");
	requireArgbPixel(frame.framebuffer, 3u, 0u, 0x0000ff00u, "GX-GPU software scanout VRAM copy green pixel");
	requireArgbPixel(frame.framebuffer, 0u, 1u, 0x000000ffu, "GX-GPU software scanout fill blue left pixel");
	requireArgbPixel(frame.framebuffer, 15u, 1u, 0x000000ffu, "GX-GPU software scanout fill blue rounded pixel");
	requireArgbPixel(frame.framebuffer, 16u, 1u, 0x00000000u, "GX-GPU software scanout fill stops at rounded edge");
}

void testSoftwarePresentationCopiesRgbAsOpaquePixels() {
	bmsx::SoftwareBackend backend(4, 2, bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes);
	backend.resizePresentationTarget(4, 2);
	bmsx::TextureHandle texture = backend.createColorTexture(2, 1, nullptr);
	auto* source = static_cast<bmsx::SoftwareTexture*>(texture);
	source->data[0u] = 0x00112233u;
	source->data[1u] = 0x80445566u;

	backend.presentTexture(texture);

	const std::array<uint32_t, 8u> expected{
		0xff112233u, 0xff112233u, 0xff445566u, 0xff445566u,
		0xff112233u, 0xff112233u, 0xff445566u, 0xff445566u,
	};
	requireFramebuffer(
		backend.framebuffer(),
		expected,
		"Software presentation copies RGB without compositing source alpha");
	backend.destroyTexture(texture);
}

void testSoftwareScanoutUsesNativeOutputDimensions() {
	bmsx::GxGpuSoftwareState software(bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes, 256u * 212u);
	bmsx::SoftwareBackend backend(256, 192, bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes);
	backend.resizePresentationTarget(256, 192);
	uint32_t* framebuffer = backend.framebuffer();
	bmsx::GxGpuPipelineState state{};
	auto pcrtcWords = kSoftwareTestPcrtcWords;
	bmsx::GxGpuPcrtcTiming pcrtcTiming{};
	bmsx::GxGpuPcrtcScanout pcrtcScanout{};
	state.width = 256;
	state.height = 192;
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB1_HIGH] = 900u | (400u << 11u);
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY1_HIGH] = 1023u | (191u << 12u);
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	std::fill(software.vram.begin(), software.vram.end(), 0u);
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 900, 400)] = 0x001fu;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 131, 401)] = 0x03e0u;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 900, 591)] = 0x7c00u;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 900, 611)] = 0x7fffu;
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);

	require(framebuffer[0] == 0x00ff0000u, "GX-GPU native 192-line scanout starts at the programmed VRAM origin");
	require(framebuffer[255] == 0x0000ff00u, "GX-GPU native scanout wraps the programmed VRAM X origin");
	require(framebuffer[191u * 256u] == 0x000000ffu, "GX-GPU native 192-line scanout reaches source row 191 without scaling");

	backend.resizePresentationTarget(256, 212);
	framebuffer = backend.framebuffer();
	std::fill_n(framebuffer, 256u * 212u, 0u);
	state.height = 212;
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY1_HIGH] = 1023u | (211u << 12u);
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
	require(framebuffer[211u * 256u] == 0x00ffffffu, "GX-GPU native 212-line scanout reaches source row 211 without scaling");

	backend.resizePresentationTarget(256, 192);
	framebuffer = backend.framebuffer();
	std::fill_n(framebuffer, 256u * 192u, 0u);
	state.height = 192;
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB1_HIGH] = 900u | (768u << 11u);
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY1_HIGH] = 1023u | (191u << 12u);
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 900, 768)] = 0x001fu;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 131, 769)] = 0x03e0u;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 900, 959)] = 0x7c00u;
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
	require(framebuffer[0u] == 0x00ff0000u, "GX-GPU native scanout reads installed upper VRAM");
	require(framebuffer[255u] == 0x0000ff00u, "GX-GPU native upper scanout preserves X wrap");
	require(framebuffer[191u * 256u] == 0x000000ffu, "GX-GPU native upper scanout reaches its final source row");
}

void testSoftwarePcrtcComposesSourceAlphaTerminalCellsOverRetainedCircuitTwoPixels() {
	bmsx::GxGpuSoftwareState software(bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes, 3u);
	bmsx::SoftwareBackend backend(3, 1, bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes);
	backend.resizePresentationTarget(3, 1);
	uint32_t* const framebuffer = backend.framebuffer();
	auto pcrtcWords = kSoftwareTestPcrtcWords;
	pcrtcWords[bmsx::GX_GPU_PCRTC_PMODE_LOW] = bmsx::GX_GPU_PCRTC_PMODE_EN1 | bmsx::GX_GPU_PCRTC_PMODE_EN2;
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB1_LOW] = 1u | (16u << 9u) | (bmsx::GX_GPU_PSMGX16 << 15u);
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB1_HIGH] = 0u;
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY1_LOW] = 3u << 23u;
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY1_HIGH] = 11u;
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB2_LOW] = (16u << 9u) | (bmsx::GX_GPU_PSMGX16 << 15u);
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB2_HIGH] = 0u;
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY2_LOW] = 3u << 23u;
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY2_HIGH] = 11u;
	pcrtcWords[bmsx::GX_GPU_PCRTC_BGCOLOR_LOW] = 0u;
	bmsx::GxGpuPcrtcTiming pcrtcTiming{};
	bmsx::GxGpuPcrtcScanout pcrtcScanout{};
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	bmsx::GxGpuPipelineState state{};
	state.width = 3;
	state.height = 1;
	std::fill(software.vram.begin(), software.vram.end(), 0u);
	software.vram[0u] = 0x001fu;
	software.vram[1u] = 0x03e0u;
	software.vram[2u] = 0xfc00u;
	software.vram[4096u] = 0u;
	software.vram[4097u] = 0x8000u;
	software.vram[4098u] = 0xffffu;
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);

	requireFramebuffer(framebuffer, std::array<uint32_t, 3u>{
		0x00ff0000u,
		0x80000000u,
		0x80ffffffu,
	}, "GX-GPU PCRTC source alpha replaces output alpha while composing terminal cells");

	pcrtcWords[bmsx::GX_GPU_PCRTC_PMODE_LOW] = bmsx::GX_GPU_PCRTC_PMODE_EN1
		| bmsx::GX_GPU_PCRTC_PMODE_EN2
		| bmsx::GX_GPU_PCRTC_PMODE_AMOD;
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
	requireFramebuffer(framebuffer, std::array<uint32_t, 3u>{
		0x00ff0000u,
		0x00000000u,
		0x80ffffffu,
	}, "GX-GPU PCRTC AMOD preserves circuit-two alpha under source-alpha terminal cells");

	pcrtcWords[bmsx::GX_GPU_PCRTC_PMODE_LOW] = bmsx::GX_GPU_PCRTC_PMODE_EN1
		| bmsx::GX_GPU_PCRTC_PMODE_EN2
		| bmsx::GX_GPU_PCRTC_PMODE_MMOD
		| bmsx::GX_GPU_PCRTC_PMODE_AMOD
		| (64u << 8u);
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
	requireFramebuffer(framebuffer, std::array<uint32_t, 3u>{
		0x00bf0000u,
		0x0000bf00u,
		0x804040ffu,
	}, "GX-GPU PCRTC constant-alpha RGB merge preserves circuit-two alpha under AMOD");

	pcrtcWords[bmsx::GX_GPU_PCRTC_PMODE_LOW] = bmsx::GX_GPU_PCRTC_PMODE_EN1
		| bmsx::GX_GPU_PCRTC_PMODE_EN2
		| bmsx::GX_GPU_PCRTC_PMODE_MMOD;
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
	requireFramebuffer(framebuffer, std::array<uint32_t, 3u>{
		0x00ff0000u,
		0x8000ff00u,
		0x800000ffu,
	}, "GX-GPU PCRTC zero constant alpha keeps underlay RGB and publishes circuit 1 alpha");

	pcrtcWords[bmsx::GX_GPU_PCRTC_PMODE_LOW] |= bmsx::GX_GPU_PCRTC_PMODE_AMOD;
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
	requireFramebuffer(framebuffer, std::array<uint32_t, 3u>{
		0x00ff0000u,
		0x0000ff00u,
		0x800000ffu,
	}, "GX-GPU PCRTC zero constant alpha preserves circuit-two alpha under AMOD");

	pcrtcWords[bmsx::GX_GPU_PCRTC_PMODE_LOW] |= 255u << 8u;
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
	requireFramebuffer(framebuffer, std::array<uint32_t, 3u>{
		0x00000000u,
		0x00000000u,
		0x80ffffffu,
	}, "GX-GPU PCRTC opaque constant color preserves circuit-two alpha under AMOD");
}

void testPcrtcProjectsDisplaySignalsAndSamplesMagnifiedSource() {
	bmsx::GxGpuSoftwareState software(bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes, 4u);
	bmsx::SoftwareBackend backend(2, 2, bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes);
	backend.resizePresentationTarget(2, 2);
	uint32_t* const framebuffer = backend.framebuffer();
	auto pcrtcWords = kSoftwareTestPcrtcWords;
	pcrtcWords[bmsx::GX_GPU_PCRTC_PMODE_LOW] = bmsx::GX_GPU_PCRTC_PMODE_EN1
		| bmsx::GX_GPU_PCRTC_PMODE_MMOD
		| bmsx::GX_GPU_PCRTC_PMODE_SLBG
		| (255u << 8u);
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB1_LOW] = 1u | (1u << 9u) | (bmsx::GX_GPU_PSMCT16S << 15u);
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB1_HIGH] = 2u | (1u << 11u);
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY1_LOW] = (1u << 12u) | (1u << 23u) | (1u << 27u);
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY1_HIGH] = 7u | (1u << 12u);
	pcrtcWords[bmsx::GX_GPU_PCRTC_BGCOLOR_LOW] = 0x00010203u;
	bmsx::GxGpuPcrtcTiming pcrtcTiming{};
	bmsx::GxGpuPcrtcScanout pcrtcScanout{};
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	const bmsx::GxGpuPcrtcCircuit& circuit = pcrtcScanout.circuits[0u];
	require(circuit.magnificationX == 2u && circuit.magnificationY == 2u, "GX-GPU PCRTC retains raw DISPLAY magnification factors");
	require(circuit.displaySignalX == 0u && circuit.displaySignalY == 1u, "GX-GPU PCRTC retains raw DISPLAY signal coordinates");
	require(circuit.displayX == 0u && circuit.displayY == 0u, "GX-GPU PCRTC normalizes the active signal origin before host allocation");
	require(circuit.displayWidth == 2u && circuit.displayHeight == 2u, "GX-GPU PCRTC projects DISPLAY signal clocks onto the common output grid");
	require(circuit.sourceAdvanceX == 2u && circuit.sourceRemainderStepX == 0u, "GX-GPU PCRTC publishes retained horizontal source stepping");
	require(pcrtcScanout.outputWidth == 2u && pcrtcScanout.outputHeight == 2u, "GX-GPU PCRTC caches common-grid output bounds");
	bmsx::GxGpuPipelineState state{};
	state.width = 2;
	state.height = 2;
	std::fill(software.vram.begin(), software.vram.end(), 0u);
	software.vram[bmsx::gxGpuLocalMemoryAddress16S(4096u, 1u, 2u, 1u)] = 0x001fu;
	software.vram[bmsx::gxGpuLocalMemoryAddress16S(4096u, 1u, 4u, 1u)] = 0x7c00u;
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
	requireFramebuffer(framebuffer, std::array<uint32_t, 4u>{
		0x00ff0000u, 0x000000ffu,
		0x00ff0000u, 0x000000ffu,
	}, "GX-GPU PCRTC incrementally samples the source at circuit magnification");
}

void testPcrtcKeepsMixedMagnificationCircuitsOnOneSignalGrid() {
	bmsx::GxGpuSoftwareState software(bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes, 9u);
	bmsx::SoftwareBackend backend(3, 3, bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes);
	backend.resizePresentationTarget(3, 3);
	uint32_t* const framebuffer = backend.framebuffer();
	auto pcrtcWords = kSoftwareTestPcrtcWords;
	pcrtcWords[bmsx::GX_GPU_PCRTC_PMODE_LOW] = bmsx::GX_GPU_PCRTC_PMODE_EN1
		| bmsx::GX_GPU_PCRTC_PMODE_EN2
		| bmsx::GX_GPU_PCRTC_PMODE_MMOD;
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB1_LOW] = 1u | (1u << 9u) | (bmsx::GX_GPU_PSMCT16S << 15u);
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB1_HIGH] = 0u;
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY1_LOW] = 680u | (37u << 12u) | (3u << 23u);
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY1_HIGH] = 11u | (1u << 12u);
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB2_LOW] = 2u | (1u << 9u) | (bmsx::GX_GPU_PSMCT16S << 15u);
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB2_HIGH] = 0u;
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY2_LOW] = 684u | (38u << 12u) | (1u << 23u);
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY2_HIGH] = 7u | (1u << 12u);
	bmsx::GxGpuPcrtcTiming pcrtcTiming{};
	bmsx::GxGpuPcrtcScanout pcrtcScanout{};
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	const bmsx::GxGpuPcrtcCircuit& circuit2 = pcrtcScanout.circuits[1u];
	require(circuit2.displayX == 1u && circuit2.displayY == 1u, "GX-GPU PCRTC projects both circuit offsets on the common signal grid");
	require(circuit2.displayRight == 3u && circuit2.displayBottom == 3u, "GX-GPU PCRTC retains the circuit-two common-grid extent");
	require(circuit2.sourceAdvanceX == 2u && circuit2.sourceRemainderStepX == 0u, "GX-GPU PCRTC publishes mixed-magnification source stepping once");
	bmsx::GxGpuPipelineState state{};
	state.width = 3;
	state.height = 3;
	std::fill(software.vram.begin(), software.vram.end(), 0u);
	software.vram[bmsx::gxGpuLocalMemoryAddress16S(8192u, 1u, 0u, 0u)] = 0x001fu;
	software.vram[bmsx::gxGpuLocalMemoryAddress16S(8192u, 1u, 2u, 0u)] = 0x03e0u;
	software.vram[bmsx::gxGpuLocalMemoryAddress16S(8192u, 1u, 0u, 1u)] = 0x7c00u;
	software.vram[bmsx::gxGpuLocalMemoryAddress16S(8192u, 1u, 2u, 1u)] = 0x7fffu;
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
	requireFramebuffer(framebuffer, std::array<uint32_t, 9u>{
		0x00000000u, 0x00000000u, 0x00000000u,
		0x00000000u, 0x00ff0000u, 0x0000ff00u,
		0x00000000u, 0x000000ffu, 0x00ffffffu,
	}, "GX-GPU PCRTC samples a displaced mixed-magnification underlay without per-pixel division");

	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY2_LOW] = 684u | (38u << 12u) | (7u << 23u);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	require(pcrtcScanout.circuits[1u].displayX == 1u && pcrtcScanout.circuits[1u].displayRight == 3u,
		"GX-GPU PCRTC circuit position does not move when only its source magnification changes");
}

void testPcrtcKeepsCircuitSourcePhaseIndependentFromOtherCrop() {
	bmsx::GxGpuSoftwareState software(bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes, 4u);
	bmsx::SoftwareBackend backend(4, 1, bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes);
	backend.resizePresentationTarget(4, 1);
	uint32_t* const framebuffer = backend.framebuffer();
	auto pcrtcWords = kSoftwareTestPcrtcWords;
	const bmsx::u32 circuitOnePmode = bmsx::GX_GPU_PCRTC_PMODE_EN1
		| bmsx::GX_GPU_PCRTC_PMODE_MMOD
		| bmsx::GX_GPU_PCRTC_PMODE_SLBG
		| (255u << 8u);
	pcrtcWords[bmsx::GX_GPU_PCRTC_PMODE_LOW] = circuitOnePmode;
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB1_LOW] = 1u | (1u << 9u) | (bmsx::GX_GPU_PSMCT16S << 15u);
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB1_HIGH] = 0u;
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY1_LOW] = 681u | (3u << 23u);
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY1_HIGH] = 7u;
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB2_LOW] = 2u | (1u << 9u) | (bmsx::GX_GPU_PSMCT16S << 15u);
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB2_HIGH] = 0u;
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY2_LOW] = 680u | (3u << 23u);
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY2_HIGH] = 7u;
	bmsx::GxGpuPcrtcTiming pcrtcTiming{};
	bmsx::GxGpuPcrtcScanout pcrtcScanout{};
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	bmsx::GxGpuPipelineState state{};
	state.width = 4;
	state.height = 1;
	std::fill(software.vram.begin(), software.vram.end(), 0u);
	software.vram[bmsx::gxGpuLocalMemoryAddress16S(4096u, 1u, 0u, 0u)] = 0x001fu;
	software.vram[bmsx::gxGpuLocalMemoryAddress16S(4096u, 1u, 1u, 0u)] = 0x03e0u;
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
	require(pcrtcScanout.circuits[0u].sourcePhaseX == 3u, "GX-GPU PCRTC retains circuit-one absolute source phase");
	requireFramebuffer(framebuffer, std::array<uint32_t, 4u>{ 0x00ff0000u, 0x0000ff00u, 0u, 0u },
		"GX-GPU PCRTC samples circuit one before enabling circuit two");

	pcrtcWords[bmsx::GX_GPU_PCRTC_PMODE_LOW] = circuitOnePmode | bmsx::GX_GPU_PCRTC_PMODE_EN2;
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
	require(pcrtcScanout.circuits[0u].sourcePhaseX == 3u, "GX-GPU PCRTC circuit-two enable does not alter circuit-one source phase");
	requireFramebuffer(framebuffer, std::array<uint32_t, 4u>{ 0u, 0x00ff0000u, 0x0000ff00u, 0u },
		"GX-GPU PCRTC circuit-two enable moves only circuit-one destination placement");

	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY2_LOW] = 676u | (3u << 23u);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
	require(pcrtcScanout.circuits[0u].sourcePhaseX == 3u, "GX-GPU PCRTC circuit-two movement does not alter circuit-one source phase");
	requireFramebuffer(framebuffer, std::array<uint32_t, 4u>{ 0u, 0u, 0x00ff0000u, 0x0000ff00u },
		"GX-GPU PCRTC circuit-two movement preserves circuit-one sampled source words");
}

void testPcrtcReadsSupportedDispFbStorageAndRejectsGpu24OnCircuitTwo() {
	bmsx::GxGpuSoftwareState software(bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes, 1u);
	bmsx::SoftwareBackend backend(1, 1, bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes);
	backend.resizePresentationTarget(1, 1);
	uint32_t* const framebuffer = backend.framebuffer();
	auto pcrtcWords = kSoftwareTestPcrtcWords;
	pcrtcWords[bmsx::GX_GPU_PCRTC_PMODE_LOW] = bmsx::GX_GPU_PCRTC_PMODE_EN2 | bmsx::GX_GPU_PCRTC_PMODE_AMOD;
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB2_LOW] = 1u | (1u << 9u);
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB2_HIGH] = 3u | (2u << 11u);
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY2_LOW] = 0u;
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY2_HIGH] = 0u;
	pcrtcWords[bmsx::GX_GPU_PCRTC_BGCOLOR_LOW] = 0x00332211u;
	bmsx::GxGpuPcrtcTiming pcrtcTiming{};
	bmsx::GxGpuPcrtcScanout pcrtcScanout{};
	bmsx::GxGpuPipelineState state{};
	state.width = 1;
	state.height = 1;
	std::fill(software.vram.begin(), software.vram.end(), 0u);

	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB2_LOW] = 1u | (1u << 9u) | (bmsx::GX_GPU_PSMCT32 << 15u);
	bmsx::u32 address = bmsx::gxGpuLocalMemoryAddress32(4096u, 1u, 3u, 2u);
	software.vram[address] = 0x2211u;
	software.vram[address + 1u] = 0x4433u;
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
	require(framebuffer[0u] == 0x44112233u, "GX-GPU PCRTC PSMCT32 keeps full source alpha");

	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB2_LOW] = 0x1ffu | (32u << 9u) | (bmsx::GX_GPU_PSMCT32 << 15u);
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB2_HIGH] = 1u << 11u;
	address = bmsx::gxGpuLocalMemoryAddress32(0x1ff000u, 32u, 0u, 1u);
	software.vram[address] = 0x6655u;
	software.vram[address + 1u] = 0x8877u;
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
	require(framebuffer[0u] == 0x88556677u, "GX-GPU PCRTC DISPFB address wraps at the physical VRAM word boundary");
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB2_HIGH] = 3u | (2u << 11u);

	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB2_LOW] = 1u | (1u << 9u) | (bmsx::GX_GPU_PSMCT24 << 15u);
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
	require(framebuffer[0u] == 0x80112233u, "GX-GPU PCRTC PSMCT24 supplies GS alpha 0x80");

	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB2_LOW] = 1u | (1u << 9u) | (bmsx::GX_GPU_PSMCT16 << 15u);
	software.vram[bmsx::gxGpuLocalMemoryAddress16(4096u, 1u, 3u, 2u)] = 0x801fu;
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
	require(framebuffer[0u] == 0x80ff0000u, "GX-GPU PCRTC PSMCT16 expands RGB555 and STP alpha");

	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB2_LOW] = 1u | (1u << 9u) | (bmsx::GX_GPU_PSMCT16S << 15u);
	software.vram[bmsx::gxGpuLocalMemoryAddress16S(4096u, 1u, 3u, 2u)] = 0x03e0u;
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
	require(framebuffer[0u] == 0x0000ff00u, "GX-GPU PCRTC PSMCT16S shares the raw RGB555 word datapath");

	pcrtcWords[bmsx::GX_GPU_PCRTC_PMODE_LOW] = bmsx::GX_GPU_PCRTC_PMODE_EN1
		| bmsx::GX_GPU_PCRTC_PMODE_MMOD
		| bmsx::GX_GPU_PCRTC_PMODE_SLBG
		| (0xffu << 8u);
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB1_LOW] = 1u | (1u << 9u) | (bmsx::GX_GPU_PSGPU24 << 15u);
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB1_HIGH] = 3u | (2u << 11u);
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY1_LOW] = 0u;
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY1_HIGH] = 0u;
	software.vram[bmsx::gxGpuLocalMemoryAddressGpu24(4096u, 1u, 3u, 2u, 0u)] = 0x1100u;
	software.vram[bmsx::gxGpuLocalMemoryAddressGpu24(4096u, 1u, 3u, 2u, 1u)] = 0x3322u;
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
	require(framebuffer[0u] == 0x80112233u, "GX-GPU PCRTC circuit one reads PSGPU24 across two PSMCT16 words");

	pcrtcWords[bmsx::GX_GPU_PCRTC_PMODE_LOW] = bmsx::GX_GPU_PCRTC_PMODE_EN2 | bmsx::GX_GPU_PCRTC_PMODE_AMOD;
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB2_LOW] = 1u | (1u << 9u) | (bmsx::GX_GPU_PSGPU24 << 15u);
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
	require(framebuffer[0u] == 0u, "GX-GPU PCRTC circuit two rejects unsupported PSGPU24 storage");

	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB2_LOW] = 1u | (1u << 9u) | (bmsx::GX_GPU_PSMGX16 << 15u);
	software.vram[bmsx::gxGpuLocalMemoryAddressGx16(4096u, 64u, 3u, 2u)] = 0x7c00u;
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
	require(framebuffer[0u] == 0x000000ffu, "GX-GPU PCRTC PSMGX16 reads the native linear framebuffer extension");

	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB2_LOW] = 1u | (1u << 9u) | (3u << 15u);
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
	require(framebuffer[0u] == 0u, "GX-GPU PCRTC unconnected PSM codes produce zero output");

	pcrtcWords[bmsx::GX_GPU_PCRTC_PMODE_LOW] = bmsx::GX_GPU_PCRTC_PMODE_EN2 | bmsx::GX_GPU_PCRTC_PMODE_SLBG | (0x55u << 8u);
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
	require(framebuffer[0u] == 0x00112233u, "GX-GPU PCRTC SLBG selects BGCOLOR with zero output alpha");
}

void testGxGpuLocalMemoryUsesGsPageBlockColumnAndGpu24WordLayouts() {
	require(bmsx::gxGpuLocalMemoryAddress32(0x1000u, 5u, 13u, 9u) == 0x1196u, "GX-GPU PSMCT32 local-memory address vector");
	require(bmsx::gxGpuLocalMemoryAddress16(0x1000u, 5u, 13u, 9u) == 0x1097u, "GX-GPU PSMCT16 local-memory address vector");
	require(bmsx::gxGpuLocalMemoryAddress16S(0x1000u, 5u, 13u, 9u) == 0x1097u, "GX-GPU PSMCT16S local-memory address vector");
	require(bmsx::gxGpuLocalMemoryAddress32(0x1000u, 5u, 63u, 31u) == 0x1ffeu, "GX-GPU PSMCT32 block-edge address vector");
	require(bmsx::gxGpuLocalMemoryAddress16(0x1000u, 5u, 63u, 31u) == 0x17ffu, "GX-GPU PSMCT16 block-edge address vector");
	require(bmsx::gxGpuLocalMemoryAddress16S(0x1000u, 5u, 63u, 31u) == 0x1dffu, "GX-GPU PSMCT16S block-edge address vector");
	require(bmsx::gxGpuLocalMemoryAddress32(0x1000u, 5u, 0u, 32u) == 0x6000u, "GX-GPU PSMCT32 page-row address vector");
	require(bmsx::gxGpuLocalMemoryAddress16(0x1000u, 5u, 0u, 32u) == 0x1800u, "GX-GPU PSMCT16 page-row address vector");
	require(bmsx::gxGpuLocalMemoryAddress16S(0x1000u, 5u, 0u, 32u) == 0x1200u, "GX-GPU PSMCT16S page-row address vector");
	require(std::array<bmsx::u32, 2u>{
		bmsx::gxGpuLocalMemoryAddressGpu24(0u, 1u, 0u, 0u, 0u),
		bmsx::gxGpuLocalMemoryAddressGpu24(0u, 1u, 0u, 0u, 1u),
	} == std::array<bmsx::u32, 2u>{0u, 2u}, "GX-GPU PSGPU24 even pixel uses two PSMCT16 words");
	require(std::array<bmsx::u32, 2u>{
		bmsx::gxGpuLocalMemoryAddressGpu24(0u, 1u, 1u, 0u, 0u),
		bmsx::gxGpuLocalMemoryAddressGpu24(0u, 1u, 1u, 0u, 1u),
	} == std::array<bmsx::u32, 2u>{2u, 8u}, "GX-GPU PSGPU24 odd pixel advances through PSMCT16 storage");
	require(std::array<bmsx::u32, 2u>{
		bmsx::gxGpuLocalMemoryAddressGpu24(0u, 1u, 0u, 1u, 0u),
		bmsx::gxGpuLocalMemoryAddressGpu24(0u, 1u, 0u, 1u, 1u),
	} == std::array<bmsx::u32, 2u>{4u, 6u}, "GX-GPU PSGPU24 preserves the PSMCT16 column layout");
	require(std::array<bmsx::u32, 2u>{
		bmsx::gxGpuLocalMemoryAddressGpu24(0u, 1u, 0u, 64u, 0u),
		bmsx::gxGpuLocalMemoryAddressGpu24(0u, 1u, 0u, 64u, 1u),
	} == std::array<bmsx::u32, 2u>{0x1000u, 0x1002u}, "GX-GPU PSGPU24 advances by a PSMCT16 page row");
	require(std::array<bmsx::u32, 2u>{
		bmsx::gxGpuLocalMemoryAddressGpu24(0x1000u, 5u, 13u, 9u, 0u),
		bmsx::gxGpuLocalMemoryAddressGpu24(0x1000u, 5u, 13u, 9u, 1u),
	} == std::array<bmsx::u32, 2u>{0x118eu, 0x1194u}, "GX-GPU PSGPU24 offsets PSMCT16 words from the framebuffer base");
	require(bmsx::gxGpuLocalMemoryAddress32(0x1ff000u, 32u, 0u, 1u) == 0xff004u, "GX-GPU local-memory word address wraps at physical VRAM");
	require(bmsx::gxGpuLocalMemoryAddressGx16(0xfff00u, 1024u, 900u, 1u) == 0x00684u, "GX-GPU native linear address wraps at physical VRAM");
}

void testPcrtcExecutesMmodAndAmodAgainstFullCircuitAlpha() {
	bmsx::GxGpuSoftwareState software(bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes, 1u);
	bmsx::SoftwareBackend backend(1, 1, bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes);
	backend.resizePresentationTarget(1, 1);
	uint32_t* const framebuffer = backend.framebuffer();
	auto pcrtcWords = kSoftwareTestPcrtcWords;
	pcrtcWords[bmsx::GX_GPU_PCRTC_PMODE_LOW] = bmsx::GX_GPU_PCRTC_PMODE_EN1 | bmsx::GX_GPU_PCRTC_PMODE_EN2;
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB1_LOW] = 1u | (1u << 9u) | (bmsx::GX_GPU_PSMCT32 << 15u);
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB1_HIGH] = 0u;
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY1_LOW] = 0u;
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY1_HIGH] = 0u;
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB2_LOW] = 2u | (1u << 9u) | (bmsx::GX_GPU_PSMCT32 << 15u);
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB2_HIGH] = 0u;
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY2_LOW] = 0u;
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY2_HIGH] = 0u;
	pcrtcWords[bmsx::GX_GPU_PCRTC_BGCOLOR_LOW] = 0u;
	bmsx::GxGpuPcrtcTiming pcrtcTiming{};
	bmsx::GxGpuPcrtcScanout pcrtcScanout{};
	bmsx::GxGpuPipelineState state{};
	state.width = 1;
	state.height = 1;
	std::fill(software.vram.begin(), software.vram.end(), 0u);
	software.vram[4096u] = 0x786eu;
	software.vram[4097u] = 0x4082u;
	software.vram[8192u] = 0x140au;
	software.vram[8193u] = 0x281eu;

	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
	require(framebuffer[0u] == 0x403c4650u, "GX-GPU PCRTC source alpha doubles for RGB while OUT1 keeps raw circuit-one alpha");

	pcrtcWords[bmsx::GX_GPU_PCRTC_PMODE_LOW] |= bmsx::GX_GPU_PCRTC_PMODE_AMOD;
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
	require(framebuffer[0u] == 0x283c4650u, "GX-GPU PCRTC AMOD preserves circuit-two alpha with source-alpha RGB blend");

	pcrtcWords[bmsx::GX_GPU_PCRTC_PMODE_LOW] = bmsx::GX_GPU_PCRTC_PMODE_EN1
		| bmsx::GX_GPU_PCRTC_PMODE_EN2
		| bmsx::GX_GPU_PCRTC_PMODE_MMOD
		| (64u << 8u);
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
	require(framebuffer[0u] == 0x40232d37u, "GX-GPU PCRTC MMOD uses ALP for RGB while OUT1 keeps raw circuit-one alpha");

	pcrtcWords[bmsx::GX_GPU_PCRTC_PMODE_LOW] |= bmsx::GX_GPU_PCRTC_PMODE_AMOD;
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	require(pcrtcScanout.circuits[0u].samplePath == bmsx::GX_GPU_PCRTC_STORAGE_CT32
		&& pcrtcScanout.circuits[1u].samplePath == bmsx::GX_GPU_PCRTC_STORAGE_CT32,
		"GX-GPU PCRTC retains both constant-alpha CT32 sample paths");
	require(pcrtcScanout.circuit1OutputPath == bmsx::GX_GPU_PCRTC_SCANOUT_DRAW_BLEND_CONSTANT_RGB
		&& pcrtcScanout.circuit2OutputPath == bmsx::GX_GPU_PCRTC_SCANOUT_DRAW_RAW_RGBA
		&& pcrtcScanout.compositionPath == bmsx::GX_GPU_PCRTC_COMPOSE_GENERIC,
		"GX-GPU PCRTC retains the fused constant-alpha AMOD output paths");
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
	require(framebuffer[0u] == 0x28232d37u, "GX-GPU PCRTC AMOD preserves circuit-two alpha with constant-alpha RGB blend");
}

void testPcrtcFollowsPmodeUnderlayAndOutputAlphaTruthTable() {
	bmsx::GxGpuSoftwareState software(bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes, 1u);
	bmsx::SoftwareBackend backend(1, 1, bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes);
	backend.resizePresentationTarget(1, 1);
	uint32_t* const framebuffer = backend.framebuffer();
	auto pcrtcWords = kSoftwareTestPcrtcWords;
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB1_LOW] = 1u | (1u << 9u) | (bmsx::GX_GPU_PSMCT32 << 15u);
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB1_HIGH] = 0u;
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY1_LOW] = 0u;
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY1_HIGH] = 0u;
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB2_LOW] = 2u | (1u << 9u) | (bmsx::GX_GPU_PSMCT32 << 15u);
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB2_HIGH] = 0u;
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY2_LOW] = 0u;
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY2_HIGH] = 0u;
	pcrtcWords[bmsx::GX_GPU_PCRTC_BGCOLOR_LOW] = 0x00332211u;
	bmsx::GxGpuPcrtcTiming pcrtcTiming{};
	bmsx::GxGpuPcrtcScanout pcrtcScanout{};
	bmsx::GxGpuPipelineState state{};
	state.width = 1;
	state.height = 1;
	std::fill(software.vram.begin(), software.vram.end(), 0u);
	software.vram[4096u] = 0xbbaau;
	software.vram[4097u] = 0x80ccu;
	software.vram[8192u] = 0x5544u;
	software.vram[8193u] = 0x7766u;

	constexpr std::array<std::array<bmsx::u32, 2u>, 9u> vectors{{
		{{ 0x55u << 8u, 0x00112233u }},
		{{ bmsx::GX_GPU_PCRTC_PMODE_EN2 | (0x55u << 8u), 0x00445566u }},
		{{ bmsx::GX_GPU_PCRTC_PMODE_EN2 | bmsx::GX_GPU_PCRTC_PMODE_SLBG | (0x55u << 8u), 0x00112233u }},
		{{ bmsx::GX_GPU_PCRTC_PMODE_EN2 | bmsx::GX_GPU_PCRTC_PMODE_AMOD | bmsx::GX_GPU_PCRTC_PMODE_SLBG, 0x77112233u }},
		{{ bmsx::GX_GPU_PCRTC_PMODE_EN1 | bmsx::GX_GPU_PCRTC_PMODE_EN2 | bmsx::GX_GPU_PCRTC_PMODE_MMOD | (0xffu << 8u), 0x80aabbccu }},
		{{ bmsx::GX_GPU_PCRTC_PMODE_EN1 | bmsx::GX_GPU_PCRTC_PMODE_EN2 | bmsx::GX_GPU_PCRTC_PMODE_MMOD | bmsx::GX_GPU_PCRTC_PMODE_AMOD | (0xffu << 8u), 0x77aabbccu }},
		{{ bmsx::GX_GPU_PCRTC_PMODE_EN1 | bmsx::GX_GPU_PCRTC_PMODE_EN2 | bmsx::GX_GPU_PCRTC_PMODE_MMOD | bmsx::GX_GPU_PCRTC_PMODE_AMOD | bmsx::GX_GPU_PCRTC_PMODE_SLBG | (0xffu << 8u), 0x77aabbccu }},
		{{ bmsx::GX_GPU_PCRTC_PMODE_EN1, 0x80aabbccu }},
		{{ bmsx::GX_GPU_PCRTC_PMODE_EN1 | bmsx::GX_GPU_PCRTC_PMODE_AMOD | (0x55u << 8u), 0x00aabbccu }},
	}};
	for (const auto& vector : vectors) {
		pcrtcWords[bmsx::GX_GPU_PCRTC_PMODE_LOW] = vector[0u];
		pcrtcTiming.update(pcrtcWords);
		pcrtcScanout.update(pcrtcWords, pcrtcTiming);
		bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
		require(framebuffer[0u] == vector[1u], "GX-GPU PCRTC PMODE truth-table vector");
	}
}

void testSoftwareScanoutWeavesCurrent480iFieldIntoRetainedOutputLines() {
	bmsx::GxGpuSoftwareState software(bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes, 4u);
	bmsx::SoftwareBackend backend(1, 4, bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes);
	backend.resizePresentationTarget(1, 4);
	uint32_t* const framebuffer = backend.framebuffer();
	bmsx::GxGpuPipelineState state{};
	auto pcrtcWords = kSoftwareTestPcrtcWords;
	bmsx::GxGpuPcrtcTiming pcrtcTiming{};
	bmsx::GxGpuPcrtcScanout pcrtcScanout{};
	state.width = 1;
	state.height = 4;
	bmsx::u64 vramReplacementSerial = 1u;
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB1_HIGH] = 1023u | (510u << 11u);
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY1_HIGH] = 3u << 12u;
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	std::fill(software.vram.begin(), software.vram.end(), 0u);
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, vramReplacementSerial);
	pcrtcWords[bmsx::GX_GPU_PCRTC_SMODE2_LOW] = bmsx::GX_GPU_PCRTC_SMODE2_INT | bmsx::GX_GPU_PCRTC_SMODE2_FFMD;
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	require(pcrtcScanout.circuits[0u].samplePath == bmsx::GX_GPU_PCRTC_SAMPLE_LINEAR_GX16,
		"GX-GPU PCRTC retains the linear GX16 sample path");
	require(pcrtcScanout.evenFieldHeight == 2u
		&& pcrtcScanout.oddFieldHeight == 2u
		&& pcrtcScanout.fieldHeight == 2u
		&& pcrtcScanout.fieldOffset == 0u,
		"GX-GPU PCRTC retains even-field output geometry");
	require(pcrtcScanout.circuits[0u].fieldDisplayY == 0u
		&& pcrtcScanout.circuits[0u].fieldDisplayLineStart == 0u
		&& pcrtcScanout.circuits[0u].fieldDisplayLineCount == 2u,
		"GX-GPU PCRTC retains even-field circuit display lines");
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 1023, 510)] = 0x001fu;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 1023, 511)] = 0x7c00u;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 1023, 512)] = 0x03e0u;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 1023, 513)] = 0x7fffu;
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, vramReplacementSerial);

	requireFramebuffer(framebuffer, std::array<uint32_t, 4u>{
		0x00ff0000u,
		0x00000000u,
		0x000000ffu,
		0x00000000u,
	}, "GX-GPU interlaced scanout initially updates only the active physical field");

	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 1023, 510)] = 0x7fffu;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 1023, 511)] = 0x001fu;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 1023, 512)] = 0x7fffu;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 1023, 513)] = 0x03e0u;
	pcrtcScanout.setField(1u);
	require(pcrtcScanout.fieldHeight == 2u && pcrtcScanout.fieldOffset == 2u,
		"GX-GPU PCRTC retains odd-field output geometry");
	require(pcrtcScanout.circuits[0u].fieldDisplayY == 1u
		&& pcrtcScanout.circuits[0u].fieldDisplayLineStart == 0u
		&& pcrtcScanout.circuits[0u].fieldDisplayLineCount == 2u,
		"GX-GPU PCRTC retains odd-field circuit display lines");
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, vramReplacementSerial);

	requireFramebuffer(framebuffer, std::array<uint32_t, 4u>{
		0x00ff0000u,
		0x00ffffffu,
		0x000000ffu,
		0x00ff0000u,
	}, "GX-GPU interlaced scanout retains the previous physical field while updating its counterpart");

	pcrtcScanout.setField(0u);
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, vramReplacementSerial);
	requireFramebuffer(framebuffer, std::array<uint32_t, 4u>{
		0x00ffffffu,
		0x00ffffffu,
		0x00ff0000u,
		0x00ff0000u,
	}, "GX-GPU legacy display-disable does not gate PCRTC field scanout");

	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 1023, 510)] = 0x7c00u;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 1023, 511)] = 0x7fffu;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 1023, 512)] = 0x7fffu;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 1023, 513)] = 0x7c00u;
	pcrtcScanout.setField(1u);
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, vramReplacementSerial);
	requireFramebuffer(framebuffer, std::array<uint32_t, 4u>{
		0x00ffffffu,
		0x000000ffu,
		0x00ff0000u,
		0x00ffffffu,
	}, "GX-GPU ordinary VRAM publication preserves the retained counter-field");

	vramReplacementSerial = 2u;
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, vramReplacementSerial);
	requireFramebuffer(framebuffer, std::array<uint32_t, 4u>{
		0x00000000u,
		0x000000ffu,
		0x00000000u,
		0x00ffffffu,
	}, "GX-GPU raw VRAM replacement clears the retained counter-field");
}

void testSoftwareScanoutMapsFieldPhasesAndFrameRows() {
	bmsx::GxGpuSoftwareState software(bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes, 4u);
	bmsx::SoftwareBackend backend(1, 4, bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes);
	backend.resizePresentationTarget(1, 4);
	uint32_t* const framebuffer = backend.framebuffer();
	bmsx::GxGpuPipelineState state{};
	auto pcrtcWords = kSoftwareTestPcrtcWords;
	bmsx::GxGpuPcrtcTiming pcrtcTiming{};
	bmsx::GxGpuPcrtcScanout pcrtcScanout{};
	state.width = 1;
	state.height = 4;
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB1_HIGH] = 1023u | (510u << 11u);
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY1_HIGH] = 3u << 12u;
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	std::fill(software.vram.begin(), software.vram.end(), 0u);
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
	pcrtcWords[bmsx::GX_GPU_PCRTC_SMODE2_LOW] = bmsx::GX_GPU_PCRTC_SMODE2_INT;
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 1023, 510)] = 0x001fu;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 1023, 511)] = 0x03e0u;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 1023, 512)] = 0x7c00u;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 1023, 513)] = 0x7fffu;
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
	requireFramebuffer(framebuffer, std::array<uint32_t, 4u>{
		0x00ff0000u,
		0x00000000u,
		0x000000ffu,
		0x00000000u,
	}, "GX-GPU FIELD mode maps the even field to even source rows when DY is even");

	pcrtcScanout.setField(1u);
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
	requireFramebuffer(framebuffer, std::array<uint32_t, 4u>{
		0x00ff0000u,
		0x0000ff00u,
		0x000000ffu,
		0x00ffffffu,
	}, "GX-GPU FIELD mode maps the odd field to odd source rows when DY is even");

	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY1_LOW] |= 1u << 12u;
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
	requireFramebuffer(framebuffer, std::array<uint32_t, 4u>{
		0x00ff0000u,
		0x00ff0000u,
		0x000000ffu,
		0x000000ffu,
	}, "GX-GPU FIELD mode reverses source parity for the odd field when DY is odd");

	pcrtcScanout.setField(0u);
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
	requireFramebuffer(framebuffer, std::array<uint32_t, 4u>{
		0x0000ff00u,
		0x00ff0000u,
		0x00ffffffu,
		0x000000ffu,
	}, "GX-GPU FIELD mode reverses source parity for the even field when DY is odd");

	pcrtcWords[bmsx::GX_GPU_PCRTC_SMODE2_LOW] |= bmsx::GX_GPU_PCRTC_SMODE2_FFMD;
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
	pcrtcScanout.setField(1u);
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
	requireFramebuffer(framebuffer, std::array<uint32_t, 4u>{
		0x00ff0000u,
		0x00ff0000u,
		0x0000ff00u,
		0x0000ff00u,
	}, "GX-GPU FRAME mode maps both physical fields through consecutive source rows");
}

void testSoftwareScanoutRetainsFinalEvenLineAtOddInterlacedHeight() {
	bmsx::GxGpuSoftwareState software(bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes, 5u);
	bmsx::SoftwareBackend backend(1, 5, bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes);
	backend.resizePresentationTarget(1, 5);
	uint32_t* const framebuffer = backend.framebuffer();
	auto pcrtcWords = kSoftwareTestPcrtcWords;
	bmsx::GxGpuPcrtcTiming pcrtcTiming{};
	bmsx::GxGpuPcrtcScanout pcrtcScanout{};
	bmsx::GxGpuPipelineState state{};
	state.width = 1;
	state.height = 5;
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB1_HIGH] = 0u;
	pcrtcWords[bmsx::GX_GPU_PCRTC_DISPLAY1_HIGH] = 3u | (4u << 12u);
	pcrtcTiming.update(pcrtcWords);
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	std::fill(software.vram.begin(), software.vram.end(), 0u);
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
	pcrtcWords[bmsx::GX_GPU_PCRTC_SMODE2_LOW] = bmsx::GX_GPU_PCRTC_SMODE2_INT | bmsx::GX_GPU_PCRTC_SMODE2_FFMD;
	pcrtcScanout.update(pcrtcWords, pcrtcTiming);
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 0, 0)] = 0x001fu;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 0, 1)] = 0x03e0u;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 0, 2)] = 0x7c00u;
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
	requireFramebuffer(framebuffer, std::array<uint32_t, 5u>{ 0x00ff0000u, 0u, 0x0000ff00u, 0u, 0x000000ffu },
		"GX-GPU interlaced even field retains its third row at odd output height");

	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 0, 0)] = 0x7fffu;
	software.vram[bmsx::gxGpuSoftwareVramIndex(software, 0, 1)] = 0x001fu;
	pcrtcScanout.setField(1u);
	bmsx::scanoutGxGpuSoftwareVram(software, backend, state, pcrtcScanout, 0u);
	requireFramebuffer(framebuffer, std::array<uint32_t, 5u>{ 0x00ff0000u, 0x00ffffffu, 0x0000ff00u, 0x00ff0000u, 0x000000ffu },
		"GX-GPU interlaced odd field preserves the final retained even line across a snapshot change");
}

void testSoftwareBackendRetiresCommandLogWithoutClearingVram() {
	bmsx::GxGpuCommandBuffer commandBuffer(commandBufferDmaHarness.dma);
	commandBuffer.reset();
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 3>{
			(bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u) | 0x0000ffu,
			0u,
			(1u << 16u) | 1u,
		},
		3u,
		bmsx::GX_GPU_COMMAND_FILL_RECTANGLE,
		bmsx::GX_GPU_GP0_FILL_RECTANGLE);
	SoftwareFrameHarness frame(commandBuffer, commandBuffer.readback);
	bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state, frame.output);
	requireArgbPixel(frame.framebuffer, 0u, 0u, 0x00ff0000u, "GX-GPU software retire test initial red pixel");

	commandBuffer.retireCommandsPreservingVram(commandBuffer.presentCommandCount);
	bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state, frame.output);
	requireArgbPixel(frame.framebuffer, 0u, 0u, 0x00ff0000u, "GX-GPU software retire preserves VRAM");

	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 3>{
			(bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u) | 0x00ff00u,
			16u | (1u << 16u),
			(1u << 16u) | 1u,
		},
		3u,
		bmsx::GX_GPU_COMMAND_FILL_RECTANGLE,
		bmsx::GX_GPU_GP0_FILL_RECTANGLE);
	bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state, frame.output);
	requireArgbPixel(frame.framebuffer, 0u, 0u, 0x00ff0000u, "GX-GPU software retire keeps previous VRAM after new log");
	requireArgbPixel(frame.framebuffer, 16u, 1u, 0x0000ff00u, "GX-GPU software retire executes commands after log reset");

	commandBuffer.reset();
	bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state, frame.output);
	requireArgbPixel(frame.framebuffer, 0u, 0u, 0x00ff0000u, "GX-GPU command-buffer reset preserves backend VRAM red pixel");
	requireArgbPixel(frame.framebuffer, 16u, 1u, 0x0000ff00u, "GX-GPU command-buffer reset preserves backend VRAM green pixel");
}

void testCommandBufferRestoreRepublishesRetainedStream() {
	bmsx::GxGpuCommandBuffer commandBuffer(commandBufferDmaHarness.dma);
	commandBuffer.reset();
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 3>{
			(bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u) | 0x0000ffu,
			0u,
			(1u << 16u) | 1u,
		},
		3u,
		bmsx::GX_GPU_COMMAND_FILL_RECTANGLE,
		bmsx::GX_GPU_GP0_FILL_RECTANGLE);
	const bmsx::GxGpuCommandBufferState state = commandBuffer.captureState();
	const uint32_t commandSerial = commandBuffer.serial;

	commandBuffer.retireCommandsPreservingVram(commandBuffer.presentCommandCount);
	commandBuffer.restoreState(state);

	require(commandBuffer.serial != commandSerial, "GX-GPU command-buffer restore republishes the command stream");
	require(commandBuffer.commandCount == 1u, "GX-GPU command-buffer restore restores command count");
	require(commandBuffer.presentCommandCount == 1u, "GX-GPU command-buffer restore restores sealed count");
}

void testCommandBufferRetireCompactsPresentedCommandStream() {
	bmsx::GxGpuSoftwareState software(bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes, 0u);
	bmsx::GxGpuCommandBuffer commandBuffer(commandBufferDmaHarness.dma);
	commandBuffer.reset();
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 3>{
			(bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u) | 0x0000ffu,
			0u,
			(1u << 16u) | 1u,
		},
		3u,
		bmsx::GX_GPU_COMMAND_FILL_RECTANGLE,
		bmsx::GX_GPU_GP0_FILL_RECTANGLE);
	commandBuffer.retireCommandsPreservingVram(commandBuffer.presentCommandCount);

	std::fill(software.vram.begin(), software.vram.end(), 0u);
	require(commandBuffer.commandCount == 0u, "GX-GPU command-buffer retire removes presented command");
	require(commandBuffer.presentCommandCount == 0u, "GX-GPU command-buffer retire clears present prefix");
	require(bmsx::executeGxGpuSoftwareCommands(software, commandBuffer, 0u, commandBuffer.presentCommandCount) == 0u, "GX-GPU software renderer ignores retired command queue");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 0, 0)] == 0u, "GX-GPU retired command queue leaves fresh software VRAM unchanged");
}

void testCommandBufferRetirePreservesPartialPayloadWords() {
	bmsx::GxGpuCommandBuffer commandBuffer(commandBufferDmaHarness.dma);
	commandBuffer.reset();
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 3>{
			(bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u) | 0x0000ffu,
			0u,
			(1u << 16u) | 1u,
		},
		3u,
		bmsx::GX_GPU_COMMAND_FILL_RECTANGLE,
		bmsx::GX_GPU_GP0_FILL_RECTANGLE);
	commandBuffer.appendWord(0xa0b0c0d0u);

	require(commandBuffer.retireCommandsPreservingVram(commandBuffer.presentCommandCount) == 3u, "GX-GPU command-buffer retire reports sealed command words");
	require(commandBuffer.commandCount == 0u, "GX-GPU command-buffer retire removes sealed command metadata");
	require(commandBuffer.presentCommandCount == 0u, "GX-GPU command-buffer retire clears sealed prefix");
	require(commandBuffer.wordCount == 1u, "GX-GPU command-buffer retire preserves partial payload word");
	require(commandBuffer.words[0] == 0xa0b0c0d0u, "GX-GPU command-buffer retire moves partial payload to the front");
}

void testSoftwareScanoutConsumesSolidPrimitives() {
	bmsx::GxGpuCommandBuffer commandBuffer(commandBufferDmaHarness.dma);
	commandBuffer.reset();
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 4>{
			(bmsx::GX_GPU_GP0_POLYGON_FIRST << 24u) | 0x0000ffu,
			(4u << 16u) | 4u,
			(4u << 16u) | 12u,
			(12u << 16u) | 4u,
		},
		4u,
		bmsx::GX_GPU_COMMAND_DRAW_POLYGON,
		bmsx::GX_GPU_GP0_POLYGON_FIRST);
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 3>{
			(bmsx::GX_GPU_GP0_RECTANGLE_FIRST << 24u) | 0x00ff00u,
			(5u << 16u) | 20u,
			(2u << 16u) | 3u,
		},
		3u,
		bmsx::GX_GPU_COMMAND_DRAW_RECTANGLE,
		bmsx::GX_GPU_GP0_RECTANGLE_FIRST);
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 3>{
			(bmsx::GX_GPU_GP0_LINE_FIRST << 24u) | 0xff0000u,
			(6u << 16u) | 30u,
			(6u << 16u) | 34u,
		},
		3u,
		bmsx::GX_GPU_COMMAND_DRAW_LINE,
		bmsx::GX_GPU_GP0_LINE_FIRST);

	SoftwareFrameHarness frame(commandBuffer, commandBuffer.readback);

	bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state, frame.output);

	requireArgbPixel(frame.framebuffer, 5u, 5u, 0x00ff0000u, "GX-GPU software scanout solid polygon pixel");
	requireArgbPixel(frame.framebuffer, 13u, 13u, 0x00000000u, "GX-GPU software scanout solid polygon background pixel");
	requireArgbPixel(frame.framebuffer, 20u, 5u, 0x0000ff00u, "GX-GPU software scanout solid rectangle left pixel");
	requireArgbPixel(frame.framebuffer, 22u, 6u, 0x0000ff00u, "GX-GPU software scanout solid rectangle right pixel");
	requireArgbPixel(frame.framebuffer, 30u, 6u, 0x000000ffu, "GX-GPU software scanout solid line start pixel");
	requireArgbPixel(frame.framebuffer, 34u, 6u, 0x000000ffu, "GX-GPU software scanout solid line end pixel");
}

void testSoftwareScanoutConsumesTexturedPrimitives() {
	bmsx::GxGpuCommandBuffer commandBuffer(commandBufferDmaHarness.dma);
	commandBuffer.reset();
	pushSoftwareVramUpload(
		commandBuffer,
		64u,
		(1u << 16u) | 2u,
		0x03e0001fu);
	pushSoftwareVramUpload(
		commandBuffer,
		80u,
		(1u << 16u) | 1u,
		0x000003ffu);
	pushSoftwareVramUpload(
		commandBuffer,
		20u << 16u,
		(1u << 16u) | 2u,
		0x7c000000u);
	pushSoftwareVramUpload(
		commandBuffer,
		(1u << 16u) | 64u,
		(1u << 16u) | 1u,
		0x00000001u);
	pushSoftwareVramUpload(
		commandBuffer,
		72u,
		(1u << 16u) | 2u,
		0x03e0001fu);
	pushSoftwareVramUpload(
		commandBuffer,
		(1u << 16u) | 72u,
		(1u << 16u) | 2u,
		0x03ff7c00u);

	constexpr uint8_t rawTexturedRectangleOpcode = bmsx::GX_GPU_GP0_RECTANGLE_FIRST | bmsx::GX_GPU_GP0_RENDER_TEXTURE_BIT | 0x01u;
	constexpr uint32_t direct16PageWord = (bmsx::GX_GPU_TEXTURE_MODE_DIRECT16 << 7u) | 1u;
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 4>{
			(rawTexturedRectangleOpcode << 24u) | 0x808080u,
			(10u << 16u) | 40u,
			0u,
			(1u << 16u) | 2u,
		},
		4u,
		bmsx::GX_GPU_COMMAND_DRAW_RECTANGLE,
		rawTexturedRectangleOpcode,
		direct16PageWord);
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 4>{
			(rawTexturedRectangleOpcode << 24u) | 0x808080u,
			(10u << 16u) | 47u,
			0u,
			(1u << 16u) | 1u,
		},
		4u,
		bmsx::GX_GPU_COMMAND_DRAW_RECTANGLE,
		rawTexturedRectangleOpcode,
		direct16PageWord,
		0x00000802u);
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 4>{
			(rawTexturedRectangleOpcode << 24u) | 0x808080u,
			(10u << 16u) | 45u,
			0x05000100u,
			(1u << 16u) | 1u,
		},
		4u,
		bmsx::GX_GPU_COMMAND_DRAW_RECTANGLE,
		rawTexturedRectangleOpcode,
		1u);
	constexpr uint8_t rawTexturedPolygonOpcode = bmsx::GX_GPU_GP0_POLYGON_FIRST | bmsx::GX_GPU_GP0_RENDER_TEXTURE_BIT | 0x01u;
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 7>{
			(rawTexturedPolygonOpcode << 24u) | 0x808080u,
			(12u << 16u) | 50u,
			0u,
			(12u << 16u) | 52u,
			2u,
			(14u << 16u) | 50u,
			0u,
		},
		7u,
		bmsx::GX_GPU_COMMAND_DRAW_POLYGON,
		rawTexturedPolygonOpcode,
		direct16PageWord);
	constexpr uint8_t rawTexturedQuadOpcode = rawTexturedPolygonOpcode | bmsx::GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT;
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 9>{
			(rawTexturedQuadOpcode << 24u) | 0x808080u,
			(20u << 16u) | 60u,
			8u,
			(20u << 16u) | 62u,
			10u | (direct16PageWord << 16u),
			(22u << 16u) | 60u,
			8u | (2u << 8u),
			(22u << 16u) | 62u,
			10u | (2u << 8u),
		},
		9u,
		bmsx::GX_GPU_COMMAND_DRAW_POLYGON,
		rawTexturedQuadOpcode,
		direct16PageWord);

	SoftwareFrameHarness frame(commandBuffer, commandBuffer.readback);

	bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state, frame.output);

	requireArgbPixel(frame.framebuffer, 40u, 10u, 0x00ff0000u, "GX-GPU software scanout direct16 textured rectangle red pixel");
	requireArgbPixel(frame.framebuffer, 41u, 10u, 0x0000ff00u, "GX-GPU software scanout direct16 textured rectangle green pixel");
	requireArgbPixel(frame.framebuffer, 45u, 10u, 0x000000ffu, "GX-GPU software scanout palette4 textured rectangle blue pixel");
	requireArgbPixel(frame.framebuffer, 47u, 10u, 0x00ffff00u, "GX-GPU software scanout texture-windowed direct16 rectangle yellow pixel");
	requireArgbPixel(frame.framebuffer, 50u, 12u, 0x00ff0000u, "GX-GPU software scanout direct16 textured polygon red pixel");
	requireArgbPixel(frame.framebuffer, 51u, 12u, 0x0000ff00u, "GX-GPU software scanout direct16 textured polygon green pixel");
	requireArgbPixel(frame.framebuffer, 60u, 20u, 0x00ff0000u, "GX-GPU software scanout direct16 textured quad red pixel");
	requireArgbPixel(frame.framebuffer, 61u, 20u, 0x0000ff00u, "GX-GPU software scanout direct16 textured quad green pixel");
	requireArgbPixel(frame.framebuffer, 60u, 21u, 0x000000ffu, "GX-GPU software scanout direct16 textured quad blue pixel");
	requireArgbPixel(frame.framebuffer, 61u, 21u, 0x00ffff00u, "GX-GPU software scanout direct16 textured quad yellow pixel");
}

void testSoftwareCommandsPreserveTextureMaskBlendAndMaskTestStoreSemantics() {
	bmsx::GxGpuSoftwareState software(bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes, 0u);
	bmsx::GxGpuCommandBuffer commandBuffer(commandBufferDmaHarness.dma);
	commandBuffer.reset();
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 5>{
			bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24u,
			64u,
			(1u << 16u) | 3u,
			0x0000801fu,
			0x00007c00u,
		},
		5u,
		bmsx::GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
		bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST);
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 3>{
			(bmsx::GX_GPU_GP0_RECTANGLE_FIRST << 24u) | 0x00ff00u,
			(20u << 16u) | 10u,
			(1u << 16u) | 4u,
		},
		3u,
		bmsx::GX_GPU_COMMAND_DRAW_RECTANGLE,
		bmsx::GX_GPU_GP0_RECTANGLE_FIRST);

	constexpr uint8_t rawTexturedSemiRectangleOpcode = bmsx::GX_GPU_GP0_RECTANGLE_FIRST | bmsx::GX_GPU_GP0_RENDER_TEXTURE_BIT | 0x03u;
	constexpr uint32_t direct16PageWord = (bmsx::GX_GPU_TEXTURE_MODE_DIRECT16 << 7u) | 1u;
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 4>{
			(rawTexturedSemiRectangleOpcode << 24u) | 0x808080u,
			(20u << 16u) | 10u,
			0u,
			(1u << 16u) | 1u,
		},
		4u,
		bmsx::GX_GPU_COMMAND_DRAW_RECTANGLE,
		rawTexturedSemiRectangleOpcode,
		direct16PageWord);
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 4>{
			(rawTexturedSemiRectangleOpcode << 24u) | 0x808080u,
			(20u << 16u) | 11u,
			1u,
			(1u << 16u) | 1u,
		},
		4u,
		bmsx::GX_GPU_COMMAND_DRAW_RECTANGLE,
		rawTexturedSemiRectangleOpcode,
		direct16PageWord);
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 4>{
			(rawTexturedSemiRectangleOpcode << 24u) | 0x808080u,
			(20u << 16u) | 12u,
			2u,
			(1u << 16u) | 1u,
		},
		4u,
		bmsx::GX_GPU_COMMAND_DRAW_RECTANGLE,
		rawTexturedSemiRectangleOpcode,
		direct16PageWord);
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 3>{
			(bmsx::GX_GPU_GP0_RECTANGLE_FIRST << 24u) | 0x0000ffu,
			(20u << 16u) | 13u,
			(1u << 16u) | 1u,
		},
		3u,
		bmsx::GX_GPU_COMMAND_DRAW_RECTANGLE,
		bmsx::GX_GPU_GP0_RECTANGLE_FIRST,
		0u,
		0u,
		0u,
		GX_GPU_SOFTWARE_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD,
		0u,
		1u);
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 3>{
			(bmsx::GX_GPU_GP0_RECTANGLE_FIRST << 24u) | 0x00ff00u,
			(20u << 16u) | 13u,
			(1u << 16u) | 1u,
		},
		3u,
		bmsx::GX_GPU_COMMAND_DRAW_RECTANGLE,
		bmsx::GX_GPU_GP0_RECTANGLE_FIRST,
		0u,
		0u,
		0u,
		GX_GPU_SOFTWARE_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD,
		0u,
		2u);
	pushSoftwareVramUpload(commandBuffer, (30u << 16u) | 10u, (1u << 16u) | 1u, 0x0000fc00u);
	pushSoftwareVramUpload(commandBuffer, (30u << 16u) | 20u, (1u << 16u) | 1u, 0x0000fc00u);
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 3>{
			((bmsx::GX_GPU_GP0_RECTANGLE_FIRST | 0x02u) << 24u) | 0x0000ffu,
			(30u << 16u) | 10u,
			(1u << 16u) | 1u,
		},
		3u,
		bmsx::GX_GPU_COMMAND_DRAW_RECTANGLE,
		bmsx::GX_GPU_GP0_RECTANGLE_FIRST | 0x02u);
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 3>{
			((bmsx::GX_GPU_GP0_RECTANGLE_FIRST | 0x02u) << 24u) | 0x0000ffu,
			(30u << 16u) | 20u,
			(1u << 16u) | 1u,
		},
		3u,
		bmsx::GX_GPU_COMMAND_DRAW_RECTANGLE,
		bmsx::GX_GPU_GP0_RECTANGLE_FIRST | 0x02u,
		0u,
		0u,
		0u,
		GX_GPU_SOFTWARE_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD,
		0u,
		2u);
	std::fill(software.vram.begin(), software.vram.end(), 0u);
	bmsx::executeGxGpuSoftwareCommands(software, commandBuffer, 0u, commandBuffer.presentCommandCount);

	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 10, 20)] == 0x81efu, "GX-GPU software textured semi-transparent pixel blends and preserves texture mask bit");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 11, 20)] == 0x03e0u, "GX-GPU software zero texture pixel does not write");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 12, 20)] == 0x7c00u, "GX-GPU software unmasked textured semi-transparent pixel stores without blending");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 13, 20)] == 0x801fu, "GX-GPU software mask-test blocks writes over masked VRAM");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 10, 30)] == 0x3c0fu, "GX-GPU software semi-transparent solid pixel writes when mask checking is disabled");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 20, 30)] == 0xfc00u, "GX-GPU software semi-transparent solid pixel preserves a checked masked destination");
}

void testSoftwareCommandsSamplePalette8RectangleFlipAndDitheredModulation() {
	bmsx::GxGpuSoftwareState software(bmsx::PSX_MACHINE_SPEC.gxGpuVramBytes, 0u);
	bmsx::GxGpuCommandBuffer commandBuffer(commandBufferDmaHarness.dma);
	commandBuffer.reset();
	pushSoftwareVramUpload(
		commandBuffer,
		(2u << 16u) | 64u,
		(1u << 16u) | 1u,
		0x00000201u);
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 5>{
			bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24u,
			(21u << 16u) | 16u,
			(1u << 16u) | 3u,
			0x03e00000u,
			0x00007c00u,
		},
		5u,
		bmsx::GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM,
		bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST);
	pushSoftwareVramUpload(
		commandBuffer,
		(3u << 16u) | 64u,
		(1u << 16u) | 1u,
		0x00000008u);
	pushSoftwareVramUpload(
		commandBuffer,
		(4u << 16u) | 64u,
		(1u << 16u) | 1u,
		0x0000001fu);
	pushSoftwareVramUpload(
		commandBuffer,
		(4u << 16u) | 319u,
		(1u << 16u) | 1u,
		0x000003e0u);

	constexpr uint8_t rawTexturedRectangleOpcode = bmsx::GX_GPU_GP0_RECTANGLE_FIRST | bmsx::GX_GPU_GP0_RENDER_TEXTURE_BIT | 0x01u;
	constexpr uint32_t palette8FlipPageWord = (bmsx::GX_GPU_TEXTURE_MODE_PALETTE8 << 7u) | bmsx::GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP | 1u;
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 4>{
			(rawTexturedRectangleOpcode << 24u) | 0x808080u,
			(20u << 16u) | 30u,
			(0x0541u << 16u) | (2u << 8u) | 1u,
			(1u << 16u) | 2u,
		},
		4u,
		bmsx::GX_GPU_COMMAND_DRAW_RECTANGLE,
		rawTexturedRectangleOpcode,
		palette8FlipPageWord);
	constexpr uint32_t direct16FlipPageWord = (bmsx::GX_GPU_TEXTURE_MODE_DIRECT16 << 7u) | bmsx::GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP | 1u;
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 4>{
			(rawTexturedRectangleOpcode << 24u) | 0x808080u,
			(20u << 16u) | 40u,
			4u << 8u,
			(1u << 16u) | 2u,
		},
		4u,
		bmsx::GX_GPU_COMMAND_DRAW_RECTANGLE,
		rawTexturedRectangleOpcode,
		direct16FlipPageWord);

	constexpr uint8_t texturedPolygonOpcode = bmsx::GX_GPU_GP0_POLYGON_FIRST | bmsx::GX_GPU_GP0_RENDER_TEXTURE_BIT;
	constexpr uint32_t ditheredDirect16PageWord = (bmsx::GX_GPU_TEXTURE_MODE_DIRECT16 << 7u) | bmsx::GX_GPU_DRAW_MODE_DITHER_ENABLED | 1u;
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 7>{
			(texturedPolygonOpcode << 24u) | 0xffffffu,
			(40u << 16u) | 20u,
			3u << 8u,
			(40u << 16u) | 30u,
			3u << 8u,
			(50u << 16u) | 20u,
			3u << 8u,
		},
		7u,
		bmsx::GX_GPU_COMMAND_DRAW_POLYGON,
		texturedPolygonOpcode,
		ditheredDirect16PageWord);

	std::fill(software.vram.begin(), software.vram.end(), 0u);
	bmsx::executeGxGpuSoftwareCommands(software, commandBuffer, 0u, commandBuffer.presentCommandCount);

	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 30, 20)] == 0x7c00u, "GX-GPU software palette8 flipped rectangle samples high byte CLUT entry first");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 31, 20)] == 0x03e0u, "GX-GPU software palette8 flipped rectangle samples low byte CLUT entry second");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 40, 20)] == 0x001fu, "GX-GPU software flipped direct16 rectangle samples base-zero texel first");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 41, 20)] == 0x03e0u, "GX-GPU software flipped direct16 rectangle wraps base-zero texel backward");
	require(software.vram[bmsx::gxGpuSoftwareVramIndex(software, 22, 41)] == 0x0010u, "GX-GPU software dithered textured polygon modulates with screen-space dither");
}

void testMmioGp0Gp1() {
	GpuHarness harness;
	bmsx::Memory& memory = harness.memory;

	memory.writeMappedU32LE(bmsx::IO_GX_GPU_GP0, 0x12345678u);
	memory.writeMappedU32LE(bmsx::IO_GX_GPU_GP1, (bmsx::GX_GPU_GP1_DISPLAY_MODE << 24u) | 0x00000000u);

	require(memory.readMappedU32LE(bmsx::IO_GX_GPU_GP0) == 0u, "GX-GPU GP0 read returns reset GPUREAD latch");
	require((memory.readMappedU32LE(bmsx::IO_GX_GPU_GP1) & bmsx::GX_GPU_STATUS_READY_TO_RECEIVE_DMA) == bmsx::GX_GPU_STATUS_READY_TO_RECEIVE_DMA, "GX-GPU GP1 GPUSTAT receive-ready bit");
	require((memory.readMappedU32LE(bmsx::IO_GX_GPU_GP1) & bmsx::GX_GPU_STATUS_PAL_MODE) == 0u, "GX-GPU GP1 MMIO GPUSTAT PAL bit");
}

void testPcrtcPublishesRawWordsAndMapsRetainedUserCircuitOneUnderSupervisor() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;
	bmsx::Memory& memory = harness.memory;
	require(bmsx::IO_GX_GTE_PLUS_BASE == 0x08010384u, "GTE+ MMIO base should match the machine map");
	require(bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_PMODE_LOW) == 0x08010354u, "PCRTC PMODE should match the machine map");
	require(bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_DISPFB1_LOW) == 0x0801035cu, "PCRTC DISPFB1 should match the machine map");
	require(bmsx::IO_GX_PCRTC_TIMING_BASE == 0x080103acu, "PCRTC timing registers should follow the GTE+ aperture");
	require(bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_SMODE1_LOW) == bmsx::IO_GX_PCRTC_TIMING_BASE, "PCRTC SMODE1 starts the timing aperture");
	constexpr bmsx::u32 userDispFbLow = 7u | (16u << 9u) | (bmsx::GX_GPU_PSMGX16 << 15u);
	constexpr bmsx::u32 userDispFbHigh = 0x0012389au;
	constexpr bmsx::u32 userDisplayLow = 0x018252a8u;
	constexpr bmsx::u32 userDisplayHigh = 0x000ef4ffu;
	constexpr bmsx::u32 userDispFb2Low = 0x11u | (16u << 9u) | (bmsx::GX_GPU_PSMGX16 << 15u);
	constexpr bmsx::u32 userDispFb2High = 0x00045023u;
	constexpr bmsx::u32 userDisplay2Low = 0x018252a8u;
	constexpr bmsx::u32 userDisplay2High = 0x000ef4ffu;
	constexpr bmsx::u32 userBackground = 0x00563412u;
	memory.writeMappedU32LE(bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_PMODE_LOW), 0x0000ff23u);
	memory.writeMappedU32LE(bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_DISPFB1_LOW), userDispFbLow);
	memory.writeMappedU32LE(bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_DISPFB1_HIGH), userDispFbHigh);
	memory.writeMappedU32LE(bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_DISPLAY1_LOW), userDisplayLow);
	memory.writeMappedU32LE(bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_DISPLAY1_HIGH), userDisplayHigh);
	memory.writeMappedU32LE(bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_DISPFB2_LOW), userDispFb2Low);
	memory.writeMappedU32LE(bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_DISPFB2_HIGH), userDispFb2High);
	memory.writeMappedU32LE(bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_DISPLAY2_LOW), userDisplay2Low);
	memory.writeMappedU32LE(bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_DISPLAY2_HIGH), userDisplay2High);
	memory.writeMappedU32LE(bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_BGCOLOR_LOW), userBackground);

	require(memory.readMappedU32LE(bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_DISPFB1_HIGH)) == userDispFbHigh, "GX-GPU PCRTC MMIO reads the active raw word");
	const auto* output = &gpu.readDeviceOutput();
	require(output->pcrtcWords[bmsx::GX_GPU_PCRTC_PMODE_LOW] == 0u, "GX-GPU PCRTC presents only VBlank-published words");
	require(output->pcrtcScanout.outputWidth == 0u && output->pcrtcScanout.outputHeight == 0u, "GX-GPU PCRTC keeps reset no-scanout state latched before VBlank");
	gpu.presentReadyFrameOnVblankEdge();
	output = &gpu.readDeviceOutput();
	require(output->pcrtcWords[bmsx::GX_GPU_PCRTC_PMODE_LOW] == 0x0000ff23u, "GX-GPU PCRTC publishes the user PMODE word at VBlank");
	require(output->pcrtcScanout.outputActive, "GX-GPU PCRTC publishes active output when a read circuit is enabled");
	require(output->pcrtcScanout.outputWidth == 320u && output->pcrtcScanout.outputHeight == 240u, "GX-GPU PCRTC normalizes the raw signal origin and publishes the native envelope at VBlank");

	gpu.enterSupervisorContext();
	output = &gpu.readDeviceOutput();
	const auto& supervisorWords = output->pcrtcWords;
	require(supervisorWords[bmsx::GX_GPU_PCRTC_PMODE_LOW] == 2u, "GX-GPU supervisor enables the retained game as circuit two");
	require(output->pcrtcScanout.outputWidth == 320u && output->pcrtcScanout.outputHeight == 240u, "GX-GPU PCRTC retains the normalized circuit-two envelope under the supervisor");
	require(supervisorWords[bmsx::GX_GPU_PCRTC_DISPFB2_LOW] == userDispFbLow, "GX-GPU supervisor copies user DISPFB1 low to DISPFB2");
	require(supervisorWords[bmsx::GX_GPU_PCRTC_DISPFB2_HIGH] == userDispFbHigh, "GX-GPU supervisor copies user DISPFB1 high to DISPFB2");
	require(supervisorWords[bmsx::GX_GPU_PCRTC_DISPLAY2_LOW] == userDisplayLow, "GX-GPU supervisor copies user DISPLAY1 low to DISPLAY2");
	require(supervisorWords[bmsx::GX_GPU_PCRTC_DISPLAY2_HIGH] == userDisplayHigh, "GX-GPU supervisor copies user DISPLAY1 high to DISPLAY2");
	require(supervisorWords[bmsx::GX_GPU_PCRTC_DISPFB2_LOW] != userDispFb2Low, "GX-GPU supervisor reserves active circuit two for the circuit-one underlay");
	require(supervisorWords[bmsx::GX_GPU_PCRTC_BGCOLOR_LOW] == userBackground, "GX-GPU supervisor retains the user background word");

	memory.writeMappedU32LE(bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_DISPFB1_LOW), 0xc0u | (16u << 9u) | (bmsx::GX_GPU_PSMGX16 << 15u));
	memory.writeMappedU32LE(bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_DISPFB1_HIGH), 0x001a0300u);
	memory.writeMappedU32LE(bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_DISPLAY1_LOW), 0x018252a8u);
	memory.writeMappedU32LE(bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_DISPLAY1_HIGH), 0x000bf3ffu);
	memory.writeMappedU32LE(bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_PMODE_LOW), 3u);
	gpu.presentReadyFrameOnVblankEdge();
	output = &gpu.readDeviceOutput();
	require(output->pcrtcWords[bmsx::GX_GPU_PCRTC_PMODE_LOW] == 3u, "GX-GPU supervisor publishes both circuits");
	require(output->pcrtcWords[bmsx::GX_GPU_PCRTC_DISPFB2_LOW] == userDispFbLow, "GX-GPU supervisor terminal writes preserve the retained game circuit");
	require(output->pcrtcScanout.outputWidth == 320u && output->pcrtcScanout.outputHeight == 240u, "GX-GPU PCRTC caches the normalized merged envelope");

	gpu.leaveSupervisorContext();
	output = &gpu.readDeviceOutput();
	const auto& restoredWords = output->pcrtcWords;
	require(restoredWords[bmsx::GX_GPU_PCRTC_PMODE_LOW] == 0x0000ff23u, "GX-GPU supervisor exit restores the user PMODE word");
	require(restoredWords[bmsx::GX_GPU_PCRTC_DISPFB1_LOW] == userDispFbLow, "GX-GPU supervisor exit restores user DISPFB1");
	require(restoredWords[bmsx::GX_GPU_PCRTC_DISPFB2_LOW] == userDispFb2Low, "GX-GPU supervisor exit restores user DISPFB2 low");
	require(restoredWords[bmsx::GX_GPU_PCRTC_DISPFB2_HIGH] == userDispFb2High, "GX-GPU supervisor exit restores user DISPFB2 high");
	require(restoredWords[bmsx::GX_GPU_PCRTC_DISPLAY2_LOW] == userDisplay2Low, "GX-GPU supervisor exit restores user DISPLAY2 low");
	require(restoredWords[bmsx::GX_GPU_PCRTC_DISPLAY2_HIGH] == userDisplay2High, "GX-GPU supervisor exit restores user DISPLAY2 high");
	require(output->pcrtcScanout.outputWidth == 320u && output->pcrtcScanout.outputHeight == 240u, "GX-GPU PCRTC restores the normalized user output envelope");
	require(memory.readMappedU32LE(bmsx::gxGpuPcrtcRegisterAddress(bmsx::GX_GPU_PCRTC_DISPLAY1_LOW)) == userDisplayLow, "GX-GPU supervisor exit restores active user DISPLAY1");
}

} // namespace

int main() {
	testPcrtcSintStopsBeamAndReleaseStartsFreshLineEpoch();
	testPcrtcAcceptsCycleZeroAndCoalescesSubCycleFields();
	testPcrtcRetainsFrameBudgetsAboveSignedCpuSlice();
	testPcrtcAdvancesExactRawHalfLinesBeyondDoubleProductPrecision();
	testGp0RawDrawWordDecoders();
	testPcrtcDecodesNativePsxAndPs2OutputResolutions();
	testGp1DisplayModeOwnsPalNtsc();
	testPowerOnVramResetSaveStateAndMachineRecreation();
	testGp1ResetRestoresRegistersAndPreservesAcceptedGpuWork();
	testDisplayModeStatusBits();
	testInterlacedScanoutStatusBits();
	testStateRestorePreservesInterlacedFieldLatches();
	testInterlacedRenderCommandWords();
	testCommandLogIsPresentableOnlyAfterVblankFrameSeal();
	testPartialPresentationSnapshotDoesNotExposeQueuedCommands();
	testRetirePreservesCommandsAppendedAfterSealedVblankSnapshot();
	testDisplayDisableAndDmaDirectionStatusBits();
	testGpustatReadinessTracksGp0PacketAssemblyAndPayloadPhases();
	testCommandTimingGatesGpustatIdleAndVblankExecutionFrontier();
	testGp0IngressBypassesOnlyNopsAndExecutesDrawingStateInFifoOrder();
	testGp1CrtcRangeRegistersLatchMaskedRawWords();
	testGp1UndefinedHighOpcodeDoesNotMirrorReset();
	testGp0IrqRequestAndGp1Acknowledge();
	testPcrtcOwnsLiveCsrImrAndSeparateIrqSource();
	testPcrtcCsrFlushAndResetExecuteOwnerActions();
	testGp0DrawModeAndMaskBitEnvironmentCommands();
	testGp0EnvironmentRegistersAndGpuInfoQueries();
	testGp0FixedLengthRenderAndBlitPacketAssembly();
	testGp0CpuToVramImagePayloadConsumption();
	testSupervisorContextPreservesPartialCpuToVramPacket();
	testGp0PolylineConsumesPayloadUntilTerminator();
	testSaveStateRestoresPartialFixedGp0Command();
	testSaveStateRestoresPartialCpuToVramUpload();
	testSaveStateRestoresPartialPolylineCommand();
	testSaveStateRestoresGouraudPolylineIngressPhase();
	testSaveStateRestoresCommandTimeAndFifoSuffixRelativeToSchedulerTime();
	testGp1ClearCompletesAcceptedDrawsAndCutsC0AtExecutionFrontier();
	testGp1ResetCancelsRestoredActiveC0Deadline();
	testGp1ClearFifoClearsPartialGp0PacketsAndFlushesPartialCpuToVramUploads();
	testSoftwareTextureModulationMath();
	testSoftwarePackedRgb555BlendMath();
	testGpureadFencesBackendWorkAndPacksWrappedOddPixels();
	testGpureadPreservesRowMajorOrderAcrossXAndYWrap();
	testOpenYGateExposesInstalledUpperVramStorage();
	testGpureadQueuesLaterC0BehindActiveFence();
	testGpureadDoesNotClaimC0AppendedAfterPublishedFence();
	testGp1ClearFifoAbortsPendingGpureadWithoutDroppingPriorCommands();
	testGp1ClearFifoAbortsReadyGpureadAndQueuedSuffix();
	testGpureadRestoreRearmsSubmittedAndResetClearsRequest();
	testSoftwareBackendConsumesOnlyPresentableCommands();
	testSoftwareBackendCapturesMidFrameVramAndPublishesItOnce();
	testSoftwareGouraudLineFixedPointRaster();
	testSoftwareLineDdaSampleWrapAndPolylineJoints();
	testSoftwareBlendsUntexturedSemiTransparentRectangles();
	testSoftwareTriangleEdgesAndQuadSeams();
	testSoftwareGouraudTriangleFixedColorPlane();
	testSoftwarePolygonRasterBucketWrap();
	testSoftwareTexturedPolygonFixedUvGradient();
	testSoftwareTextureWindowPageAndClutEdges();
	testSoftwareDrawingAreaOffsetClippingAndRectangleCoordinateWrap();
	testSoftwareFillBypassesDrawingAreaAndMaskBitDrawingState();
	testSoftwareScanoutConsumesTransfersAndFill();
	testSoftwarePresentationCopiesRgbAsOpaquePixels();
	testSoftwareScanoutUsesNativeOutputDimensions();
	testSoftwarePcrtcComposesSourceAlphaTerminalCellsOverRetainedCircuitTwoPixels();
	testPcrtcProjectsDisplaySignalsAndSamplesMagnifiedSource();
	testPcrtcKeepsMixedMagnificationCircuitsOnOneSignalGrid();
	testPcrtcKeepsCircuitSourcePhaseIndependentFromOtherCrop();
	testGxGpuLocalMemoryUsesGsPageBlockColumnAndGpu24WordLayouts();
	testPcrtcReadsSupportedDispFbStorageAndRejectsGpu24OnCircuitTwo();
	testPcrtcExecutesMmodAndAmodAgainstFullCircuitAlpha();
	testPcrtcFollowsPmodeUnderlayAndOutputAlphaTruthTable();
	testSoftwareScanoutWeavesCurrent480iFieldIntoRetainedOutputLines();
	testSoftwareScanoutMapsFieldPhasesAndFrameRows();
	testSoftwareScanoutRetainsFinalEvenLineAtOddInterlacedHeight();
	testSoftwareBackendRetiresCommandLogWithoutClearingVram();
	testCommandBufferRestoreRepublishesRetainedStream();
	testCommandBufferRetireCompactsPresentedCommandStream();
	testCommandBufferRetirePreservesPartialPayloadWords();
	testSoftwareScanoutConsumesSolidPrimitives();
	testSoftwareScanoutConsumesTexturedPrimitives();
	testSoftwareCommandsPreserveTextureMaskBlendAndMaskTestStoreSemantics();
	testSoftwareCommandsSamplePalette8RectangleFlipAndDitheredModulation();
	testMmioGp0Gp1();
	testPcrtcPublishesRawWordsAndMapsRetainedUserCircuitOneUnderSupervisor();
	return 0;
}
