import type { Value } from '../../cpu/cpu';
import {
	IO_GX_GTE_COMMAND,
	IO_GX_GTE_CONTROL0,
	IO_GX_GTE_CONTROL_REGISTER_COUNT as IO_GX_GTE_CONTROL_WORDS,
	IO_GX_GTE_CYCLES,
	IO_GX_GTE_DATA0,
	IO_GX_GTE_DATA_REGISTER_COUNT as IO_GX_GTE_DATA_WORDS,
} from '../../bus/io';
import { IO_WORD_SIZE } from '../../memory/map';
import type { Memory } from '../../memory/memory';

export const GX_GTE_DATA_REGISTER_COUNT = 32;
export const GX_GTE_CONTROL_REGISTER_COUNT = 32;

export const GX_GTE_FN_RTPS = 0x01;
export const GX_GTE_FN_NCLIP = 0x06;
export const GX_GTE_FN_OP = 0x0c;
export const GX_GTE_FN_DPCS = 0x10;
export const GX_GTE_FN_INTPL = 0x11;
export const GX_GTE_FN_MVMVA = 0x12;
export const GX_GTE_FN_SQR = 0x28;
export const GX_GTE_FN_DCPL = 0x29;
export const GX_GTE_FN_DPCT = 0x2a;
export const GX_GTE_FN_AVSZ3 = 0x2d;
export const GX_GTE_FN_AVSZ4 = 0x2e;
export const GX_GTE_FN_RTPT = 0x30;
export const GX_GTE_FN_GPF = 0x3d;
export const GX_GTE_FN_GPL = 0x3e;

export const GX_GTE_CYCLES_RTPS = 15;
export const GX_GTE_CYCLES_NCLIP = 8;
export const GX_GTE_CYCLES_OP = 6;
export const GX_GTE_CYCLES_DPCS = 8;
export const GX_GTE_CYCLES_INTPL = 8;
export const GX_GTE_CYCLES_MVMVA = 8;
export const GX_GTE_CYCLES_SQR = 5;
export const GX_GTE_CYCLES_DCPL = 8;
export const GX_GTE_CYCLES_DPCT = 17;
export const GX_GTE_CYCLES_AVSZ3 = 5;
export const GX_GTE_CYCLES_AVSZ4 = 6;
export const GX_GTE_CYCLES_RTPT = 23;
export const GX_GTE_CYCLES_GPF = 5;
export const GX_GTE_CYCLES_GPL = 5;

export const GX_GTE_FLAG_ERROR = 0x80000000;
export const GX_GTE_FLAG_MAC1_POS = 0x40000000;
export const GX_GTE_FLAG_MAC2_POS = 0x20000000;
export const GX_GTE_FLAG_MAC3_POS = 0x10000000;
export const GX_GTE_FLAG_MAC1_NEG = 0x08000000;
export const GX_GTE_FLAG_MAC2_NEG = 0x04000000;
export const GX_GTE_FLAG_MAC3_NEG = 0x02000000;
export const GX_GTE_FLAG_IR1_SAT = 0x01000000;
export const GX_GTE_FLAG_IR2_SAT = 0x00800000;
export const GX_GTE_FLAG_IR3_SAT = 0x00400000;
export const GX_GTE_FLAG_COLOR_R_SAT = 0x00200000;
export const GX_GTE_FLAG_COLOR_G_SAT = 0x00100000;
export const GX_GTE_FLAG_COLOR_B_SAT = 0x00080000;
export const GX_GTE_FLAG_SZ_OTZ_SAT = 0x00040000;
export const GX_GTE_FLAG_DIV_OVERFLOW = 0x00020000;
export const GX_GTE_FLAG_MAC0_POS = 0x00010000;
export const GX_GTE_FLAG_MAC0_NEG = 0x00008000;
export const GX_GTE_FLAG_SX2_SAT = 0x00004000;
export const GX_GTE_FLAG_SY2_SAT = 0x00002000;
export const GX_GTE_FLAG_IR0_SAT = 0x00001000;
export const GX_GTE_FLAG_WRITE_MASK = 0x7ffff000;
export const GX_GTE_FLAG_ERROR_MASK = 0x7f87e000;

const INT44_MAX = 0x7ffffffffff;
const INT44_MIN = -0x80000000000;
const INT44_RANGE = 0x100000000000;

const GTE_DIVIDE_TABLE = new Uint8Array([
	0xff, 0xfd, 0xfb, 0xf9, 0xf7, 0xf5, 0xf3, 0xf1, 0xef, 0xee, 0xec, 0xea, 0xe8, 0xe6, 0xe4, 0xe3,
	0xe1, 0xdf, 0xdd, 0xdc, 0xda, 0xd8, 0xd6, 0xd5, 0xd3, 0xd1, 0xd0, 0xce, 0xcd, 0xcb, 0xc9, 0xc8,
	0xc6, 0xc5, 0xc3, 0xc1, 0xc0, 0xbe, 0xbd, 0xbb, 0xba, 0xb8, 0xb7, 0xb5, 0xb4, 0xb2, 0xb1, 0xb0,
	0xae, 0xad, 0xab, 0xaa, 0xa9, 0xa7, 0xa6, 0xa4, 0xa3, 0xa2, 0xa0, 0x9f, 0x9e, 0x9c, 0x9b, 0x9a,
	0x99, 0x97, 0x96, 0x95, 0x94, 0x92, 0x91, 0x90, 0x8f, 0x8d, 0x8c, 0x8b, 0x8a, 0x89, 0x87, 0x86,
	0x85, 0x84, 0x83, 0x82, 0x81, 0x7f, 0x7e, 0x7d, 0x7c, 0x7b, 0x7a, 0x79, 0x78, 0x77, 0x75, 0x74,
	0x73, 0x72, 0x71, 0x70, 0x6f, 0x6e, 0x6d, 0x6c, 0x6b, 0x6a, 0x69, 0x68, 0x67, 0x66, 0x65, 0x64,
	0x63, 0x62, 0x61, 0x60, 0x5f, 0x5e, 0x5d, 0x5d, 0x5c, 0x5b, 0x5a, 0x59, 0x58, 0x57, 0x56, 0x55,
	0x54, 0x53, 0x53, 0x52, 0x51, 0x50, 0x4f, 0x4e, 0x4d, 0x4d, 0x4c, 0x4b, 0x4a, 0x49, 0x48, 0x48,
	0x47, 0x46, 0x45, 0x44, 0x43, 0x43, 0x42, 0x41, 0x40, 0x3f, 0x3f, 0x3e, 0x3d, 0x3c, 0x3c, 0x3b,
	0x3a, 0x39, 0x39, 0x38, 0x37, 0x36, 0x36, 0x35, 0x34, 0x33, 0x33, 0x32, 0x31, 0x31, 0x30, 0x2f,
	0x2e, 0x2e, 0x2d, 0x2c, 0x2c, 0x2b, 0x2a, 0x2a, 0x29, 0x28, 0x28, 0x27, 0x26, 0x26, 0x25, 0x24,
	0x24, 0x23, 0x22, 0x22, 0x21, 0x20, 0x20, 0x1f, 0x1e, 0x1e, 0x1d, 0x1d, 0x1c, 0x1b, 0x1b, 0x1a,
	0x19, 0x19, 0x18, 0x18, 0x17, 0x16, 0x16, 0x15, 0x15, 0x14, 0x14, 0x13, 0x12, 0x12, 0x11, 0x11,
	0x10, 0x0f, 0x0f, 0x0e, 0x0e, 0x0d, 0x0d, 0x0c, 0x0c, 0x0b, 0x0a, 0x0a, 0x09, 0x09, 0x08, 0x08,
	0x07, 0x07, 0x06, 0x06, 0x05, 0x05, 0x04, 0x04, 0x03, 0x03, 0x02, 0x02, 0x01, 0x01, 0x00, 0x00,
	0x00,
]);

function sign16(value: number): number {
	const signed = (value << 16) >> 16;
	return signed;
}

function highSign16(value: number): number {
	return value >> 16;
}

function signExtend44(value: number): number {
	if (value > INT44_MAX) {
		return value - INT44_RANGE;
	}
	if (value < INT44_MIN) {
		return value + INT44_RANGE;
	}
	return value;
}

function shiftRightSigned(value: number, bits: number): number {
	const divisor = 2 ** bits;
	const shifted = value / divisor;
	const truncated = shifted | 0;
	if (shifted < truncated) {
		return truncated - 1;
	}
	return truncated;
}

function shiftGte(value: number, sf: number): number {
	if (sf > 0) {
		return shiftRightSigned(value, 12);
	}
	return value;
}

function toSigned32(value: number): number {
	return value | 0;
}

function countLeadingBits(word: number): number {
	const value = word >>> 0;
	if ((value & 0x80000000) === 0) {
		return Math.clz32(value);
	}
	return Math.clz32((~value) >>> 0);
}

export type GxGteState = {
	dataRegisterWords: number[];
	controlRegisterWords: number[];
	mac0: number;
	mac1: number;
	mac2: number;
	mac3: number;
	currentSf: number;
};

export class GxGte {
	private readonly dataRegisterWords = new Uint32Array(GX_GTE_DATA_REGISTER_COUNT);
	private readonly controlRegisterWords = new Uint32Array(GX_GTE_CONTROL_REGISTER_COUNT);
	private mac0 = 0;
	private mac1 = 0;
	private mac2 = 0;
	private mac3 = 0;
	private accumValue = 0;
	private accumPositiveOverflow = false;
	private accumNegativeOverflow = false;
	private lastCycles = 0;

	public constructor(private readonly memory: Memory) {
		for (let index = 0; index < IO_GX_GTE_DATA_WORDS; index += 1) {
			this.memory.mapIoRead(IO_GX_GTE_DATA0 + index * IO_WORD_SIZE, this, GxGte.readDataRegisterThunk);
			this.memory.mapIoWrite(IO_GX_GTE_DATA0 + index * IO_WORD_SIZE, this, GxGte.writeDataRegisterThunk);
		}
		for (let index = 0; index < IO_GX_GTE_CONTROL_WORDS; index += 1) {
			this.memory.mapIoRead(IO_GX_GTE_CONTROL0 + index * IO_WORD_SIZE, this, GxGte.readControlRegisterThunk);
			this.memory.mapIoWrite(IO_GX_GTE_CONTROL0 + index * IO_WORD_SIZE, this, GxGte.writeControlRegisterThunk);
		}
		this.memory.mapIoWrite(IO_GX_GTE_COMMAND, this, GxGte.writeCommandThunk);
		this.memory.mapIoRead(IO_GX_GTE_CYCLES, this, GxGte.readCyclesThunk);
	}

	public reset(): void {
		this.dataRegisterWords.fill(0);
		this.controlRegisterWords.fill(0);
		this.mac0 = 0;
		this.mac1 = 0;
		this.mac2 = 0;
		this.mac3 = 0;
		this.accumValue = 0;
		this.accumPositiveOverflow = false;
		this.accumNegativeOverflow = false;
		this.lastCycles = 0;
		this.memory.writeIoValue(IO_GX_GTE_COMMAND, 0);
		this.memory.writeIoValue(IO_GX_GTE_CYCLES, 0);
		this.currentSf = 0;
	}

	public captureState(): GxGteState {
		return {
			dataRegisterWords: Array.from(this.dataRegisterWords),
			controlRegisterWords: Array.from(this.controlRegisterWords),
			mac0: this.mac0,
			mac1: this.mac1,
			mac2: this.mac2,
			mac3: this.mac3,
			currentSf: this.currentSf,
		};
	}

	public restoreState(state: GxGteState): void {
		for (let index = 0; index < GX_GTE_DATA_REGISTER_COUNT; index += 1) {
			this.dataRegisterWords[index] = state.dataRegisterWords[index]! >>> 0;
		}
		for (let index = 0; index < GX_GTE_CONTROL_REGISTER_COUNT; index += 1) {
			this.controlRegisterWords[index] = state.controlRegisterWords[index]! >>> 0;
		}
		this.mac0 = state.mac0;
		this.mac1 = state.mac1;
		this.mac2 = state.mac2;
		this.mac3 = state.mac3;
		this.currentSf = state.currentSf >>> 0;
	}


	private static readDataRegisterThunk(context: GxGte, addr: number): Value {
		return context.readDataRegister(((addr - IO_GX_GTE_DATA0) / IO_WORD_SIZE) >>> 0);
	}

	private static writeDataRegisterThunk(context: GxGte, addr: number, value: Value): void {
		context.writeDataRegister(((addr - IO_GX_GTE_DATA0) / IO_WORD_SIZE) >>> 0, value as number);
	}

	private static readControlRegisterThunk(context: GxGte, addr: number): Value {
		return context.readControlRegister(((addr - IO_GX_GTE_CONTROL0) / IO_WORD_SIZE) >>> 0);
	}

	private static writeControlRegisterThunk(context: GxGte, addr: number, value: Value): void {
		context.writeControlRegister(((addr - IO_GX_GTE_CONTROL0) / IO_WORD_SIZE) >>> 0, value as number);
	}

	private static writeCommandThunk(context: GxGte, _addr: number, value: Value): void {
		context.lastCycles = context.execute(value as number);
		context.memory.writeIoValue(IO_GX_GTE_CYCLES, context.lastCycles);
	}

	private static readCyclesThunk(context: GxGte, _addr: number): Value {
		return context.lastCycles;
	}

	public readDataRegister(index: number): number {
		switch (index) {
			case 1:
			case 3:
			case 5:
			case 8:
			case 9:
			case 10:
			case 11:
				return sign16(this.dataRegisterWords[index]) >>> 0;
			case 7:
			case 16:
			case 17:
			case 18:
			case 19:
				return this.dataRegisterWords[index] & 0xffff;
			case 15:
				return this.dataRegisterWords[14];
			case 28:
			case 29:
				return this.packRgbFromIr();
			default:
				return this.dataRegisterWords[index];
		}
	}

	public writeDataRegister(index: number, value: number): void {
		const word = value >>> 0;
		switch (index) {
			case 1:
			case 3:
			case 5:
			case 8:
			case 9:
			case 10:
			case 11:
				this.dataRegisterWords[index] = sign16(word) >>> 0;
				break;
			case 7:
			case 16:
			case 17:
			case 18:
			case 19:
				this.dataRegisterWords[index] = word & 0xffff;
				break;
			case 15:
				this.dataRegisterWords[12] = this.dataRegisterWords[13];
				this.dataRegisterWords[13] = this.dataRegisterWords[14];
				this.dataRegisterWords[14] = word;
				break;
			case 28:
				this.dataRegisterWords[9] = sign16((word & 0x1f) << 7) >>> 0;
				this.dataRegisterWords[10] = sign16((word & 0x3e0) << 2) >>> 0;
				this.dataRegisterWords[11] = sign16((word & 0x7c00) >> 3) >>> 0;
				this.dataRegisterWords[28] = word & 0x7fff;
				break;
			case 29:
			case 31:
				break;
			case 30:
				this.dataRegisterWords[30] = word;
				this.dataRegisterWords[31] = countLeadingBits(word) >>> 0;
				break;
			default:
				this.dataRegisterWords[index] = word;
		}
	}

	public readControlRegister(index: number): number {
		return this.controlRegisterWords[index];
	}

	public writeControlRegister(index: number, value: number): void {
		const word = value >>> 0;
		switch (index) {
			case 4:
			case 12:
			case 20:
			case 26:
			case 27:
			case 29:
			case 30:
				this.controlRegisterWords[index] = sign16(word) >>> 0;
				break;
			case 31:
				this.controlRegisterWords[31] = this.withFlagError(word & GX_GTE_FLAG_WRITE_MASK);
				break;
			default:
				this.controlRegisterWords[index] = word;
		}
	}

	public execute(opcode: number): number {
		const sf = (opcode >>> 19) & 1;
		const lm = (opcode >>> 10) & 1;
		this.controlRegisterWords[31] = 0;
		switch (opcode & 0x3f) {
			case 0x00:
			case GX_GTE_FN_RTPS:
				this.executeRtps(0, sf, lm, true);
				this.updateFlagError();
				return GX_GTE_CYCLES_RTPS;
			case GX_GTE_FN_NCLIP:
				this.executeNclip();
				this.updateFlagError();
				return GX_GTE_CYCLES_NCLIP;
			case GX_GTE_FN_OP:
				this.executeOp(sf, lm);
				this.updateFlagError();
				return GX_GTE_CYCLES_OP;
			case GX_GTE_FN_DPCS:
				this.executeDpcs(sf, lm);
				this.updateFlagError();
				return GX_GTE_CYCLES_DPCS;
			case GX_GTE_FN_INTPL:
				this.executeIntpl(sf, lm);
				this.updateFlagError();
				return GX_GTE_CYCLES_INTPL;
			case GX_GTE_FN_MVMVA:
				this.executeMvmva(opcode, sf, lm);
				this.updateFlagError();
				return GX_GTE_CYCLES_MVMVA;
			case GX_GTE_FN_SQR:
				this.executeSqr(sf, lm);
				this.updateFlagError();
				return GX_GTE_CYCLES_SQR;
			case GX_GTE_FN_DCPL:
				this.executeDcpl(sf, lm);
				this.updateFlagError();
				return GX_GTE_CYCLES_DCPL;
			case GX_GTE_FN_DPCT:
				this.executeDpct(sf, lm);
				this.updateFlagError();
				return GX_GTE_CYCLES_DPCT;
			case GX_GTE_FN_AVSZ3:
				this.executeAvsz3();
				this.updateFlagError();
				return GX_GTE_CYCLES_AVSZ3;
			case GX_GTE_FN_AVSZ4:
				this.executeAvsz4();
				this.updateFlagError();
				return GX_GTE_CYCLES_AVSZ4;
			case GX_GTE_FN_RTPT:
				this.executeRtps(0, sf, lm, false);
				this.executeRtps(1, sf, lm, false);
				this.executeRtps(2, sf, lm, true);
				this.updateFlagError();
				return GX_GTE_CYCLES_RTPT;
			case GX_GTE_FN_GPF:
				this.executeGpf(sf, lm);
				this.updateFlagError();
				return GX_GTE_CYCLES_GPF;
			case GX_GTE_FN_GPL:
				this.executeGpl(sf, lm);
				this.updateFlagError();
				return GX_GTE_CYCLES_GPL;
			default:
				return 0;
		}
	}

	private setFlag(flag: number): void {
		this.controlRegisterWords[31] = (this.controlRegisterWords[31] | flag) >>> 0;
	}

	private withFlagError(flag: number): number {
		let word = flag >>> 0;
		if ((word & GX_GTE_FLAG_ERROR_MASK) !== 0) {
			word = (word | GX_GTE_FLAG_ERROR) >>> 0;
		}
		return word;
	}

	private updateFlagError(): void {
		this.controlRegisterWords[31] = this.withFlagError(this.controlRegisterWords[31]);
	}

	private lim(value: number, max: number, min: number, flag: number): number {
		if (value > max) {
			this.setFlag(flag);
			return max;
		}
		if (value < min) {
			this.setFlag(flag);
			return min;
		}
		return value;
	}

	private mac(index: number, value: number, positiveOverflow: boolean, negativeOverflow: boolean): number {
		const shifted = toSigned32(shiftGte(value, this.currentSf));
		switch (index) {
			case 1:
				if (positiveOverflow) {
					this.setFlag(GX_GTE_FLAG_ERROR | GX_GTE_FLAG_MAC1_POS);
				}
				if (negativeOverflow) {
					this.setFlag(GX_GTE_FLAG_ERROR | GX_GTE_FLAG_MAC1_NEG);
				}
				this.mac1 = value;
				this.dataRegisterWords[25] = shifted >>> 0;
				break;
			case 2:
				if (positiveOverflow) {
					this.setFlag(GX_GTE_FLAG_ERROR | GX_GTE_FLAG_MAC2_POS);
				}
				if (negativeOverflow) {
					this.setFlag(GX_GTE_FLAG_ERROR | GX_GTE_FLAG_MAC2_NEG);
				}
				this.mac2 = value;
				this.dataRegisterWords[26] = shifted >>> 0;
				break;
			case 3:
				if (positiveOverflow) {
					this.setFlag(GX_GTE_FLAG_ERROR | GX_GTE_FLAG_MAC3_POS);
				}
				if (negativeOverflow) {
					this.setFlag(GX_GTE_FLAG_ERROR | GX_GTE_FLAG_MAC3_NEG);
				}
				this.mac3 = value;
				this.dataRegisterWords[27] = shifted >>> 0;
				break;
		}
		return shifted;
	}

	private macSigned44(index: number, value: number): number {
		return this.mac(index, signExtend44(value), value > INT44_MAX, value < INT44_MIN);
	}

	private currentSf = 0;

	private accumulateSigned44(initial: number, add0: number, add1: number, add2: number): void {
		let value = signExtend44(initial);
		let positiveOverflow = initial > INT44_MAX;
		let negativeOverflow = initial < INT44_MIN;
		let next = value + add0;
		let wrapped = signExtend44(next);
		positiveOverflow = positiveOverflow || (wrapped < 0 && value >= 0 && add0 >= 0);
		negativeOverflow = negativeOverflow || (wrapped >= 0 && value < 0 && add0 < 0);
		value = wrapped;
		next = value + add1;
		wrapped = signExtend44(next);
		positiveOverflow = positiveOverflow || (wrapped < 0 && value >= 0 && add1 >= 0);
		negativeOverflow = negativeOverflow || (wrapped >= 0 && value < 0 && add1 < 0);
		value = wrapped;
		next = value + add2;
		wrapped = signExtend44(next);
		positiveOverflow = positiveOverflow || (wrapped < 0 && value >= 0 && add2 >= 0);
		negativeOverflow = negativeOverflow || (wrapped >= 0 && value < 0 && add2 < 0);
		this.accumValue = wrapped;
		this.accumPositiveOverflow = positiveOverflow;
		this.accumNegativeOverflow = negativeOverflow;
	}


	private limitIr(index: number, value: number, lm: number): number {
		const min = lm === 0 ? -0x8000 : 0;
		switch (index) {
			case 1:
				return this.lim(value, 0x7fff, min, GX_GTE_FLAG_IR1_SAT);
			case 2:
				return this.lim(value, 0x7fff, min, GX_GTE_FLAG_IR2_SAT);
			default:
				return this.lim(value, 0x7fff, min, GX_GTE_FLAG_IR3_SAT);
		}
	}

	private writeIrFromMac(index: number, value: number, lm: number): void {
		this.dataRegisterWords[8 + index] = this.limitIr(index, value, lm) >>> 0;
	}

	private executeOp(sf: number, lm: number): void {
		this.currentSf = sf;
		const ir1 = sign16(this.dataRegisterWords[9]);
		const ir2 = sign16(this.dataRegisterWords[10]);
		const ir3 = sign16(this.dataRegisterWords[11]);
		this.writeIrFromMac(1, this.mac(1, this.rt(1, 1) * ir3 - this.rt(2, 2) * ir2, false, false), lm);
		this.writeIrFromMac(2, this.mac(2, this.rt(2, 2) * ir1 - this.rt(0, 0) * ir3, false, false), lm);
		this.writeIrFromMac(3, this.mac(3, this.rt(0, 0) * ir2 - this.rt(1, 1) * ir1, false, false), lm);
	}

	private executeDpcs(sf: number, lm: number): void {
		this.depthCue(this.rgbR() << 16, this.rgbG() << 16, this.rgbB() << 16, sf, lm);
		this.pushRgbFromMac();
	}

	private executeIntpl(sf: number, lm: number): void {
		this.depthCue(sign16(this.dataRegisterWords[9]) << 12, sign16(this.dataRegisterWords[10]) << 12, sign16(this.dataRegisterWords[11]) << 12, sf, lm);
		this.pushRgbFromMac();
	}

	private executeSqr(sf: number, lm: number): void {
		this.currentSf = sf;
		const ir1 = sign16(this.dataRegisterWords[9]);
		const ir2 = sign16(this.dataRegisterWords[10]);
		const ir3 = sign16(this.dataRegisterWords[11]);
		this.writeIrFromMac(1, this.mac(1, ir1 * ir1, false, false), lm);
		this.writeIrFromMac(2, this.mac(2, ir2 * ir2, false, false), lm);
		this.writeIrFromMac(3, this.mac(3, ir3 * ir3, false, false), lm);
	}

	private executeDcpl(sf: number, lm: number): void {
		this.depthCue((this.rgbR() << 4) * sign16(this.dataRegisterWords[9]), (this.rgbG() << 4) * sign16(this.dataRegisterWords[10]), (this.rgbB() << 4) * sign16(this.dataRegisterWords[11]), sf, lm);
		this.pushRgbFromMac();
	}

	private executeDpct(sf: number, lm: number): void {
		for (let index = 0; index < 3; index += 1) {
			const rgb0 = this.rgb0();
			this.depthCue((rgb0 & 0xff) << 16, ((rgb0 >>> 8) & 0xff) << 16, ((rgb0 >>> 16) & 0xff) << 16, sf, lm);
			this.pushRgbFromMac();
		}
	}

	private executeGpf(sf: number, lm: number): void {
		this.currentSf = sf;
		const ir0 = this.dataRegisterWords[8] & 0xffff;
		this.writeIrFromMac(1, this.macSigned44(1, ir0 * sign16(this.dataRegisterWords[9])), lm);
		this.writeIrFromMac(2, this.macSigned44(2, ir0 * sign16(this.dataRegisterWords[10])), lm);
		this.writeIrFromMac(3, this.macSigned44(3, ir0 * sign16(this.dataRegisterWords[11])), lm);
		this.pushRgbFromMac();
	}

	private executeGpl(sf: number, lm: number): void {
		this.currentSf = sf;
		const ir0 = this.dataRegisterWords[8] & 0xffff;
		const macShift = sf === 0 ? 0 : 12;
		this.writeIrFromMac(1, this.macSigned44(1, sign16(this.dataRegisterWords[9]) * ir0 + ((this.dataRegisterWords[25] | 0) * (1 << macShift))), lm);
		this.writeIrFromMac(2, this.macSigned44(2, sign16(this.dataRegisterWords[10]) * ir0 + ((this.dataRegisterWords[26] | 0) * (1 << macShift))), lm);
		this.writeIrFromMac(3, this.macSigned44(3, sign16(this.dataRegisterWords[11]) * ir0 + ((this.dataRegisterWords[27] | 0) * (1 << macShift))), lm);
		this.pushRgbFromMac();
	}

	private executeMvmva(opcode: number, sf: number, lm: number): void {
		this.currentSf = sf;
		const mx = (opcode >>> 17) & 3;
		const vector = (opcode >>> 15) & 3;
		const cv = (opcode >>> 13) & 3;
		for (let row = 0; row < 3; row += 1) {
			if (cv === 2) {
				this.accumulateSigned44(this.cv(cv, row) * 4096, this.mx(mx, row, 0) * this.vector(vector, 0), 0, 0);
				this.writeIrFromMac(row + 1, this.mac(row + 1, this.accumValue, this.accumPositiveOverflow, this.accumNegativeOverflow), 0);
				this.accumulateSigned44(0, this.mx(mx, row, 1) * this.vector(vector, 1), this.mx(mx, row, 2) * this.vector(vector, 2), 0);
				this.writeIrFromMac(row + 1, this.mac(row + 1, this.accumValue, this.accumPositiveOverflow, this.accumNegativeOverflow), lm);
			} else {
				this.accumulateSigned44(
					this.cv(cv, row) * 4096,
					this.mx(mx, row, 0) * this.vector(vector, 0),
					this.mx(mx, row, 1) * this.vector(vector, 1),
					this.mx(mx, row, 2) * this.vector(vector, 2),
				);
				this.writeIrFromMac(row + 1, this.mac(row + 1, this.accumValue, this.accumPositiveOverflow, this.accumNegativeOverflow), lm);
			}
		}
	}

	private depthCue(inR: number, inG: number, inB: number, sf: number, lm: number): void {
		this.currentSf = sf;
		const r = this.limitIr(1, this.macSigned44(1, this.rfc() * 4096 - inR), 0);
		const g = this.limitIr(2, this.macSigned44(2, this.gfc() * 4096 - inG), 0);
		const b = this.limitIr(3, this.macSigned44(3, this.bfc() * 4096 - inB), 0);
		this.writeIrFromMac(1, this.macSigned44(1, inR + (this.dataRegisterWords[8] & 0xffff) * r), lm);
		this.writeIrFromMac(2, this.macSigned44(2, inG + (this.dataRegisterWords[8] & 0xffff) * g), lm);
		this.writeIrFromMac(3, this.macSigned44(3, inB + (this.dataRegisterWords[8] & 0xffff) * b), lm);
	}

	private dotRotation(row: number, vectorIndex: number): number {
		let value = signExtend44(this.tr(row) * 4096);
		let positiveOverflow = this.tr(row) * 4096 > INT44_MAX;
		let negativeOverflow = this.tr(row) * 4096 < INT44_MIN;
		let add = this.rt(row, 0) * this.vx(vectorIndex);
		let next = value + add;
		let wrapped = signExtend44(next);
		positiveOverflow = positiveOverflow || (wrapped < 0 && value >= 0 && add >= 0);
		negativeOverflow = negativeOverflow || (wrapped >= 0 && value < 0 && add < 0);
		value = wrapped;
		add = this.rt(row, 1) * this.vy(vectorIndex);
		next = value + add;
		wrapped = signExtend44(next);
		positiveOverflow = positiveOverflow || (wrapped < 0 && value >= 0 && add >= 0);
		negativeOverflow = negativeOverflow || (wrapped >= 0 && value < 0 && add < 0);
		value = wrapped;
		add = this.rt(row, 2) * this.vz(vectorIndex);
		next = value + add;
		wrapped = signExtend44(next);
		positiveOverflow = positiveOverflow || (wrapped < 0 && value >= 0 && add >= 0);
		negativeOverflow = negativeOverflow || (wrapped >= 0 && value < 0 && add < 0);
		value = wrapped;
		return this.mac(row + 1, value, positiveOverflow, negativeOverflow);
	}

	private executeRtps(vectorIndex: number, sf: number, lm: number, last: boolean): void {
		this.currentSf = sf;
		const ir1 = this.dotRotation(0, vectorIndex);
		const ir2 = this.dotRotation(1, vectorIndex);
		this.dotRotation(2, vectorIndex);
		this.writeIr(1, ir1, lm);
		this.writeIr(2, ir2, lm);
		this.writeIr3FromMac3(sf, lm);
		this.pushSz(shiftGte(this.mac3, 1));
		const hOverSz3 = this.divideWithLimit(this.h(), this.sz(3));
		this.dataRegisterWords[12] = this.dataRegisterWords[13];
		this.dataRegisterWords[13] = this.dataRegisterWords[14];
		this.writeMac0(this.ofx() + sign16(this.dataRegisterWords[9]) * hOverSz3);
		const sx2 = this.limitScreen(shiftRightSigned(this.mac0, 16), GX_GTE_FLAG_ERROR | GX_GTE_FLAG_SX2_SAT);
		this.writeMac0(this.ofy() + sign16(this.dataRegisterWords[10]) * hOverSz3);
		const sy2 = this.limitScreen(shiftRightSigned(this.mac0, 16), GX_GTE_FLAG_ERROR | GX_GTE_FLAG_SY2_SAT);
		this.dataRegisterWords[14] = ((sx2 & 0xffff) | ((sy2 & 0xffff) << 16)) >>> 0;
		if (last) {
			this.writeMac0(this.dqb() + this.dqa() * hOverSz3);
			this.dataRegisterWords[8] = this.limitIr0(shiftGte(this.mac0, 1)) >>> 0;
		}
	}

	private executeNclip(): void {
		this.writeMac0(
			this.sx(0) * this.sy(1)
			+ this.sx(1) * this.sy(2)
			+ this.sx(2) * this.sy(0)
			- this.sx(0) * this.sy(2)
			- this.sx(1) * this.sy(0)
			- this.sx(2) * this.sy(1),
		);
	}

	private executeAvsz3(): void {
		const value = this.zsf3() * (this.sz(1) + this.sz(2) + this.sz(3));
		this.writeMac0(value);
		this.dataRegisterWords[7] = this.limitDepth(shiftRightSigned(value, 12)) >>> 0;
	}

	private executeAvsz4(): void {
		const value = this.zsf4() * (this.sz(0) + this.sz(1) + this.sz(2) + this.sz(3));
		this.writeMac0(value);
		this.dataRegisterWords[7] = this.limitDepth(shiftRightSigned(value, 12)) >>> 0;
	}

	private writeMac0(value: number): void {
		this.mac0 = value;
		if (value > 0x7fffffff) {
			this.setFlag(GX_GTE_FLAG_ERROR | GX_GTE_FLAG_MAC0_POS);
		}
		if (value < -0x80000000) {
			this.setFlag(GX_GTE_FLAG_ERROR | GX_GTE_FLAG_MAC0_NEG);
		}
		this.dataRegisterWords[24] = value >>> 0;
	}

	private writeIr(index: number, value: number, lm: number): void {
		this.dataRegisterWords[8 + index] = this.limitIr(index, value, lm) >>> 0;
	}

	private writeIr3FromMac3(sf: number, lm: number): void {
		const valueSf = shiftGte(this.mac3, sf);
		const value12 = shiftGte(this.mac3, 1);
		const min = lm === 0 ? -0x8000 : 0;
		if (value12 < -0x8000 || value12 > 0x7fff) {
			this.setFlag(GX_GTE_FLAG_IR3_SAT);
		}
		if (valueSf > 0x7fff) {
			this.dataRegisterWords[11] = 0x7fff;
		} else if (valueSf < min) {
			this.dataRegisterWords[11] = min >>> 0;
		} else {
			this.dataRegisterWords[11] = valueSf >>> 0;
		}
	}

	private pushSz(value: number): void {
		this.dataRegisterWords[16] = this.dataRegisterWords[17];
		this.dataRegisterWords[17] = this.dataRegisterWords[18];
		this.dataRegisterWords[18] = this.dataRegisterWords[19];
		this.dataRegisterWords[19] = this.limitDepth(value) >>> 0;
	}

	private limitDepth(value: number): number {
		if (value > 0xffff) {
			this.setFlag(GX_GTE_FLAG_ERROR | GX_GTE_FLAG_SZ_OTZ_SAT);
			return 0xffff;
		}
		if (value < 0) {
			this.setFlag(GX_GTE_FLAG_ERROR | GX_GTE_FLAG_SZ_OTZ_SAT);
			return 0;
		}
		return value;
	}

	private divideWithLimit(numerator: number, denominator: number): number {
		const result = this.divide(numerator, denominator);
		if (result === 0xffffffff || result > 0x1ffff) {
			this.setFlag(GX_GTE_FLAG_ERROR | GX_GTE_FLAG_DIV_OVERFLOW);
			return 0x1ffff;
		}
		return result;
	}

	private divide(numerator: number, denominator: number): number {
		if (numerator < denominator * 2) {
			const shift = Math.clz32(denominator) - 16;
			const r1 = (denominator << shift) & 0x7fff;
			const r2 = GTE_DIVIDE_TABLE[((r1 + 0x40) >> 7)]! + 0x101;
			const r3 = ((0x80 - (r2 * (r1 + 0x8000))) >> 8) & 0x1ffff;
			const reciprocal = ((r2 * r3) + 0x80) >> 8;
			const quotient = (reciprocal * (numerator * (1 << shift)) + 0x8000) / 0x10000;
			return quotient >>> 0;
		}
		return 0xffffffff;
	}

	private limitScreen(value: number, flag: number): number {
		if (value > 0x3ff) {
			this.setFlag(flag);
			return 0x3ff;
		}
		if (value < -0x400) {
			this.setFlag(flag);
			return -0x400;
		}
		return value;
	}

	private limitIr0(value: number): number {
		if (value < 0 || value > 0x1000) {
			this.setFlag(GX_GTE_FLAG_IR0_SAT);
		}
		if (value > 0x1000) {
			return 0x1000;
		}
		if (value < 0) {
			return 0;
		}
		return value;
	}

	private limitColor(value: number, flag: number): number {
		if (value > 0xff) {
			this.setFlag(flag);
			return 0xff;
		}
		if (value < 0) {
			this.setFlag(flag);
			return 0;
		}
		return value;
	}

	private pushRgbFromMac(): void {
		const r = this.limitColor((this.dataRegisterWords[25] | 0) >> 4, GX_GTE_FLAG_COLOR_R_SAT);
		const g = this.limitColor((this.dataRegisterWords[26] | 0) >> 4, GX_GTE_FLAG_COLOR_G_SAT);
		const b = this.limitColor((this.dataRegisterWords[27] | 0) >> 4, GX_GTE_FLAG_COLOR_B_SAT);
		const code = this.rgbCode();
		this.dataRegisterWords[20] = this.dataRegisterWords[21];
		this.dataRegisterWords[21] = this.dataRegisterWords[22];
		this.dataRegisterWords[22] = (r | (g << 8) | (b << 16) | (code << 24)) >>> 0;
	}

	private packRgbFromIr(): number {
		const r = this.limitRgb5(sign16(this.dataRegisterWords[9]) >> 7);
		const g = this.limitRgb5(sign16(this.dataRegisterWords[10]) >> 7);
		const b = this.limitRgb5(sign16(this.dataRegisterWords[11]) >> 7);
		const rgb = r | (g << 5) | (b << 10);
		return rgb >>> 0;
	}

	private limitRgb5(value: number): number {
		if (value > 0x1f) {
			return 0x1f;
		}
		if (value < 0) {
			return 0;
		}
		return value;
	}

	private vx(index: number): number {
		return sign16(this.dataRegisterWords[index * 2]);
	}

	private vy(index: number): number {
		return highSign16(this.dataRegisterWords[index * 2]);
	}

	private vz(index: number): number {
		return sign16(this.dataRegisterWords[index * 2 + 1]);
	}

	private vector(vectorIndex: number, component: number): number {
		if (vectorIndex === 3) {
			return sign16(this.dataRegisterWords[9 + component]);
		}
		switch (component) {
			case 0: return this.vx(vectorIndex);
			case 1: return this.vy(vectorIndex);
			default: return this.vz(vectorIndex);
		}
	}

	private mx(matrix: number, row: number, column: number): number {
		if (matrix === 3) {
			switch (row * 3 + column) {
				case 0: return -(this.dataRegisterWords[6] & 0xff) * 16;
				case 1: return (this.dataRegisterWords[6] & 0xff) * 16;
				case 2: return sign16(this.dataRegisterWords[8]);
				case 3:
				case 4:
				case 5: return sign16(this.controlRegisterWords[1]);
				default: return sign16(this.controlRegisterWords[2]);
			}
		}
		const base = matrix * 8;
		switch (row * 3 + column) {
			case 0: return sign16(this.controlRegisterWords[base]);
			case 1: return highSign16(this.controlRegisterWords[base]);
			case 2: return sign16(this.controlRegisterWords[base + 1]);
			case 3: return highSign16(this.controlRegisterWords[base + 1]);
			case 4: return sign16(this.controlRegisterWords[base + 2]);
			case 5: return highSign16(this.controlRegisterWords[base + 2]);
			case 6: return sign16(this.controlRegisterWords[base + 3]);
			case 7: return highSign16(this.controlRegisterWords[base + 3]);
			default: return sign16(this.controlRegisterWords[base + 4]);
		}
	}

	private cv(vectorIndex: number, row: number): number {
		if (vectorIndex === 3) {
			return 0;
		}
		return this.controlRegisterWords[vectorIndex * 8 + 5 + row] | 0;
	}

	private rt(row: number, column: number): number {
		switch (row * 3 + column) {
			case 0: return sign16(this.controlRegisterWords[0]);
			case 1: return highSign16(this.controlRegisterWords[0]);
			case 2: return sign16(this.controlRegisterWords[1]);
			case 3: return highSign16(this.controlRegisterWords[1]);
			case 4: return sign16(this.controlRegisterWords[2]);
			case 5: return highSign16(this.controlRegisterWords[2]);
			case 6: return sign16(this.controlRegisterWords[3]);
			case 7: return highSign16(this.controlRegisterWords[3]);
			default: return sign16(this.controlRegisterWords[4]);
		}
	}

	private tr(row: number): number {
		return this.controlRegisterWords[5 + row] | 0;
	}

	private h(): number {
		return this.controlRegisterWords[26] & 0xffff;
	}

	private dqa(): number {
		return sign16(this.controlRegisterWords[27]);
	}

	private dqb(): number {
		return this.controlRegisterWords[28] | 0;
	}

	private ofx(): number {
		return this.controlRegisterWords[24] | 0;
	}

	private ofy(): number {
		return this.controlRegisterWords[25] | 0;
	}

	private zsf3(): number {
		return sign16(this.controlRegisterWords[29]);
	}

	private zsf4(): number {
		return sign16(this.controlRegisterWords[30]);
	}

	private rgbc(): number {
		return this.dataRegisterWords[6];
	}

	private rgb0(): number {
		return this.dataRegisterWords[20];
	}

	private rgbR(): number {
		return this.rgbc() & 0xff;
	}

	private rgbG(): number {
		return (this.rgbc() >>> 8) & 0xff;
	}

	private rgbB(): number {
		return (this.rgbc() >>> 16) & 0xff;
	}

	private rgbCode(): number {
		return (this.rgbc() >>> 24) & 0xff;
	}

	private rfc(): number {
		return this.controlRegisterWords[21] | 0;
	}

	private gfc(): number {
		return this.controlRegisterWords[22] | 0;
	}

	private bfc(): number {
		return this.controlRegisterWords[23] | 0;
	}

	private sx(index: number): number {
		return sign16(this.dataRegisterWords[12 + index]);
	}

	private sy(index: number): number {
		return highSign16(this.dataRegisterWords[12 + index]);
	}

	private sz(index: number): number {
		return this.dataRegisterWords[16 + index] & 0xffff;
	}
}
