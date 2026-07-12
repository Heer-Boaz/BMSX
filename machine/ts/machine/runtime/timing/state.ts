import { HZ_SCALE } from './constants';

export class TimingState {
	public ufps: number;
	public frameDurationMs: number;

	constructor(
		public ufpsScaled: number,
		public cpuHz: number,
		public cycleBudgetPerFrame: number,
		public gpuDisplayModeWord: number,
		public gpuVerticalDisplayRangeWord: number,
		public totalScanlines: number,
		public dmaBytesPerSec: number,
		public geoWorkUnitsPerSec: number,
	) {
		this.ufps = ufpsScaled / HZ_SCALE;
		this.frameDurationMs = 1000 / this.ufps;
	}
}
