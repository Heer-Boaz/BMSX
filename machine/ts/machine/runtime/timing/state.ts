import { HZ_SCALE } from './constants';

export class TimingState {
	public ufps: number;
	public frameDurationMs: number;
	public pcrtcRevision = 0;

	constructor(
		public pcrtcRunning: boolean,
		public ufpsScaled: number,
		public cpuHz: number,
		public cycleBudgetPerFrame: number,
		public totalHalfLines: number,
		public activeDisplayHalfLines: number,
		public dmaWordsPerSec: number,
		public geoWorkUnitsPerSec: number,
	) {
		this.ufps = ufpsScaled / HZ_SCALE;
		this.frameDurationMs = 1000 / this.ufps;
	}
}
