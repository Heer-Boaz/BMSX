import {
	IO_ARG_STRIDE,
	IO_CMD_VDP_BLIT,
	IO_CMD_VDP_CLEAR,
	IO_CMD_VDP_DRAW_LINE,
	IO_CMD_VDP_FILL_RECT,
	IO_CMD_VDP_GLYPH_RUN,
	IO_CMD_VDP_TILE_RUN,
} from '../../bus/io';
import type { Runtime } from '../../runtime/runtime';
import { assertVdpPacketArgWords, getVdpPacketArgKind, VdpPacketWordKind } from './packet_schema';

function vdpFault(message: string): Error {
	return new Error(`VDP fault: ${message}`);
}

const VDP_PACKET_F32_BUFFER = new ArrayBuffer(4);
const VDP_PACKET_F32_VIEW = new DataView(VDP_PACKET_F32_BUFFER);

type PacketWordReaderKind = 'memory' | 'buffer';

type PacketWordReader = {
	readonly kind: PacketWordReaderKind;
	readU32(index: number): number;
};

class MemoryPacketWordReader implements PacketWordReader {
	public readonly kind = 'memory';
	public runtime!: Runtime;
	public base = 0;

	public set(runtime: Runtime, base: number): this {
		this.runtime = runtime;
		this.base = base;
		return this;
	}

	public readU32(index: number): number {
		return this.runtime.machine.memory.readU32(this.base + index * IO_ARG_STRIDE) >>> 0;
	}
}

class BufferPacketWordReader implements PacketWordReader {
	public readonly kind = 'buffer';
	public words!: Uint32Array;
	public wordOffset = 0;

	public set(words: Uint32Array, wordOffset: number): this {
		this.words = words;
		this.wordOffset = wordOffset;
		return this;
	}

	public readU32(index: number): number {
		return this.words[this.wordOffset + index] >>> 0;
	}
}

const VDP_PACKET_MEMORY_ARGS = new MemoryPacketWordReader();
const VDP_PACKET_MEMORY_PAYLOAD = new MemoryPacketWordReader();
const VDP_PACKET_BUFFER_ARGS = new BufferPacketWordReader();
const VDP_PACKET_BUFFER_PAYLOAD = new BufferPacketWordReader();

function readPacketI32(reader: PacketWordReader, index: number): number {
	return reader.readU32(index) | 0;
}
function readPacketArgU32(reader: PacketWordReader, index: number): number {
	const value = reader.readU32(index);
	if (value !== value) {
		return value;
	}
	return value;
}


function readPacketF32(reader: PacketWordReader, index: number): number {
	VDP_PACKET_F32_VIEW.setUint32(0, reader.readU32(index) >>> 0, true);
	return VDP_PACKET_F32_VIEW.getFloat32(0, true);
}

function readPacketArg<T>(
	reader: PacketWordReader,
	cmd: number,
	index: number,
	kind: VdpPacketWordKind,
	kindName: 'u32' | 'f32',
	readValue: (reader: PacketWordReader, index: number) => T,
): T {
	if (getVdpPacketArgKind(cmd, index) !== kind) {
		throw vdpFault(`packet arg ${index} for command ${cmd >>> 0} is not encoded as ${kindName}.`);
	}
	return readValue(reader, index);
}

function readPacketColor(reader: PacketWordReader, cmd: number, offset: number): { r: number; g: number; b: number; a: number } {
	return {
		r: readPacketArg(reader, cmd, offset + 0, VdpPacketWordKind.F32, 'f32', readPacketF32),
		g: readPacketArg(reader, cmd, offset + 1, VdpPacketWordKind.F32, 'f32', readPacketF32),
		b: readPacketArg(reader, cmd, offset + 2, VdpPacketWordKind.F32, 'f32', readPacketF32),
		a: readPacketArg(reader, cmd, offset + 3, VdpPacketWordKind.F32, 'f32', readPacketF32),
	};
}

function processVdpCommandCore(runtime: Runtime, params: {
	cmd: number;
	argWords: number;
	argReader: PacketWordReader;
	payloadReader: PacketWordReader;
	payloadWords: number;
}): void {
	switch (params.cmd) {
		case IO_CMD_VDP_CLEAR:
			processVdpClearCommand(runtime, params.argReader, params.cmd);
			return;
		case IO_CMD_VDP_FILL_RECT:
			processVdpFillRectCommand(runtime, params.argReader, params.cmd);
			return;
		case IO_CMD_VDP_DRAW_LINE:
			processVdpDrawLineCommand(runtime, params.argReader, params.cmd);
			return;
		case IO_CMD_VDP_BLIT:
			processVdpBlitCommand(runtime, params.argReader, params.cmd);
			return;
		case IO_CMD_VDP_GLYPH_RUN:
			processVdpGlyphRunCommand(runtime, params.argReader, params.cmd);
			return;
		case IO_CMD_VDP_TILE_RUN:
			processVdpTileRunCommand(runtime, params.argReader, params.cmd, params.payloadReader, params.payloadWords);
			return;
		default:
			throw vdpFault(`unknown I/O command ${params.cmd}.`);
	}
}

function processVdpClearCommand(runtime: Runtime, argReader: PacketWordReader, cmd: number): void {
	assertVdpPacketArgWords(cmd, 1);
	runtime.machine.vdp.enqueueClear(readPacketColor(argReader, cmd, 0));
}

function processVdpFillRectCommand(runtime: Runtime, argReader: PacketWordReader, cmd: number): void {
	const args = {
		x: readPacketArg(argReader, cmd, 0, VdpPacketWordKind.F32, 'f32', readPacketF32),
		y: readPacketArg(argReader, cmd, 1, VdpPacketWordKind.F32, 'f32', readPacketF32),
		width: readPacketArg(argReader, cmd, 2, VdpPacketWordKind.F32, 'f32', readPacketF32),
		height: readPacketArg(argReader, cmd, 3, VdpPacketWordKind.F32, 'f32', readPacketF32),
		weight: readPacketArg(argReader, cmd, 4, VdpPacketWordKind.F32, 'f32', readPacketF32),
		fillKind: readPacketArg(argReader, cmd, 5, VdpPacketWordKind.U32, 'u32', readPacketArgU32) as 0 | 1 | 2,
		color: readPacketColor(argReader, cmd, 6),
	};
	runtime.machine.vdp.enqueueFillRect(
		args.x,
		args.y,
		args.width,
		args.height,
		args.weight,
		args.fillKind,
		args.color,
	);
}

function processVdpDrawLineCommand(runtime: Runtime, argReader: PacketWordReader, cmd: number): void {
	const args = {
		x1: readPacketArg(argReader, cmd, 0, VdpPacketWordKind.F32, 'f32', readPacketF32),
		y1: readPacketArg(argReader, cmd, 1, VdpPacketWordKind.F32, 'f32', readPacketF32),
		x2: readPacketArg(argReader, cmd, 2, VdpPacketWordKind.F32, 'f32', readPacketF32),
		y2: readPacketArg(argReader, cmd, 3, VdpPacketWordKind.F32, 'f32', readPacketF32),
		depth: readPacketArg(argReader, cmd, 4, VdpPacketWordKind.F32, 'f32', readPacketF32),
		strokeKind: readPacketArg(argReader, cmd, 5, VdpPacketWordKind.U32, 'u32', readPacketArgU32) as 0 | 1 | 2,
		color: readPacketColor(argReader, cmd, 6),
		softness: readPacketArg(argReader, cmd, 10, VdpPacketWordKind.F32, 'f32', readPacketF32),
	};
	runtime.machine.vdp.enqueueDrawLine(
		args.x1,
		args.y1,
		args.x2,
		args.y2,
		args.depth,
		args.strokeKind,
		args.color,
		args.softness,
	);
}

function processVdpBlitCommand(runtime: Runtime, argReader: PacketWordReader, cmd: number): void {
	const flipFlags = readPacketArg(argReader, cmd, 7, VdpPacketWordKind.U32, 'u32', readPacketArgU32);
	const args = {
		texture: readPacketArg(argReader, cmd, 0, VdpPacketWordKind.U32, 'u32', readPacketArgU32),
		x: readPacketArg(argReader, cmd, 1, VdpPacketWordKind.F32, 'f32', readPacketF32),
		y: readPacketArg(argReader, cmd, 2, VdpPacketWordKind.F32, 'f32', readPacketF32),
		z: readPacketArg(argReader, cmd, 3, VdpPacketWordKind.F32, 'f32', readPacketF32),
		blendMode: readPacketArg(argReader, cmd, 4, VdpPacketWordKind.U32, 'u32', readPacketArgU32) as 0 | 1 | 2,
		scaleX: readPacketArg(argReader, cmd, 5, VdpPacketWordKind.F32, 'f32', readPacketF32),
		scaleY: readPacketArg(argReader, cmd, 6, VdpPacketWordKind.F32, 'f32', readPacketF32),
		color: readPacketColor(argReader, cmd, 8),
		rotation: readPacketArg(argReader, cmd, 12, VdpPacketWordKind.F32, 'f32', readPacketF32),
	};
	runtime.machine.vdp.enqueueBlit(
		args.texture,
		args.x,
		args.y,
		args.z,
		args.blendMode,
		args.scaleX,
		args.scaleY,
		(flipFlags & 1) !== 0,
		(flipFlags & 2) !== 0,
		args.color,
		args.rotation,
	);
}

function processVdpGlyphRunCommand(runtime: Runtime, argReader: PacketWordReader, cmd: number): void {
	const args = {
		textId: readPacketArg(argReader, cmd, 0, VdpPacketWordKind.U32, 'u32', readPacketArgU32),
		originX: readPacketArg(argReader, cmd, 1, VdpPacketWordKind.F32, 'f32', readPacketF32),
		originY: readPacketArg(argReader, cmd, 2, VdpPacketWordKind.F32, 'f32', readPacketF32),
		originZ: readPacketArg(argReader, cmd, 3, VdpPacketWordKind.F32, 'f32', readPacketF32),
		fontId: readPacketArg(argReader, cmd, 4, VdpPacketWordKind.U32, 'u32', readPacketArgU32),
		color: readPacketColor(argReader, cmd, 8),
		backgroundEnabled: readPacketArg(argReader, cmd, 12, VdpPacketWordKind.U32, 'u32', readPacketArgU32) !== 0,
		tileCount: readPacketI32(argReader, 5),
		lineAdvance: readPacketI32(argReader, 6),
		layer: readPacketArg(argReader, cmd, 7, VdpPacketWordKind.U32, 'u32', readPacketArgU32) as 0 | 1 | 2,
	};
	const glyphText = runtime.machine.cpu.getStringPool().getById(args.textId).text;
	const fontId = runtime.api.resolveFontId(args.fontId);
	if (args.backgroundEnabled) {
		runtime.machine.vdp.enqueueGlyphRun(
			glyphText,
			args.originX,
			args.originY,
			args.originZ,
			fontId,
			args.color,
			readPacketColor(argReader, cmd, 13),
			args.tileCount,
			args.lineAdvance,
			args.layer,
		);
		return;
	}
	runtime.machine.vdp.enqueueGlyphRun(
		glyphText,
		args.originX,
		args.originY,
		args.originZ,
		fontId,
		args.color,
		undefined,
		args.tileCount,
		args.lineAdvance,
		args.layer,
	);
}

function processVdpTileRunCommand(
	runtime: Runtime,
	argReader: PacketWordReader,
	cmd: number,
	payloadReader: PacketWordReader,
	payloadWords: number,
): void {
	const args = {
		tileCount: readPacketArg(argReader, cmd, 0, VdpPacketWordKind.U32, 'u32', readPacketArgU32),
		cols: readPacketI32(argReader, 1),
		rows: readPacketI32(argReader, 2),
		tileWidth: readPacketI32(argReader, 3),
		tileHeight: readPacketI32(argReader, 4),
		originX: readPacketI32(argReader, 5),
		originY: readPacketI32(argReader, 6),
		scrollX: readPacketI32(argReader, 7),
		scrollY: readPacketI32(argReader, 8),
		z: readPacketArg(argReader, cmd, 9, VdpPacketWordKind.F32, 'f32', readPacketF32),
		layer: readPacketArg(argReader, cmd, 10, VdpPacketWordKind.U32, 'u32', readPacketArgU32) as 0 | 1 | 2,
	};
	if (args.tileCount > payloadWords) {
		throw vdpFault(`tile payload underrun (${args.tileCount} > ${payloadWords}).`);
	}
	if (args.tileCount !== args.cols * args.rows) {
		throw vdpFault(`tile payload size mismatch (${args.tileCount} != ${args.cols * args.rows}).`);
	}
	if (payloadReader.kind === 'memory') {
		runtime.machine.vdp.enqueuePayloadTileRun({
			payload_base: (payloadReader as MemoryPacketWordReader).base,
			tile_count: args.tileCount,
			cols: args.cols,
			rows: args.rows,
			tile_w: args.tileWidth,
			tile_h: args.tileHeight,
			origin_x: args.originX,
			origin_y: args.originY,
			scroll_x: args.scrollX,
			scroll_y: args.scrollY,
			z: args.z,
			layer: args.layer,
		});
		return;
	}
	runtime.machine.vdp.enqueuePayloadTileRunWords({
		payload_words: (payloadReader as BufferPacketWordReader).words,
		payload_word_offset: (payloadReader as BufferPacketWordReader).wordOffset,
		tile_count: args.tileCount,
		cols: args.cols,
		rows: args.rows,
		tile_w: args.tileWidth,
		tile_h: args.tileHeight,
		origin_x: args.originX,
		origin_y: args.originY,
		scroll_x: args.scrollX,
		scroll_y: args.scrollY,
		z: args.z,
		layer: args.layer,
	});
}

export function processVdpCommand(runtime: Runtime, params: {
	cmd: number;
	argWords: number;
	argsBase: number;
	payloadBase: number;
	payloadWords: number;
}): void {
	assertVdpPacketArgWords(params.cmd, params.argWords);
	processVdpCommandCore(runtime, {
		cmd: params.cmd,
		argWords: params.argWords,
		argReader: VDP_PACKET_MEMORY_ARGS.set(runtime, params.argsBase),
		payloadReader: VDP_PACKET_MEMORY_PAYLOAD.set(runtime, params.payloadBase),
		payloadWords: params.payloadWords,
	});
}

export function processVdpBufferedCommand(runtime: Runtime, params: {
	cmd: number;
	argWords: number;
	argsWordOffset: number;
	payloadWordOffset: number;
	payloadWords: number;
	words: Uint32Array;
}): void {
	assertVdpPacketArgWords(params.cmd, params.argWords);
	processVdpCommandCore(runtime, {
		cmd: params.cmd,
		argWords: params.argWords,
		argReader: VDP_PACKET_BUFFER_ARGS.set(params.words, params.argsWordOffset),
		payloadReader: VDP_PACKET_BUFFER_PAYLOAD.set(params.words, params.payloadWordOffset),
		payloadWords: params.payloadWords,
	});
}
