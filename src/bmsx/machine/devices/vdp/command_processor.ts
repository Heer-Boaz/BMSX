import {
	IO_ARG_STRIDE,
	IO_CMD_VDP_BLIT,
	IO_CMD_VDP_CLEAR,
	IO_CMD_VDP_CONFIG_SURFACE,
	IO_CMD_VDP_DRAW_LINE,
	IO_CMD_VDP_FILL_RECT,
	IO_CMD_VDP_GLYPH_RUN,
	IO_CMD_VDP_TILE_RUN,
	IO_VDP_SLOT_PRIMARY_ATLAS,
	IO_VDP_SLOT_SECONDARY_ATLAS,
	VDP_SLOT_NONE,
	VDP_SLOT_PRIMARY,
	VDP_SLOT_SECONDARY,
	VDP_SLOT_SYSTEM,
	VDP_SYSTEM_ATLAS_ID,
} from '../../bus/io';
import { packLowHigh16 } from '../../common/word';
import type { CPU } from '../../cpu/cpu';
import type { Api } from '../../firmware/api/api';
import type { Memory } from '../../memory/memory';
import { packFrameBufferColorWordFromComponents } from './blitter';
import { vdpFault } from './fault';
import { FIX16_SCALE, toSignedWord } from '../../common/numeric';
import { assertVdpPacketArgWords, getVdpPacketArgKind, VdpPacketWordKind } from './packet_schema';
import {
	encodeVdpDrawCtrl,
	encodeVdpLayerPriority,
	VDP_CMD_BLIT,
	VDP_CMD_CLEAR,
	VDP_CMD_DRAW_LINE,
	VDP_CMD_FILL_RECT,
	VDP_REG_DRAW_COLOR,
	VDP_REG_DRAW_CTRL,
	VDP_REG_DRAW_LAYER_PRIO,
	VDP_REG_DRAW_SCALE_X,
	VDP_REG_DRAW_SCALE_Y,
	VDP_REG_DST_X,
	VDP_REG_DST_Y,
	VDP_REG_GEOM_X0,
	VDP_REG_GEOM_X1,
	VDP_REG_GEOM_Y0,
	VDP_REG_GEOM_Y1,
	VDP_REG_LINE_WIDTH,
	VDP_REG_SRC_SLOT,
	VDP_REG_SRC_UV,
	VDP_REG_SRC_WH,
} from './registers';
import type { VDP } from './vdp';

const VDP_PACKET_F32_BUFFER = new ArrayBuffer(4);
const VDP_PACKET_F32_VIEW = new DataView(VDP_PACKET_F32_BUFFER);

type PacketWordReader = {
	readU32(index: number): number;
};

class MemoryPacketWordReader implements PacketWordReader {
	public memory!: Memory;
	public base = 0;

	public set(memory: Memory, base: number): this {
		this.memory = memory;
		this.base = base;
		return this;
	}

	public readU32(index: number): number {
		return this.memory.readU32(this.base + index * IO_ARG_STRIDE) >>> 0;
	}
}

class BufferPacketWordReader implements PacketWordReader {
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

function readPacketArgWord(reader: PacketWordReader, cmd: number, index: number, kind: VdpPacketWordKind, label: string): number {
	if (getVdpPacketArgKind(cmd, index) !== kind) {
		throw vdpFault(`packet arg ${index} for command ${cmd >>> 0} is not encoded as ${label}.`);
	}
	return reader.readU32(index);
}

// disable-next-line single_line_method_pattern -- packet decoding keeps typed U32 reads named at every command-site.
function readPacketArgU32(reader: PacketWordReader, cmd: number, index: number): number {
	return readPacketArgWord(reader, cmd, index, VdpPacketWordKind.U32, 'u32');
}

function readPacketArgI32(reader: PacketWordReader, cmd: number, index: number): number {
	return readPacketArgWord(reader, cmd, index, VdpPacketWordKind.U32, 'u32') | 0;
}

function readPacketArgF32(reader: PacketWordReader, cmd: number, index: number): number {
	VDP_PACKET_F32_VIEW.setUint32(0, readPacketArgWord(reader, cmd, index, VdpPacketWordKind.F32, 'f32') >>> 0, true);
	return VDP_PACKET_F32_VIEW.getFloat32(0, true);
}

function readPacketColorWord(reader: PacketWordReader, cmd: number, offset: number): number {
	return packFrameBufferColorWordFromComponents(
		readPacketArgF32(reader, cmd, offset + 0),
		readPacketArgF32(reader, cmd, offset + 1),
		readPacketArgF32(reader, cmd, offset + 2),
		readPacketArgF32(reader, cmd, offset + 3),
	);
}

function writeVdpFillRectCommand(vdp: VDP, x0: number, y0: number, x1: number, y1: number, priority: number, layer: 0 | 1 | 2, colorWord: number): void {
	vdp.writeVdpRegister(VDP_REG_GEOM_X0, toSignedWord(FIX16_SCALE * x0));
	vdp.writeVdpRegister(VDP_REG_GEOM_Y0, toSignedWord(FIX16_SCALE * y0));
	vdp.writeVdpRegister(VDP_REG_GEOM_X1, toSignedWord(FIX16_SCALE * x1));
	vdp.writeVdpRegister(VDP_REG_GEOM_Y1, toSignedWord(FIX16_SCALE * y1));
	vdp.writeVdpRegister(VDP_REG_DRAW_LAYER_PRIO, encodeVdpLayerPriority(layer, priority));
	vdp.writeVdpRegister(VDP_REG_DRAW_COLOR, colorWord);
	vdp.consumeDirectVdpCommand(VDP_CMD_FILL_RECT);
}

function writeVdpBlitCommand(vdp: VDP, slot: number, u: number, v: number, w: number, h: number, x: number, y: number, priority: number, layer: 0 | 1 | 2, scaleX: number, scaleY: number, flipFlags: number, colorWord: number, parallaxWeight: number): void {
	vdp.writeVdpRegister(VDP_REG_SRC_SLOT, slot);
	vdp.writeVdpRegister(VDP_REG_SRC_UV, packLowHigh16(u, v));
	vdp.writeVdpRegister(VDP_REG_SRC_WH, packLowHigh16(w, h));
	vdp.writeVdpRegister(VDP_REG_DST_X, toSignedWord(FIX16_SCALE * x));
	vdp.writeVdpRegister(VDP_REG_DST_Y, toSignedWord(FIX16_SCALE * y));
	vdp.writeVdpRegister(VDP_REG_DRAW_LAYER_PRIO, encodeVdpLayerPriority(layer, priority));
	vdp.writeVdpRegister(VDP_REG_DRAW_SCALE_X, toSignedWord(FIX16_SCALE * scaleX));
	vdp.writeVdpRegister(VDP_REG_DRAW_SCALE_Y, toSignedWord(FIX16_SCALE * scaleY));
	vdp.writeVdpRegister(VDP_REG_DRAW_CTRL, encodeVdpDrawCtrl((flipFlags & 1) !== 0, (flipFlags & 2) !== 0, 0, parallaxWeight));
	vdp.writeVdpRegister(VDP_REG_DRAW_COLOR, colorWord);
	vdp.consumeDirectVdpCommand(VDP_CMD_BLIT);
}

function resolveAtlasSlotFromMemory(memory: Memory, atlasId: number): number {
	if (atlasId === VDP_SYSTEM_ATLAS_ID) {
		return VDP_SLOT_SYSTEM;
	}
	if (memory.readIoU32(IO_VDP_SLOT_PRIMARY_ATLAS) === atlasId) {
		return VDP_SLOT_PRIMARY;
	}
	if (memory.readIoU32(IO_VDP_SLOT_SECONDARY_ATLAS) === atlasId) {
		return VDP_SLOT_SECONDARY;
	}
	throw vdpFault(`atlas ${atlasId} is not loaded in a VDP slot.`);
}

function processVdpCommandCore(vdp: VDP, cpu: CPU, api: Api, params: {
	cmd: number;
	argWords: number;
	argReader: PacketWordReader;
	payloadReader: PacketWordReader;
	payloadWords: number;
}): void {
	switch (params.cmd) {
		case IO_CMD_VDP_CLEAR: {
			assertVdpPacketArgWords(params.cmd, params.argWords);
			vdp.writeVdpRegister(VDP_REG_DRAW_COLOR, readPacketColorWord(params.argReader, params.cmd, 0));
			vdp.consumeDirectVdpCommand(VDP_CMD_CLEAR);
			break;
		}
		case IO_CMD_VDP_FILL_RECT: {
			assertVdpPacketArgWords(params.cmd, params.argWords);
			writeVdpFillRectCommand(
				vdp,
				readPacketArgF32(params.argReader, params.cmd, 0),
				readPacketArgF32(params.argReader, params.cmd, 1),
				readPacketArgF32(params.argReader, params.cmd, 2),
				readPacketArgF32(params.argReader, params.cmd, 3),
				readPacketArgF32(params.argReader, params.cmd, 4),
				readPacketArgU32(params.argReader, params.cmd, 5) as 0 | 1 | 2,
				readPacketColorWord(params.argReader, params.cmd, 6),
			);
			break;
		}
		case IO_CMD_VDP_DRAW_LINE: {
			assertVdpPacketArgWords(params.cmd, params.argWords);
			vdp.writeVdpRegister(VDP_REG_GEOM_X0, toSignedWord(FIX16_SCALE * readPacketArgF32(params.argReader, params.cmd, 0)));
			vdp.writeVdpRegister(VDP_REG_GEOM_Y0, toSignedWord(FIX16_SCALE * readPacketArgF32(params.argReader, params.cmd, 1)));
			vdp.writeVdpRegister(VDP_REG_GEOM_X1, toSignedWord(FIX16_SCALE * readPacketArgF32(params.argReader, params.cmd, 2)));
			vdp.writeVdpRegister(VDP_REG_GEOM_Y1, toSignedWord(FIX16_SCALE * readPacketArgF32(params.argReader, params.cmd, 3)));
			vdp.writeVdpRegister(VDP_REG_DRAW_LAYER_PRIO, encodeVdpLayerPriority(readPacketArgU32(params.argReader, params.cmd, 5) as 0 | 1 | 2, readPacketArgF32(params.argReader, params.cmd, 4)));
			vdp.writeVdpRegister(VDP_REG_DRAW_COLOR, readPacketColorWord(params.argReader, params.cmd, 6));
			vdp.writeVdpRegister(VDP_REG_LINE_WIDTH, toSignedWord(FIX16_SCALE * readPacketArgF32(params.argReader, params.cmd, 10)));
			vdp.consumeDirectVdpCommand(VDP_CMD_DRAW_LINE);
			break;
		}
		case IO_CMD_VDP_BLIT: {
			assertVdpPacketArgWords(params.cmd, params.argWords);
			const flipFlags = readPacketArgU32(params.argReader, params.cmd, 11);
			writeVdpBlitCommand(
				vdp,
				readPacketArgU32(params.argReader, params.cmd, 0),
				readPacketArgU32(params.argReader, params.cmd, 1),
				readPacketArgU32(params.argReader, params.cmd, 2),
				readPacketArgU32(params.argReader, params.cmd, 3),
				readPacketArgU32(params.argReader, params.cmd, 4),
				readPacketArgF32(params.argReader, params.cmd, 5),
				readPacketArgF32(params.argReader, params.cmd, 6),
				readPacketArgF32(params.argReader, params.cmd, 7),
				readPacketArgU32(params.argReader, params.cmd, 8) as 0 | 1 | 2,
				readPacketArgF32(params.argReader, params.cmd, 9),
				readPacketArgF32(params.argReader, params.cmd, 10),
				flipFlags,
				readPacketColorWord(params.argReader, params.cmd, 12),
				readPacketArgF32(params.argReader, params.cmd, 16),
			);
			break;
		}
		case IO_CMD_VDP_GLYPH_RUN: {
			assertVdpPacketArgWords(params.cmd, params.argWords);
			const text = cpu.getStringPool().getById(readPacketArgU32(params.argReader, params.cmd, 0)).text;
			const backgroundEnabled = readPacketArgU32(params.argReader, params.cmd, 12) !== 0;
			let cursorX = readPacketArgF32(params.argReader, params.cmd, 1);
			const cursorY = readPacketArgF32(params.argReader, params.cmd, 2);
			const priority = readPacketArgF32(params.argReader, params.cmd, 3);
			const font = api.resolve_font(readPacketArgU32(params.argReader, params.cmd, 4));
			const start = readPacketArgI32(params.argReader, params.cmd, 5);
			const end = readPacketArgI32(params.argReader, params.cmd, 6);
			const layer = readPacketArgU32(params.argReader, params.cmd, 7) as 0 | 1 | 2;
			const colorWord = readPacketColorWord(params.argReader, params.cmd, 8);
			const backgroundColorWord = backgroundEnabled ? readPacketColorWord(params.argReader, params.cmd, 13) : 0;
			let glyphIndex = 0;
			for (const char of text) {
				const glyph = font.getGlyph(char);
				if (glyphIndex >= start && glyphIndex < end) {
					const rect = glyph.rect;
					if (backgroundEnabled) {
						writeVdpFillRectCommand(vdp, cursorX, cursorY, cursorX + rect.w, cursorY + rect.h, priority, layer, backgroundColorWord);
					}
					writeVdpBlitCommand(vdp, resolveAtlasSlotFromMemory(cpu.memory, rect.atlasId), rect.u, rect.v, rect.w, rect.h, cursorX, cursorY, priority, layer, 1, 1, 0, colorWord, 0);
				}
				cursorX += glyph.advance;
				glyphIndex += 1;
			}
			break;
		}
		case IO_CMD_VDP_TILE_RUN: {
			assertVdpPacketArgWords(params.cmd, params.argWords);
			const tileCount = readPacketArgU32(params.argReader, params.cmd, 0);
			const payloadWordCount = tileCount * 5;
			if (payloadWordCount > params.payloadWords) {
				throw vdpFault(`tile payload underrun (${payloadWordCount} > ${params.payloadWords}).`);
			}
			const cols = readPacketArgI32(params.argReader, params.cmd, 1);
			const rows = readPacketArgI32(params.argReader, params.cmd, 2);
			if (tileCount !== cols * rows) {
				throw vdpFault(`tile payload size mismatch (${tileCount} != ${cols * rows}).`);
			}
			const tileW = readPacketArgI32(params.argReader, params.cmd, 3);
			const tileH = readPacketArgI32(params.argReader, params.cmd, 4);
			const originX = readPacketArgI32(params.argReader, params.cmd, 5);
			const originY = readPacketArgI32(params.argReader, params.cmd, 6);
			const scrollX = readPacketArgI32(params.argReader, params.cmd, 7);
			const scrollY = readPacketArgI32(params.argReader, params.cmd, 8);
			const priority = readPacketArgF32(params.argReader, params.cmd, 9);
			const layer = readPacketArgU32(params.argReader, params.cmd, 10) as 0 | 1 | 2;
			const payloadReader = params.payloadReader;
			for (let row = 0; row < rows; row += 1) {
				for (let col = 0; col < cols; col += 1) {
					const payloadOffset = (row * cols + col) * 5;
					const slot = payloadReader.readU32(payloadOffset);
					if (slot === VDP_SLOT_NONE) {
						continue;
					}
					const w = payloadReader.readU32(payloadOffset + 3);
					const h = payloadReader.readU32(payloadOffset + 4);
					if (w !== tileW || h !== tileH) {
						throw vdpFault('VDP tile payload tile size mismatch.');
					}
					writeVdpBlitCommand(vdp, slot, payloadReader.readU32(payloadOffset + 1), payloadReader.readU32(payloadOffset + 2), w, h, originX + col * tileW - scrollX, originY + row * tileH - scrollY, priority, layer, 1, 1, 0, 0xffffffff, 0);
				}
			}
			break;
		}
		case IO_CMD_VDP_CONFIG_SURFACE: {
			assertVdpPacketArgWords(params.cmd, params.argWords);
			vdp.configureVramSlotSurface(
				readPacketArgU32(params.argReader, params.cmd, 0),
				readPacketArgU32(params.argReader, params.cmd, 1),
				readPacketArgU32(params.argReader, params.cmd, 2),
			);
			break;
		}
		default:
			throw vdpFault(`unknown I/O command ${params.cmd}.`);
	}
}

export function processVdpCommand(vdp: VDP, cpu: CPU, api: Api, memory: Memory, params: {
	cmd: number;
	argWords: number;
	argsBase: number;
	payloadBase: number;
	payloadWords: number;
}): void {
	processVdpCommandCore(vdp, cpu, api, {
		cmd: params.cmd,
		argWords: params.argWords,
		argReader: VDP_PACKET_MEMORY_ARGS.set(memory, params.argsBase),
		payloadReader: VDP_PACKET_MEMORY_PAYLOAD.set(memory, params.payloadBase),
		payloadWords: params.payloadWords,
	});
}

export function processVdpBufferedCommand(vdp: VDP, cpu: CPU, api: Api, params: {
	cmd: number;
	argWords: number;
	argsWordOffset: number;
	payloadWordOffset: number;
	payloadWords: number;
	words: Uint32Array;
}): void {
	processVdpCommandCore(vdp, cpu, api, {
		cmd: params.cmd,
		argWords: params.argWords,
		argReader: VDP_PACKET_BUFFER_ARGS.set(params.words, params.argsWordOffset),
		payloadReader: VDP_PACKET_BUFFER_PAYLOAD.set(params.words, params.payloadWordOffset),
		payloadWords: params.payloadWords,
	});
}
