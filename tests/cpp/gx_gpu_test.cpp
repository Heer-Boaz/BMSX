#include "common/endian.h"
#include "machine/devices/gx/gpu.h"
#include "machine/devices/gx/gpu_command_fifo.h"
#include "machine/devices/dma/controller.h"
#include "machine/devices/irq/controller.h"
#include "render/backend/gx_gpu_render_rules.h"
#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/memory/memory.h"
#include "machine/model_registry.h"
#include "machine/scheduler/device.h"
#include "render/backend/backend.h"
#include "render/backend/pass/library.h"
#include "render/backend/software/gx_gpu.h"
#include "render/backend/software/gx_gpu_scanout.h"
#include "render/backend/software/gx_gpu_commands.h"
#include "render/backend/software/gx_gpu_vram.h"

#include <array>
#include <cstdint>
#include <limits>
#include <memory>
#include <stdexcept>

namespace {

struct GpuHarness {
	std::array<uint8_t, 1> emptyRom{{0}};
	bmsx::Memory memory;
	bmsx::IrqController irq;
	bmsx::CPU cpu;
	bmsx::DeviceScheduler scheduler;
	bmsx::DmaController dma;
	bmsx::GxGpu gpu;

	GpuHarness()
		: memory(bmsx::MemoryInit{ { emptyRom.data(), 0u }, { emptyRom.data(), 0u } })
		, irq(memory)
		, cpu(memory, irq)
		, scheduler(cpu)
		, dma(memory, cpu, irq, scheduler)
		, gpu(memory, irq, scheduler, dma) {
		dma.reset();
		gpu.reset();
		irq.reset();
	}
};

struct CommandBufferDmaHarness {
	std::array<uint8_t, 1> emptyRom{{0}};
	bmsx::Memory memory;
	bmsx::IrqController irq;
	bmsx::CPU cpu;
	bmsx::DeviceScheduler scheduler;
	bmsx::DmaController dma;

	CommandBufferDmaHarness()
		: memory(bmsx::MemoryInit{ { emptyRom.data(), 0u }, { emptyRom.data(), 0u } })
		, irq(memory)
		, cpu(memory, irq)
		, scheduler(cpu)
		, dma(memory, cpu, irq, scheduler) {
		dma.reset();
		irq.reset();
	}
};

CommandBufferDmaHarness commandBufferDmaHarness;
bmsx::GxGpuSystemVramPort emptySystemVramPort(commandBufferDmaHarness.memory);

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

void completeGpuCommands(GpuHarness& harness) {
	harness.gpu.onService(std::numeric_limits<bmsx::i64>::max() >> 1u);
}

bmsx::u32 gxGpuVramDigest(const std::array<bmsx::u8, bmsx::GX_GPU_VRAM_BYTE_COUNT>& bytes) {
	bmsx::u32 digest = 0x811c9dc5u;
	for (const bmsx::u8 byte : bytes) {
		digest = (digest ^ byte) * 0x01000193u;
	}
	return digest;
}

void testGp0RawDrawWordDecoders() {
	require(bmsx::gxGpuSigned11(0x000003ffu) == 1023, "GX-GPU signed 11-bit positive coordinate");
	require(bmsx::gxGpuSigned11(0x00000400u) == -1024, "GX-GPU signed 11-bit minimum coordinate");
	require(bmsx::gxGpuSigned11(0x000007ffu) == -1, "GX-GPU signed 11-bit negative coordinate");

	require(bmsx::gxGpuSigned11(0x000007ffu) == -1, "GX-GPU vertex x decode");
	require(bmsx::gxGpuVertexY(0x07ff0000u) == -1, "GX-GPU vertex y decode");
	require(bmsx::gxGpuDisplayStartX(123u | (456u << 10u)) == 123u, "GX-GPU display start x decode");
	require(bmsx::gxGpuDisplayStartY(123u | (456u << 10u)) == 456u, "GX-GPU display start y decode");
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
	require(bmsx::gxGpuVramWrappedHeight(500u, 12u) == 12u, "GX-GPU non-wrapped VRAM height run");
	require(bmsx::gxGpuVramWrappedHeight(511u, 511u) == 1u, "GX-GPU wrapped VRAM height first run");
	require(bmsx::gxGpuVramWrappedHeight(0u, 511u) == 511u, "GX-GPU full-start VRAM height run");
	require(bmsx::gxGpuVramLogicalAreaOverlapsBounds(1008u, 500u, 32u, 24u, 0, 0, 8, 8), "GX-GPU wrapped VRAM area overlaps low corner bounds");
	require(!bmsx::gxGpuVramLogicalAreaOverlapsBounds(1008u, 500u, 32u, 24u, 512, 256, 520, 264), "GX-GPU wrapped VRAM area excludes separated bounds");
	require(bmsx::gxGpuVramCopyNeedsChunking(10u, 20u, 12u, 24u, 32u, 16u), "GX-GPU diagonal overlapping copy chunks");
	require(bmsx::gxGpuVramCopyChunkHeight(20u, 24u, 16u) == 4u, "GX-GPU diagonal overlapping copy chunk height");
	require(!bmsx::gxGpuVramCopyNeedsChunking(10u, 20u, 10u, 24u, 32u, 16u), "GX-GPU vertical-only copy is not chunked");
	require(!bmsx::gxGpuVramCopyNeedsChunking(10u, 20u, 12u, 20u, 32u, 16u), "GX-GPU horizontal-only copy is not chunked");
	require(!bmsx::gxGpuVramCopyNeedsChunking(10u, 20u, 50u, 24u, 32u, 16u), "GX-GPU separated X copy is not chunked");
	require(!bmsx::gxGpuVramCopyNeedsChunking(10u, 20u, 12u, 40u, 32u, 16u), "GX-GPU separated Y copy is not chunked");
	require(bmsx::gxGpuVramCopyChunkHeight(20u, 80u, 16u) == 16u, "GX-GPU non-overlapping row distance clamps to height");
	std::array<bmsx::i64, 2u * bmsx::GX_GPU_TRIANGLE_ATTRIBUTE_PLANE_PHASES> uvPlane{1, 2, 17, 2, 1, 18};
	std::array<bmsx::f32, 33u> uvInterpolants{};
	uvInterpolants[10] = 1.0f;
	uvInterpolants[21] = 1.0f;
	uvInterpolants[32] = 1.0f;
	bmsx::gxGpuTriangleAttributePlane(uvPlane.data(), 0u, 2u, 256, 0, 0, 16, 0, 0, 16);
	bmsx::gxGpuTriangleAttributePlaneInterpolants(uvInterpolants.data(), 0u, 11u, uvPlane.data(), 2u, 0, 0, 16, 0, 0, 16);
	require((bmsx::gxGpuTriangleAttributePlaneInterpolantValue(uvInterpolants.data(), 0u, 2u) >> bmsx::GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS) == 1u, "GX-GPU fixed attribute first vertex decode");
	require((bmsx::gxGpuTriangleAttributePlaneInterpolantValue(uvInterpolants.data(), 11u, 2u) >> bmsx::GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS) == 17u, "GX-GPU fixed attribute second vertex decode");
	require((bmsx::gxGpuTriangleAttributePlaneInterpolantValue(uvInterpolants.data(), 23u, 2u) >> bmsx::GX_GPU_TRIANGLE_ATTRIBUTE_FRACTION_BITS) == 18u, "GX-GPU fixed attribute third vertex decode");
	require(uvInterpolants[10] == 1.0f, "GX-GPU attribute digits preserve first enable slot");
	require(uvInterpolants[21] == 1.0f, "GX-GPU attribute digits preserve second enable slot");
	require(uvInterpolants[6] == 1.0f, "GX-GPU attribute plane keeps origin U digit");
	require(uvInterpolants[17] == 17.0f, "GX-GPU attribute plane carries X gradient through digit 3");
	require(uvInterpolants[29] == 18.0f, "GX-GPU attribute plane carries Y gradient through digit 3");

	require(bmsx::gxGpuTransferX(0x01ff03ffu) == 1023u, "GX-GPU transfer x decode");
	require(bmsx::gxGpuTransferY(0x01ff03ffu) == 511u, "GX-GPU transfer y decode");
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
	require(bmsx::gxGpuCommandDrawsTexture(0x24u, 0u), "GX-GPU textured opcode draws texture");
	require(!bmsx::gxGpuCommandDrawsTexture(0x24u, bmsx::GX_GPU_DRAW_MODE_TEXTURE_DISABLE), "GX-GPU texture-disable stops texture sampling");
	require(!bmsx::gxGpuCommandDrawsTexture(0x20u, 0u), "GX-GPU untextured opcode does not draw texture");
	require(bmsx::gxGpuDrawModeTextureDisableEnabled(bmsx::GX_GPU_DRAW_MODE_TEXTURE_DISABLE), "GX-GPU texture-disable bit enabled");
	require(!bmsx::gxGpuDrawModeTextureDisableEnabled(0u), "GX-GPU texture-disable bit disabled");
	require(bmsx::gxGpuDrawModeDitherEnabled(bmsx::GX_GPU_DRAW_MODE_DITHER_ENABLED), "GX-GPU dither bit enabled");
	require(!bmsx::gxGpuDrawModeDitherEnabled(0u), "GX-GPU dither bit disabled");
	require(bmsx::gxGpuDitheredPolygon(bmsx::GX_GPU_DRAW_MODE_DITHER_ENABLED, bmsx::GX_GPU_GP0_POLYGON_FIRST | bmsx::GX_GPU_GP0_RENDER_GOURAUD_BIT), "GX-GPU Gouraud polygon dithered");
	require(!bmsx::gxGpuDitheredPolygon(bmsx::GX_GPU_DRAW_MODE_DITHER_ENABLED, bmsx::GX_GPU_GP0_POLYGON_FIRST), "GX-GPU flat untextured polygon not dithered");
	require(bmsx::gxGpuDitheredPolygon(bmsx::GX_GPU_DRAW_MODE_DITHER_ENABLED, bmsx::GX_GPU_GP0_POLYGON_FIRST | bmsx::GX_GPU_GP0_RENDER_TEXTURE_BIT), "GX-GPU blended textured polygon dithered");
	require(!bmsx::gxGpuDitheredPolygon(bmsx::GX_GPU_DRAW_MODE_DITHER_ENABLED | bmsx::GX_GPU_DRAW_MODE_TEXTURE_DISABLE, bmsx::GX_GPU_GP0_POLYGON_FIRST | bmsx::GX_GPU_GP0_RENDER_TEXTURE_BIT), "GX-GPU texture-disabled flat polygon not dithered");
	require(bmsx::gxGpuDitheredPolygon(bmsx::GX_GPU_DRAW_MODE_DITHER_ENABLED | bmsx::GX_GPU_DRAW_MODE_TEXTURE_DISABLE, bmsx::GX_GPU_GP0_POLYGON_FIRST | bmsx::GX_GPU_GP0_RENDER_TEXTURE_BIT | bmsx::GX_GPU_GP0_RENDER_GOURAUD_BIT), "GX-GPU texture-disabled Gouraud polygon dithered");
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
	require(bmsx::gxGpuTextureClutBaseY(0x01c3ab56u) == 7u, "GX-GPU CLUT Y base decode");
	require(bmsx::gxGpuDrawModeTexturePageBaseX(0x0013u) == 192u, "GX-GPU texture page X base decode");
	require(bmsx::gxGpuDrawModeTexturePageBaseY(0x0013u) == 256u, "GX-GPU texture page Y base decode");
	require(bmsx::gxGpuDrawModeTexturePageBaseY(0x0810u) == 256u, "GX-GPU texture page Y base ignores texture-disable bit");
	require(bmsx::gxGpuDrawModeTextureMode(0x0100u) == bmsx::GX_GPU_TEXTURE_MODE_DIRECT16, "GX-GPU texture mode decode");
	require(bmsx::gxGpuDrawModeTransparencyMode(0x0060u) == 3u, "GX-GPU transparency mode decode");
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
	require(bmsx::gxGpuDrawingAreaTop(12u | (34u << 10u), 20u | (40u << 10u)) == 34u, "GX-GPU drawing area top");
	require(bmsx::gxGpuDrawingAreaRightExclusive(12u | (34u << 10u), 20u | (40u << 10u)) == 21u, "GX-GPU drawing area right exclusive");
	require(bmsx::gxGpuDrawingAreaBottomExclusive(12u | (34u << 10u), 20u | (40u << 10u)) == 41u, "GX-GPU drawing area bottom exclusive");
	require(bmsx::gxGpuDrawingAreaLeft(20u | (34u << 10u), 12u | (40u << 10u)) == 0u, "GX-GPU invalid drawing area left");
	require(bmsx::gxGpuDrawingAreaRightExclusive(20u | (34u << 10u), 12u | (40u << 10u)) == 0u, "GX-GPU invalid drawing area right");
	require(bmsx::gxGpuDrawingAreaTop(12u | (40u << 10u), 20u | (34u << 10u)) == 0u, "GX-GPU invalid drawing area top");
	require(bmsx::gxGpuDrawingAreaBottomExclusive(12u | (40u << 10u), 20u | (34u << 10u)) == 0u, "GX-GPU invalid drawing area bottom");
	require(bmsx::gxGpuDrawingAreaTop(12u | (600u << 10u), 20u | (700u << 10u)) == 511u, "GX-GPU drawing area top clamps to VRAM");
	require(bmsx::gxGpuDrawingAreaBottomExclusive(12u | (600u << 10u), 20u | (700u << 10u)) == 512u, "GX-GPU drawing area bottom clamps to VRAM");
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
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;
	const bmsx::GxGpuCommandBuffer& commandBuffer = gpu.readDeviceOutput().commandBuffer;
	const uint32_t commandSerial = commandBuffer.serial;
	const bmsx::u64 vramSnapshotSerial = gpu.readVramSnapshotSerial();

	gpu.writeGp1((bmsx::GX_GPU_GP1_ALLOW_TEXTURE_DISABLE << 24u) | 1u);
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
	require(gpu.readTextureDisableAllowedWord() == 1u, "GX-GPU GP1 reset preserves texture-disable allowance");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_TEXTURE_DISABLE) == 0u, "GX-GPU GP1 reset clears texture-disable status bit");
	require(gpu.readDisplayModeWord() == bmsx::GX_GPU_RESET_DISPLAY_MODE_WORD, "GX-GPU GP1 reset display mode");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_PAL_MODE) == bmsx::GX_GPU_STATUS_PAL_MODE, "GX-GPU GP1 reset PAL bit");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_RESET_WORD) == (bmsx::GX_GPU_STATUS_RESET_WORD & ~bmsx::GX_GPU_STATUS_GPU_IDLE), "GX-GPU GP1 reset base bits preserve accepted execution");
	completeGpuCommands(harness);
	gpu.presentReadyFrameOnVblankEdge();
	bmsx::g_gxGpuSoftwareVram.fill(0u);
	require(bmsx::executeGxGpuSoftwareCommands(commandBuffer, 0u) == 2u, "GX-GPU GP1 reset publishes accepted pre-reset work");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(0, 0)] == 0x001fu, "GX-GPU GP1 reset preserves accepted fill");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(32, 0)] == 0x001fu, "GX-GPU GP1 reset preserves first received upload pixel");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(33, 0)] == 0x03e0u, "GX-GPU GP1 reset preserves second received upload pixel");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(34, 0)] == 0u, "GX-GPU GP1 reset does not invent missing upload payload");

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
	const uint32_t statusBits = bmsx::GX_GPU_STATUS_REVERSE_FLAG
		| bmsx::GX_GPU_STATUS_HORIZONTAL_RESOLUTION_2
		| bmsx::GX_GPU_STATUS_VERTICAL_RESOLUTION
		| bmsx::GX_GPU_STATUS_PAL_MODE
		| bmsx::GX_GPU_STATUS_DISPLAY_AREA_COLOR_DEPTH_24
		| bmsx::GX_GPU_STATUS_VERTICAL_INTERLACE;
	require((gpu.readStatus() & statusBits) == statusBits, "GX-GPU display mode GPUSTAT single-bit fields");
	require((gpu.readStatus() & (0x3u << 17u)) == (0x3u << 17u), "GX-GPU display mode GPUSTAT horizontal resolution");
}

void testInterlacedScanoutStatusBits() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;

	gpu.writeGp1((bmsx::GX_GPU_GP1_DISPLAY_MODE << 24u) | 0x00000000u);
	gpu.setScanoutTiming(false, 0, 100, 10);
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_DISPLAY_LINE_LSB) == 0u, "GX-GPU scanout starts on even line");

	harness.scheduler.advanceTo(30);
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_DISPLAY_LINE_LSB) == bmsx::GX_GPU_STATUS_DISPLAY_LINE_LSB, "GX-GPU GPUSTAT line LSB follows current scanline");

	gpu.writeGp1((bmsx::GX_GPU_GP1_DISPLAY_START << 24u) | (7u << 10u));
	gpu.writeGp1((bmsx::GX_GPU_GP1_DISPLAY_MODE << 24u) | 0x00000024u);
	gpu.presentReadyFrameOnVblankEdge();
	gpu.setScanoutTiming(true, 90, 100, 10);
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_DISPLAY_LINE_LSB) == bmsx::GX_GPU_STATUS_DISPLAY_LINE_LSB, "GX-GPU 480i vblank display line bit uses display start");
	gpu.setScanoutTiming(false, 0, 100, 10);
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_INTERLACED_FIELD) == 0u, "GX-GPU GPUSTAT interlaced field toggles on next frame");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_DISPLAY_LINE_LSB) == 0u, "GX-GPU 480i active display line bit follows display field");
	gpu.presentReadyFrameOnVblankEdge();
	require(gpu.lastFrameCommitted(), "GX-GPU field-only transition commits a presentation frame");
}

void testStateRestorePreservesInterlacedFieldLatches() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;
	const bmsx::GxGpuCommandBuffer& commands = gpu.readDeviceOutput().commandBuffer;
	constexpr uint32_t scanoutMask = bmsx::GX_GPU_STATUS_INTERLACED_FIELD | bmsx::GX_GPU_STATUS_DISPLAY_LINE_LSB;

	gpu.writeGp1((bmsx::GX_GPU_GP1_DISPLAY_START << 24u) | (7u << 10u));
	gpu.writeGp1((bmsx::GX_GPU_GP1_DISPLAY_MODE << 24u) | 0x00000024u);
	gpu.setScanoutTiming(true, 90, 100, 10);
	gpu.setScanoutTiming(false, 0, 100, 10);
	const bmsx::GxGpuState saved = gpu.captureState();
	require((gpu.readStatus() & scanoutMask) == 0u, "GX-GPU captured interlaced field phase");

	gpu.setScanoutTiming(true, 90, 100, 10);
	gpu.setScanoutTiming(false, 0, 100, 10);
	require((gpu.readStatus() & scanoutMask) == scanoutMask, "GX-GPU interlaced field phase mutates before restore");

	gpu.restoreState(saved);
	gpu.writeGp0((bmsx::GX_GPU_GP0_POLYGON_FIRST << 24u) | 0x00010203u);
	gpu.writeGp0(0u);
	gpu.writeGp0(1u);
	gpu.writeGp0(2u);
	require(commands.commandInterlacedRenderWord[0] == bmsx::GX_GPU_INTERLACED_RENDER_ENABLE, "GX-GPU restored active line parity tags the next draw");
	require((gpu.readStatus() & scanoutMask) == 0u, "GX-GPU restore reinstates interlaced status phase");
}

void testInterlacedRenderCommandWords() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;
	const bmsx::GxGpuCommandBuffer& commands = gpu.readDeviceOutput().commandBuffer;

	require(bmsx::gxGpuSkipDrawingToActiveField(bmsx::GX_GPU_STATUS_VERTICAL_RESOLUTION | bmsx::GX_GPU_STATUS_VERTICAL_INTERLACE), "GX-GPU detects PSX skip-active-field mode");
	require(!bmsx::gxGpuSkipDrawingToActiveField(bmsx::GX_GPU_STATUS_VERTICAL_RESOLUTION | bmsx::GX_GPU_STATUS_VERTICAL_INTERLACE | (1u << 10u)), "GX-GPU displayed-field draw bit disables skip-active-field mode");
	require(bmsx::gxGpuInterlacedRenderWord(bmsx::GX_GPU_STATUS_VERTICAL_RESOLUTION | bmsx::GX_GPU_STATUS_VERTICAL_INTERLACE, 1u) == (bmsx::GX_GPU_INTERLACED_RENDER_ENABLE | bmsx::GX_GPU_INTERLACED_RENDER_ACTIVE_LINE_LSB), "GX-GPU interlaced render word carries active line LSB");
	require(bmsx::gxGpuInterlacedRenderWord(bmsx::GX_GPU_STATUS_VERTICAL_RESOLUTION | bmsx::GX_GPU_STATUS_VERTICAL_INTERLACE | (1u << 10u), 1u) == 0u, "GX-GPU interlaced render word clears when both fields are drawable");

	gpu.writeGp1((bmsx::GX_GPU_GP1_DISPLAY_START << 24u) | (7u << 10u));
	gpu.writeGp1((bmsx::GX_GPU_GP1_DISPLAY_MODE << 24u) | 0x00000024u);
	gpu.writeGp0((bmsx::GX_GPU_GP0_POLYGON_FIRST << 24u) | 0x00010203u);
	gpu.writeGp0(0x00000000u);
	gpu.writeGp0(0x00000001u);
	gpu.writeGp0(0x00000002u);

	require(commands.commandCount == 1u, "GX-GPU records first interlaced polygon command");
	require(commands.commandInterlacedRenderWord[0] == (bmsx::GX_GPU_INTERLACED_RENDER_ENABLE | bmsx::GX_GPU_INTERLACED_RENDER_ACTIVE_LINE_LSB), "GX-GPU command captures interlaced active line");
	completeGpuCommands(harness);

	gpu.writeGp0((bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | (1u << 10u));
	gpu.writeGp0((bmsx::GX_GPU_GP0_POLYGON_FIRST << 24u) | 0x00010203u);
	gpu.writeGp0(0x00000000u);
	gpu.writeGp0(0x00000001u);
	gpu.writeGp0(0x00000002u);
	completeGpuCommands(harness);

	require(commands.commandCount == 2u, "GX-GPU records second interlaced polygon command");
	require(commands.commandInterlacedRenderWord[1] == 0u, "GX-GPU command clears interlaced active-line discard when drawing to displayed field");
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
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;

	gpu.writeGp0((bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u) | 0x0000ffu);
	gpu.writeGp0(0u);
	gpu.writeGp0((1u << 16u) | 1u);

	const bmsx::GxGpuDeviceOutput& output = gpu.readDeviceOutput();
	const bmsx::GxGpuCommandBuffer& commands = output.commandBuffer;
	require(commands.commandCount == 1u, "GX-GPU partial presentation snapshot keeps queued command");
	require(commands.presentCommandCount == 0u, "GX-GPU partial presentation snapshot exposes no presentable command");

	bmsx::g_gxGpuSoftwareVram.fill(0u);
	require(bmsx::executeGxGpuSoftwareCommands(commands, 0u) == 0u, "GX-GPU software renderer ignores partial presentation command queue");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(0, 0)] == 0u, "GX-GPU software VRAM is unchanged by partial presentation");
	require(commands.commandCount == 1u, "GX-GPU partial presentation does not retire queued command");
	require(commands.presentCommandCount == 0u, "GX-GPU partial presentation does not publish queued command");

	completeGpuCommands(harness);
	gpu.presentReadyFrameOnVblankEdge();
	require(bmsx::executeGxGpuSoftwareCommands(commands, 0u) == 1u, "GX-GPU software renderer consumes committed presentation command");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(0, 0)] == 0x001fu, "GX-GPU software VRAM receives committed presentation fill");

	gpu.retirePresentedCommands();
	require(commands.commandCount == 0u, "GX-GPU committed presentation retires from the live queue");
	require(commands.presentCommandCount == 0u, "GX-GPU committed presentation clears sealed prefix");
}

void testRetirePreservesCommandsAppendedAfterSealedVblankSnapshot() {
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

	bmsx::g_gxGpuSoftwareVram.fill(0u);
	require(bmsx::executeGxGpuSoftwareCommands(commands, 0u) == 1u, "GX-GPU software renderer consumes only the sealed command prefix");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(0, 0)] == 0x001fu, "GX-GPU software VRAM receives sealed fill");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(32, 0)] == 0u, "GX-GPU software VRAM ignores post-seal command before next VBLANK");

	gpu.retirePresentedCommands();
	require(commands.commandCount == 1u, "GX-GPU retire preserves post-seal command");
	require(commands.presentCommandCount == 0u, "GX-GPU retire clears sealed prefix");
	completeGpuCommands(harness);
	gpu.presentReadyFrameOnVblankEdge();
	require(bmsx::executeGxGpuSoftwareCommands(commands, 0u) == 1u, "GX-GPU software renderer consumes preserved command after next VBLANK");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(32, 0)] == 0x03e0u, "GX-GPU software VRAM receives preserved next-frame fill");
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
	require((status & bmsx::GX_GPU_STATUS_READY_TO_RECEIVE_DMA) == bmsx::GX_GPU_STATUS_READY_TO_RECEIVE_DMA, "GX-GPU GPUSTAT partial packet remains receive-ready");
	require((status & bmsx::GX_GPU_STATUS_READY_TO_SEND_VRAM) == 0u, "GX-GPU GPUSTAT partial packet is not send-ready");
	require((status & bmsx::GX_GPU_STATUS_DMA_DATA_REQUEST) == bmsx::GX_GPU_STATUS_DMA_DATA_REQUEST, "GX-GPU GPUSTAT CPU-to-GP0 DMA request follows receive-ready partial packet");

	gpu.writeGp1((bmsx::GX_GPU_GP1_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_GPUREAD_TO_CPU);
	status = gpu.readStatus();
	require((status & bmsx::GX_GPU_STATUS_DMA_DATA_REQUEST) == 0u, "GX-GPU GPUSTAT GPUREAD DMA request stays clear without readback data");

	gpu.writeGp0(0x00000000u);
	gpu.writeGp0(0x00000001u);
	gpu.writeGp0(0x00000002u);
	gpu.writeGp1((bmsx::GX_GPU_GP1_DMA_DIRECTION << 24u) | bmsx::GX_GPU_DMA_DIRECTION_FIFO);
	gpu.writeGp0(0x00000000u);
	status = gpu.readStatus();
	require((status & bmsx::GX_GPU_STATUS_GPU_IDLE) == 0u, "GX-GPU GPUSTAT fixed packet remains busy during execution");
	require((status & bmsx::GX_GPU_STATUS_READY_TO_RECEIVE_DMA) == 0u, "GX-GPU complete queued packet lowers receive readiness");
	require((status & bmsx::GX_GPU_STATUS_DMA_DATA_REQUEST) == 0u, "GX-GPU FIFO request follows receive readiness");
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

	gpu.writeGp0(((bmsx::GX_GPU_GP0_LINE_FIRST | bmsx::GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT) << 24u) | 0x0000ffu);
	gpu.writeGp0(0x00010002u);
	gpu.writeGp0(0x00020003u);
	status = gpu.readStatus();
	require((status & bmsx::GX_GPU_STATUS_GPU_IDLE) == 0u, "GX-GPU GPUSTAT polyline waits for terminator");
	gpu.writeGp0(0x50005000u);
	status = gpu.readStatus();
	require((status & bmsx::GX_GPU_STATUS_GPU_IDLE) == 0u, "GX-GPU GPUSTAT polyline remains busy during execution");
	require(commands.commandCount == 3u, "GX-GPU polyline command emitted");
	completeGpuCommands(harness);
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_GPU_IDLE) == bmsx::GX_GPU_STATUS_GPU_IDLE, "GX-GPU polyline reaches idle at completion");

	gpu.writeGp0(bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u);
	status = gpu.readStatus();
	require((status & bmsx::GX_GPU_STATUS_GPU_IDLE) == 0u, "GX-GPU GPUSTAT partial fill packet is not idle");
	gpu.writeGp1(bmsx::GX_GPU_GP1_CLEAR_FIFO << 24u);
	status = gpu.readStatus();
	require((status & bmsx::GX_GPU_STATUS_GPU_IDLE) == bmsx::GX_GPU_STATUS_GPU_IDLE, "GX-GPU GP1 clear FIFO restores idle readiness");
}

void testCommandTimingGatesGpustatIdleAndVblankExecutionFrontier() {
	GpuHarness harness;
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

void testGp0MmioWriteReadyTracksFifoCapacity() {
	GpuHarness harness;

	harness.gpu.writeGp0((bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u) | 0x0000ffu);
	harness.gpu.writeGp0(0u);
	harness.gpu.writeGp0((1u << 16u) | 1u);
	for (size_t index = 0u; index < bmsx::GX_GPU_COMMAND_FIFO_WORD_CAPACITY; index += 1u) {
		harness.gpu.writeGp0((bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | static_cast<uint32_t>(index));
	}

	require(!harness.memory.mappedWriteReady(bmsx::IO_GX_GPU_GP0), "GX-GPU lowers GP0 MMIO write-ready at FIFO capacity");
	harness.scheduler.advanceTo(29);
	harness.gpu.onService(29);
	require(harness.memory.mappedWriteReady(bmsx::IO_GX_GPU_GP0), "GX-GPU raises GP0 MMIO write-ready at command completion");
}

void testGp1CrtcRangeRegistersLatchMaskedRawWords() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;

	gpu.writeGp1((bmsx::GX_GPU_GP1_DISPLAY_START << 24u) | 0x00000001u);
	require(gpu.readDisplayStartWord() == 0u, "GX-GPU GP1 display start forces even address");
	gpu.writeGp1((bmsx::GX_GPU_GP1_DISPLAY_START << 24u) | 0x00ffffffu);
	gpu.writeGp1((bmsx::GX_GPU_GP1_HORIZONTAL_DISPLAY_RANGE << 24u) | 0x00ffffffu);
	gpu.writeGp1((bmsx::GX_GPU_GP1_VERTICAL_DISPLAY_RANGE << 24u) | 0x00ffffffu);
	gpu.writeGp1((bmsx::GX_GPU_GP1_ALLOW_TEXTURE_DISABLE << 24u) | 0x00ffffffu);

	require(gpu.readDisplayStartWord() == bmsx::GX_GPU_DISPLAY_START_MASK, "GX-GPU GP1 display start mask");
	require(gpu.readHorizontalDisplayRangeWord() == bmsx::GX_GPU_HORIZONTAL_DISPLAY_RANGE_MASK, "GX-GPU GP1 horizontal display range mask");
	require(gpu.readVerticalDisplayRangeWord() == bmsx::GX_GPU_VERTICAL_DISPLAY_RANGE_MASK, "GX-GPU GP1 vertical display range mask");
	require(gpu.readTextureDisableAllowedWord() == 1u, "GX-GPU GP1 texture-disable allowance latch");

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

void testGp0DrawModeAndMaskBitEnvironmentCommands() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;

	gpu.writeGp0((bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | 0x00ffffffu);
	completeGpuCommands(harness);

	require(gpu.readDrawModeWord() == (bmsx::GX_GPU_DRAW_MODE_MASK & ~bmsx::GX_GPU_DRAW_MODE_TEXTURE_DISABLE), "GX-GPU GP0 draw-mode ignores texture-disable before GP1 allow");
	require((gpu.readStatus() & bmsx::GX_GPU_DRAW_MODE_GPUSTAT_MASK) == bmsx::GX_GPU_DRAW_MODE_GPUSTAT_MASK, "GX-GPU GP0 draw-mode GPUSTAT bits");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_TEXTURE_DISABLE) == 0u, "GX-GPU GP0 texture-disable ignored before GP1 allow");
	require((gpu.readDrawModeWord() & bmsx::GX_GPU_DRAW_MODE_DITHER_ENABLED) == bmsx::GX_GPU_DRAW_MODE_DITHER_ENABLED, "GX-GPU GP0 dither source bit");
	require((gpu.readDrawModeWord() & bmsx::GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP) == bmsx::GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP, "GX-GPU GP0 textured rectangle X flip source bit");
	require((gpu.readDrawModeWord() & bmsx::GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_Y_FLIP) == bmsx::GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_Y_FLIP, "GX-GPU GP0 textured rectangle Y flip source bit");

	gpu.writeGp1((bmsx::GX_GPU_GP1_ALLOW_TEXTURE_DISABLE << 24u) | 1u);
	require(gpu.readTextureDisableAllowedWord() == 1u, "GX-GPU GP1 texture-disable allowance raw word");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_TEXTURE_DISABLE) == 0u, "GX-GPU GP1 texture-disable allowance does not set GPUSTAT by itself");
	gpu.writeGp0((bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | 0x00ffffffu);
	completeGpuCommands(harness);
	require(gpu.readDrawModeWord() == bmsx::GX_GPU_DRAW_MODE_MASK, "GX-GPU GP0 draw-mode accepts texture-disable after GP1 allow");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_TEXTURE_DISABLE) == bmsx::GX_GPU_STATUS_TEXTURE_DISABLE, "GX-GPU GP0 texture-disable mirrors to GPUSTAT when allowed");

	gpu.writeGp0((bmsx::GX_GPU_GP0_MASK_BIT << 24u) | 0x00000003u);
	completeGpuCommands(harness);
	require(gpu.readMaskBitModeWord() == 3u, "GX-GPU GP0 mask-bit raw word");
	require((gpu.readStatus() & ((1u << 11u) | (1u << 12u))) == (3u << 11u), "GX-GPU GP0 mask-bit GPUSTAT bits");
	require((gpu.readDrawModeWord() & bmsx::GX_GPU_DRAW_MODE_TEXTURE_DISABLE) == bmsx::GX_GPU_DRAW_MODE_TEXTURE_DISABLE, "GX-GPU GP0 draw-mode texture-disable source bit");
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
	require(gpu.readGpuReadWord() == bmsx::GX_GPU_INFO_GPU_TYPE_208PIN, "GX-GPU GP1 info GPU type query");
	gpu.writeGp1((bmsx::GX_GPU_GP1_GET_GPU_INFO << 24u) | 0x0au);
	require(gpu.readGpuReadWord() == bmsx::GX_GPU_INFO_GPU_TYPE_208PIN, "GX-GPU GP1 info high index keeps latch");
	gpu.writeGp1((bmsx::GX_GPU_GP1_GET_GPU_INFO << 24u) | 0x08u);
	require(gpu.readGpuReadWord() == 0u, "GX-GPU GP1 info unknown query");
	gpu.writeGp1((bmsx::GX_GPU_GP1_GET_GPU_INFO_LAST << 24u) | 0x07u);
	require(gpu.readGpuReadWord() == bmsx::GX_GPU_INFO_GPU_TYPE_208PIN, "GX-GPU GP1 info mirrored opcode GPU type query");
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
	imageGpu.writeGp0(0u);
	imageGpu.writeGp0((2u << 16u) | 2u);
	imageGpu.writeGp0(0x001f03e0u);

	GpuHarness restoredImageHarness;
	bmsx::GxGpu& restoredImageGpu = restoredImageHarness.gpu;
	restoredImageGpu.restoreState(imageGpu.captureState());
	restoredImageGpu.writeGp0(0x7c00ffffu);
	const bmsx::GxGpuCommandBuffer& imageCommands = restoredImageGpu.readDeviceOutput().commandBuffer;
	require(imageCommands.commandCount == 1u, "GX-GPU save-state restores partial CPU-to-VRAM upload");
	require(imageCommands.commandKind[0] == bmsx::GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, "GX-GPU restored upload command kind");
	require(imageCommands.commandWordCount[0] == 5u, "GX-GPU restored upload command word count");
	require(imageCommands.words[imageCommands.commandWordStart[0] + 3u] == 0x001f03e0u, "GX-GPU restored upload keeps first payload word");
	require(imageCommands.words[imageCommands.commandWordStart[0] + 4u] == 0x7c00ffffu, "GX-GPU restored upload accepts final payload word");
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

void testSaveStateRestoresCommandTimeAndFifoSuffixRelativeToSchedulerTime() {
	GpuHarness harness;
	harness.gpu.writeGp0((bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u) | 0x0000ffu);
	harness.gpu.writeGp0(0u);
	harness.gpu.writeGp0((1u << 16u) | 1u);
	harness.gpu.writeGp0((bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | 0x000123u);
	harness.scheduler.advanceTo(10);
	const bmsx::GxGpuState state = harness.gpu.captureState();
	require(state.gp0FifoWordCount == 1u, "GX-GPU save-state captures the queued FIFO suffix count");
	require(state.gp0FifoWords[0] == ((bmsx::GX_GPU_GP0_DRAW_MODE << 24u) | 0x000123u), "GX-GPU save-state captures the queued FIFO suffix word");
	require(state.pendingCommandCycles == 19, "GX-GPU save-state captures remaining command cycles");
	require(state.commandBuffer.executedCommandCount == 0u, "GX-GPU save-state preserves the pending execution frontier");

	GpuHarness restored;
	restored.scheduler.advanceTo(100);
	restored.gpu.restoreState(state);
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

void testGp1ClearCutsActiveC0AtExecutionFrontierWithoutCancelingDraws() {
	GpuHarness active;
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
	require(active.gpu.readGp0() == bmsx::GX_GPU_INFO_GPU_TYPE_208PIN, "GX-GPU GP1 clear preserves the GPUREAD latch before C0 activation");
	const bmsx::u32 status = active.gpu.readStatus();
	require((status & bmsx::GX_GPU_STATUS_GPU_IDLE) != 0u, "GX-GPU GP1 clear restores idle after removing active C0");
	require((status & bmsx::GX_GPU_STATUS_READY_TO_SEND_VRAM) == 0u, "GX-GPU removed C0 never becomes send-ready");
	require((status & bmsx::GX_GPU_STATUS_READY_TO_RECEIVE_DMA) != 0u, "GX-GPU removed C0 restores receive-ready");

	GpuHarness queued;
	queued.gpu.writeGp0((bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u) | 0x0000ffu);
	queued.gpu.writeGp0(0u);
	queued.gpu.writeGp0((1u << 16u) | 1u);
	queued.gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24u);
	queued.gpu.writeGp0(0u);
	queued.gpu.writeGp0((1u << 16u) | 1u);
	const bmsx::i64 queuedFillDeadline = queued.scheduler.nextDeadline();
	queued.gpu.writeGp1(bmsx::GX_GPU_GP1_CLEAR_FIFO << 24u);
	const bmsx::GxGpuCommandBuffer& queuedCommands = queued.gpu.readDeviceOutput().commandBuffer;
	require(queuedCommands.commandCount == 1u, "GX-GPU GP1 clear preserves an active fill");
	require(queuedCommands.executedCommandCount == 0u, "GX-GPU active fill remains timed after GP1 clear");
	require(queued.gpu.captureState().gp0FifoWordCount == 0u, "GX-GPU GP1 clear discards C0 still queued behind a draw");
	require(queued.scheduler.nextDeadline() == queuedFillDeadline, "GX-GPU GP1 clear preserves an active draw deadline");
	queued.scheduler.advanceTo(queuedFillDeadline);
	queued.gpu.onService(queuedFillDeadline);
	require(queuedCommands.executedCommandCount == 1u, "GX-GPU active draw completes after GP1 clear");
	require(queuedCommands.readback.phase() == bmsx::GX_GPU_READBACK_IDLE, "GX-GPU queued C0 never activates after GP1 clear");
}

void testGp1ResetCancelsRestoredActiveC0Deadline() {
	GpuHarness source;
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
	const bmsx::u64 snapshotSerial = restored.gpu.readVramSnapshotSerial();
	require(restored.scheduler.nextDeadline() == 101, "GX-GPU restore rearms the active C0 deadline");
	restored.gpu.writeGp1(bmsx::GX_GPU_GP1_RESET << 24u);
	const bmsx::GxGpuState reset = restored.gpu.captureState();
	require(reset.commandBuffer.commandCount == 0u, "GX-GPU GP1 reset removes a restored active C0 marker");
	require(reset.commandBuffer.executedCommandCount == 0u, "GX-GPU GP1 reset leaves no restored C0 execution frontier");
	require(reset.commandBuffer.readbackPhase == bmsx::GX_GPU_READBACK_IDLE, "GX-GPU GP1 reset leaves restored C0 readback idle");
	require(restored.scheduler.nextDeadline() == std::numeric_limits<bmsx::i64>::max(), "GX-GPU GP1 reset cancels a restored C0 deadline");
	require(restored.gpu.readGp0() == bmsx::GX_GPU_INFO_GPU_TYPE_208PIN, "GX-GPU GP1 reset preserves the restored GPUREAD latch");
	require(restored.gpu.readVramSnapshotSerial() == snapshotSerial, "GX-GPU GP1 reset preserves restored raw VRAM");
	require((restored.gpu.readStatus() & bmsx::GX_GPU_STATUS_RESET_WORD) == bmsx::GX_GPU_STATUS_RESET_WORD, "GX-GPU GP1 reset becomes idle after removing restored C0");
}

void testGp1ClearFifoClearsPartialGp0PacketsAndFlushesPartialCpuToVramUploads() {
	GpuHarness harness;
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
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_GPU_IDLE) == 0u, "GX-GPU GP1 clear FIFO keeps the flushed CPU-to-VRAM command busy");
	completeGpuCommands(harness);
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_GPU_IDLE) == bmsx::GX_GPU_STATUS_GPU_IDLE, "GX-GPU partial CPU-to-VRAM reaches idle at completion");

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
	uint8_t interlacedRenderWord = 0u) {
	const size_t wordStart = commandBuffer.appendWords(words.data(), wordCount);
	commandBuffer.pushCommand(
		kind,
		opcode,
		wordStart,
		static_cast<uint32_t>(wordCount),
		drawModeWord,
		textureWindowWord,
		drawingAreaTopLeftWord,
		drawingAreaBottomRightWord,
		drawingOffsetWord,
		maskBitModeWord,
		interlacedRenderWord);
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

void requireArgbPixel(const std::array<uint32_t, 256u * 256u>& pixels, uint32_t x, uint32_t y, uint32_t color, const char* message) {
	const size_t pixelIndex = static_cast<size_t>(y) * 256u + x;
	require(pixels[pixelIndex] == color, message);
}

struct SoftwareFrameHarness {
	std::array<uint32_t, 256u * 256u> framebuffer{};
	std::unique_ptr<std::array<bmsx::u8, bmsx::GX_GPU_VRAM_BYTE_COUNT>> vramSnapshot = std::make_unique<std::array<bmsx::u8, bmsx::GX_GPU_VRAM_BYTE_COUNT>>();
	bmsx::SoftwareBackend backend;
	bmsx::GxGpuPipelineState state;

	SoftwareFrameHarness(
		const bmsx::GxGpuCommandBuffer& commandBuffer,
		bmsx::GxGpuReadbackPort& readback,
		const bmsx::GxGpuSystemVramPort& systemVramPort = emptySystemVramPort)
		: backend(framebuffer.data(), 256, 256, 256 * static_cast<int32_t>(sizeof(uint32_t))) {
		state.width = 256;
		state.height = 256;
		state.commandBuffer = &commandBuffer;
		state.systemVramPort = &systemVramPort;
		state.readbackPort = &readback;
		state.vramSnapshotBytes = vramSnapshot.get();
		state.statusWord = 0u;
		state.displayModeWord = bmsx::PSX_GPU_DISPLAY_MODE_PAL_WORD;
		state.displayStartWord = 0u;
	}
};

void testPowerOnVramResetSaveStateAndMachineRecreation() {
	bmsx::u64 firstSerial = 0u;
	bmsx::u16 powerOnWord0 = 0u;
	{
		GpuHarness harness;
		bmsx::GxGpu& first = harness.gpu;
		const auto& bytes = first.readVramSnapshotBytes();
		firstSerial = first.readVramSnapshotSerial();
		powerOnWord0 = static_cast<bmsx::u16>(static_cast<bmsx::u32>(bytes[0u]) | (static_cast<bmsx::u32>(bytes[1u]) << 8u));

		require(bytes[0u] == 38u, "GX-GPU power-on VRAM first byte");
		require(bytes[31u] == 144u, "GX-GPU power-on VRAM block boundary low byte");
		require(bytes[32u] == 185u, "GX-GPU power-on VRAM block boundary high byte");
		require(bytes[255u] == 162u, "GX-GPU power-on VRAM row boundary low byte");
		require(bytes[256u] == 51u, "GX-GPU power-on VRAM row boundary high byte");
		require(bytes[4095u] == 83u, "GX-GPU power-on VRAM page boundary low byte");
		require(bytes[4096u] == 130u, "GX-GPU power-on VRAM page boundary high byte");
		require(bytes[65535u] == 92u, "GX-GPU power-on VRAM macro boundary low byte");
		require(bytes[65536u] == 58u, "GX-GPU power-on VRAM macro boundary high byte");
		require(bytes[bmsx::GX_GPU_VRAM_BYTE_COUNT - 1u] == 26u, "GX-GPU power-on VRAM final byte");
		require(gxGpuVramDigest(bytes) == 0xd1dc1dedu, "GX-GPU power-on VRAM full digest");

		const bmsx::GxGpuDeviceOutput& output = first.readDeviceOutput();
		SoftwareFrameHarness frame(output.commandBuffer, output.readbackPort);
		*frame.vramSnapshot = output.vramSnapshotBytes;
		frame.state.vramSnapshotSerial = output.vramSnapshotSerial;
		bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state);
		require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(0, 0)] == powerOnWord0, "GX-GPU software backend loads power-on VRAM");

		first.writeGp0(bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24u);
		first.writeGp0(0u);
		first.writeGp0((1u << 16u) | 1u);
		first.writeGp0(0x00001234u);
		completeGpuCommands(harness);
		first.presentReadyFrameOnVblankEdge();
		bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state);
		require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(0, 0)] == 0x1234u, "GX-GPU first machine modifies persistent software VRAM");
	}

	{
		GpuHarness harness;
		bmsx::GxGpu& second = harness.gpu;
		require(second.readVramSnapshotSerial() > firstSerial, "GX-GPU recreated machine publishes a newer VRAM snapshot revision");
		const bmsx::GxGpuDeviceOutput& output = second.readDeviceOutput();
		SoftwareFrameHarness frame(output.commandBuffer, output.readbackPort);
		*frame.vramSnapshot = output.vramSnapshotBytes;
		frame.state.vramSnapshotSerial = output.vramSnapshotSerial;
		bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state);
		require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(0, 0)] == powerOnWord0, "GX-GPU recreated machine replaces persistent backend VRAM");

		const bmsx::u64 gp1Serial = second.readVramSnapshotSerial();
		second.writeGp1(bmsx::GX_GPU_GP1_RESET << 24u);
		require(second.readVramSnapshotSerial() == gp1Serial, "GX-GPU GP1 reset preserves VRAM snapshot revision");
		require(gxGpuVramDigest(second.readVramSnapshotBytes()) == 0xd1dc1dedu, "GX-GPU GP1 reset preserves power-on VRAM bytes");
		second.reset();
		require(second.readVramSnapshotSerial() > gp1Serial, "GX-GPU device reset publishes a newer VRAM snapshot revision");
		require(gxGpuVramDigest(second.readVramSnapshotBytes()) == 0xd1dc1dedu, "GX-GPU device reset reproduces power-on VRAM bytes");

		auto restoredBytes = std::make_unique<std::array<bmsx::u8, bmsx::GX_GPU_VRAM_BYTE_COUNT>>(second.readVramSnapshotBytes());
		(*restoredBytes)[0u] = 0x5au;
		second.replaceVramSnapshotBytes(restoredBytes->data());
		const bmsx::GxGpuSaveState saveState = second.captureSaveState();
		const bmsx::u64 savedSerial = second.readVramSnapshotSerial();
		second.reset();
		second.restoreSaveState(saveState);
		require(second.readVramSnapshotSerial() > savedSerial, "GX-GPU save-state restore publishes a newer VRAM snapshot revision");
		require(second.readVramSnapshotBytes()[0u] == 0x5au, "GX-GPU save-state restore uses saved raw VRAM bytes");
	}
}

void testSoftwareTextureModulationMath() {
	require(bmsx::gxGpuSoftwareTextureModulationPreDither(31u, 128u) == 248u, "GX-GPU software texture modulation pre-dither half intensity");
	require(bmsx::gxGpuSoftwareTextureModulationChannel5(31u, 128u, 0) == 31u, "GX-GPU software texture modulation half intensity preserves white");
	require(bmsx::gxGpuSoftwareTextureModulationChannel5(31u, 255u, 3) == 31u, "GX-GPU software texture modulation saturates high dither");
	require(bmsx::gxGpuSoftwareTextureModulationChannel5(1u, 16u, -4) == 0u, "GX-GPU software texture modulation clamps low dither");
	require(bmsx::gxGpuSoftwareTextureModulationChannel5(12u, 96u, 0) == 9u, "GX-GPU software texture modulation divides by 128");
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
	gpu.presentReadyFrameOnVblankEdge();
	const bmsx::GxGpuDeviceOutput& output = gpu.readDeviceOutput();
	SoftwareFrameHarness frame(output.commandBuffer, output.readbackPort);
	*frame.vramSnapshot = output.vramSnapshotBytes;
	frame.state.vramSnapshotSerial = output.vramSnapshotSerial;
	bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state);
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
	const uint32_t positionWord = (511u << 16u) | 1023u;
	const uint32_t sizeWord = (2u << 16u) | 2u;
	auto vramBytes = std::make_unique<std::array<bmsx::u8, bmsx::GX_GPU_VRAM_BYTE_COUNT>>();
	size_t byteIndex = (511u * bmsx::GX_GPU_VRAM_WIDTH + 1023u) << 1u;
	(*vramBytes)[byteIndex] = 0x11u;
	(*vramBytes)[byteIndex + 1u] = 0x11u;
	byteIndex = (511u * bmsx::GX_GPU_VRAM_WIDTH) << 1u;
	(*vramBytes)[byteIndex] = 0x22u;
	(*vramBytes)[byteIndex + 1u] = 0x22u;
	byteIndex = 1023u << 1u;
	(*vramBytes)[byteIndex] = 0x33u;
	(*vramBytes)[byteIndex + 1u] = 0x33u;
	(*vramBytes)[0u] = 0x44u;
	(*vramBytes)[1u] = 0x44u;
	gpu.replaceVramSnapshotBytes(vramBytes->data());
	gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24u);
	gpu.writeGp0(positionWord);
	gpu.writeGp0(sizeWord);
	completeGpuCommands(harness);
	gpu.presentReadyFrameOnVblankEdge();
	const bmsx::GxGpuDeviceOutput& output = gpu.readDeviceOutput();
	SoftwareFrameHarness frame(output.commandBuffer, output.readbackPort);
	*frame.vramSnapshot = output.vramSnapshotBytes;
	frame.state.vramSnapshotSerial = output.vramSnapshotSerial;
	bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state);
	require(gpu.readGp0() == 0x22221111u, "GX-GPU GPUREAD preserves wrapped first row");
	require(gpu.readGp0() == 0x44443333u, "GX-GPU GPUREAD preserves wrapped second row");
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
	*frame.vramSnapshot = firstOutput.vramSnapshotBytes;
	frame.state.vramSnapshotSerial = firstOutput.vramSnapshotSerial;
	bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state);
	gpu.retirePresentedCommands();
	require(gpu.readGp0() == 0x00001111u, "GX-GPU first queued C0 returns first pixel");

	completeGpuCommands(harness);
	gpu.presentReadyFrameOnVblankEdge();
	const bmsx::GxGpuDeviceOutput& secondOutput = gpu.readDeviceOutput();
	frame.state.vramSnapshotSerial = secondOutput.vramSnapshotSerial;
	bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state);
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
	*frame.vramSnapshot = firstOutput.vramSnapshotBytes;
	frame.state.vramSnapshotSerial = firstOutput.vramSnapshotSerial;
	bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state);
	require(firstOutput.readbackPort.phase() == bmsx::GX_GPU_READBACK_PENDING, "GX-GPU post-seal C0 remains pending on old frame");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_READY_TO_SEND_VRAM) == 0u, "GX-GPU post-seal C0 is not ready before its fence");
	gpu.retirePresentedCommands();
	require(firstOutput.readbackPort.fenceCommandCount() == 2u, "GX-GPU retire shifts post-seal C0 fence");

	completeGpuCommands(harness);
	gpu.presentReadyFrameOnVblankEdge();
	const bmsx::GxGpuDeviceOutput& secondOutput = gpu.readDeviceOutput();
	frame.state.vramSnapshotSerial = secondOutput.vramSnapshotSerial;
	bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state);
	require(gpu.readGp0() == 0x00001234u, "GX-GPU post-seal C0 reads after intervening upload");
}

void testGp1ClearFifoAbortsPendingGpureadWithoutDroppingPriorCommands() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;
	const bmsx::u16 powerOnWord16 = static_cast<bmsx::u16>(static_cast<bmsx::u32>(gpu.readVramSnapshotBytes()[32u])
		| (static_cast<bmsx::u32>(gpu.readVramSnapshotBytes()[33u]) << 8u));
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
	require(gpu.readGp0() == bmsx::GX_GPU_INFO_GPU_TYPE_208PIN, "GX-GPU GP1 clear FIFO preserves GPUREAD data latch");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_GPU_IDLE) != 0u, "GX-GPU GP1 clear FIFO restores GPU idle after pending readback");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_READY_TO_RECEIVE_DMA) != 0u, "GX-GPU GP1 clear FIFO restores receive-ready after pending readback");

	completeGpuCommands(harness);
	gpu.presentReadyFrameOnVblankEdge();
	require(readback.phase() == bmsx::GX_GPU_READBACK_IDLE, "GX-GPU aborted queued C0 does not reactivate on frame seal");
	SoftwareFrameHarness frame(commandBuffer, readback);
	*frame.vramSnapshot = output.vramSnapshotBytes;
	frame.state.vramSnapshotSerial = output.vramSnapshotSerial;
	bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state);
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(0, 0)] == 0x001fu, "GX-GPU pending readback abort executes the prior fill");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(16, 0)] == powerOnWord16, "GX-GPU pending readback abort preserves untouched power-on VRAM");
}

void testGp1ClearFifoAbortsReadyGpureadAndQueuedSuffix() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;
	const bmsx::u16 powerOnWord16 = static_cast<bmsx::u16>(static_cast<bmsx::u32>(gpu.readVramSnapshotBytes()[32u])
		| (static_cast<bmsx::u32>(gpu.readVramSnapshotBytes()[33u]) << 8u));
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
	gpu.presentReadyFrameOnVblankEdge();
	const bmsx::GxGpuDeviceOutput& output = gpu.readDeviceOutput();
	const bmsx::GxGpuCommandBuffer& commandBuffer = output.commandBuffer;
	bmsx::GxGpuReadbackPort& readback = output.readbackPort;
	SoftwareFrameHarness frame(commandBuffer, readback);
	*frame.vramSnapshot = output.vramSnapshotBytes;
	frame.state.vramSnapshotSerial = output.vramSnapshotSerial;
	bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state);
	const uint32_t readbackToken = readback.token();
	require(readback.phase() == bmsx::GX_GPU_READBACK_READY, "GX-GPU ready readback test completes C0");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_READY_TO_SEND_VRAM) != 0u, "GX-GPU ready readback test exposes GPUREAD data");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_DMA_DATA_REQUEST) != 0u, "GX-GPU ready readback test raises DMA request");
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
	require(gpu.readGp0() == bmsx::GX_GPU_INFO_GPU_TYPE_208PIN, "GX-GPU GP1 clear FIFO preserves ready GPUREAD latch");

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
	bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state);
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(0, 0)] == 0x001fu, "GX-GPU ready readback abort preserves prior executed VRAM");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(16, 0)] == powerOnWord16, "GX-GPU ready readback abort preserves untouched power-on VRAM");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(32, 0)] == 0x7c00u, "GX-GPU command processing resumes after ready readback abort");
}

void testGpureadRestoreRearmsSubmittedAndResetClearsRequest() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;
	auto vramBytes = std::make_unique<std::array<bmsx::u8, bmsx::GX_GPU_VRAM_BYTE_COUNT>>();
	(*vramBytes)[0u] = 0x34u;
	(*vramBytes)[1u] = 0x12u;
	gpu.replaceVramSnapshotBytes(vramBytes->data());
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
	completeGpuCommands(harness);
	gpu.presentReadyFrameOnVblankEdge();
	require(gpu.lastFrameCommitted(), "GX-GPU restored zero-fence readback schedules backend work");
	const bmsx::GxGpuDeviceOutput& output = gpu.readDeviceOutput();
	SoftwareFrameHarness frame(output.commandBuffer, output.readbackPort);
	*frame.vramSnapshot = output.vramSnapshotBytes;
	frame.state.vramSnapshotSerial = output.vramSnapshotSerial;
	bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state);
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
		GX_GPU_SOFTWARE_FULL_DRAWING_AREA_BOTTOM_RIGHT_WORD,
		0u,
		0u,
		0u);

	bmsx::g_gxGpuSoftwareVram.fill(0u);
	require(bmsx::executeGxGpuSoftwareCommands(commandBuffer, 0u) == 0u, "GX-GPU software command executor ignores unpresented commands");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(4, 5)] == 0u, "GX-GPU software VRAM is unchanged before presentation publish");

	commandBuffer.completeCommandExecution(commandBuffer.commandCount);
	commandBuffer.sealCommandsForPresentation();
	require(bmsx::executeGxGpuSoftwareCommands(commandBuffer, 0u) == 1u, "GX-GPU software command executor consumes published command");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(4, 5)] == 0x001fu, "GX-GPU software VRAM receives published fill");
}

void testSoftwareGouraudLineFixedPointRaster() {
	bmsx::GxGpuCommandBuffer commandBuffer(commandBufferDmaHarness.dma);
	commandBuffer.reset();
	constexpr uint8_t opcode = bmsx::GX_GPU_GP0_LINE_FIRST | bmsx::GX_GPU_GP0_RENDER_GOURAUD_BIT;
	pushSoftwareCommand(
		commandBuffer,
		std::array<uint32_t, 4>{
			(opcode << 24u) | 0x0000ffu,
			(10u << 16u) | 40u,
			0x00ff00u,
			(14u << 16u) | 40u,
		},
		4u,
		bmsx::GX_GPU_COMMAND_DRAW_LINE,
		opcode);

	bmsx::g_gxGpuSoftwareVram.fill(0u);
	bmsx::executeGxGpuSoftwareCommands(commandBuffer, 0u);

	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(40, 10)] == 0x001fu, "GX-GPU software line fixed-point red endpoint");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(40, 12)] == 0x0210u, "GX-GPU software line fixed-point midpoint");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(40, 14)] == 0x03e0u, "GX-GPU software line fixed-point green endpoint");
}

void testSoftwareLineDdaSampleWrapAndPolylineJoints() {
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

	bmsx::g_gxGpuSoftwareVram.fill(0u);
	bmsx::executeGxGpuSoftwareCommands(commandBuffer, 0u);

	constexpr std::array<std::array<int32_t, 2>, 5> shallowPixels{{ {{ 10, 10 }}, {{ 11, 11 }}, {{ 12, 11 }}, {{ 13, 12 }}, {{ 14, 12 }} }};
	for (const auto& pixel : shallowPixels) {
		require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(pixel[0], pixel[1])] == 0x001fu, "GX-GPU software shallow line DDA pixel");
	}
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(11, 10)] == 0u, "GX-GPU software shallow line rejects geometric round-nearest pixel");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(12, 12)] == 0u, "GX-GPU software shallow line owns one pixel per DDA step");
	constexpr std::array<std::array<int32_t, 2>, 5> steepPixels{{ {{ 20, 10 }}, {{ 20, 11 }}, {{ 21, 12 }}, {{ 21, 13 }}, {{ 22, 14 }} }};
	for (const auto& pixel : steepPixels) {
		require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(pixel[0], pixel[1])] == 0x03e0u, "GX-GPU software steep line DDA pixel");
	}
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(21, 11)] == 0u, "GX-GPU software steep line keeps X half-tie down");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(22, 13)] == 0u, "GX-GPU software steep line owns one pixel per DDA step");
	constexpr std::array<std::array<int32_t, 2>, 9> reversedPixels{{ {{ 11, 29 }}, {{ 12, 29 }}, {{ 8, 30 }}, {{ 9, 30 }}, {{ 10, 30 }}, {{ 6, 31 }}, {{ 7, 31 }}, {{ 4, 32 }}, {{ 5, 32 }} }};
	for (const auto& pixel : reversedPixels) {
		require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(pixel[0], pixel[1])] == 0x03ffu, "GX-GPU software reversed line preserves canonical DDA coverage");
	}
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(4, 31)] == 0u, "GX-GPU software reversed line keeps Y direction bias");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(12, 30)] == 0u, "GX-GPU software reversed line owns one pixel per DDA step");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(1023, 511)] == 0x001fu, "GX-GPU software line wraps each post-offset DDA sample to signed 11-bit");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(40, 40)] == 0x000fu, "GX-GPU software semi-transparent polyline first pixel");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(41, 40)] == 0x000fu, "GX-GPU software semi-transparent polyline first segment");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(42, 40)] == 0x0017u, "GX-GPU software polyline joint blends both inclusive endpoints");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(42, 41)] == 0x000fu, "GX-GPU software semi-transparent polyline second segment");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(42, 42)] == 0x000fu, "GX-GPU software semi-transparent polyline last pixel");
	for (int32_t step = 0; step < 5; step += 1) {
		require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(1023 - step, 70 + step)] == 0x7c00u, "GX-GPU software polyline continues after rejected segment");
	}
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(0, 70)] == 0u, "GX-GPU software rejects 1024-wide polyline segment");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(512, 70)] == 0u, "GX-GPU software rejected polyline segment does not clip into drawing area");
	for (int32_t step = 0; step < 5; step += 1) {
		require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(50 + step, 511 - step)] == 0x03e0u, "GX-GPU software polyline continues after height-rejected segment");
	}
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(50, 0)] == 0u, "GX-GPU software rejects 512-high polyline segment");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(50, 256)] == 0u, "GX-GPU software height-rejected segment does not clip into drawing area");
}

void testSoftwareBlendsUntexturedSemiTransparentRectangles() {
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

	bmsx::g_gxGpuSoftwareVram.fill(0u);
	bmsx::executeGxGpuSoftwareCommands(commandBuffer, 0u);

	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(10, 20)] == 0x7defu, "GX-GPU software semitrans mode 0 half blends white over blue");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(20, 20)] == 0x7fffu, "GX-GPU software semitrans mode 1 adds white over blue");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(30, 20)] == 0x0000u, "GX-GPU software semitrans mode 2 subtracts white from blue");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(40, 20)] == 0x7ce7u, "GX-GPU software semitrans mode 3 quarter-adds white over blue");
}

void testSoftwareTriangleEdgesAndQuadSeams() {
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

	bmsx::g_gxGpuSoftwareVram.fill(0u);
	bmsx::executeGxGpuSoftwareCommands(commandBuffer, 0u);

	for (int32_t row = 0; row < 4; row += 1) {
		for (int32_t column = 0; column < 4 - row; column += 1) {
			require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(4 + column, 4 + row)] == 0x001fu, "GX-GPU software clockwise triangle coverage");
			require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(12 + column, 4 + row)] == 0x03e0u, "GX-GPU software counter-clockwise triangle coverage");
		}
		require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(8 - row, 4 + row)] == 0u, "GX-GPU software triangle excludes right edge");
		require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(16 - row, 4 + row)] == 0u, "GX-GPU software reversed triangle excludes right edge");
	}
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(32, 4)] == 0u, "GX-GPU software narrow triangle drops zero-width top row");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(32, 5)] == 0x7c00u, "GX-GPU software narrow triangle includes left span pixel");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(33, 5)] == 0x7c00u, "GX-GPU software narrow triangle includes right span pixel");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(34, 5)] == 0u, "GX-GPU software narrow triangle excludes zero-width apex");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(32, 6)] == 0u, "GX-GPU software narrow triangle drops zero-width bottom row");
	for (int32_t y = 20; y < 24; y += 1) {
		for (int32_t x = 20; x < 24; x += 1) {
			require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(x, y)] == 0x000fu, "GX-GPU software quad blends each pixel exactly once");
		}
	}
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(24, 20)] == 0u, "GX-GPU software quad excludes right edge");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(20, 24)] == 0u, "GX-GPU software quad excludes bottom edge");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(30, 31)] == 0x000fu, "GX-GPU software representable quad first triangle single hit");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(31, 31)] == 0x0017u, "GX-GPU software representable quad second triangle observes the first write");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(32, 31)] == 0x0017u, "GX-GPU software representable quad overlapping row blends twice");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(31, 32)] == 0x0017u, "GX-GPU software representable quad overlapping column blends twice");
}

void testSoftwareGouraudTriangleFixedColorPlane() {
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

	bmsx::g_gxGpuSoftwareVram.fill(0u);
	bmsx::executeGxGpuSoftwareCommands(commandBuffer, 0u);

	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(13, 13)] == 0x000bu, "GX-GPU software Gouraud triangle truncates the fixed-12 color plane before RGB555 storage");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(33, 33)] == 0x000bu, "GX-GPU software textured Gouraud triangle modulates from the fixed-12 color plane");
}

void testSoftwarePolygonRasterBucketWrap() {
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

	bmsx::g_gxGpuSoftwareVram.fill(0u);
	bmsx::executeGxGpuSoftwareCommands(commandBuffer, 0u);

	for (int32_t row = 0; row < 4; row += 1) {
		for (int32_t column = 0; column < 4 - row; column += 1) {
			require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(1020 + column, 10 + row)] == 0x001fu, "GX-GPU software polygon preserves the positive 1024 exclusive edge");
		}
	}
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(0, 10)] == 0u, "GX-GPU software polygon does not pre-wrap the positive 1024 edge");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(1020, 20)] == 0x001fu, "GX-GPU software wrapped textured polygon samples first texel");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(1021, 20)] == 0x03e0u, "GX-GPU software wrapped textured polygon samples second texel");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(1022, 20)] == 0x7c00u, "GX-GPU software wrapped textured polygon samples third texel");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(1023, 20)] == 0x7fffu, "GX-GPU software wrapped textured polygon samples fourth texel");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(0, 20)] == 0u, "GX-GPU software wrapped textured polygon stays in one raster bucket");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(11, 509)] == 0x2110u, "GX-GPU software wrapped Gouraud polygon first clipped fixed-12 color");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(12, 509)] == 0x2208u, "GX-GPU software wrapped Gouraud polygon second clipped fixed-12 color");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(11, 510)] == 0x4108u, "GX-GPU software wrapped Gouraud polygon lower clipped fixed-12 color");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(10, 509)] == 0u, "GX-GPU software wrapped Gouraud polygon clips left drawing area");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(12, 510)] == 0u, "GX-GPU software wrapped Gouraud polygon clips bottom-right drawing area");
}

void testSoftwareTexturedPolygonFixedUvGradient() {
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

	bmsx::g_gxGpuSoftwareVram.fill(0u);
	bmsx::executeGxGpuSoftwareCommands(commandBuffer, 0u);

	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(10, 10)] == 0x001fu, "GX-GPU software fixed UV plane samples the seeded texel at the first pixel");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(11, 10)] == 0x03e0u, "GX-GPU software fixed UV plane rounds the half-texel boundary up");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(10, 11)] == 0x001fu, "GX-GPU software fixed UV plane preserves the vertical sample");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(12, 10)] == 0u, "GX-GPU software fixed UV triangle excludes its right edge");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(23, 20)] == 0x001fu, "GX-GPU software fixed UV plane truncates a non-integral positive gradient");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(24, 20)] == 0x03e0u, "GX-GPU software fixed UV plane advances after the truncated boundary");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(33, 30)] == 0x03e0u, "GX-GPU software fixed UV plane preserves a descending boundary texel");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(34, 30)] == 0x001fu, "GX-GPU software fixed UV plane wraps a negative gradient accumulator");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(1019, 500)] == 0x001fu, "GX-GPU software translated fixed UV plane preserves the truncated boundary");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(1020, 500)] == 0x03e0u, "GX-GPU software translated fixed UV plane advances after the truncated boundary");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(100, 503)] == 0x001fu, "GX-GPU software vertical fixed UV plane preserves the truncated boundary");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(100, 504)] == 0x03e0u, "GX-GPU software vertical fixed UV plane advances after the truncated boundary");
}

void testSoftwareTextureWindowPageAndClutEdges() {
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

	bmsx::g_gxGpuSoftwareVram.fill(0u);
	bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(15, 15)] = 0x001fu;
	bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(8, 15)] = 0x03e0u;
	bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(15, 8)] = 0x7c00u;
	bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(8, 8)] = 0x7fffu;
	bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(1023, 30)] = 0x001fu;
	bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(0, 30)] = 0x03e0u;
	bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(69, 511)] = 0x001fu;
	bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(69, 256)] = 0x03e0u;
	bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(128, 50)] = 0x100fu;
	bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(1023, 60)] = 0x001fu;
	bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(0, 60)] = 0x03e0u;
	bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(1023, 70)] = 0x1000u;
	bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(960, 70)] = 0x0002u;
	bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(17, 80)] = 0x001fu;
	bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(18, 80)] = 0x03e0u;
	bmsx::executeGxGpuSoftwareCommands(commandBuffer, 0u);

	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(10, 10)] == 0x001fu, "GX-GPU software texture window replaces the masked U bits");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(11, 10)] == 0x03e0u, "GX-GPU software texture window preserves the unmasked U bits");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(10, 11)] == 0x7c00u, "GX-GPU software texture window replaces the masked V bits");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(11, 11)] == 0x7fffu, "GX-GPU software texture window preserves the unmasked V bits");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(20, 20)] == 0x001fu, "GX-GPU software direct16 page samples the final VRAM column");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(21, 20)] == 0x03e0u, "GX-GPU software direct16 page wraps X at the VRAM edge");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(30, 30)] == 0x001fu, "GX-GPU software direct16 page samples the final VRAM row");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(30, 31)] == 0x03e0u, "GX-GPU software direct16 page wraps V within its page");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(40, 40)] == 0x001fu, "GX-GPU software palette8 samples the low byte at the page edge");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(41, 40)] == 0x03e0u, "GX-GPU software palette8 samples the high byte and wraps the CLUT lookup horizontally");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(50, 50)] == 0x001fu, "GX-GPU software palette4 samples the high nibble at the page edge");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(51, 50)] == 0x03e0u, "GX-GPU software palette4 advances into the wrapped texture word");
}

void testSoftwareDrawingAreaOffsetClippingAndRectangleCoordinateWrap() {
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

	bmsx::g_gxGpuSoftwareVram.fill(0u);
	bmsx::executeGxGpuSoftwareCommands(commandBuffer, 0u);

	for (int32_t row = 0; row < 4; row += 1) {
		for (int32_t column = 0; column < 4 - row; column += 1) {
			require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(12 + column, 12 + row)] == 0x001fu, "GX-GPU software offset triangle inside drawing area");
		}
	}
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(11, 12)] == 0u, "GX-GPU software drawing area clips triangle left");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(12, 11)] == 0u, "GX-GPU software drawing area clips triangle top");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(16, 12)] == 0u, "GX-GPU software drawing area clips triangle right");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(12, 16)] == 0u, "GX-GPU software drawing area clips triangle bottom");
	for (int32_t y = 20; y <= 25; y += 1) {
		for (int32_t x = 20; x <= 25; x += 1) {
			require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(x, y)] == 0x03e0u, "GX-GPU software inclusive drawing area clips rectangle");
		}
	}
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(19, 20)] == 0u, "GX-GPU software drawing area clips rectangle left");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(26, 25)] == 0u, "GX-GPU software drawing area clips rectangle right");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(20, 19)] == 0u, "GX-GPU software drawing area clips rectangle top");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(25, 26)] == 0u, "GX-GPU software drawing area clips rectangle bottom");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(30, 20)] == 0x001fu, "GX-GPU software clipped textured rectangle advances UV top-left");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(35, 20)] == 0x03e0u, "GX-GPU software clipped textured rectangle advances UV top-right");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(30, 25)] == 0x7c00u, "GX-GPU software clipped textured rectangle advances UV bottom-left");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(35, 25)] == 0x7fffu, "GX-GPU software clipped textured rectangle advances UV bottom-right");
	for (int32_t coord = 0; coord < 6; coord += 1) {
		require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(40 + coord, 20 + coord)] == 0x001fu, "GX-GPU software offset line inside drawing area");
	}
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(39, 19)] == 0u, "GX-GPU software drawing area clips line start");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(46, 26)] == 0u, "GX-GPU software drawing area clips line end");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(0, 0)] == 0x7fffu, "GX-GPU software rectangle wraps post-offset coordinates to signed 11-bit");
}

void testSoftwareFillBypassesDrawingAreaAndMaskBitDrawingState() {
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

	bmsx::g_gxGpuSoftwareVram.fill(0u);
	bmsx::executeGxGpuSoftwareCommands(commandBuffer, 0u);

	for (int32_t x = 80; x < 96; x += 1) {
		require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(x, 30)] == 0x03e0u, "GX-GPU software fill ignores drawing-area and mask-bit state");
	}
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(79, 30)] == 0u, "GX-GPU software fill starts at aligned X");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(96, 30)] == 0u, "GX-GPU software fill ends at rounded width");
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

	bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state);

	requireArgbPixel(frame.framebuffer, 0u, 0u, 0xffff0000u, "GX-GPU software scanout CPU upload red pixel");
	requireArgbPixel(frame.framebuffer, 1u, 0u, 0xff00ff00u, "GX-GPU software scanout CPU upload green pixel");
	requireArgbPixel(frame.framebuffer, 2u, 0u, 0xffff0000u, "GX-GPU software scanout VRAM copy red pixel");
	requireArgbPixel(frame.framebuffer, 3u, 0u, 0xff00ff00u, "GX-GPU software scanout VRAM copy green pixel");
	requireArgbPixel(frame.framebuffer, 0u, 1u, 0xff0000ffu, "GX-GPU software scanout fill blue left pixel");
	requireArgbPixel(frame.framebuffer, 15u, 1u, 0xff0000ffu, "GX-GPU software scanout fill blue rounded pixel");
	requireArgbPixel(frame.framebuffer, 16u, 1u, 0xff000000u, "GX-GPU software scanout fill stops at rounded edge");
}

void testSoftwareScanoutUsesNativeOutputDimensions() {
	std::array<uint32_t, 256u * 212u> framebuffer{};
	bmsx::SoftwareBackend backend(framebuffer.data(), 256, 192, 256 * static_cast<int32_t>(sizeof(uint32_t)));
	bmsx::GxGpuPipelineState state{};
	state.statusWord = 0u;
	state.displayModeWord = bmsx::PSX_GPU_DISPLAY_MODE_PAL_WORD;
	state.displayStartWord = 900u | (400u << 10u);
	bmsx::g_gxGpuSoftwareVram.fill(0u);
	bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(900, 400)] = 0x001fu;
	bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(131, 400)] = 0x03e0u;
	bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(900, 79)] = 0x7c00u;
	bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(900, 99)] = 0x7fffu;
	bmsx::scanoutGxGpuSoftwareVram(backend, state);

	require(framebuffer[0] == 0xffff0000u, "GX-GPU native 192-line scanout starts at the programmed VRAM origin");
	require(framebuffer[255] == 0xff00ff00u, "GX-GPU native scanout wraps the programmed VRAM X origin");
	require(framebuffer[191u * 256u] == 0xff0000ffu, "GX-GPU native 192-line scanout reaches source row 191 without scaling");

	backend.setFramebuffer(framebuffer.data(), 256, 212, 256 * static_cast<int32_t>(sizeof(uint32_t)));
	framebuffer.fill(0u);
	bmsx::scanoutGxGpuSoftwareVram(backend, state);
	require(framebuffer[211u * 256u] == 0xffffffffu, "GX-GPU native 212-line scanout reaches source row 211 without scaling");
}

void testSoftwareScanoutWeavesCurrent480iFieldIntoRetainedOutputLines() {
	std::array<uint32_t, 4u> framebuffer{};
	bmsx::SoftwareBackend backend(framebuffer.data(), 1, 4, static_cast<int32_t>(sizeof(uint32_t)));
	bmsx::GxGpuPipelineState state{};
	state.width = 1;
	state.height = 4;
	state.statusWord = bmsx::GX_GPU_STATUS_INTERLACED_FIELD;
	state.displayModeWord = bmsx::GX_GPU_DISPLAY_MODE_VERTICAL_INTERLACE_BIT | bmsx::GX_GPU_DISPLAY_MODE_VERTICAL_RESOLUTION_BIT;
	state.displayStartWord = 1023u | (510u << 10u);
	state.vramSnapshotSerial = 1u;
	bmsx::g_gxGpuSoftwareVram.fill(0u);
	bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(1023, 510)] = 0x001fu;
	bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(1023, 511)] = 0x7c00u;
	bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(1023, 0)] = 0x03e0u;
	bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(1023, 1)] = 0x7fffu;
	bmsx::scanoutGxGpuSoftwareVram(backend, state);

	require(framebuffer == std::array<uint32_t, 4u>{
		0xffff0000u,
		0xff0000ffu,
		0xff00ff00u,
		0xffffffffu,
	}, "GX-GPU 480i scanout initially assembles both wrapped source fields");

	state.display2StartWord = bmsx::GX_GPU_SYSTEM_VRAM_X | (64u << 10u);
	state.display2SizeWord = (4u << 16u) | 1u;
	state.compositorControlWord = bmsx::GX_GPU_COMPOSITOR_DISPLAY2_ENABLE;
	bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(bmsx::GX_GPU_SYSTEM_VRAM_X, 65u)] = 0x83e0u;
	bmsx::scanoutGxGpuSoftwareVram(backend, state);
	require(framebuffer[1u] == 0xff00ff00u, "GX display2 composes after interlaced field weave");
	state.compositorControlWord = 0u;

	bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(1023, 510)] = 0x7fffu;
	bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(1023, 0)] = 0x7fffu;
	bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(1023, 511)] = 0x001fu;
	bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(1023, 1)] = 0x03e0u;
	state.statusWord = 0u;
	bmsx::scanoutGxGpuSoftwareVram(backend, state);

	require(framebuffer == std::array<uint32_t, 4u>{
		0xffff0000u,
		0xffff0000u,
		0xff00ff00u,
		0xff00ff00u,
	}, "GX-GPU 480i scanout updates only the current field lines");

	state.statusWord = bmsx::GX_GPU_STATUS_DISPLAY_DISABLE | bmsx::GX_GPU_STATUS_INTERLACED_FIELD;
	state.compositorControlWord = bmsx::GX_GPU_COMPOSITOR_DISPLAY2_ENABLE;
	bmsx::scanoutGxGpuSoftwareVram(backend, state);
	require(framebuffer == std::array<uint32_t, 4u>{
		0xff000000u,
		0xff00ff00u,
		0xff000000u,
		0xff000000u,
	}, "GX display2 composes over a disabled interlaced primary after field weave");
	state.compositorControlWord = 0u;

	bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(1023, 510)] = 0x7c00u;
	bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(1023, 511)] = 0x7fffu;
	bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(1023, 0)] = 0x7fffu;
	bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(1023, 1)] = 0x7c00u;
	state.statusWord = 0u;
	state.vramSnapshotSerial = 2u;
	bmsx::scanoutGxGpuSoftwareVram(backend, state);
	require(framebuffer == std::array<uint32_t, 4u>{
		0xff0000ffu,
		0xffffffffu,
		0xffffffffu,
		0xff0000ffu,
	}, "GX-GPU snapshot replacement rebuilds both retained fields");
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
	bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state);
	requireArgbPixel(frame.framebuffer, 0u, 0u, 0xffff0000u, "GX-GPU software retire test initial red pixel");

	commandBuffer.retireCommandsPreservingVram();
	bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state);
	requireArgbPixel(frame.framebuffer, 0u, 0u, 0xffff0000u, "GX-GPU software retire preserves VRAM");

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
	bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state);
	requireArgbPixel(frame.framebuffer, 0u, 0u, 0xffff0000u, "GX-GPU software retire keeps previous VRAM after new log");
	requireArgbPixel(frame.framebuffer, 16u, 1u, 0xff00ff00u, "GX-GPU software retire executes commands after log reset");

	commandBuffer.reset();
	bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state);
	requireArgbPixel(frame.framebuffer, 0u, 0u, 0xffff0000u, "GX-GPU command-buffer reset preserves backend VRAM red pixel");
	requireArgbPixel(frame.framebuffer, 16u, 1u, 0xff00ff00u, "GX-GPU command-buffer reset preserves backend VRAM green pixel");
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

	commandBuffer.retireCommandsPreservingVram();
	commandBuffer.restoreState(state);

	require(commandBuffer.serial != commandSerial, "GX-GPU command-buffer restore republishes the command stream");
	require(commandBuffer.commandCount == 1u, "GX-GPU command-buffer restore restores command count");
	require(commandBuffer.presentCommandCount == 1u, "GX-GPU command-buffer restore restores sealed count");
}

void testCommandBufferRetireCompactsPresentedCommandStream() {
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
	commandBuffer.retireCommandsPreservingVram();

	bmsx::g_gxGpuSoftwareVram.fill(0u);
	require(commandBuffer.commandCount == 0u, "GX-GPU command-buffer retire removes presented command");
	require(commandBuffer.presentCommandCount == 0u, "GX-GPU command-buffer retire clears present prefix");
	require(bmsx::executeGxGpuSoftwareCommands(commandBuffer, 0u) == 0u, "GX-GPU software renderer ignores retired command queue");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(0, 0)] == 0u, "GX-GPU retired command queue leaves fresh software VRAM unchanged");
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

	require(commandBuffer.retireCommandsPreservingVram() == 3u, "GX-GPU command-buffer retire reports sealed command words");
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

	bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state);

	requireArgbPixel(frame.framebuffer, 5u, 5u, 0xffff0000u, "GX-GPU software scanout solid polygon pixel");
	requireArgbPixel(frame.framebuffer, 13u, 13u, 0xff000000u, "GX-GPU software scanout solid polygon background pixel");
	requireArgbPixel(frame.framebuffer, 20u, 5u, 0xff00ff00u, "GX-GPU software scanout solid rectangle left pixel");
	requireArgbPixel(frame.framebuffer, 22u, 6u, 0xff00ff00u, "GX-GPU software scanout solid rectangle right pixel");
	requireArgbPixel(frame.framebuffer, 30u, 6u, 0xff0000ffu, "GX-GPU software scanout solid line start pixel");
	requireArgbPixel(frame.framebuffer, 34u, 6u, 0xff0000ffu, "GX-GPU software scanout solid line end pixel");
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

	bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state);

	requireArgbPixel(frame.framebuffer, 40u, 10u, 0xffff0000u, "GX-GPU software scanout direct16 textured rectangle red pixel");
	requireArgbPixel(frame.framebuffer, 41u, 10u, 0xff00ff00u, "GX-GPU software scanout direct16 textured rectangle green pixel");
	requireArgbPixel(frame.framebuffer, 45u, 10u, 0xff0000ffu, "GX-GPU software scanout palette4 textured rectangle blue pixel");
	requireArgbPixel(frame.framebuffer, 47u, 10u, 0xffffff00u, "GX-GPU software scanout texture-windowed direct16 rectangle yellow pixel");
	requireArgbPixel(frame.framebuffer, 50u, 12u, 0xffff0000u, "GX-GPU software scanout direct16 textured polygon red pixel");
	requireArgbPixel(frame.framebuffer, 51u, 12u, 0xff00ff00u, "GX-GPU software scanout direct16 textured polygon green pixel");
	requireArgbPixel(frame.framebuffer, 60u, 20u, 0xffff0000u, "GX-GPU software scanout direct16 textured quad red pixel");
	requireArgbPixel(frame.framebuffer, 61u, 20u, 0xff00ff00u, "GX-GPU software scanout direct16 textured quad green pixel");
	requireArgbPixel(frame.framebuffer, 60u, 21u, 0xff0000ffu, "GX-GPU software scanout direct16 textured quad blue pixel");
	requireArgbPixel(frame.framebuffer, 61u, 21u, 0xffffff00u, "GX-GPU software scanout direct16 textured quad yellow pixel");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(62, 20)] == 0u, "GX-GPU software textured quad excludes right edge");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(60, 22)] == 0u, "GX-GPU software textured quad excludes bottom edge");
}

void testSoftwareCommandsPreserveTextureMaskBlendAndMaskTestStoreSemantics() {
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
	bmsx::g_gxGpuSoftwareVram.fill(0u);
	bmsx::executeGxGpuSoftwareCommands(commandBuffer, 0u);

	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(10, 20)] == 0x81efu, "GX-GPU software textured semi-transparent pixel blends and preserves texture mask bit");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(11, 20)] == 0x03e0u, "GX-GPU software zero texture pixel does not write");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(12, 20)] == 0x7c00u, "GX-GPU software unmasked textured semi-transparent pixel stores without blending");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(13, 20)] == 0x801fu, "GX-GPU software mask-test blocks writes over masked VRAM");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(10, 30)] == 0x3c0fu, "GX-GPU software semi-transparent solid pixel writes when mask checking is disabled");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(20, 30)] == 0xfc00u, "GX-GPU software semi-transparent solid pixel preserves a checked masked destination");
}

void testSoftwareCommandsSamplePalette8RectangleFlipAndDitheredModulation() {
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

	bmsx::g_gxGpuSoftwareVram.fill(0u);
	bmsx::executeGxGpuSoftwareCommands(commandBuffer, 0u);

	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(30, 20)] == 0x7c00u, "GX-GPU software palette8 flipped rectangle samples high byte CLUT entry first");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(31, 20)] == 0x03e0u, "GX-GPU software palette8 flipped rectangle samples low byte CLUT entry second");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(40, 20)] == 0x001fu, "GX-GPU software flipped direct16 rectangle samples base-zero texel first");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(41, 20)] == 0x03e0u, "GX-GPU software flipped direct16 rectangle wraps base-zero texel backward");
	require(bmsx::g_gxGpuSoftwareVram[bmsx::gxGpuSoftwareVramIndex(22, 41)] == 0x0010u, "GX-GPU software dithered textured polygon modulates with screen-space dither");
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

void testSystemVramTransferAndDisplay2Ownership() {
	GpuHarness harness;
	harness.gpu.writeGp0(bmsx::GX_GPU_GP0_POLYGON_FIRST << 24u);
	const bmsx::GxGpuState gp0Before = harness.gpu.captureState();

	harness.memory.writeMappedU32LE(bmsx::IO_GX_GPU_DISPLAY2_START, bmsx::GX_GPU_SYSTEM_VRAM_X | (64u << 10u));
	harness.memory.writeMappedU32LE(bmsx::IO_GX_GPU_DISPLAY2_SIZE, (2u << 16u) | 2u);
	harness.memory.writeMappedU32LE(bmsx::IO_GX_GPU_COMPOSITOR_CONTROL, bmsx::GX_GPU_COMPOSITOR_DISPLAY2_ENABLE);
	harness.memory.writeMappedU32LE(bmsx::IO_GX_GPU_SYSTEM_VRAM_POSITION, 64u << 16u);
	harness.memory.writeMappedU32LE(bmsx::IO_GX_GPU_SYSTEM_VRAM_SIZE, (2u << 16u) | 2u);
	harness.memory.writeMappedU32LE(bmsx::IO_GX_GPU_SYSTEM_VRAM_CONTROL, bmsx::GX_GPU_SYSTEM_VRAM_PORT_CONTROL_START);
	harness.memory.writeMappedU32LE(bmsx::IO_GX_GPU_SYSTEM_VRAM_DATA, 0xfc00801fu);
	harness.memory.writeMappedU32LE(bmsx::IO_GX_GPU_SYSTEM_VRAM_DATA, 0xffff83e0u);
	const bmsx::GxGpuState state = harness.gpu.captureState();
	require(state.gp0CommandWordCount == gp0Before.gp0CommandWordCount
		&& state.gp0CommandTargetWordCount == gp0Before.gp0CommandTargetWordCount
		&& state.gp0CommandWords == gp0Before.gp0CommandWords,
		"GX system transfer MMIO preserves interrupted GP0 assembly");

	harness.gpu.presentReadyFrameOnVblankEdge();
	const bmsx::GxGpuDeviceOutput& output = harness.gpu.readDeviceOutput();
	require(harness.gpu.lastFrameCommitted(), "GX-GPU commits a frame containing only system-display work");

	SoftwareFrameHarness frame(output.commandBuffer, output.readbackPort, output.systemVramPort);
	*frame.vramSnapshot = output.vramSnapshotBytes;
	frame.state.vramSnapshotSerial = output.vramSnapshotSerial;
	frame.state.statusWord = output.statusWord;
	frame.state.displayModeWord = output.displayModeWord;
	frame.state.displayStartWord = output.displayStartWord;
	frame.state.display2StartWord = output.display2StartWord;
	frame.state.display2SizeWord = output.display2SizeWord;
	frame.state.compositorControlWord = output.compositorControlWord;
	bmsx::renderGxGpuSoftwareFrame(frame.backend, frame.state);
	require(frame.framebuffer[0u] == 0xffff0000u && frame.framebuffer[1u] == 0xff0000ffu
		&& frame.framebuffer[256u] == 0xff00ff00u && frame.framebuffer[257u] == 0xffffffffu,
		"GX display2 composes A1RGB555 from the shared system VRAM window");
	require(frame.framebuffer[2u] == 0xff000000u, "GX display2 geometry excludes VRAM outside its programmed window");
}

} // namespace

int main() {
	testGp0RawDrawWordDecoders();
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
	testGp0MmioWriteReadyTracksFifoCapacity();
	testGp1CrtcRangeRegistersLatchMaskedRawWords();
	testGp0IrqRequestAndGp1Acknowledge();
	testGp0DrawModeAndMaskBitEnvironmentCommands();
	testGp0EnvironmentRegistersAndGpuInfoQueries();
	testGp0FixedLengthRenderAndBlitPacketAssembly();
	testGp0CpuToVramImagePayloadConsumption();
	testGp0PolylineConsumesPayloadUntilTerminator();
	testSaveStateRestoresPartialFixedGp0Command();
	testSaveStateRestoresPartialCpuToVramUpload();
	testSaveStateRestoresPartialPolylineCommand();
	testSaveStateRestoresCommandTimeAndFifoSuffixRelativeToSchedulerTime();
	testGp1ClearCutsActiveC0AtExecutionFrontierWithoutCancelingDraws();
	testGp1ResetCancelsRestoredActiveC0Deadline();
	testGp1ClearFifoClearsPartialGp0PacketsAndFlushesPartialCpuToVramUploads();
	testSoftwareTextureModulationMath();
	testGpureadFencesBackendWorkAndPacksWrappedOddPixels();
	testGpureadPreservesRowMajorOrderAcrossXAndYWrap();
	testGpureadQueuesLaterC0BehindActiveFence();
	testGpureadDoesNotClaimC0AppendedAfterPublishedFence();
	testGp1ClearFifoAbortsPendingGpureadWithoutDroppingPriorCommands();
	testGp1ClearFifoAbortsReadyGpureadAndQueuedSuffix();
	testGpureadRestoreRearmsSubmittedAndResetClearsRequest();
	testSoftwareBackendConsumesOnlyPresentableCommands();
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
	testSoftwareScanoutUsesNativeOutputDimensions();
	testSoftwareScanoutWeavesCurrent480iFieldIntoRetainedOutputLines();
	testSoftwareBackendRetiresCommandLogWithoutClearingVram();
	testCommandBufferRestoreRepublishesRetainedStream();
	testCommandBufferRetireCompactsPresentedCommandStream();
	testCommandBufferRetirePreservesPartialPayloadWords();
	testSoftwareScanoutConsumesSolidPrimitives();
	testSoftwareScanoutConsumesTexturedPrimitives();
	testSoftwareCommandsPreserveTextureMaskBlendAndMaskTestStoreSemantics();
	testSoftwareCommandsSamplePalette8RectangleFlipAndDitheredModulation();
	testMmioGp0Gp1();
	testSystemVramTransferAndDisplay2Ownership();
	return 0;
}
