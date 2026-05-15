#include "machine/devices/vdp/frame.h"

namespace bmsx {
namespace {

template<typename Source>
VdpBlitterSourceSaveState captureSourceState(const Source& source) {
	return VdpBlitterSourceSaveState{
		source.surfaceId,
		source.srcX,
		source.srcY,
		source.width,
		source.height,
	};
}

template<typename Source>
void restoreSourceState(Source& target, const VdpBlitterSourceSaveState& state) {
	target.surfaceId = state.surfaceId;
	target.srcX = state.srcX;
	target.srcY = state.srcY;
	target.width = state.width;
	target.height = state.height;
}

VdpGlyphRunGlyphSaveState captureGlyphRunGlyphState(const VdpGlyphRunGlyph& glyph) {
	VdpGlyphRunGlyphSaveState state;
	static_cast<VdpBlitterSourceSaveState&>(state) = captureSourceState(glyph);
	state.dstX = glyph.dstX;
	state.dstY = glyph.dstY;
	state.advance = glyph.advance;
	return state;
}

VdpGlyphRunGlyph restoreGlyphRunGlyph(const VdpGlyphRunGlyphSaveState& state) {
	VdpGlyphRunGlyph glyph;
	restoreSourceState(glyph, state);
	glyph.dstX = state.dstX;
	glyph.dstY = state.dstY;
	glyph.advance = state.advance;
	return glyph;
}

VdpTileRunBlitSaveState captureTileRunBlitState(const VdpTileRunBlit& tile) {
	VdpTileRunBlitSaveState state;
	static_cast<VdpBlitterSourceSaveState&>(state) = captureSourceState(tile);
	state.dstX = tile.dstX;
	state.dstY = tile.dstY;
	return state;
}

VdpTileRunBlit restoreTileRunBlit(const VdpTileRunBlitSaveState& state) {
	VdpTileRunBlit tile;
	restoreSourceState(tile, state);
	tile.dstX = state.dstX;
	tile.dstY = state.dstY;
	return tile;
}

std::vector<VdpGlyphRunGlyphSaveState> captureGlyphRunGlyphs(const std::vector<VdpGlyphRunGlyph>& glyphs) {
	std::vector<VdpGlyphRunGlyphSaveState> states;
	states.reserve(glyphs.size());
	for (const VdpGlyphRunGlyph& glyph : glyphs) {
		states.push_back(captureGlyphRunGlyphState(glyph));
	}
	return states;
}

std::vector<VdpGlyphRunGlyph> restoreGlyphRunGlyphs(const std::vector<VdpGlyphRunGlyphSaveState>& states) {
	std::vector<VdpGlyphRunGlyph> glyphs;
	glyphs.reserve(states.size());
	for (const VdpGlyphRunGlyphSaveState& state : states) {
		glyphs.push_back(restoreGlyphRunGlyph(state));
	}
	return glyphs;
}

std::vector<VdpTileRunBlitSaveState> captureTileRunBlits(const std::vector<VdpTileRunBlit>& tiles) {
	std::vector<VdpTileRunBlitSaveState> states;
	states.reserve(tiles.size());
	for (const VdpTileRunBlit& tile : tiles) {
		states.push_back(captureTileRunBlitState(tile));
	}
	return states;
}

std::vector<VdpTileRunBlit> restoreTileRunBlits(const std::vector<VdpTileRunBlitSaveState>& states) {
	std::vector<VdpTileRunBlit> tiles;
	tiles.reserve(states.size());
	for (const VdpTileRunBlitSaveState& state : states) {
		tiles.push_back(restoreTileRunBlit(state));
	}
	return tiles;
}

VdpBlitterCommandSaveState captureBlitterCommandState(const VdpBlitterCommand& command) {
	VdpBlitterCommandSaveState state;
	state.opcode = command.type;
	state.seq = command.seq;
	state.renderCost = command.renderCost;
	state.layer = command.layer;
	state.priority = command.priority;
	state.source = captureSourceState(command.source);
	state.dstX = command.dstX;
	state.dstY = command.dstY;
	state.scaleX = command.scaleX;
	state.scaleY = command.scaleY;
	state.flipH = command.flipH;
	state.flipV = command.flipV;
	state.color = packArgbColor(command.color);
	state.parallaxWeight = command.parallaxWeight;
	state.srcX = command.srcX;
	state.srcY = command.srcY;
	state.width = command.width;
	state.height = command.height;
	state.x0 = command.x0;
	state.y0 = command.y0;
	state.x1 = command.x1;
	state.y1 = command.y1;
	state.thickness = command.thickness;
	state.hasBackgroundColor = command.backgroundColor.has_value();
	if (state.hasBackgroundColor) {
		state.backgroundColor = packArgbColor(*command.backgroundColor);
	}
	state.lineHeight = command.lineHeight;
	state.glyphs = captureGlyphRunGlyphs(command.glyphs);
	state.tiles = captureTileRunBlits(command.tiles);
	return state;
}

VdpBlitterCommand restoreBlitterCommand(const VdpBlitterCommandSaveState& state) {
	VdpBlitterCommand command;
	command.type = state.opcode;
	command.seq = state.seq;
	command.renderCost = state.renderCost;
	command.layer = state.layer;
	command.priority = state.priority;
	restoreSourceState(command.source, state.source);
	command.dstX = state.dstX;
	command.dstY = state.dstY;
	command.scaleX = state.scaleX;
	command.scaleY = state.scaleY;
	command.flipH = state.flipH;
	command.flipV = state.flipV;
	command.color = unpackArgbColor(state.color);
	command.parallaxWeight = state.parallaxWeight;
	command.srcX = state.srcX;
	command.srcY = state.srcY;
	command.width = state.width;
	command.height = state.height;
	command.x0 = state.x0;
	command.y0 = state.y0;
	command.x1 = state.x1;
	command.y1 = state.y1;
	command.thickness = state.thickness;
	if (state.hasBackgroundColor) {
		command.backgroundColor = unpackArgbColor(state.backgroundColor);
	}
	command.lineHeight = state.lineHeight;
	command.glyphs = restoreGlyphRunGlyphs(state.glyphs);
	command.tiles = restoreTileRunBlits(state.tiles);
	return command;
}

std::vector<VdpBlitterCommandSaveState> captureBlitterCommandBufferState(const std::vector<VdpBlitterCommand>& commands) {
	std::vector<VdpBlitterCommandSaveState> states;
	states.reserve(commands.size());
	for (const VdpBlitterCommand& command : commands) {
		states.push_back(captureBlitterCommandState(command));
	}
	return states;
}

std::vector<VdpBlitterCommand> restoreBlitterCommandBufferState(const std::vector<VdpBlitterCommandSaveState>& states) {
	std::vector<VdpBlitterCommand> commands;
	commands.reserve(states.size());
	for (const VdpBlitterCommandSaveState& state : states) {
		commands.push_back(restoreBlitterCommand(state));
	}
	return commands;
}

VdpBbuBillboardSaveState captureBbuBillboardState(const VdpBbuBillboardEntry& billboard) {
	VdpBbuBillboardSaveState state;
	state.seq = billboard.seq;
	state.layer = billboard.layer;
	state.priority = billboard.priority;
	state.positionX = billboard.positionX;
	state.positionY = billboard.positionY;
	state.positionZ = billboard.positionZ;
	state.size = billboard.size;
	state.color = billboard.color;
	state.source = captureSourceState(billboard.source);
	state.surfaceWidth = billboard.surfaceWidth;
	state.surfaceHeight = billboard.surfaceHeight;
	state.slot = billboard.slot;
	return state;
}

VdpBbuBillboardEntry restoreBbuBillboard(const VdpBbuBillboardSaveState& state) {
	VdpBbuBillboardEntry billboard;
	billboard.seq = state.seq;
	billboard.layer = state.layer;
	billboard.priority = state.priority;
	billboard.positionX = state.positionX;
	billboard.positionY = state.positionY;
	billboard.positionZ = state.positionZ;
	billboard.size = state.size;
	billboard.color = state.color;
	restoreSourceState(billboard.source, state.source);
	billboard.surfaceWidth = state.surfaceWidth;
	billboard.surfaceHeight = state.surfaceHeight;
	billboard.slot = state.slot;
	return billboard;
}

std::vector<VdpBbuBillboardSaveState> captureBbuFrameBufferState(const std::vector<VdpBbuBillboardEntry>& billboards) {
	std::vector<VdpBbuBillboardSaveState> states;
	states.reserve(billboards.size());
	for (const VdpBbuBillboardEntry& billboard : billboards) {
		states.push_back(captureBbuBillboardState(billboard));
	}
	return states;
}

std::vector<VdpBbuBillboardEntry> restoreBbuFrameBufferState(const std::vector<VdpBbuBillboardSaveState>& states) {
	std::vector<VdpBbuBillboardEntry> billboards;
	billboards.reserve(states.size());
	for (const VdpBbuBillboardSaveState& state : states) {
		billboards.push_back(restoreBbuBillboard(state));
	}
	return billboards;
}

} // namespace


void reserveFrameStorage(VdpBuildingFrame& frame) {
	frame.queue.reserve(VDP_BLITTER_FIFO_CAPACITY);
	frame.billboards.reserve(VDP_BBU_BILLBOARD_LIMIT);
	frame.meshes.reserve(VDP_MDU_MESH_LIMIT);
}

void reserveFrameStorage(VdpSubmittedFrame& frame) {
	frame.queue.reserve(VDP_BLITTER_FIFO_CAPACITY);
	frame.billboards.reserve(VDP_BBU_BILLBOARD_LIMIT);
	frame.meshes.reserve(VDP_MDU_MESH_LIMIT);
}

void resetSubmittedFrameSlot(VdpSubmittedFrame& frame) {
	frame.queue.clear();
	frame.billboards.clear();
	frame.meshes.clear();
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
	frame.morphWeightWords.fill(0u);
	frame.jointMatrixWords.fill(0u);
}

VdpBuildingFrameSaveState captureBuildingFrameState(const VdpBuildingFrame& frame) {
	VdpBuildingFrameSaveState state;
	state.state = frame.state;
	state.queue = captureBlitterCommandBufferState(frame.queue);
	state.billboards = captureBbuFrameBufferState(frame.billboards);
	state.cost = frame.cost;
	return state;
}

void restoreBuildingFrameState(VdpBuildingFrame& frame, const VdpBuildingFrameSaveState& state) {
	frame.state = state.state;
	frame.queue = restoreBlitterCommandBufferState(state.queue);
	frame.billboards = restoreBbuFrameBufferState(state.billboards);
	frame.cost = state.cost;
}

VdpSubmittedFrameSaveState captureSubmittedFrameState(const VdpSubmittedFrame& frame) {
	VdpSubmittedFrameSaveState state;
	state.state = frame.state;
	state.queue = captureBlitterCommandBufferState(frame.queue);
	state.billboards = captureBbuFrameBufferState(frame.billboards);
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
	return state;
}

void restoreSubmittedFrameState(VdpSubmittedFrame& frame, const VdpSubmittedFrameSaveState& state) {
	frame.state = state.state;
	frame.queue = restoreBlitterCommandBufferState(state.queue);
	frame.billboards = restoreBbuFrameBufferState(state.billboards);
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
}

} // namespace bmsx
