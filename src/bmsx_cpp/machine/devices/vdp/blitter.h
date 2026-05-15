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
	GlyphRun = 6,
	TileRun = 7,
};

struct VdpBlitterCommandBuffer {
	size_t length = 0u;
	size_t glyphEntryCount = 0u;
	size_t tileEntryCount = 0u;

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
	std::array<u32, VDP_BLITTER_FIFO_CAPACITY> glyphRunFirstEntry{};
	std::array<u32, VDP_BLITTER_FIFO_CAPACITY> glyphRunEntryCount{};
	std::array<u32, VDP_BLITTER_FIFO_CAPACITY> tileRunFirstEntry{};
	std::array<u32, VDP_BLITTER_FIFO_CAPACITY> tileRunEntryCount{};

	std::array<u32, VDP_BLITTER_RUN_ENTRY_CAPACITY> glyphSurfaceId{};
	std::array<u32, VDP_BLITTER_RUN_ENTRY_CAPACITY> glyphSrcX{};
	std::array<u32, VDP_BLITTER_RUN_ENTRY_CAPACITY> glyphSrcY{};
	std::array<u32, VDP_BLITTER_RUN_ENTRY_CAPACITY> glyphWidth{};
	std::array<u32, VDP_BLITTER_RUN_ENTRY_CAPACITY> glyphHeight{};
	std::array<f32, VDP_BLITTER_RUN_ENTRY_CAPACITY> glyphDstX{};
	std::array<f32, VDP_BLITTER_RUN_ENTRY_CAPACITY> glyphDstY{};
	std::array<u32, VDP_BLITTER_RUN_ENTRY_CAPACITY> glyphAdvance{};

	std::array<u32, VDP_BLITTER_RUN_ENTRY_CAPACITY> tileSurfaceId{};
	std::array<u32, VDP_BLITTER_RUN_ENTRY_CAPACITY> tileSrcX{};
	std::array<u32, VDP_BLITTER_RUN_ENTRY_CAPACITY> tileSrcY{};
	std::array<u32, VDP_BLITTER_RUN_ENTRY_CAPACITY> tileWidth{};
	std::array<u32, VDP_BLITTER_RUN_ENTRY_CAPACITY> tileHeight{};
	std::array<f32, VDP_BLITTER_RUN_ENTRY_CAPACITY> tileDstX{};
	std::array<f32, VDP_BLITTER_RUN_ENTRY_CAPACITY> tileDstY{};

	void reset();
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
