import {
	IO_GX_PCRTC_BASE,
	IO_GX_PCRTC_TIMING_BASE,
	IO_GX_PCRTC_TIMING_WORD_COUNT,
	IO_GX_PCRTC_WORD_COUNT,
} from '../bmsx/io';
import { IO_WORD_SIZE } from '../bmsx/memory_map';

export const GX_GPU_PCRTC_WORD_COUNT = IO_GX_PCRTC_WORD_COUNT + IO_GX_PCRTC_TIMING_WORD_COUNT;
export const GX_GPU_PCRTC_CONFIG_WORD_COUNT = 22;
export const GX_GPU_PCRTC_COMPOSITION_WORD_COUNT = 12;
export const GX_GPU_PCRTC_PMODE_LOW = 0;
export const GX_GPU_PCRTC_PMODE_HIGH = 1;
export const GX_GPU_PCRTC_DISPFB1_LOW = 2;
export const GX_GPU_PCRTC_DISPFB1_HIGH = 3;
export const GX_GPU_PCRTC_DISPLAY1_LOW = 4;
export const GX_GPU_PCRTC_DISPLAY1_HIGH = 5;
export const GX_GPU_PCRTC_DISPFB2_LOW = 6;
export const GX_GPU_PCRTC_DISPFB2_HIGH = 7;
export const GX_GPU_PCRTC_DISPLAY2_LOW = 8;
export const GX_GPU_PCRTC_DISPLAY2_HIGH = 9;
export const GX_GPU_PCRTC_BGCOLOR_LOW = 10;
export const GX_GPU_PCRTC_BGCOLOR_HIGH = 11;
export const GX_GPU_PCRTC_SMODE1_LOW = 12;
export const GX_GPU_PCRTC_SMODE1_HIGH = 13;
export const GX_GPU_PCRTC_SMODE2_LOW = 14;
export const GX_GPU_PCRTC_SMODE2_HIGH = 15;
export const GX_GPU_PCRTC_SYNCH1_LOW = 16;
export const GX_GPU_PCRTC_SYNCH1_HIGH = 17;
export const GX_GPU_PCRTC_SYNCH2_LOW = 18;
export const GX_GPU_PCRTC_SYNCH2_HIGH = 19;
export const GX_GPU_PCRTC_SYNCV_LOW = 20;
export const GX_GPU_PCRTC_SYNCV_HIGH = 21;
export const GX_GPU_PCRTC_CSR_LOW = 22;
export const GX_GPU_PCRTC_CSR_HIGH = 23;
export const GX_GPU_PCRTC_IMR_LOW = 24;
export const GX_GPU_PCRTC_IMR_HIGH = 25;

export const GX_GPU_PCRTC_PMODE_EN1 = 1 << 0;
export const GX_GPU_PCRTC_PMODE_EN2 = 1 << 1;
export const GX_GPU_PCRTC_PMODE_MMOD_SHIFT = 5;
export const GX_GPU_PCRTC_PMODE_AMOD_SHIFT = 6;
export const GX_GPU_PCRTC_PMODE_SLBG_SHIFT = 7;
export const GX_GPU_PCRTC_PMODE_MMOD = 1 << GX_GPU_PCRTC_PMODE_MMOD_SHIFT;
export const GX_GPU_PCRTC_PMODE_AMOD = 1 << GX_GPU_PCRTC_PMODE_AMOD_SHIFT;
export const GX_GPU_PCRTC_PMODE_SLBG = 1 << GX_GPU_PCRTC_PMODE_SLBG_SHIFT;
export const GX_GPU_PCRTC_PMODE_ALP_SHIFT = 8;
export const GX_GPU_PCRTC_SMODE1_PRST = 1 << 16;
export const GX_GPU_PCRTC_SMODE1_SINT = 1 << 17;
export const GX_GPU_PCRTC_SMODE2_INT = 1 << 0;
export const GX_GPU_PCRTC_SMODE2_FFMD = 1 << 1;
export const GX_GPU_PCRTC_CSR_SIGNAL = 1 << 0;
export const GX_GPU_PCRTC_CSR_FINISH = 1 << 1;
export const GX_GPU_PCRTC_CSR_HSINT = 1 << 2;
export const GX_GPU_PCRTC_CSR_VSINT = 1 << 3;
export const GX_GPU_PCRTC_CSR_EDWINT = 1 << 4;
export const GX_GPU_PCRTC_CSR_EVENT_MASK = 0x1f;
export const GX_GPU_PCRTC_CSR_FLUSH = 1 << 8;
export const GX_GPU_PCRTC_CSR_RESET = 1 << 9;
export const GX_GPU_PCRTC_CSR_FIELD = 1 << 13;
export const GX_GPU_PCRTC_CSR_ACTION_MASK = GX_GPU_PCRTC_CSR_FLUSH | GX_GPU_PCRTC_CSR_RESET;
export const GX_GPU_PCRTC_IMR_EVENT_MASK = 0x1f00;
export const GX_GPU_PCRTC_IMR_FIXED_BITS = 0x6000;

export const GX_GPU_PCRTC_RESET_CSR_WORD = 0x551b4000;
export const GX_GPU_PCRTC_RESET_IMR_WORD = 0x00007f00;

type GxGpuPcrtcConfigWords = readonly [
	number, number, number, number, number, number,
	number, number, number, number, number, number,
	number, number, number, number, number, number,
	number, number, number, number,
];

export const GX_GPU_PCRTC_RESET_CONFIG_WORDS: GxGpuPcrtcConfigWords = [
	0x00000000,
	0x00000000,
	0x000fa000,
	0x00000000,
	0x018252a8,
	0x000ef4ff,
	0x000fa000,
	0x00000000,
	0x018252a8,
	0x000ef4ff,
	0x00000000,
	0x00000000,
	0x40806504,
	0x00000007,
	0x00000000,
	0x00000000,
	0x1fc83030,
	0x0007f5c2,
	0x003484bc,
	0x00000000,
	0x02101404,
	0x00a90005,
];

export function gxGpuPcrtcRegisterAddress(index: number): number {
	return index < IO_GX_PCRTC_WORD_COUNT
		? IO_GX_PCRTC_BASE + index * IO_WORD_SIZE
		: IO_GX_PCRTC_TIMING_BASE + (index - IO_GX_PCRTC_WORD_COUNT) * IO_WORD_SIZE;
}
