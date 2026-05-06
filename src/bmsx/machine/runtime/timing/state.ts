import { consoleCore } from '../../../core/console';
import { DEFAULT_FRAME_TIME_MS, DEFAULT_UFPS, DEFAULT_UFPS_SCALED, HZ_SCALE } from './constants';
import { resolveUfpsScaled } from './index';

export class TimingState {
	public ufps = DEFAULT_UFPS;
	public frameDurationMs = DEFAULT_FRAME_TIME_MS;
	public vdpWorkUnitsPerSec = 0;
	public geoWorkUnitsPerSec = 0;
	public imgDecBytesPerSec = 0;
	public dmaBytesPerSecIso = 0;
	public dmaBytesPerSecBulk = 0;

	constructor(public ufpsScaled = DEFAULT_UFPS_SCALED, public cpuHz = 0, public cycleBudgetPerFrame = 0) {
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
