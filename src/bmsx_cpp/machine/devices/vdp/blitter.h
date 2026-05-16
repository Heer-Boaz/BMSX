#pragma once

#include "common/primitives.h"
#include "machine/devices/vdp/contracts.h"
#include <array>

namespace bmsx {

constexpr size_t VDP_BLITTER_FIFO_CAPACITY = 4096u;
constexpr size_t VDP_BLITTER_RUN_ENTRY_CAPACITY = 16384u;

struct VdpFrameBufferColor {
	u8 r = 255;
	u8 g = 255;
	u8 b = 255;
	u8 a = 255;
};

struct VdpBlitterSource {
	u32 surfaceId = 0;
	u32 srcX = 0;
	u32 srcY = 0;
	u32 width = 0;
	u32 height = 0;
};

struct VdpResolvedBlitterSample {
	VdpBlitterSource source{};
	u32 surfaceWidth = 0;
	u32 surfaceHeight = 0;
	u32 slot = 0;
};

using VdpSkyboxSamples = std::array<VdpResolvedBlitterSample, SKYBOX_FACE_COUNT>;

enum class VdpBlitterCommandType : u8 {
	Clear = 1,
	Blit = 2,
	CopyRect = 3,
	FillRect = 4,
	DrawLine = 5,
	BatchBlit = 6,
};

struct VdpBlitterCommandBuffer {
	size_t length = 0u;
	size_t batchBlitEntryCount = 0u;

	std::array<VdpBlitterCommandType, VDP_BLITTER_FIFO_CAPACITY> opcode{};
	std::array<u32, VDP_BLITTER_FIFO_CAPACITY> seq{};
	std::array<int, VDP_BLITTER_FIFO_CAPACITY> renderCost{};
	std::array<Layer2D, VDP_BLITTER_FIFO_CAPACITY> layer{};
	std::array<f32, VDP_BLITTER_FIFO_CAPACITY> priority{};
	std::array<u32, VDP_BLITTER_FIFO_CAPACITY> sourceSurfaceId{};
	std::array<u32, VDP_BLITTER_FIFO_CAPACITY> sourceSrcX{};
	std::array<u32, VDP_BLITTER_FIFO_CAPACITY> sourceSrcY{};
	std::array<u32, VDP_BLITTER_FIFO_CAPACITY> sourceWidth{};
	std::array<u32, VDP_BLITTER_FIFO_CAPACITY> sourceHeight{};
	std::array<f32, VDP_BLITTER_FIFO_CAPACITY> dstX{};
	std::array<f32, VDP_BLITTER_FIFO_CAPACITY> dstY{};
	std::array<f32, VDP_BLITTER_FIFO_CAPACITY> scaleX{};
	std::array<f32, VDP_BLITTER_FIFO_CAPACITY> scaleY{};
	std::array<u8, VDP_BLITTER_FIFO_CAPACITY> flipH{};
	std::array<u8, VDP_BLITTER_FIFO_CAPACITY> flipV{};
	std::array<u32, VDP_BLITTER_FIFO_CAPACITY> color{};
	std::array<f32, VDP_BLITTER_FIFO_CAPACITY> parallaxWeight{};
	// Blend mode and PMU bank per-command (used for batch-blit setup)
	std::array<u32, VDP_BLITTER_FIFO_CAPACITY> blendMode{};
	std::array<u32, VDP_BLITTER_FIFO_CAPACITY> pmuBank{};
	std::array<i32, VDP_BLITTER_FIFO_CAPACITY> srcX{};
	std::array<i32, VDP_BLITTER_FIFO_CAPACITY> srcY{};
	std::array<i32, VDP_BLITTER_FIFO_CAPACITY> width{};
	std::array<i32, VDP_BLITTER_FIFO_CAPACITY> height{};
	std::array<f32, VDP_BLITTER_FIFO_CAPACITY> x0{};
	std::array<f32, VDP_BLITTER_FIFO_CAPACITY> y0{};
	std::array<f32, VDP_BLITTER_FIFO_CAPACITY> x1{};
	std::array<f32, VDP_BLITTER_FIFO_CAPACITY> y1{};
	std::array<f32, VDP_BLITTER_FIFO_CAPACITY> thickness{};
	std::array<u32, VDP_BLITTER_FIFO_CAPACITY> backgroundColor{};
	std::array<u8, VDP_BLITTER_FIFO_CAPACITY> hasBackgroundColor{};
	std::array<u32, VDP_BLITTER_FIFO_CAPACITY> lineHeight{};
	std::array<u32, VDP_BLITTER_FIFO_CAPACITY> batchBlitFirstEntry{};
	std::array<u32, VDP_BLITTER_FIFO_CAPACITY> batchBlitItemCount{};
	std::array<u32, VDP_BLITTER_FIFO_CAPACITY> tileRunEntryCount{};

	std::array<u32, VDP_BLITTER_RUN_ENTRY_CAPACITY> batchBlitSurfaceId{};
	std::array<u32, VDP_BLITTER_RUN_ENTRY_CAPACITY> batchBlitSrcX{};
	std::array<u32, VDP_BLITTER_RUN_ENTRY_CAPACITY> batchBlitSrcY{};
	std::array<u32, VDP_BLITTER_RUN_ENTRY_CAPACITY> batchBlitWidth{};
	std::array<u32, VDP_BLITTER_RUN_ENTRY_CAPACITY> batchBlitHeight{};
	std::array<f32, VDP_BLITTER_RUN_ENTRY_CAPACITY> batchBlitDstX{};
	std::array<f32, VDP_BLITTER_RUN_ENTRY_CAPACITY> batchBlitDstY{};
	std::array<u32, VDP_BLITTER_RUN_ENTRY_CAPACITY> batchBlitAdvance{};

	std::array<u32, VDP_BLITTER_RUN_ENTRY_CAPACITY> tileSurfaceId{};
	std::array<u32, VDP_BLITTER_RUN_ENTRY_CAPACITY> tileSrcX{};
	std::array<u32, VDP_BLITTER_RUN_ENTRY_CAPACITY> tileSrcY{};
	std::array<u32, VDP_BLITTER_RUN_ENTRY_CAPACITY> tileWidth{};
	std::array<u32, VDP_BLITTER_RUN_ENTRY_CAPACITY> tileHeight{};
	std::array<f32, VDP_BLITTER_RUN_ENTRY_CAPACITY> tileDstX{};
	std::array<f32, VDP_BLITTER_RUN_ENTRY_CAPACITY> tileDstY{};

	void reset();
	void writeClear(size_t index, u32 clearColor);
	void writeGeometryColor(size_t index, Layer2D commandLayer, f32 commandPriority, f32 x0Value, f32 y0Value, f32 x1Value, f32 y1Value, u32 drawColor);
	void writeGeometryColorThickness(size_t index, Layer2D commandLayer, f32 commandPriority, f32 x0Value, f32 y0Value, f32 x1Value, f32 y1Value, u32 drawColor, f32 thicknessValue);
	void writeBlit(size_t index, Layer2D commandLayer, f32 commandPriority, const VdpBlitterSource& source, f32 dstXValue, f32 dstYValue, f32 scaleXValue, f32 scaleYValue, bool flipHValue, bool flipVValue, u32 drawColor, f32 parallax);
	void writeCopyRect(size_t index, Layer2D commandLayer, f32 commandPriority, i32 srcXValue, i32 srcYValue, i32 widthValue, i32 heightValue, i32 dstXValue, i32 dstYValue);
	bool writeBatchBlitBegin(size_t index, u32 drawColor, u32 drawBlendMode, Layer2D commandLayer, f32 commandPriority, u32 drawPmuBank, f32 parallax);
	bool writeBatchBlitItem(size_t index, u32 surfaceId, u32 srcX, u32 srcY, u32 width, u32 height, f32 dstX, f32 dstY, f32 advanceX);
	bool beginCommandSlot(VdpBlitterCommandType commandType, u32 commandSeq, size_t& index);
	void commitCommandSlot(size_t index, int commandRenderCost);
	bool reserve(VdpBlitterCommandType commandType, u32 commandSeq, int commandRenderCost, size_t& index);
};

using VdpBlitterCommand = VdpBlitterCommandBuffer;

constexpr u32 VDP_BLITTER_WHITE = 0xffffffffu;
constexpr u32 VDP_BLITTER_IMPLICIT_CLEAR = 0xff000000u;

u8 frameBufferColorByte(f32 value);
u32 packArgbColor(const VdpFrameBufferColor& value);
VdpFrameBufferColor unpackArgbColor(u32 value);

} // namespace bmsx
