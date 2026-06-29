import { HZ_SCALE } from './constants';

export class TimingState {
	public ufps: number;
	public frameDurationMs: number;

	constructor(
		public ufpsScaled: number,
		public cpuHz: number,
		public cycleBudgetPerFrame: number,
		public regionWord: number,
		public totalScanlines: number,
		public imgDecBytesPerSec: number,
		public dmaBytesPerSecIso: number,
		public dmaBytesPerSecBulk: number,
		public vdpWorkUnitsPerSec: number,
		public geoWorkUnitsPerSec: number,
	) {
		this.ufps = ufpsScaled / HZ_SCALE;
		this.frameDurationMs = 1000 / this.ufps;
	}
}
