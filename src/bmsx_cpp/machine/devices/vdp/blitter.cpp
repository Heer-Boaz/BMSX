#include "machine/devices/vdp/blitter.h"

namespace bmsx {

void VdpBlitterCommandBuffer::reset() {
	length = 0u;
	batchBlitEntryCount = 0u;
}

void VdpBlitterCommandBuffer::writeClear(size_t index, u32 clearColor) {
	color[index] = clearColor;
}

void VdpBlitterCommandBuffer::writeGeometryColor(size_t index, Layer2D commandLayer, f32 commandPriority, f32 x0Value, f32 y0Value, f32 x1Value, f32 y1Value, u32 drawColor) {
	layer[index] = commandLayer;
	priority[index] = commandPriority;
	x0[index] = x0Value;
	y0[index] = y0Value;
	x1[index] = x1Value;
	y1[index] = y1Value;
	color[index] = drawColor;
}

void VdpBlitterCommandBuffer::writeGeometryColorThickness(size_t index, Layer2D commandLayer, f32 commandPriority, f32 x0Value, f32 y0Value, f32 x1Value, f32 y1Value, u32 drawColor, f32 thicknessValue) {
	writeGeometryColor(index, commandLayer, commandPriority, x0Value, y0Value, x1Value, y1Value, drawColor);
	thickness[index] = thicknessValue;
}

void VdpBlitterCommandBuffer::writeBlit(size_t index, Layer2D commandLayer, f32 commandPriority, const VdpBlitterSource& source, f32 dstXValue, f32 dstYValue, f32 scaleXValue, f32 scaleYValue, bool flipHValue, bool flipVValue, u32 drawColor, f32 parallax) {
	layer[index] = commandLayer;
	priority[index] = commandPriority;
	sourceSurfaceId[index] = source.surfaceId;
	sourceSrcX[index] = source.srcX;
	sourceSrcY[index] = source.srcY;
	sourceWidth[index] = source.width;
	sourceHeight[index] = source.height;
	dstX[index] = dstXValue;
	dstY[index] = dstYValue;
	scaleX[index] = scaleXValue;
	scaleY[index] = scaleYValue;
	flipH[index] = flipHValue ? 1u : 0u;
	flipV[index] = flipVValue ? 1u : 0u;
	color[index] = drawColor;
	parallaxWeight[index] = parallax;
}

void VdpBlitterCommandBuffer::writeCopyRect(size_t index, Layer2D commandLayer, f32 commandPriority, i32 srcXValue, i32 srcYValue, i32 widthValue, i32 heightValue, i32 dstXValue, i32 dstYValue) {
	layer[index] = commandLayer;
	priority[index] = commandPriority;
	srcX[index] = srcXValue;
	srcY[index] = srcYValue;
	width[index] = widthValue;
	height[index] = heightValue;
	dstX[index] = static_cast<f32>(dstXValue);
	dstY[index] = static_cast<f32>(dstYValue);
}


bool VdpBlitterCommandBuffer::beginCommandSlot(VdpBlitterCommandType commandType, u32 commandSeq, size_t& index) {
	index = length;
	if (index >= VDP_BLITTER_FIFO_CAPACITY) {
		return false;
	}
	opcode[index] = commandType;
	seq[index] = commandSeq;
	renderCost[index] = 0;
	return true;
}

void VdpBlitterCommandBuffer::commitCommandSlot(size_t index, int commandRenderCost) {
	renderCost[index] = commandRenderCost;
	length = index + 1u;
}

bool VdpBlitterCommandBuffer::reserve(VdpBlitterCommandType commandType, u32 commandSeq, int commandRenderCost, size_t& index) {
	if (!beginCommandSlot(commandType, commandSeq, index)) {
		return false;
	}
	commitCommandSlot(index, commandRenderCost);
	return true;
}

u8 frameBufferColorByte(f32 value) {
	return static_cast<u8>(value * 255.0f + 0.5f);
}

u32 packArgbColor(const VdpFrameBufferColor& value) {
	return (static_cast<u32>(value.a) << 24u)
		| (static_cast<u32>(value.r) << 16u)
		| (static_cast<u32>(value.g) << 8u)
		| static_cast<u32>(value.b);
}

VdpFrameBufferColor unpackArgbColor(u32 value) {
	return {
		static_cast<u8>((value >> 16u) & 0xffu),
		static_cast<u8>((value >> 8u) & 0xffu),
		static_cast<u8>(value & 0xffu),
		static_cast<u8>((value >> 24u) & 0xffu),
	};
}

bool VdpBlitterCommandBuffer::writeBatchBlitBegin(size_t index, u32 drawColor, u32 drawBlendMode, Layer2D commandLayer, f32 commandPriority, u32 drawPmuBank, f32 parallax) {
	priority[index] = commandPriority;
	layer[index] = commandLayer;
	color[index] = drawColor;
	parallaxWeight[index] = parallax;
	batchBlitFirstEntry[index] = batchBlitEntryCount;
	batchBlitItemCount[index] = 0;
	return true;
}

bool VdpBlitterCommandBuffer::writeBatchBlitItem(size_t index, u32 surfaceId, u32 srcX, u32 srcY, u32 width, u32 height, f32 dstX, f32 dstY, f32 advanceX) {
	if (batchBlitEntryCount >= VDP_BLITTER_RUN_ENTRY_CAPACITY) {
		return false;
	}
	const size_t entryIndex = batchBlitEntryCount++;
	batchBlitSurfaceId[entryIndex] = surfaceId;
	batchBlitSrcX[entryIndex] = srcX;
	batchBlitSrcY[entryIndex] = srcY;
	batchBlitWidth[entryIndex] = width;
	batchBlitHeight[entryIndex] = height;
	batchBlitDstX[entryIndex] = dstX;
	batchBlitDstY[entryIndex] = dstY;
	batchBlitAdvance[entryIndex] = advanceX;
	batchBlitItemCount[index]++;
	return true;
}
} // namespace bmsx