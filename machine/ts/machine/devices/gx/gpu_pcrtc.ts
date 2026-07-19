import type { Value } from '../../cpu/cpu';
import { IO_GX_PCRTC_BASE, IO_GX_PCRTC_WORD_COUNT } from '../../bus/io';
import { IO_WORD_SIZE } from '../../memory/map';
import type { Memory } from '../../memory/memory';

export const GX_GPU_PCRTC_WORD_COUNT = IO_GX_PCRTC_WORD_COUNT;
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

export const GX_GPU_PCRTC_PMODE_EN1 = 1 << 0;
export const GX_GPU_PCRTC_PMODE_EN2 = 1 << 1;
export const GX_GPU_PCRTC_PMODE_MMOD = 1 << 5;
export const GX_GPU_PCRTC_PMODE_AMOD = 1 << 6;
export const GX_GPU_PCRTC_PMODE_SLBG = 1 << 7;
export const GX_GPU_PCRTC_PMODE_ALP_SHIFT = 8;

export const GX_GPU_PCRTC_PSMCT32 = 0;
export const GX_GPU_PCRTC_PSMCT24 = 1;
export const GX_GPU_PCRTC_PSMCT16 = 2;
export const GX_GPU_PCRTC_PSMCT16S = 10;
export const GX_GPU_PCRTC_PSGPU24 = 18;

export const GX_GPU_PCRTC_RESET_DISPFB_LOW = (16 << 9) | (GX_GPU_PCRTC_PSMCT16 << 15);
export const GX_GPU_PCRTC_RESET_DISPLAY_LOW = 0;
export const GX_GPU_PCRTC_RESET_DISPLAY_HIGH = 319 | (239 << 12);

export type GxGpuPcrtcState = {
	registerWords: number[];
	presentWords: number[];
};

export type GxGpuPcrtcCircuit = {
	enabled: boolean;
	framebufferBaseWord: number;
	framebufferWidth: number;
	framebufferPsm: number;
	framebufferX: number;
	framebufferY: number;
	displayX: number;
	displayY: number;
	displayWidth: number;
	displayHeight: number;
	displayRight: number;
	displayBottom: number;
	magnificationX: number;
	magnificationY: number;
};

const resetWords = new Uint32Array([
	0,
	0,
	GX_GPU_PCRTC_RESET_DISPFB_LOW,
	0,
	GX_GPU_PCRTC_RESET_DISPLAY_LOW,
	GX_GPU_PCRTC_RESET_DISPLAY_HIGH,
	GX_GPU_PCRTC_RESET_DISPFB_LOW,
	0,
	GX_GPU_PCRTC_RESET_DISPLAY_LOW,
	GX_GPU_PCRTC_RESET_DISPLAY_HIGH,
	0,
	0,
]);

function circuitDispFbLowIndex(circuit: number): number {
	return circuit === 0 ? GX_GPU_PCRTC_DISPFB1_LOW : GX_GPU_PCRTC_DISPFB2_LOW;
}

function circuitDisplayLowIndex(circuit: number): number {
	return circuit === 0 ? GX_GPU_PCRTC_DISPLAY1_LOW : GX_GPU_PCRTC_DISPLAY2_LOW;
}

function gxGpuPcrtcCircuitEnabled(words: ArrayLike<number>, circuit: number): boolean {
	return (words[GX_GPU_PCRTC_PMODE_LOW]! & (1 << circuit)) !== 0;
}

function gxGpuPcrtcFramebufferBaseWord(words: ArrayLike<number>, circuit: number): number {
	return (words[circuitDispFbLowIndex(circuit)]! & 0x1ff) << 12;
}

function gxGpuPcrtcFramebufferWidth(words: ArrayLike<number>, circuit: number): number {
	return ((words[circuitDispFbLowIndex(circuit)]! >>> 9) & 0x3f) * 64;
}

function gxGpuPcrtcFramebufferPsm(words: ArrayLike<number>, circuit: number): number {
	return (words[circuitDispFbLowIndex(circuit)]! >>> 15) & 0x1f;
}

function gxGpuPcrtcFramebufferX(words: ArrayLike<number>, circuit: number): number {
	return words[circuitDispFbLowIndex(circuit) + 1]! & 0x7ff;
}

function gxGpuPcrtcFramebufferY(words: ArrayLike<number>, circuit: number): number {
	return (words[circuitDispFbLowIndex(circuit) + 1]! >>> 11) & 0x7ff;
}

function gxGpuPcrtcDisplayX(words: ArrayLike<number>, circuit: number): number {
	return words[circuitDisplayLowIndex(circuit)]! & 0xfff;
}

function gxGpuPcrtcDisplayY(words: ArrayLike<number>, circuit: number): number {
	return (words[circuitDisplayLowIndex(circuit)]! >>> 12) & 0x7ff;
}

function gxGpuPcrtcMagnificationX(words: ArrayLike<number>, circuit: number): number {
	return ((words[circuitDisplayLowIndex(circuit)]! >>> 23) & 0xf) + 1;
}

function gxGpuPcrtcMagnificationY(words: ArrayLike<number>, circuit: number): number {
	return ((words[circuitDisplayLowIndex(circuit)]! >>> 27) & 0x3) + 1;
}

function gxGpuPcrtcDisplayWidth(words: ArrayLike<number>, circuit: number): number {
	return (words[circuitDisplayLowIndex(circuit) + 1]! & 0xfff) + 1;
}

function gxGpuPcrtcDisplayHeight(words: ArrayLike<number>, circuit: number): number {
	return ((words[circuitDisplayLowIndex(circuit) + 1]! >>> 12) & 0x7ff) + 1;
}

export class GxGpuPcrtcScanout {
	public readonly circuits: [GxGpuPcrtcCircuit, GxGpuPcrtcCircuit] = [
		{
			enabled: false,
			framebufferBaseWord: 0,
			framebufferWidth: 0,
			framebufferPsm: 0,
			framebufferX: 0,
			framebufferY: 0,
			displayX: 0,
			displayY: 0,
			displayWidth: 0,
			displayHeight: 0,
			displayRight: 0,
			displayBottom: 0,
			magnificationX: 1,
			magnificationY: 1,
		},
		{
			enabled: false,
			framebufferBaseWord: 0,
			framebufferWidth: 0,
			framebufferPsm: 0,
			framebufferX: 0,
			framebufferY: 0,
			displayX: 0,
			displayY: 0,
			displayWidth: 0,
			displayHeight: 0,
			displayRight: 0,
			displayBottom: 0,
			magnificationX: 1,
			magnificationY: 1,
		},
	];
	public backgroundColor = 0;
	public constantAlpha = 0;
	public constantAlphaEnabled = false;
	public circuit2UnderlayEnabled = false;
	public outputWidth = 320;
	public outputHeight = 240;
	public revision = 0;

	public update(words: ArrayLike<number>): void {
		for (let index = 0; index < this.circuits.length; index += 1) {
			const circuit = this.circuits[index]!;
			circuit.enabled = gxGpuPcrtcCircuitEnabled(words, index);
			circuit.framebufferBaseWord = gxGpuPcrtcFramebufferBaseWord(words, index);
			circuit.framebufferWidth = gxGpuPcrtcFramebufferWidth(words, index);
			circuit.framebufferPsm = gxGpuPcrtcFramebufferPsm(words, index);
			circuit.framebufferX = gxGpuPcrtcFramebufferX(words, index);
			circuit.framebufferY = gxGpuPcrtcFramebufferY(words, index);
			circuit.displayX = gxGpuPcrtcDisplayX(words, index);
			circuit.displayY = gxGpuPcrtcDisplayY(words, index);
			circuit.displayWidth = gxGpuPcrtcDisplayWidth(words, index);
			circuit.displayHeight = gxGpuPcrtcDisplayHeight(words, index);
			circuit.displayRight = circuit.displayX + circuit.displayWidth;
			circuit.displayBottom = circuit.displayY + circuit.displayHeight;
			circuit.magnificationX = gxGpuPcrtcMagnificationX(words, index);
			circuit.magnificationY = gxGpuPcrtcMagnificationY(words, index);
		}
		const pmode = words[GX_GPU_PCRTC_PMODE_LOW]!;
		this.backgroundColor = words[GX_GPU_PCRTC_BGCOLOR_LOW]! & 0x00ffffff;
		this.constantAlpha = (pmode >>> GX_GPU_PCRTC_PMODE_ALP_SHIFT) & 0xff;
		this.constantAlphaEnabled = (pmode & GX_GPU_PCRTC_PMODE_MMOD) !== 0;
		this.circuit2UnderlayEnabled = this.circuits[1].enabled && (pmode & GX_GPU_PCRTC_PMODE_SLBG) === 0;

		const primaryCircuit = this.circuits[1].enabled && !this.circuits[0].enabled
			? this.circuits[1]
			: this.circuits[0];
		this.outputWidth = primaryCircuit.displayRight;
		this.outputHeight = primaryCircuit.displayBottom;
		if (this.circuits[0].enabled && this.circuits[1].enabled) {
			if (this.circuits[1].displayRight > this.outputWidth) {
				this.outputWidth = this.circuits[1].displayRight;
			}
			if (this.circuits[1].displayBottom > this.outputHeight) {
				this.outputHeight = this.circuits[1].displayBottom;
			}
		}
		this.revision = (this.revision + 1) >>> 0;
	}
}

export class GxGpuPcrtc {
	public readonly registerWords = new Uint32Array(IO_GX_PCRTC_WORD_COUNT);
	public readonly presentWords = new Uint32Array(IO_GX_PCRTC_WORD_COUNT);
	public readonly scanout = new GxGpuPcrtcScanout();

	public constructor(memory: Memory) {
		for (let index = 0; index < IO_GX_PCRTC_WORD_COUNT; index += 1) {
			const address = IO_GX_PCRTC_BASE + index * IO_WORD_SIZE;
			memory.mapIoRead(address, this, GxGpuPcrtc.readWordThunk);
			memory.mapIoWrite(address, this, GxGpuPcrtc.writeWordThunk);
		}
	}

	public reset(): void {
		this.registerWords.set(resetWords);
		this.presentWords.set(resetWords);
		this.scanout.update(this.presentWords);
	}

	public resetActiveWords(): void {
		this.registerWords.set(resetWords);
	}

	public latchPresentationWords(): boolean {
		for (let index = 0; index < IO_GX_PCRTC_WORD_COUNT; index += 1) {
			if (this.registerWords[index] !== this.presentWords[index]) {
				this.presentWords.set(this.registerWords);
				this.scanout.update(this.presentWords);
				return true;
			}
		}
		return false;
	}

	public captureState(): GxGpuPcrtcState {
		return {
			registerWords: Array.from(this.registerWords),
			presentWords: Array.from(this.presentWords),
		};
	}

	public restoreState(state: GxGpuPcrtcState): void {
		this.registerWords.set(state.registerWords);
		this.presentWords.set(state.presentWords);
		this.scanout.update(this.presentWords);
	}

	public captureContext(registerWords: number[], presentWords: number[]): void {
		for (let index = 0; index < IO_GX_PCRTC_WORD_COUNT; index += 1) {
			registerWords[index] = this.registerWords[index]!;
			presentWords[index] = this.presentWords[index]!;
		}
	}

	public restoreContext(registerWords: ArrayLike<number>, presentWords: ArrayLike<number>): void {
		this.registerWords.set(registerWords);
		this.presentWords.set(presentWords);
		this.scanout.update(this.presentWords);
	}

	public enterSupervisorContext(userPresentWords: ArrayLike<number>): void {
		this.resetActiveWords();
		this.registerWords[GX_GPU_PCRTC_PMODE_LOW] = (userPresentWords[GX_GPU_PCRTC_PMODE_LOW]! & GX_GPU_PCRTC_PMODE_EN1) << 1;
		this.registerWords[GX_GPU_PCRTC_DISPFB2_LOW] = userPresentWords[GX_GPU_PCRTC_DISPFB1_LOW]!;
		this.registerWords[GX_GPU_PCRTC_DISPFB2_HIGH] = userPresentWords[GX_GPU_PCRTC_DISPFB1_HIGH]!;
		this.registerWords[GX_GPU_PCRTC_DISPLAY2_LOW] = userPresentWords[GX_GPU_PCRTC_DISPLAY1_LOW]!;
		this.registerWords[GX_GPU_PCRTC_DISPLAY2_HIGH] = userPresentWords[GX_GPU_PCRTC_DISPLAY1_HIGH]!;
		this.registerWords[GX_GPU_PCRTC_BGCOLOR_LOW] = userPresentWords[GX_GPU_PCRTC_BGCOLOR_LOW]!;
		this.registerWords[GX_GPU_PCRTC_BGCOLOR_HIGH] = userPresentWords[GX_GPU_PCRTC_BGCOLOR_HIGH]!;
		this.presentWords.set(this.registerWords);
		this.scanout.update(this.presentWords);
	}

	private static readWordThunk(context: GxGpuPcrtc, address: number): Value {
		return context.registerWords[((address - IO_GX_PCRTC_BASE) / IO_WORD_SIZE) >>> 0]!;
	}

	private static writeWordThunk(context: GxGpuPcrtc, address: number, value: Value): void {
		context.registerWords[((address - IO_GX_PCRTC_BASE) / IO_WORD_SIZE) >>> 0] = (value as number) >>> 0;
	}
}
