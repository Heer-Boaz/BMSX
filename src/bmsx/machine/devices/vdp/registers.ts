import { IO_VDP_CMD_ARG_COUNT } from '../../bus/io';

export const VDP_REGISTER_COUNT = IO_VDP_CMD_ARG_COUNT;

export const VDP_REG_SRC_SLOT = 0;
export const VDP_REG_SRC_UV = 1;
export const VDP_REG_SRC_WH = 2;
export const VDP_REG_DST_X = 3;
export const VDP_REG_DST_Y = 4;
export const VDP_REG_GEOM_X0 = 5;
export const VDP_REG_GEOM_Y0 = 6;
export const VDP_REG_GEOM_X1 = 7;
export const VDP_REG_GEOM_Y1 = 8;
export const VDP_REG_LINE_WIDTH = 9;
export const VDP_REG_DRAW_LAYER = 10;
export const VDP_REG_DRAW_PRIORITY = 11;
export const VDP_REG_DRAW_CTRL = 12;
export const VDP_REG_DRAW_SCALE_X = 13;
export const VDP_REG_DRAW_SCALE_Y = 14;
export const VDP_REG_DRAW_COLOR = 15;
export const VDP_REG_BG_COLOR = 16;
export const VDP_REG_SLOT_INDEX = 17;
export const VDP_REG_SLOT_DIM = 18;

export const VDP_Q16_ONE = 0x00010000;

export const VDP_DRAW_CTRL_FLIP_H = 0x00000001;
export const VDP_DRAW_CTRL_FLIP_V = 0x00000002;
export const VDP_DRAW_CTRL_BLEND_SHIFT = 2;
export const VDP_DRAW_CTRL_BLEND_MASK = 0x000000fc;
export const VDP_DRAW_CTRL_PMU_BANK_SHIFT = 8;
export const VDP_DRAW_CTRL_PMU_BANK_MASK = 0x0000ff00;
export const VDP_DRAW_CTRL_PMU_WEIGHT_SHIFT = 16;

export const VDP_PKT_KIND_MASK = 0xff000000;
export const VDP_PKT_RESERVED_MASK = 0x00ff0000;
export const VDP_PKT_END = 0x00000000;
export const VDP_PKT_CMD = 0x01000000;
export const VDP_PKT_REG1 = 0x02000000;
export const VDP_PKT_REGN = 0x03000000;

export const VDP_CMD_NOP = 0;
export const VDP_CMD_CLEAR = 1;
export const VDP_CMD_FILL_RECT = 2;
export const VDP_CMD_DRAW_LINE = 3;
export const VDP_CMD_BLIT = 4;
export const VDP_CMD_COPY_RECT = 5;
export const VDP_CMD_BEGIN_FRAME = 14;
export const VDP_CMD_END_FRAME = 15;

export type VdpLatchedGeometry = {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
};

export type VdpDrawCtrl = {
	flipH: boolean;
	flipV: boolean;
	blendMode: number;
	pmuBank: number;
	parallaxWeight: number;
};


export function decodeVdpDrawCtrl(value: number, target: VdpDrawCtrl): void {
	const rawQ8_8 = (value >>> VDP_DRAW_CTRL_PMU_WEIGHT_SHIFT) & 0xffff;
	const signedQ8_8 = (rawQ8_8 & 0x8000) !== 0 ? rawQ8_8 - 0x10000 : rawQ8_8;
	target.flipH = (value & VDP_DRAW_CTRL_FLIP_H) !== 0;
	target.flipV = (value & VDP_DRAW_CTRL_FLIP_V) !== 0;
	target.blendMode = (value & VDP_DRAW_CTRL_BLEND_MASK) >>> VDP_DRAW_CTRL_BLEND_SHIFT;
	target.pmuBank = ((value & VDP_DRAW_CTRL_PMU_BANK_MASK) >>> VDP_DRAW_CTRL_PMU_BANK_SHIFT) & 0xff;
	target.parallaxWeight = signedQ8_8 / 256;
}

export function encodeVdpDrawCtrl(flipH: boolean, flipV: boolean, pmuBank: number, parallaxWeight: number): number {
	const rawQ8_8 = ((parallaxWeight * 256) | 0) & 0xffff;
	return (
		(flipH ? VDP_DRAW_CTRL_FLIP_H : 0)
		| (flipV ? VDP_DRAW_CTRL_FLIP_V : 0)
		| ((pmuBank & 0xff) << VDP_DRAW_CTRL_PMU_BANK_SHIFT)
		| (rawQ8_8 << VDP_DRAW_CTRL_PMU_WEIGHT_SHIFT)
	) >>> 0;
}
