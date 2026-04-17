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

function readPacketU32(reader: PacketWordReader, index: number): number {
	return reader.readU32(index);
}

function readPacketI32(reader: PacketWordReader, index: number): number {
	return reader.readU32(index) | 0;
}

function readPacketF32(reader: PacketWordReader, index: number): number {
	VDP_PACKET_F32_VIEW.setUint32(0, reader.readU32(index) >>> 0, true);
	return VDP_PACKET_F32_VIEW.getFloat32(0, true);
}

function readPacketArgU32(reader: PacketWordReader, cmd: number, index: number): number {
	if (getVdpPacketArgKind(cmd, index) !== VdpPacketWordKind.U32) {
		throw vdpFault(`packet arg ${index} for command ${cmd >>> 0} is not encoded as u32.`);
	}
	return readPacketU32(reader, index);
}

function readPacketArgI32(reader: PacketWordReader, cmd: number, index: number): number {
	if (getVdpPacketArgKind(cmd, index) !== VdpPacketWordKind.U32) {
		throw vdpFault(`packet arg ${index} for command ${cmd >>> 0} is not encoded as u32.`);
	}
	return readPacketI32(reader, index);
}

function readPacketArgF32(reader: PacketWordReader, cmd: number, index: number): number {
	if (getVdpPacketArgKind(cmd, index) !== VdpPacketWordKind.F32) {
		throw vdpFault(`packet arg ${index} for command ${cmd >>> 0} is not encoded as f32.`);
	}
	return readPacketF32(reader, index);
}

function readPacketColor(reader: PacketWordReader, cmd: number, offset: number): { r: number; g: number; b: number; a: number } {
	return {
		r: readPacketArgF32(reader, cmd, offset + 0),
		g: readPacketArgF32(reader, cmd, offset + 1),
		b: readPacketArgF32(reader, cmd, offset + 2),
		a: readPacketArgF32(reader, cmd, offset + 3),
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
		case IO_CMD_VDP_CLEAR: {
			assertVdpPacketArgWords(params.cmd, params.argWords);
			runtime.machine.vdp.enqueueClear(readPacketColor(params.argReader, params.cmd, 0));
			break;
		}
		case IO_CMD_VDP_FILL_RECT: {
			assertVdpPacketArgWords(params.cmd, params.argWords);
			runtime.machine.vdp.enqueueFillRect(
				readPacketArgF32(params.argReader, params.cmd, 0),
				readPacketArgF32(params.argReader, params.cmd, 1),
				readPacketArgF32(params.argReader, params.cmd, 2),
				readPacketArgF32(params.argReader, params.cmd, 3),
				readPacketArgF32(params.argReader, params.cmd, 4),
				readPacketArgU32(params.argReader, params.cmd, 5) as 0 | 1 | 2,
				readPacketColor(params.argReader, params.cmd, 6),
			);
			break;
		}
		case IO_CMD_VDP_DRAW_LINE: {
			assertVdpPacketArgWords(params.cmd, params.argWords);
			runtime.machine.vdp.enqueueDrawLine(
				readPacketArgF32(params.argReader, params.cmd, 0),
				readPacketArgF32(params.argReader, params.cmd, 1),
				readPacketArgF32(params.argReader, params.cmd, 2),
				readPacketArgF32(params.argReader, params.cmd, 3),
				readPacketArgF32(params.argReader, params.cmd, 4),
				readPacketArgU32(params.argReader, params.cmd, 5) as 0 | 1 | 2,
				readPacketColor(params.argReader, params.cmd, 6),
				readPacketArgF32(params.argReader, params.cmd, 10),
			);
			break;
		}
		case IO_CMD_VDP_BLIT: {
			assertVdpPacketArgWords(params.cmd, params.argWords);
			const flipFlags = readPacketArgU32(params.argReader, params.cmd, 7);
			runtime.machine.vdp.enqueueBlit(
				readPacketArgU32(params.argReader, params.cmd, 0),
				readPacketArgF32(params.argReader, params.cmd, 1),
				readPacketArgF32(params.argReader, params.cmd, 2),
				readPacketArgF32(params.argReader, params.cmd, 3),
				readPacketArgU32(params.argReader, params.cmd, 4) as 0 | 1 | 2,
				readPacketArgF32(params.argReader, params.cmd, 5),
				readPacketArgF32(params.argReader, params.cmd, 6),
				(flipFlags & 1) !== 0,
				(flipFlags & 2) !== 0,
				readPacketColor(params.argReader, params.cmd, 8),
				readPacketArgF32(params.argReader, params.cmd, 12),
			);
			break;
		}
		case IO_CMD_VDP_GLYPH_RUN: {
			assertVdpPacketArgWords(params.cmd, params.argWords);
			const text = runtime.machine.cpu.getStringPool().getById(readPacketArgU32(params.argReader, params.cmd, 0)).text;
			const backgroundEnabled = readPacketArgU32(params.argReader, params.cmd, 12) !== 0;
			runtime.machine.vdp.enqueueGlyphRun(
				text,
				readPacketArgF32(params.argReader, params.cmd, 1),
				readPacketArgF32(params.argReader, params.cmd, 2),
				readPacketArgF32(params.argReader, params.cmd, 3),
				runtime.api.resolveFontId(readPacketArgU32(params.argReader, params.cmd, 4)),
				readPacketColor(params.argReader, params.cmd, 8),
				backgroundEnabled ? readPacketColor(params.argReader, params.cmd, 13) : undefined,
				readPacketArgI32(params.argReader, params.cmd, 5),
				readPacketArgI32(params.argReader, params.cmd, 6),
				readPacketArgU32(params.argReader, params.cmd, 7) as 0 | 1 | 2,
			);
			break;
		}
		case IO_CMD_VDP_TILE_RUN: {
			assertVdpPacketArgWords(params.cmd, params.argWords);
			const tileCount = readPacketArgU32(params.argReader, params.cmd, 0);
			if (tileCount > params.payloadWords) {
				throw vdpFault(`tile payload underrun (${tileCount} > ${params.payloadWords}).`);
			}
			const cols = readPacketArgI32(params.argReader, params.cmd, 1);
			const rows = readPacketArgI32(params.argReader, params.cmd, 2);
			if (tileCount !== cols * rows) {
				throw vdpFault(`tile payload size mismatch (${tileCount} != ${cols * rows}).`);
			}
			if (params.payloadReader.kind === 'memory') {
				const payloadReader = params.payloadReader as MemoryPacketWordReader;
				runtime.machine.vdp.enqueuePayloadTileRun({
					payload_base: payloadReader.base,
					tile_count: tileCount,
					cols,
					rows,
					tile_w: readPacketArgI32(params.argReader, params.cmd, 3),
					tile_h: readPacketArgI32(params.argReader, params.cmd, 4),
					origin_x: readPacketArgI32(params.argReader, params.cmd, 5),
					origin_y: readPacketArgI32(params.argReader, params.cmd, 6),
					scroll_x: readPacketArgI32(params.argReader, params.cmd, 7),
					scroll_y: readPacketArgI32(params.argReader, params.cmd, 8),
					z: readPacketArgF32(params.argReader, params.cmd, 9),
					layer: readPacketArgU32(params.argReader, params.cmd, 10) as 0 | 1 | 2,
				});
				break;
			}
			const payloadReader = params.payloadReader as BufferPacketWordReader;
			runtime.machine.vdp.enqueuePayloadTileRunWords({
				payload_words: payloadReader.words,
				payload_word_offset: payloadReader.wordOffset,
				tile_count: tileCount,
				cols,
				rows,
				tile_w: readPacketArgI32(params.argReader, params.cmd, 3),
				tile_h: readPacketArgI32(params.argReader, params.cmd, 4),
				origin_x: readPacketArgI32(params.argReader, params.cmd, 5),
				origin_y: readPacketArgI32(params.argReader, params.cmd, 6),
				scroll_x: readPacketArgI32(params.argReader, params.cmd, 7),
				scroll_y: readPacketArgI32(params.argReader, params.cmd, 8),
				z: readPacketArgF32(params.argReader, params.cmd, 9),
				layer: readPacketArgU32(params.argReader, params.cmd, 10) as 0 | 1 | 2,
			});
			break;
		}
		default:
			throw vdpFault(`unknown I/O command ${params.cmd}.`);
	}
}

export function processVdpCommand(runtime: Runtime, params: {
	cmd: number;
	argWords: number;
	argsBase: number;
	payloadBase: number;
	payloadWords: number;
}): void {
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
	processVdpCommandCore(runtime, {
		cmd: params.cmd,
		argWords: params.argWords,
		argReader: VDP_PACKET_BUFFER_ARGS.set(params.words, params.argsWordOffset),
		payloadReader: VDP_PACKET_BUFFER_PAYLOAD.set(params.words, params.payloadWordOffset),
		payloadWords: params.payloadWords,
	});
}
