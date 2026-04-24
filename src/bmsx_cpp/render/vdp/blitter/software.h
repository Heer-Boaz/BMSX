#pragma once

#include "machine/devices/vdp/vdp.h"

namespace bmsx {

struct VdpSoftwareBlitter {
	static void execute(VDP& vdp, const std::vector<VDP::BlitterCommand>& queue);

private:
	static void resetFrameBufferPriority();
	static void blendFrameBufferPixel(std::vector<u8>& pixels, size_t index, u8 r, u8 g, u8 b, u8 a, Layer2D layer, f32 z, u32 seq);
	static void rasterizeFrameBufferFill(VDP& vdp, std::vector<u8>& pixels, f32 x0, f32 y0, f32 x1, f32 y1, const VDP::FrameBufferColor& color, Layer2D layer, f32 z, u32 seq);
	static void rasterizeFrameBufferLine(VDP& vdp, std::vector<u8>& pixels, f32 x0, f32 y0, f32 x1, f32 y1, f32 thickness, const VDP::FrameBufferColor& color, Layer2D layer, f32 z, u32 seq);
	static void rasterizeFrameBufferBlit(VDP& vdp, std::vector<u8>& pixels, const VDP::BlitterSource& source, f32 dstX, f32 dstY, f32 scaleX, f32 scaleY, bool flipH, bool flipV, const VDP::FrameBufferColor& color, Layer2D layer, f32 z, u32 seq);
	static void copyFrameBufferRect(VDP& vdp, std::vector<u8>& pixels, i32 srcX, i32 srcY, i32 width, i32 height, i32 dstX, i32 dstY, Layer2D layer, f32 z, u32 seq);
};

} // namespace bmsx
