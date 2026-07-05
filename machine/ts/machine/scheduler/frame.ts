import { Runtime } from '../runtime/runtime';

export type TickCompletion = {
	sequence: number;
	remaining: number;
	visualCommitted: boolean;
	vdpFrameCost: number;
	vdpFrameHeld: boolean;
};

export type FrameSchedulerStateSnapshot = {
	accumulatedHostTimeMs: number;
	queuedTickCompletions: TickCompletion[];
	lastTickSequence: number;
	lastTickBudgetGranted: number;
	lastTickCpuBudgetGranted: number;
	lastTickCpuUsedCycles: number;
	lastTickBudgetRemaining: number;
	lastTickVisualFrameCommitted: boolean;
	lastTickVdpFrameCost: number;
	lastTickVdpFrameHeld: boolean;
	lastTickCompleted: boolean;
	lastTickConsumedSequence: number;
};

type BudgetFrameState = {
	cycleBudgetRemaining: number;
	cycleBudgetGranted: number;
};

const TICK_COMPLETION_QUEUE_CAPACITY = 16;
const MAX_CATCH_UP_FRAMES = 5;
const FRAME_SLICE_EPSILON_MS = 0.000001;
function createTickCompletionQueue(): TickCompletion[] {
	const queue = new Array<TickCompletion>(TICK_COMPLETION_QUEUE_CAPACITY);
	for (let index = 0; index < TICK_COMPLETION_QUEUE_CAPACITY; index += 1) {
		queue[index] = {
			sequence: 0,
			remaining: 0,
			visualCommitted: true,
			vdpFrameCost: 0,
			vdpFrameHeld: false,
		};
	}
	return queue;
}

export class FrameSchedulerState {
	public lastTickSequence = 0;
	public lastTickBudgetGranted = 0;
	public lastTickCpuBudgetGranted = 0;
	public lastTickCpuUsedCycles = 0;
	public lastTickBudgetRemaining = 0;
	public lastTickVisualFrameCommitted = true;
	public lastTickVdpFrameCost = 0;
	public lastTickVdpFrameHeld = false;
	public lastTickCompleted = false;
	public lastTickConsumedSequence = 0;
	private accumulatedHostTimeMs = 0;
	private readonly tickCompletionQueue = createTickCompletionQueue();
	private tickCompletionReadIndex = 0;
	private tickCompletionWriteIndex = 0;
	private tickCompletionCount = 0;

	constructor(private readonly runtime: Runtime) {
	}

	private accumulateHostTime(deltaMs: number): void {
		const runtime = this.runtime;
		const maxAccumulatedMs = runtime.timing.frameDurationMs * MAX_CATCH_UP_FRAMES;
		this.accumulatedHostTimeMs += deltaMs;
		if (this.accumulatedHostTimeMs > maxAccumulatedMs) {
			this.accumulatedHostTimeMs = maxAccumulatedMs;
		}
	}

	private hasScheduledFrame(): boolean {
		const runtime = this.runtime;
		return this.accumulatedHostTimeMs + FRAME_SLICE_EPSILON_MS >= runtime.timing.frameDurationMs;
	}

	private canRunScheduledUpdate(): boolean {
		const runtime = this.runtime;
		if (!runtime.luaInitialized || runtime.luaRuntimeFailed) {
			return false;
		}
		return (runtime.frameLoop.frameActive && runtime.frameLoop.frameState.cycleBudgetRemaining > 0)
			|| this.hasScheduledFrame();
	}

	private consumeScheduledFrame(): boolean {
		if (!this.hasScheduledFrame()) {
			return false;
		}
		const runtime = this.runtime;
		this.accumulatedHostTimeMs -= runtime.timing.frameDurationMs;
		if (this.accumulatedHostTimeMs < 0) {
			this.accumulatedHostTimeMs = 0;
		}
		return true;
	}

	public clearQueuedTime(): void {
		this.accumulatedHostTimeMs = 0;
	}

	public clearTickCompletionQueue(): void {
		this.tickCompletionReadIndex = 0;
		this.tickCompletionWriteIndex = 0;
		this.tickCompletionCount = 0;
		this.lastTickConsumedSequence = this.lastTickSequence;
	}

	public reset(): void {
		this.clearQueuedTime();
		this.clearTickCompletionQueue();
	}

	public resetTickTelemetry(): void {
		this.lastTickCompleted = false;
		this.lastTickBudgetGranted = 0;
		this.lastTickCpuBudgetGranted = 0;
		this.lastTickCpuUsedCycles = 0;
		this.lastTickBudgetRemaining = 0;
		this.lastTickVisualFrameCommitted = true;
		this.lastTickVdpFrameCost = 0;
		this.lastTickVdpFrameHeld = false;
		this.lastTickSequence = 0;
		this.lastTickConsumedSequence = 0;
	}

	public captureState(): FrameSchedulerStateSnapshot {
		const queuedTickCompletions = new Array<TickCompletion>(this.tickCompletionCount);
		for (let index = 0; index < this.tickCompletionCount; index += 1) {
			const slot = this.tickCompletionQueue[(this.tickCompletionReadIndex + index) % TICK_COMPLETION_QUEUE_CAPACITY]!;
			queuedTickCompletions[index] = {
				sequence: slot.sequence,
				remaining: slot.remaining,
				visualCommitted: slot.visualCommitted,
				vdpFrameCost: slot.vdpFrameCost,
				vdpFrameHeld: slot.vdpFrameHeld,
			};
		}
		return {
			accumulatedHostTimeMs: this.accumulatedHostTimeMs,
			queuedTickCompletions,
			lastTickSequence: this.lastTickSequence,
			lastTickBudgetGranted: this.lastTickBudgetGranted,
			lastTickCpuBudgetGranted: this.lastTickCpuBudgetGranted,
			lastTickCpuUsedCycles: this.lastTickCpuUsedCycles,
			lastTickBudgetRemaining: this.lastTickBudgetRemaining,
			lastTickVisualFrameCommitted: this.lastTickVisualFrameCommitted,
			lastTickVdpFrameCost: this.lastTickVdpFrameCost,
			lastTickVdpFrameHeld: this.lastTickVdpFrameHeld,
			lastTickCompleted: this.lastTickCompleted,
			lastTickConsumedSequence: this.lastTickConsumedSequence,
		};
	}

	public restoreState(state: FrameSchedulerStateSnapshot): void {
		this.accumulatedHostTimeMs = state.accumulatedHostTimeMs;
		this.lastTickSequence = state.lastTickSequence;
		this.lastTickBudgetGranted = state.lastTickBudgetGranted;
		this.lastTickCpuBudgetGranted = state.lastTickCpuBudgetGranted;
		this.lastTickCpuUsedCycles = state.lastTickCpuUsedCycles;
		this.lastTickBudgetRemaining = state.lastTickBudgetRemaining;
		this.lastTickVisualFrameCommitted = state.lastTickVisualFrameCommitted;
		this.lastTickVdpFrameCost = state.lastTickVdpFrameCost;
		this.lastTickVdpFrameHeld = state.lastTickVdpFrameHeld;
		this.lastTickCompleted = state.lastTickCompleted;
		this.lastTickConsumedSequence = state.lastTickConsumedSequence;
		this.tickCompletionReadIndex = 0;
		this.tickCompletionWriteIndex = state.queuedTickCompletions.length % TICK_COMPLETION_QUEUE_CAPACITY;
		this.tickCompletionCount = state.queuedTickCompletions.length;
		for (let index = 0; index < TICK_COMPLETION_QUEUE_CAPACITY; index += 1) {
			const slot = this.tickCompletionQueue[index]!;
			if (index < state.queuedTickCompletions.length) {
				const queued = state.queuedTickCompletions[index]!;
				slot.sequence = queued.sequence;
				slot.remaining = queued.remaining;
				slot.visualCommitted = queued.visualCommitted;
				slot.vdpFrameCost = queued.vdpFrameCost;
				slot.vdpFrameHeld = queued.vdpFrameHeld;
				continue;
			}
			slot.sequence = 0;
			slot.remaining = 0;
			slot.visualCommitted = true;
			slot.vdpFrameCost = 0;
			slot.vdpFrameHeld = false;
		}
	}

	public run(hostDeltaMs: number): void {
		this.accumulateHostTime(hostDeltaMs);
		const runtime = this.runtime;
		while (this.canRunScheduledUpdate()) {
			const progressed = runtime.frameLoop.tickUpdate();
			if (runtime.frameLoop.frameActive && !progressed) {
				break;
			}
		}
	}

	public consumeTickCompletion(out: TickCompletion): boolean {
		if (this.tickCompletionCount <= 0) {
			return false;
		}
		const slot = this.tickCompletionQueue[this.tickCompletionReadIndex]!;
		out.sequence = slot.sequence;
		out.remaining = slot.remaining;
		out.visualCommitted = slot.visualCommitted;
		out.vdpFrameCost = slot.vdpFrameCost;
		out.vdpFrameHeld = slot.vdpFrameHeld;
		this.tickCompletionReadIndex = (this.tickCompletionReadIndex + 1) % TICK_COMPLETION_QUEUE_CAPACITY;
		this.tickCompletionCount -= 1;
		this.lastTickConsumedSequence = out.sequence;
		return true;
	}

	public enqueueTickCompletion(frameState: {
		cycleBudgetRemaining: number;
		cycleBudgetGranted: number;
		cycleCarryGranted: number;
		activeCpuUsedCycles: number;
	}): void {
		if (this.tickCompletionCount >= TICK_COMPLETION_QUEUE_CAPACITY) {
			throw new Error('Runtime fault: tick completion queue overflow.');
		}
		const slot = this.tickCompletionQueue[this.tickCompletionWriteIndex]!;
		const sequence = this.lastTickSequence + 1;
		const remaining = frameState.cycleBudgetRemaining;
		const granted = frameState.cycleBudgetGranted;
		const cpuUsed = frameState.activeCpuUsedCycles;
		const runtime = this.runtime;
		const vdp = runtime.machine.vdp;
		slot.sequence = sequence;
		slot.remaining = remaining;
		slot.visualCommitted = vdp.lastFrameCommitted();
		slot.vdpFrameCost = vdp.lastFrameCost();
		slot.vdpFrameHeld = vdp.lastFrameHeld();
		this.tickCompletionWriteIndex = (this.tickCompletionWriteIndex + 1) % TICK_COMPLETION_QUEUE_CAPACITY;
		this.tickCompletionCount += 1;
		this.lastTickBudgetGranted = granted;
		this.lastTickCpuBudgetGranted = granted;
		this.lastTickCpuUsedCycles = cpuUsed;
		this.lastTickBudgetRemaining = remaining;
		this.lastTickVisualFrameCommitted = slot.visualCommitted;
		this.lastTickVdpFrameCost = slot.vdpFrameCost;
		this.lastTickVdpFrameHeld = slot.vdpFrameHeld;
		this.lastTickCompleted = true;
		this.lastTickSequence = sequence;
	}

	public refillFrameBudget(frameState: BudgetFrameState): boolean {
		if (!this.consumeScheduledFrame()) {
			return false;
		}
		const runtime = this.runtime;
		const budget = runtime.timing.cycleBudgetPerFrame;
		frameState.cycleBudgetRemaining += budget;
		frameState.cycleBudgetGranted += budget;
		return true;
	}

	public startScheduledFrame(): boolean {
		if (!this.consumeScheduledFrame()) {
			return false;
		}
		const runtime = this.runtime;
		this.lastTickCompleted = false;
		runtime.frameLoop.beginFrameState();
		return true;
	}
}
