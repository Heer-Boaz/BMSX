import {
	IO_GX_PCRTC_BASE,
	IO_GX_PCRTC_TIMING_BASE,
	IO_GX_PCRTC_TIMING_WORD_COUNT,
	IO_GX_PCRTC_WORD_COUNT,
} from '../../bus/io';
import { IO_WORD_SIZE } from '../../memory/map';
import { GX_GPU_PSMGX16 } from './gpu_local_memory';

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
export const GX_GPU_PCRTC_PMODE_MMOD = 1 << 5;
export const GX_GPU_PCRTC_PMODE_AMOD = 1 << 6;
export const GX_GPU_PCRTC_PMODE_SLBG = 1 << 7;
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

export const GX_GPU_PCRTC_COMPOSE_GENERIC = 0;
export const GX_GPU_PCRTC_COMPOSE_GX16 = 1;
export const GX_GPU_PCRTC_COMPOSE_GX16_DIRECT_CIRCUIT1 = 2;

export const GX_GPU_PCRTC_RESET_DISPFB_LOW = (16 << 9) | (GX_GPU_PSMGX16 << 15);
export const GX_GPU_PCRTC_RESET_DISPLAY_LOW = 0x018252a8;
export const GX_GPU_PCRTC_RESET_DISPLAY_HIGH = 0x000ef4ff;
export const GX_GPU_PCRTC_RESET_CSR_WORD = 0x551b4000;
export const GX_GPU_PCRTC_RESET_IMR_WORD = 0x00007f00;
export const GX_GPU_PCRTC_RESET_REFRESH_UFPS_SCALED = 49_761_146;
export const GX_GPU_PCRTC_RESET_TOTAL_HALF_LINES = 628;
export const GX_GPU_PCRTC_RESET_ACTIVE_DISPLAY_HALF_LINES = 576;

export const GX_GPU_PCRTC_RUNTIME_EDGE_NONE = 0;
export const GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_BEGIN = 1;
export const GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_END = 2;

export const GX_GPU_PCRTC_SERVICE_RUNTIME_EDGE_MASK = 0x3;
export const GX_GPU_PCRTC_SERVICE_IRQ = 1 << 2;
const GX_GPU_PCRTC_VERTICAL_STAGE_VBLANK_BEGIN = 0;
const GX_GPU_PCRTC_VERTICAL_STAGE_VSYNC = 1;
const GX_GPU_PCRTC_VERTICAL_STAGE_FIELD_END = 2;

const PCRTC_REFERENCE_CLOCK_HZ = 13_500_000;
const PCRTC_HZ_SCALE = 1_000_000;
export const GX_GPU_PCRTC_SOURCE_DIVISION_SHIFT = 18;
const PCRTC_SOURCE_DIVISION_SCALE = 1 << GX_GPU_PCRTC_SOURCE_DIVISION_SHIFT;

export function gxGpuPcrtcRegisterAddress(index: number): number {
	return index < IO_GX_PCRTC_WORD_COUNT
		? IO_GX_PCRTC_BASE + index * IO_WORD_SIZE
		: IO_GX_PCRTC_TIMING_BASE + (index - IO_GX_PCRTC_WORD_COUNT) * IO_WORD_SIZE;
}

export type GxGpuPcrtcState = {
	registerWords: number[];
	presentWords: number[];
	csrWord: number;
	imrWord: number;
	beamCycleOffset: number;
	beamRemainder: number;
	beamHalfLine: number;
	nextHsyncHalfLine: number;
	verticalStage: number;
	vblankActive: boolean;
};

export type GxGpuPcrtcCircuit = {
	enabled: boolean;
	framebufferBaseWord: number;
	framebufferWidth: number;
	framebufferPagesPerRow: number;
	framebufferPsm: number;
	framebufferX: number;
	framebufferY: number;
	displayX: number;
	displayY: number;
	displaySignalX: number;
	displaySignalY: number;
	displayWidth: number;
	displayHeight: number;
	displayRight: number;
	displayBottom: number;
	sourcePhaseX: number;
	sourcePhaseY: number;
	sourceStepX: number;
	sourceStepY: number;
	sourceAdvanceX: number;
	sourceRemainderStepX: number;
	sourceDivisionMultiplierX: number;
	sourceDivisionMultiplierY: number;
	interlacedSourceDivisionMultiplierY: number;
	fieldSourcePhase: number;
	fieldSourceStride: number;
	magnificationX: number;
	magnificationY: number;
	linearSampling: boolean;
};

const resetConfigWords = new Uint32Array([
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
	0x40806504,
	0x00000007,
	0,
	0,
	0x1fc83030,
	0x0007f5c2,
	0x003484bc,
	0,
	0x02101404,
	0x00a90005,
]);

function circuitDispFbLowIndex(circuit: number): number {
	return circuit === 0 ? GX_GPU_PCRTC_DISPFB1_LOW : GX_GPU_PCRTC_DISPFB2_LOW;
}

function circuitDisplayLowIndex(circuit: number): number {
	return circuit === 0 ? GX_GPU_PCRTC_DISPLAY1_LOW : GX_GPU_PCRTC_DISPLAY2_LOW;
}

function createCircuit(): GxGpuPcrtcCircuit {
	return {
		enabled: false,
		framebufferBaseWord: 0,
		framebufferWidth: 0,
		framebufferPagesPerRow: 0,
		framebufferPsm: 0,
		framebufferX: 0,
		framebufferY: 0,
		displayX: 0,
		displayY: 0,
		displaySignalX: 0,
		displaySignalY: 0,
		displayWidth: 0,
		displayHeight: 0,
		displayRight: 0,
		displayBottom: 0,
		sourcePhaseX: 0,
		sourcePhaseY: 0,
		sourceStepX: 1,
		sourceStepY: 1,
		sourceAdvanceX: 1,
		sourceRemainderStepX: 0,
		sourceDivisionMultiplierX: PCRTC_SOURCE_DIVISION_SCALE,
		sourceDivisionMultiplierY: PCRTC_SOURCE_DIVISION_SCALE,
		interlacedSourceDivisionMultiplierY: PCRTC_SOURCE_DIVISION_SCALE >> 1,
		fieldSourcePhase: 0,
		fieldSourceStride: 1,
		magnificationX: 1,
		magnificationY: 1,
		linearSampling: true,
	};
}

function sourceDivisionMultiplier(divisor: number): number {
	const numerator = PCRTC_SOURCE_DIVISION_SCALE + divisor - 1;
	return (numerator - numerator % divisor) / divisor;
}

function isBeamTimingWord(index: number): boolean {
	return index === GX_GPU_PCRTC_SMODE1_LOW
		|| index === GX_GPU_PCRTC_SMODE1_HIGH
		|| index >= GX_GPU_PCRTC_SYNCH1_LOW && index <= GX_GPU_PCRTC_SYNCV_HIGH;
}

export class GxGpuPcrtcTiming {
	public signalStepX = 4;
	public halfLineClockNumerator = 27_648;
	public halfLineClockDenominator = 864_000_000;
	public totalHalfLines = GX_GPU_PCRTC_RESET_TOTAL_HALF_LINES;
	public activeDisplayHalfLines = GX_GPU_PCRTC_RESET_ACTIVE_DISPLAY_HALF_LINES;
	public vsyncHalfLine = 585;
	public nextVblankCycleBudget = 1;
	public refreshUfpsScaled = GX_GPU_PCRTC_RESET_REFRESH_UFPS_SCALED;
	public fieldToggles = true;
	public running = true;
	public revision = 0;

	public update(words: ArrayLike<number>): void {
		const smode1 = words[GX_GPU_PCRTC_SMODE1_LOW]!;
		const smode1High = words[GX_GPU_PCRTC_SMODE1_HIGH]!;
		const synch1Low = words[GX_GPU_PCRTC_SYNCH1_LOW]!;
		const synch1High = words[GX_GPU_PCRTC_SYNCH1_HIGH]!;
		const synch2Low = words[GX_GPU_PCRTC_SYNCH2_LOW]!;
		const syncvLow = words[GX_GPU_PCRTC_SYNCV_LOW]!;
		const syncvHigh = words[GX_GPU_PCRTC_SYNCV_HIGH]!;
		const hfp = synch1Low & 0x7ff;
		const hbp = (synch1Low >>> 11) & 0x7ff;
		const hs = (synch1High >>> 11) & 0xffff;
		const hf = synch2Low & 0x7ff;
		const hb = (synch2Low >>> 11) & 0xffff;
		const horizontalTotal = hfp + hbp + hs + hf + hb;
		const vfp = syncvLow & 0x3ff;
		const vfpe = (syncvLow >>> 10) & 0x3ff;
		const vbp = syncvLow >>> 20;
		const vbpe = syncvHigh & 0x3ff;
		const vdp = (syncvHigh >>> 10) & 0x7ff;
		const vs = (syncvHigh >>> 21) & 0x7ff;
		const cmod = (smode1 >>> 13) & 0x3;
		const verticalUnitHalfLines = ((smode1High >>> 4) & 1) !== 0 ? 2 : 1;
		const verticalTotal = vfp + vfpe + vbp + vbpe + vdp + vs;
		const rc = smode1 & 0x7;
		const lc = (smode1 >>> 3) & 0x7f;
		const referenceDivider = rc * (((smode1 >>> 10) & 0x3) + 1);
		this.signalStepX = (smode1 >>> 21) & 0xf;
		this.halfLineClockNumerator = horizontalTotal * referenceDivider;
		this.halfLineClockDenominator = 2 * PCRTC_REFERENCE_CLOCK_HZ * lc;
		this.totalHalfLines = verticalTotal * verticalUnitHalfLines;
		this.activeDisplayHalfLines = vdp * verticalUnitHalfLines;
		this.vsyncHalfLine = (vdp + vfp + vfpe) * verticalUnitHalfLines;
		this.running = (smode1 & (GX_GPU_PCRTC_SMODE1_SINT | GX_GPU_PCRTC_SMODE1_PRST)) === 0
			&& this.halfLineClockNumerator !== 0
			&& this.halfLineClockDenominator !== 0
			&& this.totalHalfLines !== 0;
		if (this.running) {
			const refreshNumerator = this.halfLineClockDenominator * PCRTC_HZ_SCALE;
			const refreshDenominator = this.halfLineClockNumerator * this.totalHalfLines;
			this.refreshUfpsScaled = (refreshNumerator - refreshNumerator % refreshDenominator) / refreshDenominator;
		} else {
			this.refreshUfpsScaled = 0;
		}
		this.fieldToggles = cmod !== 0 && (vfp & 1) !== 0;
		this.revision = (this.revision + 1) >>> 0;
	}
}

export class GxGpuPcrtcScanout {
	public readonly circuits: [GxGpuPcrtcCircuit, GxGpuPcrtcCircuit] = [createCircuit(), createCircuit()];
	public backgroundColor = 0;
	public blendAlpha = 0;
	public blendAlphaFromRegister = false;
	public outputAlphaFromCircuit2 = false;
	public rgbUnderlayFromCircuit2 = false;
	public circuit2SampleRequired = false;
	public circuit2CoversOutput = false;
	public interlaced = false;
	public frameMode = false;
	public field = 0;
	public cropSignalX = 0;
	public cropSignalY = 0;
	public compositionPath = GX_GPU_PCRTC_COMPOSE_GENERIC;
	public outputWidth = 0;
	public outputHeight = 0;
	public revision = 0;

	public setField(field: number): void {
		this.field = field;
		for (const circuit of this.circuits) {
			circuit.fieldSourcePhase = this.interlaced && !this.frameMode
				? (circuit.displaySignalY ^ field) & 1
				: 0;
		}
	}

	public update(words: ArrayLike<number>, timing: GxGpuPcrtcTiming): void {
		const pmode = words[GX_GPU_PCRTC_PMODE_LOW]!;
		const smode2 = words[GX_GPU_PCRTC_SMODE2_LOW]!;
		for (let index = 0; index < this.circuits.length; index += 1) {
			const circuit = this.circuits[index]!;
			const dispFbLowIndex = circuitDispFbLowIndex(index);
			const displayLowIndex = circuitDisplayLowIndex(index);
			const dispFbLow = words[dispFbLowIndex]!;
			const dispFbHigh = words[dispFbLowIndex + 1]!;
			const displayLow = words[displayLowIndex]!;
			circuit.enabled = (pmode & (1 << index)) !== 0;
			circuit.framebufferBaseWord = (dispFbLow & 0x1ff) << 12;
			circuit.framebufferWidth = ((dispFbLow >>> 9) & 0x3f) * 64;
			circuit.framebufferPagesPerRow = (dispFbLow >>> 9) & 0x3f;
			circuit.framebufferPsm = (dispFbLow >>> 15) & 0x1f;
			circuit.framebufferX = dispFbHigh & 0x7ff;
			circuit.framebufferY = (dispFbHigh >>> 11) & 0x7ff;
			circuit.displaySignalX = displayLow & 0xfff;
			circuit.displaySignalY = (displayLow >>> 12) & 0x7ff;
			circuit.magnificationX = ((displayLow >>> 23) & 0xf) + 1;
			circuit.magnificationY = ((displayLow >>> 27) & 0x3) + 1;
			circuit.sourceStepX = timing.signalStepX;
			circuit.sourceStepY = 1;
			circuit.sourceAdvanceX = (timing.signalStepX - timing.signalStepX % circuit.magnificationX) / circuit.magnificationX;
			circuit.sourceRemainderStepX = timing.signalStepX % circuit.magnificationX;
			circuit.sourceDivisionMultiplierX = sourceDivisionMultiplier(circuit.magnificationX);
			circuit.sourceDivisionMultiplierY = sourceDivisionMultiplier(circuit.magnificationY);
			circuit.interlacedSourceDivisionMultiplierY = sourceDivisionMultiplier(circuit.magnificationY << 1);
		}
		const circuit1 = this.circuits[0];
		const circuit2 = this.circuits[1];
		const pixelOutputActive = timing.running && timing.signalStepX !== 0;
		const anyEnabled = pixelOutputActive && (circuit1.enabled || circuit2.enabled);
		let cropSignalX = circuit1.enabled ? circuit1.displaySignalX : circuit2.displaySignalX;
		let cropSignalY = circuit1.enabled ? circuit1.displaySignalY : circuit2.displaySignalY;
		if (circuit1.enabled && circuit2.enabled) {
			if (circuit2.displaySignalX < cropSignalX) cropSignalX = circuit2.displaySignalX;
			if (circuit2.displaySignalY < cropSignalY) cropSignalY = circuit2.displaySignalY;
		}
		this.cropSignalX = anyEnabled ? cropSignalX : 0;
		this.cropSignalY = anyEnabled ? cropSignalY : 0;
		const signalStepX = timing.signalStepX;
		const cropPixelXNumerator = cropSignalX + signalStepX - 1;
		const cropPixelX = anyEnabled
			? (cropPixelXNumerator - cropPixelXNumerator % signalStepX) / signalStepX
			: 0;
		for (let index = 0; index < this.circuits.length; index += 1) {
			const circuit = this.circuits[index]!;
			if (!circuit.enabled || !pixelOutputActive) {
				circuit.displayX = 0;
				circuit.displayY = 0;
				circuit.displayWidth = 0;
				circuit.displayHeight = 0;
				circuit.displayRight = 0;
				circuit.displayBottom = 0;
				circuit.sourcePhaseX = 0;
				circuit.sourcePhaseY = 0;
				circuit.fieldSourcePhase = 0;
				circuit.fieldSourceStride = 1;
				circuit.linearSampling = false;
				continue;
			}
			const displayHigh = words[circuitDisplayLowIndex(index) + 1]!;
			const absoluteSignalRight = circuit.displaySignalX + (displayHigh & 0xfff) + 1;
			const displayXNumerator = circuit.displaySignalX + signalStepX - 1;
			const displayRightNumerator = absoluteSignalRight + signalStepX - 1;
			const absoluteDisplayX = (displayXNumerator - displayXNumerator % signalStepX) / signalStepX;
			const absoluteDisplayRight = (displayRightNumerator - displayRightNumerator % signalStepX) / signalStepX;
			circuit.displayX = absoluteDisplayX - cropPixelX;
			circuit.displayY = circuit.displaySignalY - cropSignalY;
			circuit.displayRight = absoluteDisplayRight - cropPixelX;
			circuit.displayBottom = circuit.displayY + ((displayHigh >>> 12) & 0x7ff) + 1;
			circuit.displayWidth = circuit.displayRight - circuit.displayX;
			circuit.displayHeight = circuit.displayBottom - circuit.displayY;
			circuit.sourcePhaseX = absoluteDisplayX * signalStepX - circuit.displaySignalX;
			circuit.sourcePhaseY = 0;
			circuit.linearSampling = circuit.sourcePhaseX === 0
				&& signalStepX === circuit.magnificationX
				&& circuit.magnificationY === 1;
		}
		this.backgroundColor = words[GX_GPU_PCRTC_BGCOLOR_LOW]! & 0x00ffffff;
		this.blendAlpha = (pmode >>> GX_GPU_PCRTC_PMODE_ALP_SHIFT) & 0xff;
		this.blendAlphaFromRegister = (pmode & GX_GPU_PCRTC_PMODE_MMOD) !== 0;
		this.outputAlphaFromCircuit2 = (pmode & GX_GPU_PCRTC_PMODE_AMOD) !== 0;
		this.rgbUnderlayFromCircuit2 = circuit2.enabled && (pmode & GX_GPU_PCRTC_PMODE_SLBG) === 0;
		this.circuit2SampleRequired = circuit2.enabled
			&& (this.rgbUnderlayFromCircuit2 || this.outputAlphaFromCircuit2);
		this.interlaced = (smode2 & GX_GPU_PCRTC_SMODE2_INT) !== 0;
		this.frameMode = this.interlaced && (smode2 & GX_GPU_PCRTC_SMODE2_FFMD) !== 0;
		for (const circuit of this.circuits) {
			circuit.fieldSourceStride = this.interlaced && !this.frameMode ? 2 : 1;
			circuit.fieldSourcePhase = this.interlaced && !this.frameMode
				? (circuit.displaySignalY ^ this.field) & 1
				: 0;
		}

		this.outputWidth = circuit1.enabled ? circuit1.displayRight : circuit2.enabled ? circuit2.displayRight : 0;
		this.outputHeight = circuit1.enabled ? circuit1.displayBottom : circuit2.enabled ? circuit2.displayBottom : 0;
		if (circuit1.enabled && circuit2.enabled) {
			if (circuit2.displayRight > this.outputWidth) this.outputWidth = circuit2.displayRight;
			if (circuit2.displayBottom > this.outputHeight) this.outputHeight = circuit2.displayBottom;
		}
		const circuit1CoversOutput = circuit1.displayX === 0
			&& circuit1.displayY === 0
			&& circuit1.displayRight >= this.outputWidth
			&& circuit1.displayBottom >= this.outputHeight;
		this.circuit2CoversOutput = circuit2.displayX === 0
			&& circuit2.displayY === 0
			&& circuit2.displayRight >= this.outputWidth
			&& circuit2.displayBottom >= this.outputHeight;
		if (circuit1.enabled
			&& circuit1.linearSampling
			&& circuit1.framebufferPsm === GX_GPU_PSMGX16
			&& this.blendAlphaFromRegister
			&& this.blendAlpha === 255
			&& !this.outputAlphaFromCircuit2
			&& circuit1CoversOutput) {
			this.compositionPath = GX_GPU_PCRTC_COMPOSE_GX16_DIRECT_CIRCUIT1;
		} else if ((!circuit1.enabled || circuit1.linearSampling && circuit1.framebufferPsm === GX_GPU_PSMGX16)
			&& (!this.circuit2SampleRequired || circuit2.linearSampling && circuit2.framebufferPsm === GX_GPU_PSMGX16)) {
			this.compositionPath = GX_GPU_PCRTC_COMPOSE_GX16;
		} else {
			this.compositionPath = GX_GPU_PCRTC_COMPOSE_GENERIC;
		}
		this.revision = (this.revision + 1) >>> 0;
	}
}

export class GxGpuPcrtc {
	public readonly registerWords = new Uint32Array(GX_GPU_PCRTC_CONFIG_WORD_COUNT);
	public readonly presentWords = new Uint32Array(GX_GPU_PCRTC_CONFIG_WORD_COUNT);
	public readonly timing = new GxGpuPcrtcTiming();
	public readonly scanout = new GxGpuPcrtcScanout();
	private readonly presentationTiming = new GxGpuPcrtcTiming();
	private csrWord = GX_GPU_PCRTC_RESET_CSR_WORD;
	private imrWord = GX_GPU_PCRTC_RESET_IMR_WORD;
	private cpuHz = 1;
	private halfLineSystemNumerator = 0;
	private halfLineBaseCycles = 0;
	private halfLineRemainderCycles = 0;
	private beamCycle = 0;
	private beamRemainder = 0;
	private beamHalfLine = 0;
	private nextHsyncHalfLine = 2;
	private verticalStage = GX_GPU_PCRTC_VERTICAL_STAGE_VBLANK_BEGIN;
	private beamVblankActive = false;
	private presentationWordsDirty = false;
	private presentationTimingDirty = false;

	public reset(nowCycles: number): void {
		this.registerWords.set(resetConfigWords);
		this.presentWords.set(resetConfigWords);
		this.csrWord = GX_GPU_PCRTC_RESET_CSR_WORD;
		this.imrWord = GX_GPU_PCRTC_RESET_IMR_WORD;
		this.timing.update(this.registerWords);
		this.presentationTiming.update(this.presentWords);
		this.scanout.setField(0);
		this.presentationWordsDirty = false;
		this.presentationTimingDirty = false;
		this.restartBeam(nowCycles);
		this.publishConfiguration();
	}

	private resetCompositionWords(): void {
		for (let index = 0; index < GX_GPU_PCRTC_COMPOSITION_WORD_COUNT; index += 1) {
			this.registerWords[index] = resetConfigWords[index]!;
		}
	}

	public readRegisterWord(index: number): number {
		if (index < GX_GPU_PCRTC_CONFIG_WORD_COUNT) return this.registerWords[index]!;
		if (index === GX_GPU_PCRTC_CSR_LOW) return this.csrWord;
		if (index === GX_GPU_PCRTC_IMR_LOW) return this.imrWord;
		return 0;
	}

	public writeConfigWord(index: number, word: number, nowCycles: number): boolean {
		const registerWord = word >>> 0;
		if (this.registerWords[index] === registerWord) return false;
		this.registerWords[index] = registerWord;
		this.presentationWordsDirty = true;
		if (isBeamTimingWord(index)) {
			this.presentationTimingDirty = true;
			this.timing.update(this.registerWords);
			this.restartBeam(nowCycles);
			return true;
		}
		return false;
	}

	public setCpuHz(cpuHz: number, nowCycles: number): boolean {
		if (this.cpuHz === cpuHz) return false;
		this.cpuHz = cpuHz;
		this.restartBeam(nowCycles);
		return true;
	}

	public readCsr(): number {
		return this.csrWord;
	}

	public readImr(): number {
		return this.imrWord;
	}

	public writeCsr(word: number, nowCycles: number): number {
		const hsyncWasPending = this.hsyncPending();
		this.csrWord = (this.csrWord & ~(word & GX_GPU_PCRTC_CSR_EVENT_MASK)) >>> 0;
		if (hsyncWasPending && !this.hsyncPending() && this.timing.running) this.resumeHsync(nowCycles);
		return word & GX_GPU_PCRTC_CSR_ACTION_MASK;
	}

	public writeImr(word: number): boolean {
		const previousImrWord = this.imrWord;
		this.imrWord = ((word & GX_GPU_PCRTC_IMR_EVENT_MASK) | GX_GPU_PCRTC_IMR_FIXED_BITS) >>> 0;
		const unmaskedEvents = previousImrWord & ~this.imrWord & GX_GPU_PCRTC_IMR_EVENT_MASK;
		return ((this.csrWord << 8) & unmaskedEvents) !== 0;
	}

	public hsyncPending(): boolean {
		return (this.csrWord & GX_GPU_PCRTC_CSR_HSINT) !== 0;
	}

	public vblankActive(): boolean {
		return this.beamVblankActive;
	}

	public field(): number {
		return (this.csrWord >>> 13) & 1;
	}

	public currentHalfLine(nowCycles: number): number {
		if (!this.timing.running) return 0;
		const elapsedNumerator = (nowCycles - this.beamCycle) * this.timing.halfLineClockDenominator
			- this.beamRemainder;
		const elapsedHalfLines = (elapsedNumerator - elapsedNumerator % this.halfLineSystemNumerator)
			/ this.halfLineSystemNumerator;
		return this.beamHalfLine + elapsedHalfLines;
	}

	public nextDeadlineCycle(): number {
		if (!this.timing.running) return -1;
		const verticalHalfLine = this.verticalEventHalfLine();
		const eventHalfLine = !this.hsyncPending() && this.nextHsyncHalfLine < verticalHalfLine
			? this.nextHsyncHalfLine
			: verticalHalfLine;
		return this.deadlineAtHalfLine(eventHalfLine);
	}

	public service(nowCycles: number): number {
		if (!this.timing.running) return GX_GPU_PCRTC_RUNTIME_EDGE_NONE;
		const deadline = this.nextDeadlineCycle();
		if (deadline > nowCycles) return GX_GPU_PCRTC_RUNTIME_EDGE_NONE;
		// CPU instructions are atomic and may service this device after its deadline. Advance from
		// the retained beam epoch: anchoring to nowCycles accumulates lateness into scanout phase.
		// Do not compensate by changing VBlank-edge tick completion or cart first-tick semantics.
		const elapsedNumerator = (nowCycles - this.beamCycle) * this.timing.halfLineClockDenominator
			- this.beamRemainder;
		const elapsedRemainder = elapsedNumerator % this.halfLineSystemNumerator;
		const elapsedHalfLines = (elapsedNumerator - elapsedRemainder) / this.halfLineSystemNumerator;
		const targetHalfLine = this.beamHalfLine + elapsedHalfLines;
		const totalHalfLines = this.timing.totalHalfLines;

		let firstVblankHalfLine = this.timing.activeDisplayHalfLines;
		if (this.verticalStage !== GX_GPU_PCRTC_VERTICAL_STAGE_VBLANK_BEGIN) {
			firstVblankHalfLine += totalHalfLines;
		}
		let firstVsyncHalfLine = this.timing.vsyncHalfLine;
		if (this.verticalStage === GX_GPU_PCRTC_VERTICAL_STAGE_FIELD_END) {
			firstVsyncHalfLine += totalHalfLines;
		}
		const vblankCount = this.periodicEventCount(firstVblankHalfLine, targetHalfLine);
		const vsyncCount = this.periodicEventCount(firstVsyncHalfLine, targetHalfLine);
		const fieldEndCount = this.periodicEventCount(totalHalfLines, targetHalfLine);

		if (vblankCount !== 0) {
			const lastVblankHalfLine = firstVblankHalfLine + (vblankCount - 1) * totalHalfLines;
			this.timing.nextVblankCycleBudget = this.deadlineAtHalfLine(lastVblankHalfLine + totalHalfLines)
				- this.deadlineAtHalfLine(lastVblankHalfLine);
		}

		let result = GX_GPU_PCRTC_RUNTIME_EDGE_NONE;
		if (this.nextHsyncHalfLine <= targetHalfLine) {
			const hsyncDistance = targetHalfLine - this.nextHsyncHalfLine;
			this.nextHsyncHalfLine += hsyncDistance - hsyncDistance % 2 + 2;
			if (!this.hsyncPending() && this.raiseEvent(GX_GPU_PCRTC_CSR_HSINT)) {
				result |= GX_GPU_PCRTC_SERVICE_IRQ;
			}
		}
		if (vsyncCount !== 0) {
			if (this.timing.fieldToggles) {
				if ((vsyncCount & 1) !== 0) this.csrWord = (this.csrWord ^ GX_GPU_PCRTC_CSR_FIELD) >>> 0;
			} else {
				this.csrWord = (this.csrWord | GX_GPU_PCRTC_CSR_FIELD) >>> 0;
			}
			this.scanout.setField(this.field());
			if (this.raiseEvent(GX_GPU_PCRTC_CSR_VSINT)) result |= GX_GPU_PCRTC_SERVICE_IRQ;
		}

		this.advanceBeam(targetHalfLine);
		const beamHalfLine = this.beamHalfLine % totalHalfLines;
		const completedHalfLines = this.beamHalfLine - beamHalfLine;
		this.beamHalfLine = beamHalfLine;
		this.nextHsyncHalfLine -= completedHalfLines;
		if (beamHalfLine < this.timing.activeDisplayHalfLines) {
			this.verticalStage = GX_GPU_PCRTC_VERTICAL_STAGE_VBLANK_BEGIN;
			this.beamVblankActive = false;
		} else if (beamHalfLine < this.timing.vsyncHalfLine) {
			this.verticalStage = GX_GPU_PCRTC_VERTICAL_STAGE_VSYNC;
			this.beamVblankActive = true;
		} else {
			this.verticalStage = GX_GPU_PCRTC_VERTICAL_STAGE_FIELD_END;
			this.beamVblankActive = true;
		}

		if (vblankCount !== 0) return result | GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_BEGIN;
		if (fieldEndCount !== 0) return result | GX_GPU_PCRTC_RUNTIME_EDGE_VBLANK_END;
		return result;
	}

	public latchPresentationWords(): boolean {
		if (!this.presentationWordsDirty) return false;
		this.presentWords.set(this.registerWords);
		if (this.presentationTimingDirty) this.presentationTiming.update(this.presentWords);
		this.presentationWordsDirty = false;
		this.presentationTimingDirty = false;
		this.publishConfiguration();
		return true;
	}

	public captureState(nowCycles: number): GxGpuPcrtcState {
		return {
			registerWords: Array.from(this.registerWords),
			presentWords: Array.from(this.presentWords),
			csrWord: this.csrWord,
			imrWord: this.imrWord,
			beamCycleOffset: this.beamCycle - nowCycles,
			beamRemainder: this.beamRemainder,
			beamHalfLine: this.beamHalfLine,
			nextHsyncHalfLine: this.nextHsyncHalfLine,
			verticalStage: this.verticalStage,
			vblankActive: this.beamVblankActive,
		};
	}

	public restoreState(state: GxGpuPcrtcState, nowCycles: number): void {
		this.registerWords.set(state.registerWords);
		this.presentWords.set(state.presentWords);
		this.csrWord = state.csrWord >>> 0;
		this.imrWord = state.imrWord >>> 0;
		this.timing.update(this.registerWords);
		this.presentationTiming.update(this.presentWords);
		this.refreshPresentationDirtyState();
		this.beamCycle = nowCycles + state.beamCycleOffset;
		this.beamRemainder = state.beamRemainder;
		this.beamHalfLine = state.beamHalfLine;
		this.nextHsyncHalfLine = state.nextHsyncHalfLine;
		this.verticalStage = state.verticalStage;
		this.beamVblankActive = state.vblankActive;
		if (this.timing.running) {
			this.configureHalfLinePeriod();
			let nextVblankHalfLine = this.timing.activeDisplayHalfLines;
			if (nextVblankHalfLine < this.beamHalfLine) nextVblankHalfLine += this.timing.totalHalfLines;
			this.timing.nextVblankCycleBudget = this.deadlineAtHalfLine(
				nextVblankHalfLine + this.timing.totalHalfLines,
			) - this.deadlineAtHalfLine(nextVblankHalfLine);
		} else {
			this.halfLineSystemNumerator = 0;
			this.halfLineBaseCycles = 0;
			this.halfLineRemainderCycles = 0;
			this.timing.nextVblankCycleBudget = 0;
		}
		this.scanout.setField(this.field());
		this.publishConfiguration();
	}

	public captureContext(registerWords: number[], presentWords: number[]): void {
		for (let index = 0; index < GX_GPU_PCRTC_COMPOSITION_WORD_COUNT; index += 1) {
			registerWords[index] = this.registerWords[index]!;
			presentWords[index] = this.presentWords[index]!;
		}
	}

	public restoreContext(
		registerWords: ArrayLike<number>,
		presentWords: ArrayLike<number>,
	): void {
		for (let index = 0; index < GX_GPU_PCRTC_COMPOSITION_WORD_COUNT; index += 1) {
			this.registerWords[index] = registerWords[index]!;
			this.presentWords[index] = presentWords[index]!;
		}
		this.refreshPresentationDirtyState();
		this.scanout.setField(this.field());
		this.publishConfiguration();
	}

	public enterSupervisorContext(userPresentWords: ArrayLike<number>): void {
		this.resetCompositionWords();
		this.registerWords[GX_GPU_PCRTC_PMODE_LOW] = (userPresentWords[GX_GPU_PCRTC_PMODE_LOW]! & GX_GPU_PCRTC_PMODE_EN1) << 1;
		this.registerWords[GX_GPU_PCRTC_DISPFB2_LOW] = userPresentWords[GX_GPU_PCRTC_DISPFB1_LOW]!;
		this.registerWords[GX_GPU_PCRTC_DISPFB2_HIGH] = userPresentWords[GX_GPU_PCRTC_DISPFB1_HIGH]!;
		this.registerWords[GX_GPU_PCRTC_DISPLAY2_LOW] = userPresentWords[GX_GPU_PCRTC_DISPLAY1_LOW]!;
		this.registerWords[GX_GPU_PCRTC_DISPLAY2_HIGH] = userPresentWords[GX_GPU_PCRTC_DISPLAY1_HIGH]!;
		this.registerWords[GX_GPU_PCRTC_BGCOLOR_LOW] = userPresentWords[GX_GPU_PCRTC_BGCOLOR_LOW]!;
		this.registerWords[GX_GPU_PCRTC_BGCOLOR_HIGH] = userPresentWords[GX_GPU_PCRTC_BGCOLOR_HIGH]!;
		for (let index = 0; index < GX_GPU_PCRTC_COMPOSITION_WORD_COUNT; index += 1) {
			this.presentWords[index] = this.registerWords[index]!;
		}
		this.refreshPresentationDirtyState();
		this.publishConfiguration();
	}

	private refreshPresentationDirtyState(): void {
		this.presentationWordsDirty = false;
		this.presentationTimingDirty = false;
		for (let index = 0; index < GX_GPU_PCRTC_CONFIG_WORD_COUNT; index += 1) {
			if (this.registerWords[index] === this.presentWords[index]) continue;
			this.presentationWordsDirty = true;
			if (isBeamTimingWord(index)) this.presentationTimingDirty = true;
		}
	}

	private publishConfiguration(): void {
		this.scanout.update(this.presentWords, this.presentationTiming);
	}

	private configureHalfLinePeriod(): void {
		this.halfLineSystemNumerator = this.cpuHz * this.timing.halfLineClockNumerator;
		const denominator = this.timing.halfLineClockDenominator;
		this.halfLineRemainderCycles = this.halfLineSystemNumerator % denominator;
		this.halfLineBaseCycles = (this.halfLineSystemNumerator - this.halfLineRemainderCycles) / denominator;
	}

	private restartBeam(nowCycles: number): void {
		this.beamCycle = nowCycles;
		this.beamRemainder = 0;
		this.beamHalfLine = 0;
		this.nextHsyncHalfLine = 2;
		this.verticalStage = GX_GPU_PCRTC_VERTICAL_STAGE_VBLANK_BEGIN;
		this.beamVblankActive = false;
		if (this.timing.running) {
			this.configureHalfLinePeriod();
			const firstVblankHalfLine = this.timing.activeDisplayHalfLines;
			this.timing.nextVblankCycleBudget = this.deadlineAtHalfLine(
				firstVblankHalfLine + this.timing.totalHalfLines,
			) - this.deadlineAtHalfLine(firstVblankHalfLine);
		} else {
			this.halfLineSystemNumerator = 0;
			this.halfLineBaseCycles = 0;
			this.halfLineRemainderCycles = 0;
			this.timing.nextVblankCycleBudget = 0;
		}
	}

	private verticalEventHalfLine(): number {
		switch (this.verticalStage) {
			case GX_GPU_PCRTC_VERTICAL_STAGE_VBLANK_BEGIN:
				return this.timing.activeDisplayHalfLines;
			case GX_GPU_PCRTC_VERTICAL_STAGE_VSYNC:
				return this.timing.vsyncHalfLine;
			default:
				return this.timing.totalHalfLines;
		}
	}

	private deadlineAtHalfLine(halfLine: number): number {
		const deltaHalfLines = halfLine - this.beamHalfLine;
		const remainderTotal = this.beamRemainder + deltaHalfLines * this.halfLineRemainderCycles;
		const remainder = remainderTotal % this.timing.halfLineClockDenominator;
		const carry = (remainderTotal - remainder) / this.timing.halfLineClockDenominator;
		return this.beamCycle + deltaHalfLines * this.halfLineBaseCycles + carry + (remainder === 0 ? 0 : 1);
	}

	private advanceBeam(halfLine: number): void {
		const deltaHalfLines = halfLine - this.beamHalfLine;
		const remainderTotal = this.beamRemainder + deltaHalfLines * this.halfLineRemainderCycles;
		this.beamRemainder = remainderTotal % this.timing.halfLineClockDenominator;
		this.beamCycle += deltaHalfLines * this.halfLineBaseCycles
			+ (remainderTotal - this.beamRemainder) / this.timing.halfLineClockDenominator;
		this.beamHalfLine = halfLine;
	}

	private resumeHsync(nowCycles: number): void {
		const elapsedNumerator = (nowCycles - this.beamCycle) * this.timing.halfLineClockDenominator
			- this.beamRemainder;
		const elapsedHalfLines = (elapsedNumerator - elapsedNumerator % this.halfLineSystemNumerator)
			/ this.halfLineSystemNumerator;
		this.skipSuppressedHsyncs(this.beamHalfLine + elapsedHalfLines);
	}

	private skipSuppressedHsyncs(halfLine: number): void {
		if (this.nextHsyncHalfLine > halfLine) return;
		const distance = halfLine - this.nextHsyncHalfLine;
		this.nextHsyncHalfLine += distance - distance % 2 + 2;
	}

	private periodicEventCount(firstHalfLine: number, targetHalfLine: number): number {
		if (firstHalfLine > targetHalfLine) return 0;
		const distance = targetHalfLine - firstHalfLine;
		return 1 + (distance - distance % this.timing.totalHalfLines) / this.timing.totalHalfLines;
	}

	private raiseEvent(event: number): boolean {
		if ((this.csrWord & event) !== 0) return false;
		this.csrWord = (this.csrWord | event) >>> 0;
		return (this.imrWord & event << 8) === 0;
	}

}
