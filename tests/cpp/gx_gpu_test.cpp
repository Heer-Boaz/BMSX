#include "machine/devices/gx/gpu.h"
#include "machine/bus/io.h"
#include "machine/cpu/cpu.h"
#include "machine/memory/memory.h"
#include "machine/model_registry.h"
#include "machine/scheduler/device.h"

#include <array>
#include <cstdint>
#include <stdexcept>

namespace {

struct GpuHarness {
	std::array<uint8_t, 1> emptyRom{{0}};
	bmsx::Memory memory;
	bmsx::CPU cpu;
	bmsx::DeviceScheduler scheduler;
	bmsx::GxGpu gpu;

	GpuHarness()
		: memory(bmsx::MemoryInit{ { emptyRom.data(), 0u }, { emptyRom.data(), 0u } })
		, cpu(memory)
		, scheduler(cpu)
		, gpu(memory, scheduler) {
		gpu.reset();
	}
};

void require(bool condition, const char* message) {
	if (!condition) {
		throw std::runtime_error(message);
	}
}

void testGp0RawDrawWordDecoders() {
	require(bmsx::gxGpuSigned11(0x000003ffu) == 1023, "GX-GPU signed 11-bit positive coordinate");
	require(bmsx::gxGpuSigned11(0x00000400u) == -1024, "GX-GPU signed 11-bit minimum coordinate");
	require(bmsx::gxGpuSigned11(0x000007ffu) == -1, "GX-GPU signed 11-bit negative coordinate");

	require(bmsx::gxGpuVertexX(0x000007ffu) == -1, "GX-GPU vertex x decode");
	require(bmsx::gxGpuVertexY(0x07ff0000u) == -1, "GX-GPU vertex y decode");
	require(bmsx::gxGpuDisplayStartX(123u | (456u << 10u)) == 123u, "GX-GPU display start x decode");
	require(bmsx::gxGpuDisplayStartY(123u | (456u << 10u)) == 456u, "GX-GPU display start y decode");
	require(bmsx::gxGpuDisplayModeScreenWidth(0u) == 256u, "GX-GPU 256-wide display mode");
	require(bmsx::gxGpuDisplayModeScreenWidth(1u) == 320u, "GX-GPU 320-wide display mode");
	require(bmsx::gxGpuDisplayModeScreenWidth(2u) == 512u, "GX-GPU 512-wide display mode");
	require(bmsx::gxGpuDisplayModeScreenWidth(3u) == 640u, "GX-GPU 640-wide display mode");
	require(bmsx::gxGpuDisplayModeScreenWidth(0x40u) == 368u, "GX-GPU 368-wide display mode");
	require(bmsx::gxGpuDisplayModeScreenWidth(0x41u) == 384u, "GX-GPU 384-wide display mode");
	require(bmsx::gxGpuDisplayModeDotClockDivider(0u) == 10u, "GX-GPU 256-wide dot clock divider");
	require(bmsx::gxGpuDisplayModeDotClockDivider(1u) == 8u, "GX-GPU 320-wide dot clock divider");
	require(bmsx::gxGpuDisplayModeDotClockDivider(2u) == 5u, "GX-GPU 512-wide dot clock divider");
	require(bmsx::gxGpuDisplayModeDotClockDivider(3u) == 4u, "GX-GPU 640-wide dot clock divider");
	require(bmsx::gxGpuDisplayModeDotClockDivider(0x40u) == 7u, "GX-GPU 368-wide dot clock divider");
	require(bmsx::gxGpuDisplayModeDotClockDivider(0x41u) == 7u, "GX-GPU 384-wide dot clock divider");
	require(bmsx::gxGpuHorizontalDisplayRangeStart(0x00c60260u) == 0x260u, "GX-GPU horizontal display start decode");
	require(bmsx::gxGpuHorizontalDisplayRangeEnd(0x00c60260u) == 0xc60u, "GX-GPU horizontal display end decode");
	require(bmsx::gxGpuHorizontalVisibleColumns(0x00c60260u, 1u) == 320u, "GX-GPU horizontal columns default 320 range");
	require(bmsx::gxGpuHorizontalVisibleColumns((0xc5fu << 12u) | 0x260u, 1u) == 320u, "GX-GPU horizontal columns round to multiple of four");
	require(bmsx::gxGpuHorizontalVisibleColumns((0xc3fu << 12u) | 0x260u, 1u) == 316u, "GX-GPU horizontal columns shortened multiple of four");
	require(bmsx::gxGpuHorizontalVisibleColumns(0x00c60260u, 0x40u) == 364, "GX-GPU horizontal columns 368 dot-clock default range");
	require(bmsx::gxGpuHorizontalVisibleColumns(0x00c70260u, 0x40u) == 368, "GX-GPU horizontal columns 368 display mode");
	require(bmsx::gxGpuHorizontalVisibleColumns(0x00ce0260u, 0x41u) == 384, "GX-GPU horizontal columns 384 display mode");
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
	require(bmsx::gxGpuVramCopyNeedsChunking(10u, 20u, 12u, 24u, 32u, 16u), "GX-GPU diagonal overlapping copy chunks");
	require(bmsx::gxGpuVramCopyChunkHeight(20u, 24u, 16u) == 4u, "GX-GPU diagonal overlapping copy chunk height");
	require(!bmsx::gxGpuVramCopyNeedsChunking(10u, 20u, 10u, 24u, 32u, 16u), "GX-GPU vertical-only copy is not chunked");
	require(!bmsx::gxGpuVramCopyNeedsChunking(10u, 20u, 12u, 20u, 32u, 16u), "GX-GPU horizontal-only copy is not chunked");
	require(!bmsx::gxGpuVramCopyNeedsChunking(10u, 20u, 50u, 24u, 32u, 16u), "GX-GPU separated X copy is not chunked");
	require(!bmsx::gxGpuVramCopyNeedsChunking(10u, 20u, 12u, 40u, 32u, 16u), "GX-GPU separated Y copy is not chunked");
	require(bmsx::gxGpuVramCopyChunkHeight(20u, 80u, 16u) == 16u, "GX-GPU non-overlapping row distance clamps to height");

	require(bmsx::gxGpuTransferX(0x01ff03ffu) == 1023u, "GX-GPU transfer x decode");
	require(bmsx::gxGpuTransferY(0x01ff03ffu) == 511u, "GX-GPU transfer y decode");
	require(bmsx::gxGpuTransferWidth(0u) == 1024u, "GX-GPU zero transfer width means full VRAM row");
	require(bmsx::gxGpuTransferHeight(0u) == 512u, "GX-GPU zero transfer height means full VRAM height");
	require(bmsx::gxGpuTransferWidth(0x012c0007u) == 7u, "GX-GPU transfer width decode");
	require(bmsx::gxGpuTransferHeight(0x012c0007u) == 300u, "GX-GPU transfer height decode");
	require(bmsx::gxGpuTransferPixelWord(0x89abcdefu, 0u) == 0xcdefu, "GX-GPU transfer low pixel word");
	require(bmsx::gxGpuTransferPixelWord(0x89abcdefu, 1u) == 0x89abu, "GX-GPU transfer high pixel word");

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
	require(bmsx::gxGpuTextureModulationPreDither(31u, 128u) == 248u, "GX-GPU texture modulation pre-dither half intensity");
	require(bmsx::gxGpuTextureModulationChannel5(31u, 128u, 0) == 31u, "GX-GPU texture modulation half intensity preserves white");
	require(bmsx::gxGpuTextureModulationChannel5(31u, 255u, 3) == 31u, "GX-GPU texture modulation saturates high dither");
	require(bmsx::gxGpuTextureModulationChannel5(1u, 16u, -4) == 0u, "GX-GPU texture modulation clamps low dither");
	require(bmsx::gxGpuTextureModulationChannel5(12u, 96u, 0) == 9u, "GX-GPU texture modulation divides by 128");
	require(bmsx::gxGpuDrawModeTextureRectangleXFlip(bmsx::GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP), "GX-GPU textured rectangle X flip bit enabled");
	require(!bmsx::gxGpuDrawModeTextureRectangleXFlip(bmsx::GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_Y_FLIP), "GX-GPU textured rectangle X flip bit disabled");
	require(bmsx::gxGpuDrawModeTextureRectangleYFlip(bmsx::GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_Y_FLIP), "GX-GPU textured rectangle Y flip bit enabled");
	require(!bmsx::gxGpuDrawModeTextureRectangleYFlip(bmsx::GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP), "GX-GPU textured rectangle Y flip bit disabled");
	require(bmsx::gxGpuTextureRectangleEdge0(7u, false) == 7, "GX-GPU textured rectangle unflipped edge0");
	require(bmsx::gxGpuTextureRectangleEdge1(7, 16u, false) == 23, "GX-GPU textured rectangle unflipped edge1");
	require(bmsx::gxGpuTextureRectangleEdge0(7u, true) == 8, "GX-GPU textured rectangle flipped edge0");
	require(bmsx::gxGpuTextureRectangleEdge1(8, 16u, true) == -8, "GX-GPU textured rectangle flipped edge1");
	require(bmsx::gxGpuTextureRectangleEdge0(0u, true) == 1, "GX-GPU textured rectangle zero flipped edge0");
	require(bmsx::gxGpuTextureRectangleEdge1(1, 16u, true) == -15, "GX-GPU textured rectangle zero flipped edge1");
	require(!bmsx::gxGpuSegmentExceedsPrimitiveSize(0, 0, 1023, 0), "GX-GPU primitive-size line accepts 1024-pixel width");
	require(bmsx::gxGpuSegmentExceedsPrimitiveSize(0, 0, 1024, 0), "GX-GPU primitive-size line rejects 1025-pixel width");
	require(!bmsx::gxGpuSegmentExceedsPrimitiveSize(0, 0, 0, 511), "GX-GPU primitive-size line accepts 512-pixel height");
	require(bmsx::gxGpuSegmentExceedsPrimitiveSize(0, 0, 0, 512), "GX-GPU primitive-size line rejects 513-pixel height");
	require(!bmsx::gxGpuTriangleExceedsPrimitiveSize(0, 0, 1023, 0, 0, 511), "GX-GPU primitive-size triangle accepts full bounds");
	require(bmsx::gxGpuTriangleExceedsPrimitiveSize(0, 0, 1024, 0, 0, 511), "GX-GPU primitive-size triangle rejects wide bounds");
	require(bmsx::gxGpuTriangleExceedsPrimitiveSize(0, 0, 1023, 0, 0, 512), "GX-GPU primitive-size triangle rejects tall bounds");
	require(!bmsx::gxGpuTriangleExceedsPrimitiveSize(-512, -256, 511, 255, 0, 0), "GX-GPU primitive-size triangle accepts signed full bounds");
	require(bmsx::gxGpuTriangleExceedsPrimitiveSize(-513, -256, 511, 255, 0, 0), "GX-GPU primitive-size triangle rejects signed wide bounds");
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

	gpu.writeGp1((bmsx::GX_GPU_GP1_SET_ALLOW_TEXTURE_DISABLE << 24u) | 1u);
	gpu.writeGp1((bmsx::GX_GPU_GP1_SET_DISPLAY_MODE << 24u) | 0x00000000u);
	require(gpu.readDisplayModeWord() == 0u, "GX-GPU GP1 display NTSC before reset");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_PAL_MODE) == 0u, "GX-GPU GP1 PAL bit clear before reset");

	require(gpu.writeGp1(bmsx::GX_GPU_GP1_RESET << 24u) == bmsx::GX_GPU_GP1_RESET, "GX-GPU GP1 reset opcode");

	require(gpu.readTextureDisableAllowedWord() == 1u, "GX-GPU GP1 reset preserves texture-disable allowance");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_TEXTURE_DISABLE) == 0u, "GX-GPU GP1 reset clears texture-disable status bit");
	require(gpu.readDisplayModeWord() == bmsx::PSX_GPU_DISPLAY_MODE_PAL_WORD, "GX-GPU GP1 reset display mode");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_PAL_MODE) == bmsx::GX_GPU_STATUS_PAL_MODE, "GX-GPU GP1 reset PAL bit");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_RESET_WORD) == bmsx::GX_GPU_STATUS_RESET_WORD, "GX-GPU GP1 reset base bits");
}

void testDisplayModeStatusBits() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;

	gpu.writeGp1((bmsx::GX_GPU_GP1_SET_DISPLAY_MODE << 24u) | 0x00ffffffu);

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

	gpu.writeGp1((bmsx::GX_GPU_GP1_SET_DISPLAY_MODE << 24u) | 0x00000000u);
	gpu.setScanoutTiming(false, 0, 100, 10);
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_DISPLAY_LINE_LSB) == 0u, "GX-GPU scanout starts on even line");

	harness.scheduler.advanceTo(30);
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_DISPLAY_LINE_LSB) == bmsx::GX_GPU_STATUS_DISPLAY_LINE_LSB, "GX-GPU GPUSTAT line LSB follows current scanline");

	gpu.writeGp1((bmsx::GX_GPU_GP1_SET_DISPLAY_START << 24u) | (7u << 10u));
	gpu.writeGp1((bmsx::GX_GPU_GP1_SET_DISPLAY_MODE << 24u) | 0x00000024u);
	gpu.setScanoutTiming(true, 90, 100, 10);
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_DISPLAY_LINE_LSB) == bmsx::GX_GPU_STATUS_DISPLAY_LINE_LSB, "GX-GPU 480i vblank display line bit uses display start");
	gpu.setScanoutTiming(false, 0, 100, 10);
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_INTERLACED_FIELD) == 0u, "GX-GPU GPUSTAT interlaced field toggles on next frame");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_DISPLAY_LINE_LSB) == 0u, "GX-GPU 480i active display line bit follows display field");
}

void testInterlacedRenderCommandWords() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;
	const bmsx::GxGpuCommandBuffer& commands = *gpu.readDeviceOutput().commandBuffer;

	require(bmsx::gxGpuSkipDrawingToActiveField(bmsx::GX_GPU_STATUS_VERTICAL_RESOLUTION | bmsx::GX_GPU_STATUS_VERTICAL_INTERLACE), "GX-GPU detects PSX skip-active-field mode");
	require(!bmsx::gxGpuSkipDrawingToActiveField(bmsx::GX_GPU_STATUS_VERTICAL_RESOLUTION | bmsx::GX_GPU_STATUS_VERTICAL_INTERLACE | (1u << 10u)), "GX-GPU displayed-field draw bit disables skip-active-field mode");
	require(bmsx::gxGpuInterlacedRenderWord(bmsx::GX_GPU_STATUS_VERTICAL_RESOLUTION | bmsx::GX_GPU_STATUS_VERTICAL_INTERLACE, 1u) == (bmsx::GX_GPU_INTERLACED_RENDER_ENABLE | bmsx::GX_GPU_INTERLACED_RENDER_ACTIVE_LINE_LSB), "GX-GPU interlaced render word carries active line LSB");
	require(bmsx::gxGpuInterlacedRenderWord(bmsx::GX_GPU_STATUS_VERTICAL_RESOLUTION | bmsx::GX_GPU_STATUS_VERTICAL_INTERLACE | (1u << 10u), 1u) == 0u, "GX-GPU interlaced render word clears when both fields are drawable");

	gpu.writeGp1((bmsx::GX_GPU_GP1_SET_DISPLAY_START << 24u) | (7u << 10u));
	gpu.writeGp1((bmsx::GX_GPU_GP1_SET_DISPLAY_MODE << 24u) | 0x00000024u);
	gpu.writeGp0((bmsx::GX_GPU_GP0_POLYGON_FIRST << 24u) | 0x00010203u);
	gpu.writeGp0(0x00000000u);
	gpu.writeGp0(0x00000001u);
	gpu.writeGp0(0x00000002u);

	require(commands.commandCount == 1u, "GX-GPU records first interlaced polygon command");
	require(commands.commandInterlacedRenderWord[0] == (bmsx::GX_GPU_INTERLACED_RENDER_ENABLE | bmsx::GX_GPU_INTERLACED_RENDER_ACTIVE_LINE_LSB), "GX-GPU command captures interlaced active line");

	gpu.writeGp0((bmsx::GX_GPU_GP0_SET_DRAW_MODE << 24u) | (1u << 10u));
	gpu.writeGp0((bmsx::GX_GPU_GP0_POLYGON_FIRST << 24u) | 0x00010203u);
	gpu.writeGp0(0x00000000u);
	gpu.writeGp0(0x00000001u);
	gpu.writeGp0(0x00000002u);

	require(commands.commandCount == 2u, "GX-GPU records second interlaced polygon command");
	require(commands.commandInterlacedRenderWord[1] == 0u, "GX-GPU command clears interlaced active-line discard when drawing to displayed field");
}

void testDisplayDisableAndDmaDirectionStatusBits() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;

	gpu.writeGp1(bmsx::GX_GPU_GP1_SET_DISPLAY_DISABLE << 24u);
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_DISPLAY_DISABLE) == 0u, "GX-GPU GP1 display enable clears display-disable bit");
	require((gpu.readDeviceOutput().statusWord & bmsx::GX_GPU_STATUS_DISPLAY_DISABLE) == 0u, "GX-GPU output display enable status");

	gpu.writeGp1((bmsx::GX_GPU_GP1_SET_DISPLAY_DISABLE << 24u) | 1u);
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_DISPLAY_DISABLE) == bmsx::GX_GPU_STATUS_DISPLAY_DISABLE, "GX-GPU GP1 display disable bit");
	require((gpu.readDeviceOutput().statusWord & bmsx::GX_GPU_STATUS_DISPLAY_DISABLE) == bmsx::GX_GPU_STATUS_DISPLAY_DISABLE, "GX-GPU output display disable status");

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

	gpu.writeGp1((bmsx::GX_GPU_GP1_SET_DISPLAY_START << 24u) | 0x00000001u);
	require(gpu.readDisplayStartWord() == 0u, "GX-GPU GP1 display start forces even address");
	gpu.writeGp1((bmsx::GX_GPU_GP1_SET_DISPLAY_START << 24u) | 0x00ffffffu);
	gpu.writeGp1((bmsx::GX_GPU_GP1_SET_HORIZONTAL_DISPLAY_RANGE << 24u) | 0x00ffffffu);
	gpu.writeGp1((bmsx::GX_GPU_GP1_SET_VERTICAL_DISPLAY_RANGE << 24u) | 0x00ffffffu);
	gpu.writeGp1((bmsx::GX_GPU_GP1_SET_ALLOW_TEXTURE_DISABLE << 24u) | 0x00ffffffu);

	require(gpu.readDisplayStartWord() == bmsx::GX_GPU_DISPLAY_START_MASK, "GX-GPU GP1 display start mask");
	require(gpu.readHorizontalDisplayRangeWord() == bmsx::GX_GPU_HORIZONTAL_DISPLAY_RANGE_MASK, "GX-GPU GP1 horizontal display range mask");
	require(gpu.readVerticalDisplayRangeWord() == bmsx::GX_GPU_VERTICAL_DISPLAY_RANGE_MASK, "GX-GPU GP1 vertical display range mask");
	require(gpu.readTextureDisableAllowedWord() == 1u, "GX-GPU GP1 texture-disable allowance latch");

	const bmsx::GxGpuDeviceOutput& output = gpu.readDeviceOutput();
	require(output.statusWord == gpu.readStatus(), "GX-GPU output status word");
	require(output.displayModeWord == gpu.readDisplayModeWord(), "GX-GPU output display mode word");
	require(output.displayStartWord == bmsx::GX_GPU_DISPLAY_START_MASK, "GX-GPU output display start word");
	require(output.horizontalDisplayRangeWord == bmsx::GX_GPU_HORIZONTAL_DISPLAY_RANGE_MASK, "GX-GPU output horizontal range word");
	require(output.verticalDisplayRangeWord == bmsx::GX_GPU_VERTICAL_DISPLAY_RANGE_MASK, "GX-GPU output vertical range word");
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

	require(gpu.readDrawModeWord() == (bmsx::GX_GPU_DRAW_MODE_MASK & ~bmsx::GX_GPU_DRAW_MODE_TEXTURE_DISABLE), "GX-GPU GP0 draw-mode ignores texture-disable before GP1 allow");
	require((gpu.readStatus() & bmsx::GX_GPU_DRAW_MODE_GPUSTAT_MASK) == bmsx::GX_GPU_DRAW_MODE_GPUSTAT_MASK, "GX-GPU GP0 draw-mode GPUSTAT bits");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_TEXTURE_DISABLE) == 0u, "GX-GPU GP0 texture-disable ignored before GP1 allow");
	require((gpu.readDrawModeWord() & bmsx::GX_GPU_DRAW_MODE_DITHER_ENABLED) == bmsx::GX_GPU_DRAW_MODE_DITHER_ENABLED, "GX-GPU GP0 dither source bit");
	require((gpu.readDrawModeWord() & bmsx::GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP) == bmsx::GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_X_FLIP, "GX-GPU GP0 textured rectangle X flip source bit");
	require((gpu.readDrawModeWord() & bmsx::GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_Y_FLIP) == bmsx::GX_GPU_DRAW_MODE_TEXTURE_RECTANGLE_Y_FLIP, "GX-GPU GP0 textured rectangle Y flip source bit");

	gpu.writeGp1((bmsx::GX_GPU_GP1_SET_ALLOW_TEXTURE_DISABLE << 24u) | 1u);
	require(gpu.readTextureDisableAllowedWord() == 1u, "GX-GPU GP1 texture-disable allowance raw word");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_TEXTURE_DISABLE) == 0u, "GX-GPU GP1 texture-disable allowance does not set GPUSTAT by itself");
	gpu.writeGp0((bmsx::GX_GPU_GP0_SET_DRAW_MODE << 24u) | 0x00ffffffu);
	require(gpu.readDrawModeWord() == bmsx::GX_GPU_DRAW_MODE_MASK, "GX-GPU GP0 draw-mode accepts texture-disable after GP1 allow");
	require((gpu.readStatus() & bmsx::GX_GPU_STATUS_TEXTURE_DISABLE) == bmsx::GX_GPU_STATUS_TEXTURE_DISABLE, "GX-GPU GP0 texture-disable mirrors to GPUSTAT when allowed");

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
	gpu.writeGp1((bmsx::GX_GPU_GP1_GET_GPU_INFO_LAST << 24u) | 0x02u);
	require(gpu.readGpuReadWord() == bmsx::GX_GPU_TEXTURE_WINDOW_MASK, "GX-GPU GP1 10h-1fh info opcode range");
}

void testGp0FixedLengthRenderAndBlitPacketAssembly() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;
	const bmsx::GxGpuCommandBuffer& commands = *gpu.readDeviceOutput().commandBuffer;

	gpu.writeGp0((bmsx::GX_GPU_GP0_POLYGON_FIRST << 24u) | 0x0000ffu);
	gpu.writeGp0((bmsx::GX_GPU_GP0_SET_DRAW_MODE << 24u) | 0x123456u);
	gpu.writeGp0(0x00020003u);

	require(commands.commandCount == 0u, "GX-GPU GP0 partial polygon has no emitted command");
	require(gpu.readDrawModeWord() == 0u, "GX-GPU GP0 partial polygon payload does not execute draw mode");

	gpu.writeGp0(0x00040005u);
	require(commands.commandCount == 1u, "GX-GPU GP0 flat triangle emitted command count");
	require(commands.commandKind[0] == bmsx::GX_GPU_COMMAND_DRAW_POLYGON, "GX-GPU GP0 flat triangle command kind");
	require(commands.commandOpcode[0] == bmsx::GX_GPU_GP0_POLYGON_FIRST, "GX-GPU GP0 flat triangle opcode");
	require(commands.commandWordCount[0] == 4u, "GX-GPU GP0 flat triangle command words");
	require(commands.words[commands.commandWordStart[0] + 1u] == ((bmsx::GX_GPU_GP0_SET_DRAW_MODE << 24u) | 0x123456u), "GX-GPU GP0 flat triangle raw payload word");
	require(gpu.readDrawModeWord() == 0u, "GX-GPU GP0 completed polygon payload does not execute draw mode");

	const uint32_t texturedGouraudQuad = bmsx::GX_GPU_GP0_POLYGON_FIRST
		| bmsx::GX_GPU_GP0_RENDER_TEXTURE_BIT
		| bmsx::GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT
		| bmsx::GX_GPU_GP0_RENDER_GOURAUD_BIT;
	gpu.writeGp0(texturedGouraudQuad << 24u);
	for (uint32_t index = 1u; index < 12u; index += 1u) {
		gpu.writeGp0(index == 5u ? 0x01830055u : index == 6u ? ((bmsx::GX_GPU_GP0_SET_DRAW_MODE << 24u) | 0x000345u) : index);
	}
	require(commands.commandCount == 2u, "GX-GPU GP0 textured Gouraud quad emitted command count");
	require(commands.commandKind[1] == bmsx::GX_GPU_COMMAND_DRAW_POLYGON, "GX-GPU GP0 textured Gouraud quad command kind");
	require(commands.commandOpcode[1] == texturedGouraudQuad, "GX-GPU GP0 textured Gouraud quad opcode");
	require(commands.commandWordCount[1] == 12u, "GX-GPU GP0 textured Gouraud quad command words");
	require(commands.commandDrawModeWord[1] == 0x0183u, "GX-GPU textured polygon captures texpage draw mode");
	require(gpu.readDrawModeWord() == 0x0183u, "GX-GPU textured polygon writes texpage draw mode");

	gpu.writeGp0(bmsx::GX_GPU_GP0_FILL_RECTANGLE << 24u);
	gpu.writeGp0((bmsx::GX_GPU_GP0_SET_DRAW_MODE << 24u) | 0x000222u);
	require(commands.commandCount == 2u, "GX-GPU GP0 fill rectangle waits for size word");
	gpu.writeGp0(0x000c000du);
	require(commands.commandCount == 3u, "GX-GPU GP0 fill rectangle emitted command count");
	require(commands.commandKind[2] == bmsx::GX_GPU_COMMAND_FILL_RECTANGLE, "GX-GPU GP0 fill rectangle command kind");
	require(commands.commandWordCount[2] == 3u, "GX-GPU GP0 fill rectangle command words");

	gpu.writeGp0((bmsx::GX_GPU_GP0_RECTANGLE_FIRST | bmsx::GX_GPU_GP0_RENDER_TEXTURE_BIT) << 24u);
	gpu.writeGp0((bmsx::GX_GPU_GP0_SET_DRAW_MODE << 24u) | 0x000333u);
	gpu.writeGp0(0x00030004u);
	gpu.writeGp0(0x00050006u);
	require(commands.commandCount == 4u, "GX-GPU GP0 textured variable rectangle emitted command count");
	require(commands.commandKind[3] == bmsx::GX_GPU_COMMAND_DRAW_RECTANGLE, "GX-GPU GP0 textured variable rectangle command kind");
	require(commands.commandWordCount[3] == 4u, "GX-GPU GP0 textured variable rectangle command words");

	gpu.writeGp0(bmsx::GX_GPU_GP0_VRAM_TO_VRAM_FIRST << 24u);
	gpu.writeGp0((bmsx::GX_GPU_GP0_SET_DRAW_MODE << 24u) | 0x000444u);
	gpu.writeGp0(0x00030004u);
	gpu.writeGp0(0x00050006u);
	require(commands.commandCount == 5u, "GX-GPU GP0 VRAM-to-VRAM emitted command count");
	require(commands.commandKind[4] == bmsx::GX_GPU_COMMAND_COPY_VRAM_TO_VRAM, "GX-GPU GP0 VRAM-to-VRAM command kind");
	require(commands.commandWordCount[4] == 4u, "GX-GPU GP0 VRAM-to-VRAM command words");

	gpu.writeGp0((bmsx::GX_GPU_GP0_SET_DRAW_MODE << 24u) | 0x0007ffu);
	require(commands.commandCount == 5u, "GX-GPU GP0 environment command does not emit GPU command");
	require(gpu.readDrawModeWord() == 0x0007ffu, "GX-GPU GP0 command processing resumes after fixed packets");

	gpu.writeGp0(0x40u << 24u);
	gpu.writeGp0(0x00010002u);
	gpu.writeGp0(0x00030004u);
	require(commands.commandCount == 6u, "GX-GPU GP0 line emitted command count");
	require(commands.commandKind[5] == bmsx::GX_GPU_COMMAND_DRAW_LINE, "GX-GPU GP0 line command kind");
	require(commands.commandDrawModeWord[5] == 0x0007ffu, "GX-GPU GP0 line captures draw mode state");
}

void testGp0CpuToVramImagePayloadConsumption() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;
	const bmsx::GxGpuCommandBuffer& commands = *gpu.readDeviceOutput().commandBuffer;

	gpu.writeGp0(bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24u);
	gpu.writeGp0(0x00010002u);
	gpu.writeGp0(0x00020003u);
	require(commands.commandCount == 0u, "GX-GPU GP0 CPU-to-VRAM header waits for payload");

	gpu.writeGp0((bmsx::GX_GPU_GP0_SET_DRAW_MODE << 24u) | 0x000111u);
	gpu.writeGp0((bmsx::GX_GPU_GP0_SET_MASK_BIT << 24u) | 0x000003u);
	require(commands.commandCount == 0u, "GX-GPU GP0 CPU-to-VRAM partial payload has no command");
	gpu.writeGp0((bmsx::GX_GPU_GP0_SET_DRAW_MODE << 24u) | 0x000222u);
	require(commands.commandCount == 1u, "GX-GPU GP0 CPU-to-VRAM emitted command count");
	require(commands.commandKind[0] == bmsx::GX_GPU_COMMAND_UPLOAD_CPU_TO_VRAM, "GX-GPU GP0 CPU-to-VRAM command kind");
	require(commands.commandOpcode[0] == bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST, "GX-GPU GP0 CPU-to-VRAM opcode");
	require(commands.commandWordCount[0] == 6u, "GX-GPU GP0 CPU-to-VRAM command words");
	require(commands.words[commands.commandWordStart[0] + 3u] == ((bmsx::GX_GPU_GP0_SET_DRAW_MODE << 24u) | 0x000111u), "GX-GPU GP0 CPU-to-VRAM first payload word");
	require(commands.words[commands.commandWordStart[0] + 5u] == ((bmsx::GX_GPU_GP0_SET_DRAW_MODE << 24u) | 0x000222u), "GX-GPU GP0 CPU-to-VRAM final payload word");
	require(gpu.readDrawModeWord() == 0u, "GX-GPU GP0 image payload words do not execute draw mode");
	require(gpu.readMaskBitModeWord() == 0u, "GX-GPU GP0 image payload words do not execute mask bit");

	gpu.writeGp0((bmsx::GX_GPU_GP0_SET_DRAW_MODE << 24u) | 0x0007ffu);
	require(commands.commandCount == 1u, "GX-GPU GP0 post-transfer environment command does not emit GPU command");
	require(gpu.readDrawModeWord() == 0x0007ffu, "GX-GPU GP0 command processing resumes after image transfer");
}

void testGp0PolylineConsumesPayloadUntilTerminator() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;
	const bmsx::GxGpuCommandBuffer& commands = *gpu.readDeviceOutput().commandBuffer;

	gpu.writeGp0((0x48u << 24u) | 0x0000ffu);
	gpu.writeGp0(0x00010002u);
	gpu.writeGp0(0x00020003u);
	require(commands.commandCount == 0u, "GX-GPU GP0 polyline waits for terminator");
	gpu.writeGp0(0x50005000u);
	require(commands.commandCount == 1u, "GX-GPU GP0 polyline emitted command count");
	require(commands.commandKind[0] == bmsx::GX_GPU_COMMAND_DRAW_POLYLINE, "GX-GPU GP0 polyline command kind");
	require(commands.commandOpcode[0] == 0x48u, "GX-GPU GP0 polyline opcode");
	require(commands.commandWordCount[0] == 3u, "GX-GPU GP0 polyline command words");
	require(commands.words[commands.commandWordStart[0] + 1u] == 0x00010002u, "GX-GPU GP0 polyline first vertex word");
	require(gpu.readDrawModeWord() == 0u, "GX-GPU GP0 polyline payload does not execute draw mode");

	gpu.writeGp0((bmsx::GX_GPU_GP0_SET_DRAW_MODE << 24u) | 0x000222u);
	require(commands.commandCount == 1u, "GX-GPU GP0 post-polyline environment command does not emit GPU command");
	require(gpu.readDrawModeWord() == 0x000222u, "GX-GPU GP0 command processing resumes after polyline terminator");

	gpu.writeGp0(((0x40u | bmsx::GX_GPU_GP0_RENDER_QUAD_OR_POLYLINE_BIT | bmsx::GX_GPU_GP0_RENDER_GOURAUD_BIT) << 24u) | 0x0000ffu);
	gpu.writeGp0(0x00010002u);
	gpu.writeGp0(0x00010000u);
	gpu.writeGp0(0x00020003u);
	require(commands.commandCount == 1u, "GX-GPU GP0 shaded polyline waits for terminator");
	gpu.writeGp0(0x50005000u);
	require(commands.commandCount == 2u, "GX-GPU GP0 shaded polyline emitted command count");
	require(commands.commandKind[1] == bmsx::GX_GPU_COMMAND_DRAW_POLYLINE, "GX-GPU GP0 shaded polyline command kind");
	require(commands.commandOpcode[1] == 0x58u, "GX-GPU GP0 shaded polyline opcode");
	require(commands.commandWordCount[1] == 4u, "GX-GPU GP0 shaded polyline command words");
	require(commands.words[commands.commandWordStart[1] + 2u] == 0x00010000u, "GX-GPU GP0 shaded polyline second color word");

	gpu.writeGp0((bmsx::GX_GPU_GP0_SET_DRAW_MODE << 24u) | 0x000333u);
	require(commands.commandCount == 2u, "GX-GPU GP0 post-shaded-polyline environment command does not emit GPU command");
	require(gpu.readDrawModeWord() == 0x000333u, "GX-GPU GP0 command processing resumes after shaded polyline terminator");
}

void testGp1ClearFifoClearsPartialGp0PacketAndImageTransfer() {
	GpuHarness harness;
	bmsx::GxGpu& gpu = harness.gpu;
	const bmsx::GxGpuCommandBuffer& commands = *gpu.readDeviceOutput().commandBuffer;

	gpu.writeGp0((bmsx::GX_GPU_GP0_POLYGON_FIRST << 24u) | 0x0000ffu);
	gpu.writeGp0((bmsx::GX_GPU_GP0_SET_DRAW_MODE << 24u) | 0x000111u);
	gpu.writeGp1(bmsx::GX_GPU_GP1_CLEAR_FIFO << 24u);
	require(commands.commandCount == 0u, "GX-GPU GP1 clear FIFO does not emit abandoned partial GP0 command");
	gpu.writeGp0((bmsx::GX_GPU_GP0_SET_DRAW_MODE << 24u) | 0x000222u);
	require(gpu.readDrawModeWord() == 0x000222u, "GX-GPU GP1 clear FIFO clears partial GP0 command");

	gpu.writeGp0(bmsx::GX_GPU_GP0_CPU_TO_VRAM_FIRST << 24u);
	gpu.writeGp0(0x00010002u);
	gpu.writeGp0(0x00020003u);
	gpu.writeGp1(bmsx::GX_GPU_GP1_CLEAR_FIFO << 24u);
	require(commands.commandCount == 0u, "GX-GPU GP1 clear FIFO does not emit abandoned CPU-to-VRAM command");
	gpu.writeGp0((bmsx::GX_GPU_GP0_SET_MASK_BIT << 24u) | 0x000003u);
	require(gpu.readMaskBitModeWord() == 3u, "GX-GPU GP1 clear FIFO clears image transfer state");
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
	testGp0RawDrawWordDecoders();
	testGp1DisplayModeOwnsPalNtsc();
	testGp1ResetRestoresPalDisplayStatus();
	testDisplayModeStatusBits();
	testInterlacedScanoutStatusBits();
	testInterlacedRenderCommandWords();
	testDisplayDisableAndDmaDirectionStatusBits();
	testGp1CrtcRangeRegistersLatchMaskedRawWords();
	testGp0IrqRequestAndGp1Acknowledge();
	testGp0DrawModeAndMaskBitEnvironmentCommands();
	testGp0EnvironmentRegistersAndGpuInfoQueries();
	testGp0FixedLengthRenderAndBlitPacketAssembly();
	testGp0CpuToVramImagePayloadConsumption();
	testGp0PolylineConsumesPayloadUntilTerminator();
	testGp1ClearFifoClearsPartialGp0PacketAndImageTransfer();
	testMmioGp0Gp1();
	return 0;
}
