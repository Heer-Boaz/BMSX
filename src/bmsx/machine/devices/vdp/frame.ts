import { SKYBOX_FACE_COUNT, SKYBOX_FACE_WORD_COUNT, VDP_JTU_REGISTER_WORDS, VDP_MFU_WEIGHT_COUNT } from './contracts';
import { VdpBbuFrameBuffer } from './bbu';
import { VdpBlitterCommandBuffer, type VdpResolvedBlitterSample } from './blitter';
import { VdpMduFrameBuffer } from './mdu';
import { VdpXfUnit, type VdpXfState } from './xf';
import { VDP_LPU_REGISTER_WORDS } from './lpu';

export const VDP_DEX_FRAME_IDLE = 0;
export const VDP_DEX_FRAME_DIRECT_OPEN = 1;
export const VDP_DEX_FRAME_STREAM_OPEN = 2;

export type VdpDexFrameState =
	| typeof VDP_DEX_FRAME_IDLE
	| typeof VDP_DEX_FRAME_DIRECT_OPEN
	| typeof VDP_DEX_FRAME_STREAM_OPEN;

export const VDP_SUBMITTED_FRAME_EMPTY = 0;
export const VDP_SUBMITTED_FRAME_QUEUED = 1;
export const VDP_SUBMITTED_FRAME_EXECUTING = 2;
export const VDP_SUBMITTED_FRAME_READY = 3;

export type VdpSubmittedFrameState =
	| typeof VDP_SUBMITTED_FRAME_EMPTY
	| typeof VDP_SUBMITTED_FRAME_QUEUED
	| typeof VDP_SUBMITTED_FRAME_EXECUTING
	| typeof VDP_SUBMITTED_FRAME_READY;

export type VdpSubmittedFrame = {
	queue: VdpBlitterCommandBuffer;
	state: VdpSubmittedFrameState;
	hasCommands: boolean;
	hasFrameBufferCommands: boolean;
	cost: number;
	workRemaining: number;
	ditherType: number;
	frameBufferWidth: number;
	frameBufferHeight: number;
	xf: VdpXfUnit;
	skyboxControl: number;
	skyboxFaceWords: Uint32Array;
	skyboxSamples: VdpResolvedBlitterSample[];
	billboards: VdpBbuFrameBuffer;
	meshes: VdpMduFrameBuffer;
	lightRegisterWords: Uint32Array;
	morphWeightWords: Uint32Array;
	jointMatrixWords: Uint32Array;
};

export type VdpBuildingFrameState = {
	queue: VdpBlitterCommandBuffer;
	billboards: VdpBbuFrameBuffer;
	meshes: VdpMduFrameBuffer;
	state: VdpDexFrameState;
	cost: number;
};

export type VdpBlitterSourceSaveState = {
	surfaceId: number;
	srcX: number;
	srcY: number;
	width: number;
	height: number;
};

export type VdpGlyphRunGlyphSaveState = VdpBlitterSourceSaveState & {
	dstX: number;
	dstY: number;
	advance: number;
};

export type VdpTileRunBlitSaveState = VdpBlitterSourceSaveState & {
	dstX: number;
	dstY: number;
};

export type VdpBlitterCommandSaveState = {
	opcode: number;
	seq: number;
	renderCost: number;
	layer: number;
	priority: number;
	source: VdpBlitterSourceSaveState;
	dstX: number;
	dstY: number;
	scaleX: number;
	scaleY: number;
	flipH: boolean;
	flipV: boolean;
	color: number;
	parallaxWeight: number;
	srcX: number;
	srcY: number;
	width: number;
	height: number;
	x0: number;
	y0: number;
	x1: number;
	y1: number;
	thickness: number;
	hasBackgroundColor: boolean;
	backgroundColor: number;
	lineHeight: number;
	glyphs: VdpGlyphRunGlyphSaveState[];
	tiles: VdpTileRunBlitSaveState[];
};

export type VdpBbuBillboardSaveState = {
	seq: number;
	layer: number;
	priority: number;
	positionX: number;
	positionY: number;
	positionZ: number;
	size: number;
	color: number;
	source: VdpBlitterSourceSaveState;
	surfaceWidth: number;
	surfaceHeight: number;
	slot: number;
};

export type VdpBuildingFrameSaveState = {
	state: VdpDexFrameState;
	queue: VdpBlitterCommandSaveState[];
	billboards: VdpBbuBillboardSaveState[];
	cost: number;
};

export type VdpSubmittedFrameSaveState = {
	state: VdpSubmittedFrameState;
	queue: VdpBlitterCommandSaveState[];
	billboards: VdpBbuBillboardSaveState[];
	hasCommands: boolean;
	hasFrameBufferCommands: boolean;
	cost: number;
	workRemaining: number;
	ditherType: number;
	frameBufferWidth: number;
	frameBufferHeight: number;
	xf: VdpXfState;
	skyboxControl: number;
	skyboxFaceWords: number[];
	skyboxSamples: VdpResolvedBlitterSample[];
	lightRegisterWords: number[];
};

export function createResolvedBlitterSample(): VdpResolvedBlitterSample {
	return {
		source: {
			surfaceId: 0,
			srcX: 0,
			srcY: 0,
			width: 0,
			height: 0,
		},
		surfaceWidth: 0,
		surfaceHeight: 0,
		slot: 0,
	};
}

export function createResolvedBlitterSamples(): VdpResolvedBlitterSample[] {
	const samples: VdpResolvedBlitterSample[] = [];
	for (let index = 0; index < SKYBOX_FACE_COUNT; index += 1) {
		samples.push(createResolvedBlitterSample());
	}
	return samples;
}

export function allocateSubmittedFrameSlot(): VdpSubmittedFrame {
	return {
		queue: new VdpBlitterCommandBuffer(),
		state: VDP_SUBMITTED_FRAME_EMPTY,
		hasCommands: false,
		hasFrameBufferCommands: false,
		cost: 0,
		workRemaining: 0,
		ditherType: 0,
		frameBufferWidth: 0,
		frameBufferHeight: 0,
		xf: new VdpXfUnit(),
		skyboxControl: 0,
		skyboxFaceWords: new Uint32Array(SKYBOX_FACE_WORD_COUNT),
		skyboxSamples: createResolvedBlitterSamples(),
		billboards: new VdpBbuFrameBuffer(),
		meshes: new VdpMduFrameBuffer(),
		lightRegisterWords: new Uint32Array(VDP_LPU_REGISTER_WORDS),
		morphWeightWords: new Uint32Array(VDP_MFU_WEIGHT_COUNT),
		jointMatrixWords: new Uint32Array(VDP_JTU_REGISTER_WORDS),
	};
}

export function resetBuildingFrame(frame: VdpBuildingFrameState): void {
	frame.queue.reset();
	frame.billboards.reset();
	frame.meshes.reset();
	frame.cost = 0;
	frame.state = VDP_DEX_FRAME_IDLE;
}

export function resetSubmittedFrameSlot(frame: VdpSubmittedFrame): void {
	frame.queue.reset();
	frame.state = VDP_SUBMITTED_FRAME_EMPTY;
	frame.hasCommands = false;
	frame.hasFrameBufferCommands = false;
	frame.cost = 0;
	frame.workRemaining = 0;
	frame.ditherType = 0;
	frame.frameBufferWidth = 0;
	frame.frameBufferHeight = 0;
	frame.xf.reset();
	frame.skyboxControl = 0;
	frame.skyboxFaceWords.fill(0);
	frame.billboards.reset();
	frame.meshes.reset();
	frame.lightRegisterWords.fill(0);
	frame.morphWeightWords.fill(0);
	frame.jointMatrixWords.fill(0);
}

function captureBlitterSourceState(
	surfaceId: number,
	srcX: number,
	srcY: number,
	width: number,
	height: number,
): VdpBlitterSourceSaveState {
	return { surfaceId, srcX, srcY, width, height };
}

function captureGlyphRunGlyphState(queue: VdpBlitterCommandBuffer, index: number): VdpGlyphRunGlyphSaveState {
	return {
		...captureBlitterSourceState(
			queue.glyphSurfaceId[index],
			queue.glyphSrcX[index],
			queue.glyphSrcY[index],
			queue.glyphWidth[index],
			queue.glyphHeight[index],
		),
		dstX: queue.glyphDstX[index],
		dstY: queue.glyphDstY[index],
		advance: queue.glyphAdvance[index],
	};
}

function captureTileRunBlitState(queue: VdpBlitterCommandBuffer, index: number): VdpTileRunBlitSaveState {
	return {
		...captureBlitterSourceState(
			queue.tileSurfaceId[index],
			queue.tileSrcX[index],
			queue.tileSrcY[index],
			queue.tileWidth[index],
			queue.tileHeight[index],
		),
		dstX: queue.tileDstX[index],
		dstY: queue.tileDstY[index],
	};
}

function captureRunEntries<T>(
	firstEntryByCommand: Uint32Array,
	entryCountByCommand: Uint32Array,
	commandIndex: number,
	captureEntry: (index: number) => T,
): T[] {
	const firstEntry = firstEntryByCommand[commandIndex];
	const entryEnd = firstEntry + entryCountByCommand[commandIndex];
	const entries: T[] = [];
	for (let index = firstEntry; index < entryEnd; index += 1) {
		entries.push(captureEntry(index));
	}
	return entries;
}

function captureBlitterCommandState(queue: VdpBlitterCommandBuffer, index: number): VdpBlitterCommandSaveState {
	return {
		opcode: queue.opcode[index],
		seq: queue.seq[index],
		renderCost: queue.renderCost[index],
		layer: queue.layer[index],
		priority: queue.priority[index],
		source: captureBlitterSourceState(
			queue.sourceSurfaceId[index],
			queue.sourceSrcX[index],
			queue.sourceSrcY[index],
			queue.sourceWidth[index],
			queue.sourceHeight[index],
		),
		dstX: queue.dstX[index],
		dstY: queue.dstY[index],
		scaleX: queue.scaleX[index],
		scaleY: queue.scaleY[index],
		flipH: queue.flipH[index] !== 0,
		flipV: queue.flipV[index] !== 0,
		color: queue.color[index],
		parallaxWeight: queue.parallaxWeight[index],
		srcX: queue.srcX[index],
		srcY: queue.srcY[index],
		width: queue.width[index],
		height: queue.height[index],
		x0: queue.x0[index],
		y0: queue.y0[index],
		x1: queue.x1[index],
		y1: queue.y1[index],
		thickness: queue.thickness[index],
		hasBackgroundColor: queue.hasBackgroundColor[index] !== 0,
		backgroundColor: queue.backgroundColor[index],
		lineHeight: queue.lineHeight[index],
		glyphs: captureRunEntries(
			queue.glyphRunFirstEntry,
			queue.glyphRunEntryCount,
			index,
			(entryIndex) => captureGlyphRunGlyphState(queue, entryIndex),
		),
		tiles: captureRunEntries(
			queue.tileRunFirstEntry,
			queue.tileRunEntryCount,
			index,
			(entryIndex) => captureTileRunBlitState(queue, entryIndex),
		),
	};
}

export function captureBlitterCommandBufferState(queue: VdpBlitterCommandBuffer): VdpBlitterCommandSaveState[] {
	const commands: VdpBlitterCommandSaveState[] = [];
	for (let index = 0; index < queue.length; index += 1) {
		commands.push(captureBlitterCommandState(queue, index));
	}
	return commands;
}

function restoreGlyphRunGlyph(queue: VdpBlitterCommandBuffer, index: number, glyph: VdpGlyphRunGlyphSaveState): void {
	queue.glyphSurfaceId[index] = glyph.surfaceId;
	queue.glyphSrcX[index] = glyph.srcX;
	queue.glyphSrcY[index] = glyph.srcY;
	queue.glyphWidth[index] = glyph.width;
	queue.glyphHeight[index] = glyph.height;
	queue.glyphDstX[index] = glyph.dstX;
	queue.glyphDstY[index] = glyph.dstY;
	queue.glyphAdvance[index] = glyph.advance;
}

function restoreTileRunBlit(queue: VdpBlitterCommandBuffer, index: number, tile: VdpTileRunBlitSaveState): void {
	queue.tileSurfaceId[index] = tile.surfaceId;
	queue.tileSrcX[index] = tile.srcX;
	queue.tileSrcY[index] = tile.srcY;
	queue.tileWidth[index] = tile.width;
	queue.tileHeight[index] = tile.height;
	queue.tileDstX[index] = tile.dstX;
	queue.tileDstY[index] = tile.dstY;
}

function restoreBlitterCommand(queue: VdpBlitterCommandBuffer, index: number, command: VdpBlitterCommandSaveState): void {
	queue.opcode[index] = command.opcode;
	queue.seq[index] = command.seq;
	queue.renderCost[index] = command.renderCost;
	queue.layer[index] = command.layer;
	queue.priority[index] = command.priority;
	queue.sourceSurfaceId[index] = command.source.surfaceId;
	queue.sourceSrcX[index] = command.source.srcX;
	queue.sourceSrcY[index] = command.source.srcY;
	queue.sourceWidth[index] = command.source.width;
	queue.sourceHeight[index] = command.source.height;
	queue.dstX[index] = command.dstX;
	queue.dstY[index] = command.dstY;
	queue.scaleX[index] = command.scaleX;
	queue.scaleY[index] = command.scaleY;
	queue.flipH[index] = command.flipH ? 1 : 0;
	queue.flipV[index] = command.flipV ? 1 : 0;
	queue.color[index] = command.color;
	queue.parallaxWeight[index] = command.parallaxWeight;
	queue.srcX[index] = command.srcX;
	queue.srcY[index] = command.srcY;
	queue.width[index] = command.width;
	queue.height[index] = command.height;
	queue.x0[index] = command.x0;
	queue.y0[index] = command.y0;
	queue.x1[index] = command.x1;
	queue.y1[index] = command.y1;
	queue.thickness[index] = command.thickness;
	queue.hasBackgroundColor[index] = command.hasBackgroundColor ? 1 : 0;
	queue.backgroundColor[index] = command.backgroundColor;
	queue.lineHeight[index] = command.lineHeight;
	queue.glyphRunFirstEntry[index] = queue.glyphEntryCount;
	queue.glyphRunEntryCount[index] = command.glyphs.length;
	for (let glyphIndex = 0; glyphIndex < command.glyphs.length; glyphIndex += 1) {
		restoreGlyphRunGlyph(queue, queue.glyphEntryCount + glyphIndex, command.glyphs[glyphIndex]);
	}
	queue.glyphEntryCount += command.glyphs.length;
	queue.tileRunFirstEntry[index] = queue.tileEntryCount;
	queue.tileRunEntryCount[index] = command.tiles.length;
	for (let tileIndex = 0; tileIndex < command.tiles.length; tileIndex += 1) {
		restoreTileRunBlit(queue, queue.tileEntryCount + tileIndex, command.tiles[tileIndex]);
	}
	queue.tileEntryCount += command.tiles.length;
}

export function restoreBlitterCommandBufferState(queue: VdpBlitterCommandBuffer, commands: VdpBlitterCommandSaveState[]): void {
	queue.reset();
	queue.length = commands.length;
	for (let index = 0; index < commands.length; index += 1) {
		restoreBlitterCommand(queue, index, commands[index]);
	}
}

function captureBbuBillboardState(buffer: VdpBbuFrameBuffer, index: number): VdpBbuBillboardSaveState {
	return {
		seq: buffer.seq[index],
		layer: buffer.layer[index],
		priority: buffer.priority[index],
		positionX: buffer.positionX[index],
		positionY: buffer.positionY[index],
		positionZ: buffer.positionZ[index],
		size: buffer.size[index],
		color: buffer.color[index],
		source: captureBlitterSourceState(
			buffer.sourceSurfaceId[index],
			buffer.sourceSrcX[index],
			buffer.sourceSrcY[index],
			buffer.sourceWidth[index],
			buffer.sourceHeight[index],
		),
		surfaceWidth: buffer.surfaceWidth[index],
		surfaceHeight: buffer.surfaceHeight[index],
		slot: buffer.slot[index],
	};
}

export function captureBbuFrameBufferState(buffer: VdpBbuFrameBuffer): VdpBbuBillboardSaveState[] {
	const billboards: VdpBbuBillboardSaveState[] = [];
	for (let index = 0; index < buffer.length; index += 1) {
		billboards.push(captureBbuBillboardState(buffer, index));
	}
	return billboards;
}

export function restoreBbuFrameBufferState(buffer: VdpBbuFrameBuffer, billboards: VdpBbuBillboardSaveState[]): void {
	buffer.reset();
	buffer.length = billboards.length;
	for (let index = 0; index < billboards.length; index += 1) {
		const billboard = billboards[index];
		buffer.seq[index] = billboard.seq;
		buffer.layer[index] = billboard.layer;
		buffer.priority[index] = billboard.priority;
		buffer.positionX[index] = billboard.positionX;
		buffer.positionY[index] = billboard.positionY;
		buffer.positionZ[index] = billboard.positionZ;
		buffer.size[index] = billboard.size;
		buffer.color[index] = billboard.color;
		buffer.sourceSurfaceId[index] = billboard.source.surfaceId;
		buffer.sourceSrcX[index] = billboard.source.srcX;
		buffer.sourceSrcY[index] = billboard.source.srcY;
		buffer.sourceWidth[index] = billboard.source.width;
		buffer.sourceHeight[index] = billboard.source.height;
		buffer.surfaceWidth[index] = billboard.surfaceWidth;
		buffer.surfaceHeight[index] = billboard.surfaceHeight;
		buffer.slot[index] = billboard.slot;
	}
}

function captureResolvedBlitterSampleState(sample: VdpResolvedBlitterSample): VdpResolvedBlitterSample {
	return {
		source: {
			surfaceId: sample.source.surfaceId,
			srcX: sample.source.srcX,
			srcY: sample.source.srcY,
			width: sample.source.width,
			height: sample.source.height,
		},
		surfaceWidth: sample.surfaceWidth,
		surfaceHeight: sample.surfaceHeight,
		slot: sample.slot,
	};
}

function restoreResolvedBlitterSampleState(target: VdpResolvedBlitterSample, state: VdpResolvedBlitterSample): void {
	target.source.surfaceId = state.source.surfaceId;
	target.source.srcX = state.source.srcX;
	target.source.srcY = state.source.srcY;
	target.source.width = state.source.width;
	target.source.height = state.source.height;
	target.surfaceWidth = state.surfaceWidth;
	target.surfaceHeight = state.surfaceHeight;
	target.slot = state.slot;
}

export function captureBuildingFrameState(frame: VdpBuildingFrameState): VdpBuildingFrameSaveState {
	return {
		state: frame.state,
		queue: captureBlitterCommandBufferState(frame.queue),
		billboards: captureBbuFrameBufferState(frame.billboards),
		cost: frame.cost,
	};
}

export function restoreBuildingFrameState(frame: VdpBuildingFrameState, state: VdpBuildingFrameSaveState): void {
	frame.state = state.state;
	restoreBlitterCommandBufferState(frame.queue, state.queue);
	restoreBbuFrameBufferState(frame.billboards, state.billboards);
	frame.cost = state.cost;
}

export function captureSubmittedFrameState(frame: VdpSubmittedFrame): VdpSubmittedFrameSaveState {
	const skyboxSamples: VdpResolvedBlitterSample[] = [];
	for (let index = 0; index < SKYBOX_FACE_COUNT; index += 1) {
		skyboxSamples.push(captureResolvedBlitterSampleState(frame.skyboxSamples[index]));
	}
	return {
		state: frame.state,
		queue: captureBlitterCommandBufferState(frame.queue),
		billboards: captureBbuFrameBufferState(frame.billboards),
		hasCommands: frame.hasCommands,
		hasFrameBufferCommands: frame.hasFrameBufferCommands,
		cost: frame.cost,
		workRemaining: frame.workRemaining,
		ditherType: frame.ditherType,
		frameBufferWidth: frame.frameBufferWidth,
		frameBufferHeight: frame.frameBufferHeight,
		xf: frame.xf.captureState(),
		skyboxControl: frame.skyboxControl,
		skyboxFaceWords: Array.from(frame.skyboxFaceWords),
		skyboxSamples,
		lightRegisterWords: Array.from(frame.lightRegisterWords),
	};
}

export function restoreSubmittedFrameState(frame: VdpSubmittedFrame, state: VdpSubmittedFrameSaveState): void {
	frame.state = state.state;
	restoreBlitterCommandBufferState(frame.queue, state.queue);
	restoreBbuFrameBufferState(frame.billboards, state.billboards);
	frame.hasCommands = state.hasCommands;
	frame.hasFrameBufferCommands = state.hasFrameBufferCommands;
	frame.cost = state.cost;
	frame.workRemaining = state.workRemaining;
	frame.ditherType = state.ditherType;
	frame.frameBufferWidth = state.frameBufferWidth;
	frame.frameBufferHeight = state.frameBufferHeight;
	frame.xf.restoreState(state.xf);
	frame.skyboxControl = state.skyboxControl;
	frame.skyboxFaceWords.set(state.skyboxFaceWords);
	for (let index = 0; index < SKYBOX_FACE_COUNT; index += 1) {
		restoreResolvedBlitterSampleState(frame.skyboxSamples[index], state.skyboxSamples[index]);
	}
	frame.lightRegisterWords.set(state.lightRegisterWords);
}
