import {
	IO_CMD_VDP_BLIT,
	IO_CMD_VDP_CLEAR,
	IO_CMD_VDP_DRAW_LINE,
	IO_CMD_VDP_FILL_RECT,
	IO_CMD_VDP_GLYPH_RUN,
	IO_CMD_VDP_TILE_RUN,
} from '../../bus/io';

export const enum VdpPacketWordKind {
	U32 = 0,
	F32 = 1,
}

export type VdpPacketSchema = {
	readonly cmd: number;
	readonly name: string;
	readonly argWords: number;
	readonly argKinds: ReadonlyArray<VdpPacketWordKind>;
};

const CLEAR_ARG_KINDS = [
	VdpPacketWordKind.F32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.F32,
] as const;

const FILL_RECT_ARG_KINDS = [
	VdpPacketWordKind.F32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.U32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.F32,
] as const;

const DRAW_LINE_ARG_KINDS = [
	VdpPacketWordKind.F32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.U32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.F32,
] as const;

const BLIT_ARG_KINDS = [
	VdpPacketWordKind.U32,
	VdpPacketWordKind.U32,
	VdpPacketWordKind.U32,
	VdpPacketWordKind.U32,
	VdpPacketWordKind.U32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.U32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.U32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.F32,
] as const;

const GLYPH_RUN_ARG_KINDS = [
	VdpPacketWordKind.U32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.U32,
	VdpPacketWordKind.U32,
	VdpPacketWordKind.U32,
	VdpPacketWordKind.U32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.U32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.F32,
] as const;

const TILE_RUN_ARG_KINDS = [
	VdpPacketWordKind.U32,
	VdpPacketWordKind.U32,
	VdpPacketWordKind.U32,
	VdpPacketWordKind.U32,
	VdpPacketWordKind.U32,
	VdpPacketWordKind.U32,
	VdpPacketWordKind.U32,
	VdpPacketWordKind.U32,
	VdpPacketWordKind.U32,
	VdpPacketWordKind.F32,
	VdpPacketWordKind.U32,
] as const;

const CLEAR_PACKET_SCHEMA: VdpPacketSchema = { cmd: IO_CMD_VDP_CLEAR, name: 'clear', argWords: CLEAR_ARG_KINDS.length, argKinds: CLEAR_ARG_KINDS };
const FILL_RECT_PACKET_SCHEMA: VdpPacketSchema = { cmd: IO_CMD_VDP_FILL_RECT, name: 'fill_rect', argWords: FILL_RECT_ARG_KINDS.length, argKinds: FILL_RECT_ARG_KINDS };
const DRAW_LINE_PACKET_SCHEMA: VdpPacketSchema = { cmd: IO_CMD_VDP_DRAW_LINE, name: 'draw_line', argWords: DRAW_LINE_ARG_KINDS.length, argKinds: DRAW_LINE_ARG_KINDS };
const BLIT_PACKET_SCHEMA: VdpPacketSchema = { cmd: IO_CMD_VDP_BLIT, name: 'blit', argWords: BLIT_ARG_KINDS.length, argKinds: BLIT_ARG_KINDS };
const GLYPH_RUN_PACKET_SCHEMA: VdpPacketSchema = { cmd: IO_CMD_VDP_GLYPH_RUN, name: 'glyph_run', argWords: GLYPH_RUN_ARG_KINDS.length, argKinds: GLYPH_RUN_ARG_KINDS };
const TILE_RUN_PACKET_SCHEMA: VdpPacketSchema = { cmd: IO_CMD_VDP_TILE_RUN, name: 'tile_run', argWords: TILE_RUN_ARG_KINDS.length, argKinds: TILE_RUN_ARG_KINDS };

export function findVdpPacketSchema(cmd: number): VdpPacketSchema | null {
	switch (cmd >>> 0) {
		case IO_CMD_VDP_CLEAR:
			return CLEAR_PACKET_SCHEMA;
		case IO_CMD_VDP_FILL_RECT:
			return FILL_RECT_PACKET_SCHEMA;
		case IO_CMD_VDP_DRAW_LINE:
			return DRAW_LINE_PACKET_SCHEMA;
		case IO_CMD_VDP_BLIT:
			return BLIT_PACKET_SCHEMA;
		case IO_CMD_VDP_GLYPH_RUN:
			return GLYPH_RUN_PACKET_SCHEMA;
		case IO_CMD_VDP_TILE_RUN:
			return TILE_RUN_PACKET_SCHEMA;
		default:
			return null;
	}
}

export function getVdpPacketSchema(cmd: number): VdpPacketSchema {
	const schema = findVdpPacketSchema(cmd);
	if (schema === null) {
		throw new Error(`[VDP] Unknown packet command ${cmd >>> 0}.`);
	}
	return schema;
}

export function getVdpPacketArgKind(cmd: number, index: number): VdpPacketWordKind {
	const schema = getVdpPacketSchema(cmd);
	if (index < 0 || index >= schema.argWords) {
		throw new Error(`[VDP] ${schema.name} arg index ${index} is out of range (${schema.argWords}).`);
	}
	return schema.argKinds[index]!;
}

export function assertVdpPacketArgWords(cmd: number, argWords: number): void {
	const schema = getVdpPacketSchema(cmd);
	if (argWords !== schema.argWords) {
		throw new Error(`[VDP] ${schema.name} expects ${schema.argWords} arg words, got ${argWords}.`);
	}
}
