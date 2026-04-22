import type { CPU } from '../cpu/cpu';

export const TIMER_KIND_VBLANK_BEGIN = 1;
export const TIMER_KIND_VBLANK_END = 2;
export const TIMER_KIND_DEVICE_SERVICE = 3;

export const DEVICE_SERVICE_GEO = 1;
export const DEVICE_SERVICE_DMA = 2;
export const DEVICE_SERVICE_IMG = 3;
export const DEVICE_SERVICE_VDP = 4;

const DEVICE_SERVICE_KIND_COUNT = DEVICE_SERVICE_VDP + 1;
const TIMER_EVENT_KIND_SHIFT = 8;

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
	private readonly timerKinds: number[] = [];
	private readonly timerPayloads: number[] = [];
	private readonly timerGenerations: number[] = [];
	private timerCount = 0;
	private vblankEnterTimerGeneration = 0;
	private vblankEndTimerGeneration = 0;
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
		this.vblankEnterTimerGeneration = 0;
		this.vblankEndTimerGeneration = 0;
		this.deviceServiceTimerGeneration.fill(0);
	}

	public currentNowCycles(): number {
		if (!this.schedulerSliceActive) {
			return this.schedulerNowCycles;
		}
		return this.activeSliceBaseCycle + (this.activeSliceBudgetCycles - this.cpu.instructionBudgetRemaining);
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

	public advanceTo(nowCycles: number): void {
		this.schedulerNowCycles = nowCycles;
	}

	public nextDeadline(): number {
		this.discardStaleTopTimers();
		if (this.timerCount === 0) {
			return Number.MAX_SAFE_INTEGER;
		}
		return this.timerDeadlines[0]!;
	}

	public hasDueTimer(): boolean {
		this.discardStaleTopTimers();
		return this.timerCount > 0 && this.timerDeadlines[0]! <= this.schedulerNowCycles;
	}

	public popDueTimer(): number {
		const kind = this.timerKinds[0]!;
		const payload = this.timerPayloads[0]!;
		this.removeTopTimer();
		return (kind << TIMER_EVENT_KIND_SHIFT) | payload;
	}

	public scheduleVblankTimer(timerKind: number, deadlineCycles: number): void {
		let generation: number;
		if (timerKind === TIMER_KIND_VBLANK_BEGIN) {
			generation = nextTimerGeneration(this.vblankEnterTimerGeneration);
			this.vblankEnterTimerGeneration = generation;
		} else {
			generation = nextTimerGeneration(this.vblankEndTimerGeneration);
			this.vblankEndTimerGeneration = generation;
		}
		this.pushTimer(deadlineCycles, timerKind, 0, generation);
		this.requestYieldForEarlierDeadline(deadlineCycles);
	}

	public scheduleDeviceService(deviceKind: number, deadlineCycles: number): void {
		const generation = nextTimerGeneration(this.deviceServiceTimerGeneration[deviceKind]!);
		this.deviceServiceTimerGeneration[deviceKind] = generation;
		this.pushTimer(deadlineCycles, TIMER_KIND_DEVICE_SERVICE, deviceKind, generation);
		this.requestYieldForEarlierDeadline(deadlineCycles);
	}

	public cancelDeviceService(deviceKind: number): void {
		this.deviceServiceTimerGeneration[deviceKind] = nextTimerGeneration(this.deviceServiceTimerGeneration[deviceKind]!);
	}

	private clearTimerHeap(): void {
		this.timerCount = 0;
		this.timerDeadlines.length = 0;
		this.timerKinds.length = 0;
		this.timerPayloads.length = 0;
		this.timerGenerations.length = 0;
	}

	// @code-quality start repeated-sequence-acceptable -- Scheduler heap moves four parallel timer columns inline; helper calls would sit on the timer hot path.
	private pushTimer(deadline: number, kind: number, payload: number, generation: number): void {
		let index = this.timerCount;
		this.timerCount += 1;
		this.timerDeadlines[index] = deadline;
		this.timerKinds[index] = kind;
		this.timerPayloads[index] = payload;
		this.timerGenerations[index] = generation;
		while (index > 0) {
			const parent = (index - 1) >> 1;
			if (this.timerDeadlines[parent]! <= deadline) {
				break;
			}
			this.timerDeadlines[index] = this.timerDeadlines[parent]!;
			this.timerKinds[index] = this.timerKinds[parent]!;
			this.timerPayloads[index] = this.timerPayloads[parent]!;
			this.timerGenerations[index] = this.timerGenerations[parent]!;
			index = parent;
		}
		this.timerDeadlines[index] = deadline;
		this.timerKinds[index] = kind;
		this.timerPayloads[index] = payload;
		this.timerGenerations[index] = generation;
	}

	private removeTopTimer(): void {
		const lastIndex = this.timerCount - 1;
		if (lastIndex < 0) {
			return;
		}
		const deadline = this.timerDeadlines[lastIndex]!;
		const kind = this.timerKinds[lastIndex]!;
		const payload = this.timerPayloads[lastIndex]!;
		const generation = this.timerGenerations[lastIndex]!;
		this.timerCount = lastIndex;
		this.timerDeadlines.length = lastIndex;
		this.timerKinds.length = lastIndex;
		this.timerPayloads.length = lastIndex;
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
			this.timerKinds[index] = this.timerKinds[child]!;
			this.timerPayloads[index] = this.timerPayloads[child]!;
			this.timerGenerations[index] = this.timerGenerations[child]!;
			index = child;
		}
		this.timerDeadlines[index] = deadline;
		this.timerKinds[index] = kind;
		this.timerPayloads[index] = payload;
		this.timerGenerations[index] = generation;
	}
	// @code-quality end repeated-sequence-acceptable

	private isTimerCurrent(kind: number, payload: number, generation: number): boolean {
		switch (kind) {
			case TIMER_KIND_VBLANK_BEGIN:
				return generation === this.vblankEnterTimerGeneration;
			case TIMER_KIND_VBLANK_END:
				return generation === this.vblankEndTimerGeneration;
			case TIMER_KIND_DEVICE_SERVICE:
				return generation === this.deviceServiceTimerGeneration[payload];
			default:
				throw new Error(`Runtime fault: unknown timer kind ${kind}.`);
		}
	}

	private discardStaleTopTimers(): void {
		while (this.timerCount > 0) {
			if (this.isTimerCurrent(this.timerKinds[0]!, this.timerPayloads[0]!, this.timerGenerations[0]!)) {
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
