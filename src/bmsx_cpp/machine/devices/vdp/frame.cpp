#include "machine/devices/vdp/frame.h"

namespace bmsx {
namespace {

VdpBlitterSourceSaveState captureBlitterCommandSourceState(const VdpBlitterCommandBuffer& buffer, size_t index) {
	return VdpBlitterSourceSaveState{
		buffer.sourceSurfaceId[index],
		buffer.sourceSrcX[index],
		buffer.sourceSrcY[index],
		buffer.sourceWidth[index],
		buffer.sourceHeight[index],
	};
}

VdpBatchBlitGlyphSaveState captureBatchBlitGlyphState(const VdpBlitterCommandBuffer& buffer, size_t index) {
	VdpBatchBlitGlyphSaveState state;
	state.surfaceId = buffer.batchBlitSurfaceId[index];
	state.srcX = buffer.batchBlitSrcX[index];
	state.srcY = buffer.batchBlitSrcY[index];
	state.width = buffer.batchBlitWidth[index];
	state.height = buffer.batchBlitHeight[index];
	state.dstX = buffer.batchBlitDstX[index];
	state.dstY = buffer.batchBlitDstY[index];
	state.advance = buffer.batchBlitAdvance[index];
	return state;
}

std::vector<VdpBatchBlitGlyphSaveState> captureBatchBlitGlyphs(const VdpBlitterCommandBuffer& buffer, size_t commandIndex) {
	std::vector<VdpBatchBlitGlyphSaveState> states;
	const size_t firstEntry = buffer.batchBlitFirstEntry[commandIndex];
	const size_t entryEnd = firstEntry + buffer.batchBlitItemCount[commandIndex];
	states.reserve(buffer.batchBlitItemCount[commandIndex]);
	for (size_t index = firstEntry; index < entryEnd; ++index) {
		states.push_back(captureBatchBlitGlyphState(buffer, index));
	}
	return states;
}

VdpBlitterCommandSaveState captureBlitterCommandState(const VdpBlitterCommandBuffer& buffer, size_t index) {
	VdpBlitterCommandSaveState state;
	state.opcode = buffer.opcode[index];
	state.seq = buffer.seq[index];
	state.renderCost = buffer.renderCost[index];
	state.layer = buffer.layer[index];
	state.priority = buffer.priority[index];
	state.source = captureBlitterCommandSourceState(buffer, index);
	state.dstX = buffer.dstX[index];
	state.dstY = buffer.dstY[index];
	state.scaleX = buffer.scaleX[index];
	state.scaleY = buffer.scaleY[index];
	state.flipH = buffer.flipH[index] != 0u;
	state.flipV = buffer.flipV[index] != 0u;
	state.color = buffer.color[index];
	state.parallaxWeight = buffer.parallaxWeight[index];
	state.srcX = buffer.srcX[index];
	state.srcY = buffer.srcY[index];
	state.width = buffer.width[index];
	state.height = buffer.height[index];
	state.x0 = buffer.x0[index];
	state.y0 = buffer.y0[index];
	state.x1 = buffer.x1[index];
	state.y1 = buffer.y1[index];
	state.thickness = buffer.thickness[index];
	state.hasBackgroundColor = buffer.hasBackgroundColor[index] != 0u;
	state.backgroundColor = buffer.backgroundColor[index];
	state.lineHeight = buffer.lineHeight[index];
	state.items = captureBatchBlitGlyphs(buffer, index);
	return state;
}

std::vector<VdpBlitterCommandSaveState> captureBlitterCommandBufferState(const VdpBlitterCommandBuffer& buffer) {
	std::vector<VdpBlitterCommandSaveState> states;
	states.reserve(buffer.length);
	for (size_t index = 0u; index < buffer.length; ++index) {
		states.push_back(captureBlitterCommandState(buffer, index));
	}
	return states;
}

void restoreBatchBlitGlyph(VdpBlitterCommandBuffer& buffer, size_t index, const VdpBatchBlitGlyphSaveState& item) {
	buffer.batchBlitSurfaceId[index] = item.surfaceId;
	buffer.batchBlitSrcX[index] = item.srcX;
	buffer.batchBlitSrcY[index] = item.srcY;
	buffer.batchBlitWidth[index] = item.width;
	buffer.batchBlitHeight[index] = item.height;
	buffer.batchBlitDstX[index] = item.dstX;
	buffer.batchBlitDstY[index] = item.dstY;
	buffer.batchBlitAdvance[index] = item.advance;
}

void restoreBlitterCommand(VdpBlitterCommandBuffer& buffer, size_t index, const VdpBlitterCommandSaveState& state) {
	buffer.opcode[index] = state.opcode;
	buffer.seq[index] = state.seq;
	buffer.renderCost[index] = state.renderCost;
	buffer.layer[index] = state.layer;
	buffer.priority[index] = state.priority;
	buffer.sourceSurfaceId[index] = state.source.surfaceId;
	buffer.sourceSrcX[index] = state.source.srcX;
	buffer.sourceSrcY[index] = state.source.srcY;
	buffer.sourceWidth[index] = state.source.width;
	buffer.sourceHeight[index] = state.source.height;
	buffer.dstX[index] = state.dstX;
	buffer.dstY[index] = state.dstY;
	buffer.scaleX[index] = state.scaleX;
	buffer.scaleY[index] = state.scaleY;
	buffer.flipH[index] = state.flipH ? 1u : 0u;
	buffer.flipV[index] = state.flipV ? 1u : 0u;
	buffer.color[index] = state.color;
	buffer.parallaxWeight[index] = state.parallaxWeight;
	buffer.srcX[index] = state.srcX;
	buffer.srcY[index] = state.srcY;
	buffer.width[index] = state.width;
	buffer.height[index] = state.height;
	buffer.x0[index] = state.x0;
	buffer.y0[index] = state.y0;
	buffer.x1[index] = state.x1;
	buffer.y1[index] = state.y1;
	buffer.thickness[index] = state.thickness;
	buffer.hasBackgroundColor[index] = state.hasBackgroundColor ? 1u : 0u;
	buffer.backgroundColor[index] = state.backgroundColor;
	buffer.lineHeight[index] = state.lineHeight;
	buffer.batchBlitFirstEntry[index] = static_cast<u32>(buffer.batchBlitEntryCount);
	buffer.batchBlitItemCount[index] = static_cast<u32>(state.items.size());
	for (size_t itemIndex = 0u; itemIndex < state.items.size(); ++itemIndex) {
		restoreBatchBlitGlyph(buffer, buffer.batchBlitEntryCount + itemIndex, state.items[itemIndex]);
	}
	buffer.batchBlitEntryCount += state.items.size();
}

void restoreBlitterCommandBufferState(VdpBlitterCommandBuffer& buffer, const std::vector<VdpBlitterCommandSaveState>& states) {
	buffer.reset();
	buffer.length = states.size();
	for (size_t index = 0u; index < states.size(); ++index) {
		restoreBlitterCommand(buffer, index, states[index]);
	}
}

VdpBbuBillboardSaveState captureBbuBillboardState(const VdpBbuFrameBuffer& buffer, size_t index) {
	VdpBbuBillboardSaveState state;
	state.seq = buffer.seq[index];
	state.layer = buffer.layer[index];
	state.priority = buffer.priority[index];
	state.positionX = buffer.positionX[index];
	state.positionY = buffer.positionY[index];
	state.positionZ = buffer.positionZ[index];
	state.size = buffer.size[index];
	state.color = buffer.color[index];
	state.source = VdpBlitterSourceSaveState{
		buffer.sourceSurfaceId[index],
		buffer.sourceSrcX[index],
		buffer.sourceSrcY[index],
		buffer.sourceWidth[index],
		buffer.sourceHeight[index],
	};
	state.surfaceWidth = buffer.surfaceWidth[index];
	state.surfaceHeight = buffer.surfaceHeight[index];
	state.slot = buffer.slot[index];
	return state;
}

std::vector<VdpBbuBillboardSaveState> captureBbuFrameBufferState(const VdpBbuFrameBuffer& billboards) {
	std::vector<VdpBbuBillboardSaveState> states;
	states.reserve(billboards.length);
	for (size_t index = 0u; index < billboards.length; ++index) {
		states.push_back(captureBbuBillboardState(billboards, index));
	}
	return states;
}

void restoreBbuFrameBufferState(VdpBbuFrameBuffer& billboards, const std::vector<VdpBbuBillboardSaveState>& states) {
	billboards.reset();
	billboards.length = states.size();
	for (size_t index = 0u; index < states.size(); ++index) {
		const VdpBbuBillboardSaveState& state = states[index];
		billboards.seq[index] = state.seq;
		billboards.layer[index] = state.layer;
		billboards.priority[index] = state.priority;
		billboards.positionX[index] = state.positionX;
		billboards.positionY[index] = state.positionY;
		billboards.positionZ[index] = state.positionZ;
		billboards.size[index] = state.size;
		billboards.color[index] = state.color;
		billboards.sourceSurfaceId[index] = state.source.surfaceId;
		billboards.sourceSrcX[index] = state.source.srcX;
		billboards.sourceSrcY[index] = state.source.srcY;
		billboards.sourceWidth[index] = state.source.width;
		billboards.sourceHeight[index] = state.source.height;
		billboards.surfaceWidth[index] = state.surfaceWidth;
		billboards.surfaceHeight[index] = state.surfaceHeight;
		billboards.slot[index] = state.slot;
	}
}

} // namespace


void resetBuildingFrame(VdpBuildingFrame& frame) {
	frame.queue->reset();
	frame.billboards->reset();
	frame.meshes->reset();
	frame.cost = 0;
	frame.state = VdpDexFrameState::Idle;
}

void resetSubmittedFrameSlot(VdpSubmittedFrame& frame) {
	frame.queue->reset();
	frame.billboards->reset();
	frame.meshes->reset();
	frame.state = VdpSubmittedFrameState::Empty;
	frame.hasCommands = false;
	frame.hasFrameBufferCommands = false;
	frame.cost = 0;
	frame.workRemaining = 0;
	frame.ditherType = 0;
	frame.frameBufferWidth = 0u;
	frame.frameBufferHeight = 0u;
	frame.xf.reset();
	frame.skyboxControl = 0;
	frame.skyboxFaceWords.fill(0u);
	frame.lightRegisterWords.fill(0u);
	frame.morphWeightWords.fill(0u);
	frame.jointMatrixWords.fill(0u);
}

VdpBuildingFrameSaveState captureBuildingFrameState(const VdpBuildingFrame& frame) {
	VdpBuildingFrameSaveState state;
	state.state = frame.state;
	state.queue = captureBlitterCommandBufferState(*frame.queue);
	state.billboards = captureBbuFrameBufferState(*frame.billboards);
	state.cost = frame.cost;
	return state;
}

void restoreBuildingFrameState(VdpBuildingFrame& frame, const VdpBuildingFrameSaveState& state) {
	frame.state = state.state;
	restoreBlitterCommandBufferState(*frame.queue, state.queue);
	restoreBbuFrameBufferState(*frame.billboards, state.billboards);
	frame.cost = state.cost;
}

VdpSubmittedFrameSaveState captureSubmittedFrameState(const VdpSubmittedFrame& frame) {
	VdpSubmittedFrameSaveState state;
	state.state = frame.state;
	state.queue = captureBlitterCommandBufferState(*frame.queue);
	state.billboards = captureBbuFrameBufferState(*frame.billboards);
	state.hasCommands = frame.hasCommands;
	state.hasFrameBufferCommands = frame.hasFrameBufferCommands;
	state.cost = frame.cost;
	state.workRemaining = frame.workRemaining;
	state.ditherType = frame.ditherType;
	state.frameBufferWidth = frame.frameBufferWidth;
	state.frameBufferHeight = frame.frameBufferHeight;
	state.xf = frame.xf.captureState();
	state.skyboxControl = frame.skyboxControl;
	state.skyboxFaceWords = frame.skyboxFaceWords;
	state.skyboxSamples = frame.skyboxSamples;
	state.lightRegisterWords = frame.lightRegisterWords;
	return state;
}

void restoreSubmittedFrameState(VdpSubmittedFrame& frame, const VdpSubmittedFrameSaveState& state) {
	frame.state = state.state;
	restoreBlitterCommandBufferState(*frame.queue, state.queue);
	restoreBbuFrameBufferState(*frame.billboards, state.billboards);
	frame.hasCommands = state.hasCommands;
	frame.hasFrameBufferCommands = state.hasFrameBufferCommands;
	frame.cost = state.cost;
	frame.workRemaining = state.workRemaining;
	frame.ditherType = state.ditherType;
	frame.frameBufferWidth = state.frameBufferWidth;
	frame.frameBufferHeight = state.frameBufferHeight;
	frame.xf.restoreState(state.xf);
	frame.skyboxControl = state.skyboxControl;
	frame.skyboxFaceWords = state.skyboxFaceWords;
	frame.skyboxSamples = state.skyboxSamples;
	frame.lightRegisterWords = state.lightRegisterWords;
}

} // namespace bmsx
