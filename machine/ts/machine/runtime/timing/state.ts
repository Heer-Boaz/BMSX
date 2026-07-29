import { HZ_SCALE } from '../../../spec/bmsx/timing';
import { calcCyclesPerFrameScaled } from './index';
import type { MachineModelSpec } from '../../../spec/bmsx/model';
import {
	GX_GPU_PCRTC_RESET_ACTIVE_DISPLAY_HALF_LINES,
	GX_GPU_PCRTC_RESET_REFRESH_UFPS_SCALED,
	GX_GPU_PCRTC_RESET_TOTAL_HALF_LINES,
} from '../../devices/gx/gpu_pcrtc';

export class TimingState {
	public ufps: number;
	public frameDurationMs: number;
	public cpuCyclesPerMillisecond: number;
	public pcrtcRevision = 0;
	public pcrtcRunning = true;
	public ufpsScaled = GX_GPU_PCRTC_RESET_REFRESH_UFPS_SCALED;
	public cpuHz: number;
	public cycleBudgetPerFrame: number;
	public totalHalfLines = GX_GPU_PCRTC_RESET_TOTAL_HALF_LINES;
	public activeDisplayHalfLines = GX_GPU_PCRTC_RESET_ACTIVE_DISPLAY_HALF_LINES;
	public geoWorkUnitsPerSec: number;

	constructor(model: MachineModelSpec) {
		this.cpuHz = model.cpuFreqHz;
		this.cycleBudgetPerFrame = calcCyclesPerFrameScaled(
			model.cpuFreqHz,
			GX_GPU_PCRTC_RESET_REFRESH_UFPS_SCALED,
		);
		this.geoWorkUnitsPerSec = model.geoWorkUnitsPerSec;
		this.ufps = this.ufpsScaled / HZ_SCALE;
		this.frameDurationMs = 1000 / this.ufps;
		this.cpuCyclesPerMillisecond = model.cpuFreqHz / 1000;
	}
}
