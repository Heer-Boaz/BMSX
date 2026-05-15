import { VdpBbuFrameBuffer } from './bbu';
import { VdpJtuUnit } from './jtu';
import { VdpMduFrameBuffer } from './mdu';
import { VdpMfuUnit } from './mfu';
import type { VdpResolvedBlitterSample } from './blitter';
import type { VdpDeviceOutput } from './device_output';
import type { VdpSubmittedFrame } from './frame';
import { createResolvedBlitterSamples } from './frame';
import { VDP_JTU_REGISTER_WORDS, VDP_MFU_WEIGHT_COUNT } from './contracts';
import { VdpXfUnit } from './xf';

export const VDP_VOUT_STATE_IDLE = 0;
export const VDP_VOUT_STATE_REGISTER_LATCHED = 1;
export const VDP_VOUT_STATE_FRAME_SEALED = 2;
export const VDP_VOUT_STATE_FRAME_PRESENTED = 3;

export const VDP_VOUT_SCANOUT_PHASE_ACTIVE = 0;
export const VDP_VOUT_SCANOUT_PHASE_VBLANK = 1;

export type VdpVoutState =
	| typeof VDP_VOUT_STATE_IDLE
	| typeof VDP_VOUT_STATE_REGISTER_LATCHED
	| typeof VDP_VOUT_STATE_FRAME_SEALED
	| typeof VDP_VOUT_STATE_FRAME_PRESENTED;

export type VdpVoutScanoutPhase =
	| typeof VDP_VOUT_SCANOUT_PHASE_ACTIVE
	| typeof VDP_VOUT_SCANOUT_PHASE_VBLANK;

export type VdpVoutFrameOutput = {
	ditherType: number;
	frameBufferWidth: number;
	frameBufferHeight: number;
};

type MutableVdpDeviceOutput = {
	-readonly [Key in keyof VdpDeviceOutput]: VdpDeviceOutput[Key];
};

export class VdpVoutUnit {
	private _state: VdpVoutState = VDP_VOUT_STATE_IDLE;
	private liveDither = 0;
	private _scanoutPhase: VdpVoutScanoutPhase = VDP_VOUT_SCANOUT_PHASE_ACTIVE;
	private scanoutX = 0;
	private scanoutY = 0;
	private scanoutFrameStartCycle = 0;
	private scanoutCyclesPerFrame = 1;
	private scanoutVblankStartCycle = 1;
	private liveFrameBufferWidth = 0;
	private liveFrameBufferHeight = 0;
	private visibleDither = 0;
	private visibleFrameBufferWidth = 0;
	private visibleFrameBufferHeight = 0;
	private readonly visibleXf = new VdpXfUnit();
	private visibleSkyboxEnabled = false;
	private visibleSkyboxSamples = createResolvedBlitterSamples();
	private visibleBillboards = new VdpBbuFrameBuffer();
	private visibleMeshes = new VdpMduFrameBuffer();
	private readonly visibleMorphWeightWords = new Uint32Array(VDP_MFU_WEIGHT_COUNT);
	private readonly visibleJointMatrixWords = new Uint32Array(VDP_JTU_REGISTER_WORDS);
	private readonly sealedFrameOutput: VdpVoutFrameOutput = {
		ditherType: 0,
		frameBufferWidth: 0,
		frameBufferHeight: 0,
	};
	private readonly deviceOutput: MutableVdpDeviceOutput = {
		ditherType: 0,
		scanoutPhase: VDP_VOUT_SCANOUT_PHASE_ACTIVE,
		scanoutX: 0,
		scanoutY: 0,
		xfMatrixWords: this.visibleXf.matrixWords,
		xfViewMatrixIndex: 0,
		xfProjectionMatrixIndex: 0,
		skyboxEnabled: false,
		skyboxSamples: this.visibleSkyboxSamples,
		billboards: this.visibleBillboards,
		meshes: this.visibleMeshes,
		morphWeightWords: this.visibleMorphWeightWords,
		jointMatrixWords: this.visibleJointMatrixWords,
		frameBufferWidth: 0,
		frameBufferHeight: 0,
	};

	public get state(): VdpVoutState {
		return this._state;
	}

	public get liveDitherType(): number {
		return this.liveDither;
	}

	public get vblankActive(): boolean {
		return this._scanoutPhase === VDP_VOUT_SCANOUT_PHASE_VBLANK;
	}

	public get visibleDitherType(): number {
		return this.visibleDither;
	}

	public get visibleSkyboxSampleBuffer(): VdpResolvedBlitterSample[] {
		return this.visibleSkyboxSamples;
	}

	public reset(ditherType = 0, frameBufferWidth = 0, frameBufferHeight = 0): void {
		this.liveDither = ditherType;
		this._scanoutPhase = VDP_VOUT_SCANOUT_PHASE_ACTIVE;
		this.scanoutX = 0;
		this.scanoutY = 0;
		this.scanoutFrameStartCycle = 0;
		this.scanoutCyclesPerFrame = 1;
		this.scanoutVblankStartCycle = 1;
		this.liveFrameBufferWidth = frameBufferWidth;
		this.liveFrameBufferHeight = frameBufferHeight;
		this.visibleDither = ditherType;
		this.visibleFrameBufferWidth = frameBufferWidth;
		this.visibleFrameBufferHeight = frameBufferHeight;
		this.visibleXf.reset();
		this.visibleSkyboxEnabled = false;
		this.resetVisibleSkyboxSamples();
		this.visibleBillboards.reset();
		this.visibleMeshes.reset();
		this.visibleMorphWeightWords.fill(0);
		this.visibleJointMatrixWords.fill(0);
		this.sealedFrameOutput.ditherType = ditherType;
		this.sealedFrameOutput.frameBufferWidth = frameBufferWidth;
		this.sealedFrameOutput.frameBufferHeight = frameBufferHeight;
		this._state = VDP_VOUT_STATE_IDLE;
	}

	public writeDitherType(ditherType: number): void {
		this.liveDither = ditherType;
		this._state = VDP_VOUT_STATE_REGISTER_LATCHED;
	}

	public configureScanout(frameBufferWidth: number, frameBufferHeight: number): void {
		this.liveFrameBufferWidth = frameBufferWidth;
		this.liveFrameBufferHeight = frameBufferHeight;
		this._state = VDP_VOUT_STATE_REGISTER_LATCHED;
	}

	public setScanoutTiming(cyclesIntoFrame: number, cyclesPerFrame: number, vblankStartCycle: number, nowCycles: number): void {
		this.scanoutFrameStartCycle = nowCycles - cyclesIntoFrame;
		this.scanoutCyclesPerFrame = cyclesPerFrame;
		this.scanoutVblankStartCycle = vblankStartCycle;
		this.refreshScanoutBeam(nowCycles);
	}

	private refreshScanoutBeam(nowCycles: number): void {
		const cyclesIntoFrame = (nowCycles - this.scanoutFrameStartCycle) % this.scanoutCyclesPerFrame;
		const vblankActive = this.scanoutVblankStartCycle === 0 || cyclesIntoFrame >= this.scanoutVblankStartCycle;
		this._scanoutPhase = vblankActive ? VDP_VOUT_SCANOUT_PHASE_VBLANK : VDP_VOUT_SCANOUT_PHASE_ACTIVE;
		if (this.visibleFrameBufferWidth === 0 || this.visibleFrameBufferHeight === 0) {
			this.scanoutX = 0;
			this.scanoutY = 0;
			return;
		}
		if (vblankActive) {
			this.setVblankBeamPosition(cyclesIntoFrame);
			return;
		}
		const pixelNumerator = cyclesIntoFrame * this.visibleFrameBufferWidth * this.visibleFrameBufferHeight;
		const pixel = (pixelNumerator - pixelNumerator % this.scanoutVblankStartCycle) / this.scanoutVblankStartCycle;
		this.scanoutX = pixel % this.visibleFrameBufferWidth;
		this.scanoutY = (pixel - this.scanoutX) / this.visibleFrameBufferWidth;
	}

	public sealFrame(): VdpVoutFrameOutput {
		this.sealedFrameOutput.ditherType = this.liveDither;
		this.sealedFrameOutput.frameBufferWidth = this.liveFrameBufferWidth;
		this.sealedFrameOutput.frameBufferHeight = this.liveFrameBufferHeight;
		this._state = VDP_VOUT_STATE_FRAME_SEALED;
		return this.sealedFrameOutput;
	}

	public presentFrame(frame: VdpSubmittedFrame, skyboxEnabled: boolean): void {
		this.visibleDither = frame.ditherType;
		this.visibleFrameBufferWidth = frame.frameBufferWidth;
		this.visibleFrameBufferHeight = frame.frameBufferHeight;
		this.visibleXf.matrixWords.set(frame.xf.matrixWords);
		this.visibleXf.viewMatrixIndex = frame.xf.viewMatrixIndex;
		this.visibleXf.projectionMatrixIndex = frame.xf.projectionMatrixIndex;
		this.visibleSkyboxEnabled = skyboxEnabled;
		const frameSkyboxSamples = frame.skyboxSamples;
		frame.skyboxSamples = this.visibleSkyboxSamples;
		this.visibleSkyboxSamples = frameSkyboxSamples;
		const frameBillboards = frame.billboards;
		frame.billboards = this.visibleBillboards;
		this.visibleBillboards = frameBillboards;
		frame.billboards.reset();
		const frameMeshes = frame.meshes;
		frame.meshes = this.visibleMeshes;
		this.visibleMeshes = frameMeshes;
		frame.meshes.reset();
		this.visibleMorphWeightWords.set(frame.morphWeightWords);
		this.visibleJointMatrixWords.set(frame.jointMatrixWords);
		this._state = VDP_VOUT_STATE_FRAME_PRESENTED;
	}

	public presentLiveState(xf: VdpXfUnit, skyboxEnabled: boolean, mfu: VdpMfuUnit, jtu: VdpJtuUnit): void {
		this.visibleDither = this.liveDither;
		this.visibleFrameBufferWidth = this.liveFrameBufferWidth;
		this.visibleFrameBufferHeight = this.liveFrameBufferHeight;
		this.visibleXf.matrixWords.set(xf.matrixWords);
		this.visibleXf.viewMatrixIndex = xf.viewMatrixIndex;
		this.visibleXf.projectionMatrixIndex = xf.projectionMatrixIndex;
		this.visibleSkyboxEnabled = skyboxEnabled;
		this.visibleBillboards.reset();
		this.visibleMeshes.reset();
		this.visibleMorphWeightWords.set(mfu.weightWords);
		this.visibleJointMatrixWords.set(jtu.matrixWords);
		this._state = VDP_VOUT_STATE_FRAME_PRESENTED;
	}

	public readDeviceOutput(nowCycles: number): VdpDeviceOutput {
		this.refreshScanoutBeam(nowCycles);
		const output = this.deviceOutput;
		output.ditherType = this.visibleDither;
		output.scanoutPhase = this._scanoutPhase;
		output.scanoutX = this.scanoutX;
		output.scanoutY = this.scanoutY;
		output.xfViewMatrixIndex = this.visibleXf.viewMatrixIndex;
		output.xfProjectionMatrixIndex = this.visibleXf.projectionMatrixIndex;
		output.skyboxEnabled = this.visibleSkyboxEnabled;
		output.skyboxSamples = this.visibleSkyboxSamples;
		output.billboards = this.visibleBillboards;
		output.meshes = this.visibleMeshes;
		output.morphWeightWords = this.visibleMorphWeightWords;
		output.jointMatrixWords = this.visibleJointMatrixWords;
		output.frameBufferWidth = this.visibleFrameBufferWidth;
		output.frameBufferHeight = this.visibleFrameBufferHeight;
		return output;
	}

	private resetVisibleSkyboxSamples(): void {
		for (let index = 0; index < this.visibleSkyboxSamples.length; index += 1) {
			const sample = this.visibleSkyboxSamples[index]!;
			sample.source.surfaceId = 0;
			sample.source.srcX = 0;
			sample.source.srcY = 0;
			sample.source.width = 0;
			sample.source.height = 0;
			sample.surfaceWidth = 0;
			sample.surfaceHeight = 0;
			sample.slot = 0;
		}
	}

	private setVblankBeamPosition(cyclesIntoFrame: number): void {
		if (this.scanoutVblankStartCycle === 0) {
			const pixelNumerator = cyclesIntoFrame * this.visibleFrameBufferWidth * this.visibleFrameBufferHeight;
			const pixel = (pixelNumerator - pixelNumerator % this.scanoutCyclesPerFrame) / this.scanoutCyclesPerFrame;
			this.scanoutX = pixel % this.visibleFrameBufferWidth;
			this.scanoutY = this.visibleFrameBufferHeight + (pixel - this.scanoutX) / this.visibleFrameBufferWidth;
			return;
		}
		const vblankCycles = this.scanoutCyclesPerFrame - this.scanoutVblankStartCycle;
		const vblankCycle = cyclesIntoFrame - this.scanoutVblankStartCycle;
		const blankLineNumerator = vblankCycles * this.visibleFrameBufferHeight;
		const blankLineCount = (blankLineNumerator - blankLineNumerator % this.scanoutVblankStartCycle) / this.scanoutVblankStartCycle;
		const blankPixelNumerator = vblankCycle * this.visibleFrameBufferWidth * blankLineCount;
		const blankPixel = (blankPixelNumerator - blankPixelNumerator % vblankCycles) / vblankCycles;
		this.scanoutX = blankPixel % this.visibleFrameBufferWidth;
		this.scanoutY = this.visibleFrameBufferHeight + (blankPixel - this.scanoutX) / this.visibleFrameBufferWidth;
	}
}
