import { CpuRunKind, type CPU, type RunResult } from '../cpu/cpu';

export const DEVICE_SERVICE_GEO = 1;
export const DEVICE_SERVICE_DMA = 2;
export const DEVICE_SERVICE_APU = 3;
export const DEVICE_SERVICE_GPU = 4;
export const DEVICE_SERVICE_APU_TRANSFER = 5;
export const DEVICE_SERVICE_SYSTEM = 6;
export const DEVICE_SERVICE_GTE = 7;
export const DEVICE_SERVICE_IMGDEC = 8;

// Equal-cycle device edges are serviced in this fixed device-kind order.
// This does not determine ownership of any shared data bus.
const DEVICE_SERVICE_KIND_COUNT = DEVICE_SERVICE_IMGDEC + 1;

const INACTIVE_TIMER = 0xff;

export class DeviceScheduler {
	private schedulerNowCycles = 0;
	// Already charged, not yet committed to device time.
	private acceptedCpuUntil = 0;
	public get acceptedCpuCycles(): number {
		return this.acceptedCpuUntil > this.schedulerNowCycles ? this.acceptedCpuUntil - this.schedulerNowCycles : 0;
	}
	public set acceptedCpuCycles(cycles: number) { this.acceptedCpuUntil = this.schedulerNowCycles + cycles; }
	private schedulerSliceActive = false;
	private activeSliceBaseCycle = 0;
	private activeSliceBudgetCycles = 0;
	private activeSliceTargetCycle = 0;
	// Index zero anchors the ordered list; each device kind owns one node.
	private readonly timerDeadlines = new Float64Array(DEVICE_SERVICE_KIND_COUNT);
	private readonly timerPrevious = new Uint8Array(DEVICE_SERVICE_KIND_COUNT).fill(INACTIVE_TIMER);
	private readonly timerNext = new Uint8Array(DEVICE_SERVICE_KIND_COUNT);

	public constructor(private readonly cpu: CPU) {
		this.timerDeadlines[0] = Number.MAX_SAFE_INTEGER;
	}

	public get nowCycles(): number {
		return this.schedulerNowCycles;
	}

	public setNowCycles(nowCycles: number): void {
		this.schedulerNowCycles = nowCycles;
	}

	public reset(): void {
		this.timerPrevious.fill(INACTIVE_TIMER);
		this.timerNext.fill(0);
		this.schedulerNowCycles = 0;
		this.acceptedCpuUntil = 0;
		this.schedulerSliceActive = false;
		this.activeSliceBaseCycle = 0;
		this.activeSliceBudgetCycles = 0;
		this.activeSliceTargetCycle = 0;
	}

	public currentNowCycles(): number {
		if (!this.schedulerSliceActive) {
			return this.schedulerNowCycles;
		}
		return this.activeSliceBaseCycle + (this.activeSliceBudgetCycles - this.cpu.instructionBudgetRemaining);
	}

	public isCpuSliceActive(): boolean {
		return this.schedulerSliceActive;
	}

	public beginCpuSlice(sliceBudget: number): void {
		this.schedulerSliceActive = true;
		this.activeSliceBaseCycle = this.schedulerNowCycles;
		this.activeSliceBudgetCycles = sliceBudget;
		this.activeSliceTargetCycle = this.schedulerNowCycles + sliceBudget;
	}

	public endCpuSlice(): void {
		this.schedulerSliceActive = false;
	}

	public runCpuSlice(targetDepth: number, sliceBudget: number, targetThread: number = this.cpu.rootThread.address, kind = CpuRunKind.Direct): RunResult {
		this.beginCpuSlice(sliceBudget);
		try {
			return this.cpu.runUntilDepth(targetDepth, sliceBudget, targetThread, kind);
		} finally {
			this.endCpuSlice();
		}
	}

	public advanceTo(nowCycles: number): void {
		this.schedulerNowCycles = nowCycles;
	}

	public nextDeadline(): number {
		return this.timerDeadlines[this.timerNext[0]];
	}

	public hasDueTimer(): boolean {
		const head = this.timerNext[0];
		return head !== 0 && this.timerDeadlines[head] <= this.schedulerNowCycles;
	}

	public popDueTimer(): number {
		const deviceKind = this.timerNext[0];
		this.cancelDeviceService(deviceKind);
		return deviceKind;
	}

	public scheduleDeviceService(deviceKind: number, deadlineCycles: number): void {
		if (this.timerPrevious[deviceKind] === INACTIVE_TIMER || this.timerDeadlines[deviceKind] !== deadlineCycles) {
			this.cancelDeviceService(deviceKind);
			let previous = 0;
			let next = this.timerNext[0];
			while (next !== 0) {
				const deadline = this.timerDeadlines[next];
				if (deadline > deadlineCycles || (deadline === deadlineCycles && next > deviceKind)) break;
				previous = next;
				next = this.timerNext[next];
			}
			this.timerDeadlines[deviceKind] = deadlineCycles;
			this.timerPrevious[deviceKind] = previous;
			this.timerNext[deviceKind] = next;
			this.timerNext[previous] = deviceKind;
			this.timerPrevious[next] = deviceKind;
		}
		this.requestYieldForEarlierDeadline(deadlineCycles);
	}

	public cancelDeviceService(deviceKind: number): void {
		const previous = this.timerPrevious[deviceKind];
		if (previous === INACTIVE_TIMER) return;
		const next = this.timerNext[deviceKind];
		this.timerNext[previous] = next;
		this.timerPrevious[next] = previous;
		this.timerPrevious[deviceKind] = INACTIVE_TIMER;
	}

	public requestYieldForEarlierDeadline(deadlineCycles: number): void {
		if (!this.schedulerSliceActive) {
			return;
		}
		if (deadlineCycles > this.activeSliceTargetCycle) {
			return;
		}
		this.cpu.requestYield();
	}
}
