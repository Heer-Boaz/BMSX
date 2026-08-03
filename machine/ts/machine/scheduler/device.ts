import type { CPU, RunResult } from '../cpu/cpu';

export const DEVICE_SERVICE_GEO = 1;
export const DEVICE_SERVICE_DMA = 2;
export const DEVICE_SERVICE_APU = 3;
export const DEVICE_SERVICE_GPU = 4;
export const DEVICE_SERVICE_APU_TRANSFER = 5;
export const DEVICE_SERVICE_SYSTEM = 6;
export const DEVICE_SERVICE_GTE = 7;
export const DEVICE_SERVICE_IMGDEC = 8;

const DEVICE_SERVICE_KIND_COUNT = DEVICE_SERVICE_IMGDEC + 1;

function nextTimerGeneration(value: number): number {
	const next = (value + 1) >>> 0;
	return next === 0 ? 1 : next;
}

export class DeviceScheduler {
	private schedulerNowCycles = 0;
	private schedulerSliceActive = false;
	private activeSliceBaseCycle = 0;
	private activeSliceBudgetCycles = 0;
	private activeSliceTargetCycle = 0;
	private readonly timerDeadlines: number[] = [];
	private readonly timerDeviceKinds: number[] = [];
	private readonly timerGenerations: number[] = [];
	private readonly deviceServiceTimerGeneration = new Uint32Array(DEVICE_SERVICE_KIND_COUNT);

	public constructor(private readonly cpu: CPU) {
	}

	public get nowCycles(): number {
		return this.schedulerNowCycles;
	}

	public setNowCycles(nowCycles: number): void {
		this.schedulerNowCycles = nowCycles;
	}

	public reset(): void {
		this.clearTimerHeap();
		this.schedulerNowCycles = 0;
		this.schedulerSliceActive = false;
		this.activeSliceBaseCycle = 0;
		this.activeSliceBudgetCycles = 0;
		this.activeSliceTargetCycle = 0;
		this.deviceServiceTimerGeneration.fill(0);
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

	public runCpuSlice(targetDepth: number, sliceBudget: number): RunResult {
		this.beginCpuSlice(sliceBudget);
		try {
			return this.cpu.runUntilDepth(targetDepth, sliceBudget);
		} finally {
			this.endCpuSlice();
		}
	}

	public advanceTo(nowCycles: number): void {
		this.schedulerNowCycles = nowCycles;
	}

	public nextDeadline(): number {
		this.discardStaleTopTimers();
		if (this.timerDeadlines.length === 0) {
			return Number.MAX_SAFE_INTEGER;
		}
		return this.timerDeadlines[0]!;
	}

	public hasDueTimer(): boolean {
		this.discardStaleTopTimers();
		return this.timerDeadlines.length > 0 && this.timerDeadlines[0]! <= this.schedulerNowCycles;
	}

	public popDueTimer(): number {
		const deviceKind = this.timerDeviceKinds[0]!;
		this.removeTopTimer();
		return deviceKind;
	}

	public scheduleDeviceService(deviceKind: number, deadlineCycles: number): void {
		const generation = nextTimerGeneration(this.deviceServiceTimerGeneration[deviceKind]!);
		this.deviceServiceTimerGeneration[deviceKind] = generation;
		this.pushTimer(deadlineCycles, deviceKind, generation);
		this.requestYieldForEarlierDeadline(deadlineCycles);
	}

	public cancelDeviceService(deviceKind: number): void {
		this.deviceServiceTimerGeneration[deviceKind] = nextTimerGeneration(this.deviceServiceTimerGeneration[deviceKind]!);
	}

	private clearTimerHeap(): void {
		this.timerDeadlines.length = 0;
		this.timerDeviceKinds.length = 0;
		this.timerGenerations.length = 0;
	}

	// start repeated-sequence-acceptable -- Scheduler heap moves three parallel timer columns inline; helper calls would sit on the timer hot path.
	private pushTimer(deadline: number, deviceKind: number, generation: number): void {
		let index = this.timerDeadlines.length;
		this.timerDeadlines[index] = deadline;
		this.timerDeviceKinds[index] = deviceKind;
		this.timerGenerations[index] = generation;
		while (index > 0) {
			const parent = (index - 1) >> 1;
			if (this.timerDeadlines[parent]! <= deadline) {
				break;
			}
			this.timerDeadlines[index] = this.timerDeadlines[parent]!;
			this.timerDeviceKinds[index] = this.timerDeviceKinds[parent]!;
			this.timerGenerations[index] = this.timerGenerations[parent]!;
			index = parent;
		}
		this.timerDeadlines[index] = deadline;
		this.timerDeviceKinds[index] = deviceKind;
		this.timerGenerations[index] = generation;
	}

	private removeTopTimer(): void {
		const lastIndex = this.timerDeadlines.length - 1;
		const deadline = this.timerDeadlines[lastIndex]!;
		const deviceKind = this.timerDeviceKinds[lastIndex]!;
		const generation = this.timerGenerations[lastIndex]!;
		this.timerDeadlines.length = lastIndex;
		this.timerDeviceKinds.length = lastIndex;
		this.timerGenerations.length = lastIndex;
		if (lastIndex === 0) {
			return;
		}
		let index = 0;
		while (index < (lastIndex >> 1)) {
			let child = (index << 1) + 1;
			if (child + 1 < lastIndex && this.timerDeadlines[child + 1]! < this.timerDeadlines[child]!) {
				child += 1;
			}
			if (this.timerDeadlines[child]! >= deadline) {
				break;
			}
			this.timerDeadlines[index] = this.timerDeadlines[child]!;
			this.timerDeviceKinds[index] = this.timerDeviceKinds[child]!;
			this.timerGenerations[index] = this.timerGenerations[child]!;
			index = child;
		}
		this.timerDeadlines[index] = deadline;
		this.timerDeviceKinds[index] = deviceKind;
		this.timerGenerations[index] = generation;
	}
	// end repeated-sequence-acceptable

	private discardStaleTopTimers(): void {
		while (this.timerDeadlines.length > 0) {
			if (this.timerGenerations[0] === this.deviceServiceTimerGeneration[this.timerDeviceKinds[0]!]) {
				return;
			}
			this.removeTopTimer();
		}
	}

	private requestYieldForEarlierDeadline(deadlineCycles: number): void {
		if (!this.schedulerSliceActive) {
			return;
		}
		if (deadlineCycles > this.activeSliceTargetCycle) {
			return;
		}
		this.cpu.requestYield();
	}
}
