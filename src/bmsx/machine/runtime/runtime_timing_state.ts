import { $ } from '../../core/engine_core';
import { HZ_SCALE } from '../../platform/platform';
import { resolveUfpsScaled } from './runtime_timing';

export class RuntimeTimingState {
	public ufps: number;
	public frameDurationMs: number;
	public cpuHz: number;
	public cycleBudgetPerFrame: number;
	public vdpWorkUnitsPerSec = 0;
	public geoWorkUnitsPerSec = 0;
	public imgDecBytesPerSec = 0;
	public dmaBytesPerSecIso = 0;
	public dmaBytesPerSecBulk = 0;

	constructor(public ufpsScaled: number, cpuHz: number, cycleBudgetPerFrame: number) {
		this.cpuHz = cpuHz;
		this.cycleBudgetPerFrame = cycleBudgetPerFrame;
		this.applyUfpsScaled(ufpsScaled);
	}

	public applyUfpsScaled(ufpsScaled: number): void {
		this.ufpsScaled = resolveUfpsScaled(ufpsScaled);
		this.ufps = this.ufpsScaled / HZ_SCALE;
		this.frameDurationMs = 1000 / this.ufps;
		$.platform.audio.setFrameTimeSec(HZ_SCALE / this.ufpsScaled);
		$.sndmaster.setMixerFps(this.ufps);
	}
}
