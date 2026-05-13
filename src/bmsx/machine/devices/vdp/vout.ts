import { VdpBbuFrameBuffer } from './bbu';
import type { VdpResolvedBlitterSample } from './blitter';
import type { VdpDeviceOutput } from './device_output';
import type { VdpSubmittedFrameState } from './frame';
import { createResolvedBlitterSamples } from './frame';
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
	private liveFrameBufferWidth = 0;
	private liveFrameBufferHeight = 0;
	private visibleDither = 0;
	private visibleFrameBufferWidth = 0;
	private visibleFrameBufferHeight = 0;
	private readonly visibleXf = new VdpXfUnit();
	private visibleSkyboxEnabled = false;
	private visibleSkyboxSamples = createResolvedBlitterSamples();
	private visibleBillboards = new VdpBbuFrameBuffer();
	private readonly sealedFrameOutput: VdpVoutFrameOutput = {
		ditherType: 0,
		frameBufferWidth: 0,
		frameBufferHeight: 0,
	};
	private readonly deviceOutput: MutableVdpDeviceOutput = {
		ditherType: 0,
		scanoutPhase: VDP_VOUT_SCANOUT_PHASE_ACTIVE,
		xfMatrixWords: this.visibleXf.matrixWords,
		xfViewMatrixIndex: 0,
		xfProjectionMatrixIndex: 0,
		skyboxEnabled: false,
		skyboxSamples: this.visibleSkyboxSamples,
		billboards: this.visibleBillboards,
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
		this.liveFrameBufferWidth = frameBufferWidth;
		this.liveFrameBufferHeight = frameBufferHeight;
		this.visibleDither = ditherType;
		this.visibleFrameBufferWidth = frameBufferWidth;
		this.visibleFrameBufferHeight = frameBufferHeight;
		this.visibleXf.reset();
		this.visibleSkyboxEnabled = false;
		this.resetVisibleSkyboxSamples();
		this.visibleBillboards.reset();
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

	public setVblankActive(active: boolean): void {
		this._scanoutPhase = active ? VDP_VOUT_SCANOUT_PHASE_VBLANK : VDP_VOUT_SCANOUT_PHASE_ACTIVE;
	}

	public sealFrame(): VdpVoutFrameOutput {
		this.sealedFrameOutput.ditherType = this.liveDither;
		this.sealedFrameOutput.frameBufferWidth = this.liveFrameBufferWidth;
		this.sealedFrameOutput.frameBufferHeight = this.liveFrameBufferHeight;
		this._state = VDP_VOUT_STATE_FRAME_SEALED;
		return this.sealedFrameOutput;
	}

	public presentFrame(frame: VdpSubmittedFrameState, skyboxEnabled: boolean): void {
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
		this._state = VDP_VOUT_STATE_FRAME_PRESENTED;
	}

	public presentLiveState(xf: VdpXfUnit, skyboxEnabled: boolean): void {
		this.visibleDither = this.liveDither;
		this.visibleFrameBufferWidth = this.liveFrameBufferWidth;
		this.visibleFrameBufferHeight = this.liveFrameBufferHeight;
		this.visibleXf.matrixWords.set(xf.matrixWords);
		this.visibleXf.viewMatrixIndex = xf.viewMatrixIndex;
		this.visibleXf.projectionMatrixIndex = xf.projectionMatrixIndex;
		this.visibleSkyboxEnabled = skyboxEnabled;
		this.visibleBillboards.reset();
		this._state = VDP_VOUT_STATE_FRAME_PRESENTED;
	}

	public readDeviceOutput(): VdpDeviceOutput {
		const output = this.deviceOutput;
		output.ditherType = this.visibleDither;
		output.scanoutPhase = this._scanoutPhase;
		output.xfViewMatrixIndex = this.visibleXf.viewMatrixIndex;
		output.xfProjectionMatrixIndex = this.visibleXf.projectionMatrixIndex;
		output.skyboxEnabled = this.visibleSkyboxEnabled;
		output.skyboxSamples = this.visibleSkyboxSamples;
		output.billboards = this.visibleBillboards;
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
}
