#pragma once

#include "common/primitives.h"
#include "machine/devices/vdp/blitter.h"
#include "machine/devices/vdp/contracts.h"
#include "machine/devices/vdp/device_output.h"
#include <vector>

namespace bmsx {

class VDP;

class VdpFrameBufferRasterizer final {
public:
	explicit VdpFrameBufferRasterizer(VDP& vdp);

	void executeFrameBufferCommands(const VdpBlitterCommand& commands, u32 frameWidth, u32 frameHeight, std::vector<u8>& pixels);

private:
	void resizeFrameBufferPriorityStorage(size_t pixelCount);
	void resetFrameBufferPriority();
	void fillFrameBuffer(std::vector<u8>& pixels, const VdpFrameBufferColor& color);
	void blendFrameBufferPixel(std::vector<u8>& pixels, size_t pixelIndex, u8 r, u8 g, u8 b, u8 a, Layer2D layer, f32 priority, u32 seq);
	void rasterizeFrameBufferFill(std::vector<u8>& pixels, u32 frameWidth, u32 frameHeight, i32 x0, i32 y0, i32 x1, i32 y1, const VdpFrameBufferColor& color, Layer2D layer, f32 priority, u32 seq);
	void rasterizeFrameBufferLine(std::vector<u8>& pixels, u32 frameWidth, u32 frameHeight, i32 x0, i32 y0, i32 x1, i32 y1, i32 thicknessValue, const VdpFrameBufferColor& color, Layer2D layer, f32 priority, u32 seq);
	void rasterizeFrameBufferBlit(std::vector<u8>& pixels, u32 frameWidth, u32 frameHeight, const VdpBlitterSource& source, i32 dstX, i32 dstY, i32 dstW, i32 dstH, bool flipH, bool flipV, const VdpFrameBufferColor& color, Layer2D layer, f32 priority, u32 seq);

	VDP& m_vdp;
	std::vector<u8> m_frameBufferPriorityLayer;
	std::vector<f32> m_frameBufferPriorityZ;
	std::vector<u32> m_frameBufferPrioritySeq;
	VdpBlitterSource m_latchedSourceScratch{};
};

} // namespace bmsx
