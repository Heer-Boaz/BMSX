import { consoleCore } from '../../../core/console';
import { DEFAULT_FRAME_TIME_MS, DEFAULT_UFPS, DEFAULT_UFPS_SCALED, HZ_SCALE } from './constants';
import { resolveUfpsScaled } from './index';

export class TimingState {
	public ufps: number = DEFAULT_UFPS;
	public frameDurationMs: number = DEFAULT_FRAME_TIME_MS;
	public vdpWorkUnitsPerSec: number = 0;
	public geoWorkUnitsPerSec: number = 0;
	public imgDecBytesPerSec: number = 0;
	public dmaBytesPerSecIso: number = 0;
	public dmaBytesPerSecBulk: number = 0;

	constructor(public ufpsScaled: number = DEFAULT_UFPS_SCALED, public cpuHz: number = 0, public cycleBudgetPerFrame: number = 0) {
		this.applyUfpsScaled(ufpsScaled);
	}

	public applyUfpsScaled(ufpsScaled: number): void {
		this.ufpsScaled = resolveUfpsScaled(ufpsScaled);
		this.ufps = this.ufpsScaled / HZ_SCALE;
		this.frameDurationMs = 1000 / this.ufps;
		consoleCore.platform.audio.setFrameTimeSec(HZ_SCALE / this.ufpsScaled);
		consoleCore.sndmaster.setMixerUfpsScaled(this.ufpsScaled);
	}
}
