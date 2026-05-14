#pragma once

#include "common/primitives.h"
#include "machine/devices/vdp/contracts.h"
#include <array>
#include <optional>
#include <vector>

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

struct VdpGlyphRunGlyph : VdpBlitterSource {
	f32 dstX = 0.0f;
	f32 dstY = 0.0f;
	u32 advance = 0;
};

struct VdpTileRunBlit : VdpBlitterSource {
	f32 dstX = 0.0f;
	f32 dstY = 0.0f;
};

enum class VdpBlitterCommandType : u8 {
	Clear = 1,
	Blit = 2,
	CopyRect = 3,
	FillRect = 4,
	DrawLine = 5,
	GlyphRun = 6,
	TileRun = 7,
};

struct VdpBlitterCommand {
	VdpBlitterCommandType type = VdpBlitterCommandType::Clear;
	u32 seq = 0;
	int renderCost = 0;
	f32 priority = 0.0f;
	Layer2D layer = Layer2D::World;
	VdpBlitterSource source{};
	f32 dstX = 0.0f;
	f32 dstY = 0.0f;
	f32 scaleX = 1.0f;
	f32 scaleY = 1.0f;
	f32 parallaxWeight = 0.0f;
	bool flipH = false;
	bool flipV = false;
	i32 srcX = 0;
	i32 srcY = 0;
	i32 width = 0;
	i32 height = 0;
	f32 x0 = 0.0f;
	f32 y0 = 0.0f;
	f32 x1 = 0.0f;
	f32 y1 = 0.0f;
	f32 thickness = 1.0f;
	VdpFrameBufferColor color{};
	std::optional<VdpFrameBufferColor> backgroundColor;
	u32 lineHeight = 0;
	std::vector<VdpGlyphRunGlyph> glyphs;
	std::vector<VdpTileRunBlit> tiles;
};

u8 frameBufferColorByte(f32 value);
u32 packArgbColor(const VdpFrameBufferColor& value);
VdpFrameBufferColor unpackArgbColor(u32 value);

} // namespace bmsx
