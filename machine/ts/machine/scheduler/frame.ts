import { Runtime } from '../runtime/runtime';

export type TickCompletion = {
	sequence: number;
	remaining: number;
	visualCommitted: boolean;
};

export type FrameSchedulerStateSnapshot = {
	accumulatedHostTimeMs: number;
	cycleGrantRemainder: number;
	carriedCycleBudget: number;
	tickCompletionPending: boolean;
	tickCompletionVisualCommitted: boolean;
	lastTickSequence: number;
	lastTickBudgetGranted: number;
	lastTickCpuBudgetGranted: number;
	lastTickCpuUsedCycles: number;
	lastTickBudgetRemaining: number;
	lastTickVisualFrameCommitted: boolean;
	lastTickCompleted: boolean;
	lastTickConsumedSequence: number;
};

type BudgetFrameState = {
	cycleBudgetRemaining: number;
	cycleBudgetGranted: number;
};

const MACHINE_SERVICE_QUANTA_PER_SECOND = 60;
const MACHINE_SERVICE_QUANTUM_MS = 1000 / MACHINE_SERVICE_QUANTA_PER_SECOND;
const MAX_CATCH_UP_QUANTA = 5;
const MACHINE_SERVICE_EPSILON_MS = 0.000001;
export class FrameSchedulerState {
	public lastTickSequence = 0;
	public lastTickBudgetGranted = 0;
	public lastTickCpuBudgetGranted = 0;
	public lastTickCpuUsedCycles = 0;
	public lastTickBudgetRemaining = 0;
	public lastTickVisualFrameCommitted = true;
	public lastTickCompleted = false;
	public lastTickConsumedSequence = 0;
	private accumulatedHostTimeMs = 0;
	private cycleGrantRemainder = 0;
	private carriedCycleBudget = 0;
	private tickCompletionPending = false;
	private tickCompletionVisualCommitted = false;
	private backendServiceSuspended = false;

	constructor(private readonly runtime: Runtime) {
	}

	private accumulateHostTime(deltaMs: number): void {
		const maxAccumulatedMs = MACHINE_SERVICE_QUANTUM_MS * MAX_CATCH_UP_QUANTA;
		this.accumulatedHostTimeMs += deltaMs;
		if (this.accumulatedHostTimeMs > maxAccumulatedMs) {
			this.accumulatedHostTimeMs = maxAccumulatedMs;
		}
	}

	private hasScheduledSlice(): boolean {
		return this.accumulatedHostTimeMs + MACHINE_SERVICE_EPSILON_MS >= MACHINE_SERVICE_QUANTUM_MS;
	}

	private canRunScheduledUpdate(): boolean {
		const runtime = this.runtime;
		if (!runtime.luaInitialized
			|| runtime.luaRuntimeFailed
			|| runtime.machine.gxGpu.backendReadbackBlocksMachine()) {
			return false;
		}
		return (runtime.frameLoop.frameActive && runtime.frameLoop.frameState.cycleBudgetRemaining > 0)
			|| this.carriedCycleBudget > 0
			|| this.hasScheduledSlice();
	}

	private takeScheduledCycleBudget(): number {
		if (!this.hasScheduledSlice()) return -1;
		this.accumulatedHostTimeMs -= MACHINE_SERVICE_QUANTUM_MS;
		if (this.accumulatedHostTimeMs < 0) {
			this.accumulatedHostTimeMs = 0;
		}
		const numerator = this.runtime.timing.cpuHz + this.cycleGrantRemainder;
		this.cycleGrantRemainder = numerator % MACHINE_SERVICE_QUANTA_PER_SECOND;
		return (numerator - this.cycleGrantRemainder) / MACHINE_SERVICE_QUANTA_PER_SECOND;
	}

	public clearQueuedTime(): void {
		this.accumulatedHostTimeMs = 0;
		this.carriedCycleBudget = 0;
	}

	public clearPendingTickCompletion(): void {
		this.tickCompletionPending = false;
		this.tickCompletionVisualCommitted = false;
		this.lastTickConsumedSequence = this.lastTickSequence;
	}

	public reset(): void {
		this.clearQueuedTime();
		this.cycleGrantRemainder = 0;
		this.clearPendingTickCompletion();
		this.backendServiceSuspended = false;
	}

	public resetTickTelemetry(): void {
		this.lastTickCompleted = false;
		this.lastTickBudgetGranted = 0;
		this.lastTickCpuBudgetGranted = 0;
		this.lastTickCpuUsedCycles = 0;
		this.lastTickBudgetRemaining = 0;
		this.lastTickVisualFrameCommitted = true;
		this.lastTickSequence = 0;
		this.lastTickConsumedSequence = 0;
	}

	public captureState(): FrameSchedulerStateSnapshot {
		return {
			accumulatedHostTimeMs: this.accumulatedHostTimeMs,
			cycleGrantRemainder: this.cycleGrantRemainder,
			carriedCycleBudget: this.carriedCycleBudget,
			tickCompletionPending: this.tickCompletionPending,
			tickCompletionVisualCommitted: this.tickCompletionVisualCommitted,
			lastTickSequence: this.lastTickSequence,
			lastTickBudgetGranted: this.lastTickBudgetGranted,
			lastTickCpuBudgetGranted: this.lastTickCpuBudgetGranted,
			lastTickCpuUsedCycles: this.lastTickCpuUsedCycles,
			lastTickBudgetRemaining: this.lastTickBudgetRemaining,
			lastTickVisualFrameCommitted: this.lastTickVisualFrameCommitted,
			lastTickCompleted: this.lastTickCompleted,
			lastTickConsumedSequence: this.lastTickConsumedSequence,
		};
	}

	public restoreState(state: FrameSchedulerStateSnapshot): void {
		this.accumulatedHostTimeMs = state.accumulatedHostTimeMs;
		this.cycleGrantRemainder = state.cycleGrantRemainder;
		this.carriedCycleBudget = state.carriedCycleBudget;
		this.lastTickSequence = state.lastTickSequence;
		this.lastTickBudgetGranted = state.lastTickBudgetGranted;
		this.lastTickCpuBudgetGranted = state.lastTickCpuBudgetGranted;
		this.lastTickCpuUsedCycles = state.lastTickCpuUsedCycles;
		this.lastTickBudgetRemaining = state.lastTickBudgetRemaining;
		this.lastTickVisualFrameCommitted = state.lastTickVisualFrameCommitted;
		this.lastTickCompleted = state.lastTickCompleted;
		this.lastTickConsumedSequence = state.lastTickConsumedSequence;
		this.tickCompletionPending = state.tickCompletionPending;
		this.tickCompletionVisualCommitted = state.tickCompletionVisualCommitted;
		this.backendServiceSuspended = false;
	}

	public run(hostDeltaMs: number): void {
		const runtime = this.runtime;
		if (runtime.machine.gxGpu.backendReadbackBlocksMachine()) {
			this.backendServiceSuspended = true;
			return;
		}
		if (this.backendServiceSuspended) {
			// Backend submission/mapping latency is host time, not machine time. Resume
			// the in-flight machine frame without turning that latency into catch-up.
			this.backendServiceSuspended = false;
			hostDeltaMs = 0;
		}
		this.accumulateHostTime(hostDeltaMs);
		while (this.canRunScheduledUpdate()) {
			const progressed = runtime.frameLoop.tickUpdate();
			if (runtime.frameLoop.frameActive && !progressed) {
				break;
			}
		}
		if (runtime.machine.gxGpu.backendReadbackBlocksMachine()) {
			this.backendServiceSuspended = true;
		}
	}

	public consumeTickCompletion(out: TickCompletion): boolean {
		if (!this.tickCompletionPending) return false;
		out.sequence = this.lastTickSequence;
		out.remaining = this.lastTickBudgetRemaining;
		out.visualCommitted = this.tickCompletionVisualCommitted;
		this.tickCompletionPending = false;
		this.tickCompletionVisualCommitted = false;
		this.lastTickConsumedSequence = out.sequence;
		return true;
	}

	public enqueueTickCompletion(frameState: {
		cycleBudgetRemaining: number;
		cycleBudgetGranted: number;
		cycleCarryGranted: number;
		activeCpuUsedCycles: number;
	}): void {
		const sequence = this.lastTickSequence + 1;
		const remaining = frameState.cycleBudgetRemaining;
		const granted = frameState.cycleBudgetGranted;
		const cpuUsed = frameState.activeCpuUsedCycles;
		const runtime = this.runtime;
		const visualCommitted = runtime.machine.gxGpu.lastFrameCommitted();
		this.tickCompletionVisualCommitted = this.tickCompletionPending
			? this.tickCompletionVisualCommitted || visualCommitted
			: visualCommitted;
		this.tickCompletionPending = true;
		this.lastTickBudgetGranted = granted;
		this.lastTickCpuBudgetGranted = granted;
		this.lastTickCpuUsedCycles = cpuUsed;
		this.lastTickBudgetRemaining = remaining;
		this.lastTickVisualFrameCommitted = visualCommitted;
		this.lastTickCompleted = true;
		this.lastTickSequence = sequence;
		this.carriedCycleBudget = remaining;
	}

	public refillFrameBudget(frameState: BudgetFrameState): boolean {
		const budget = this.takeScheduledCycleBudget();
		if (budget < 0) return false;
		frameState.cycleBudgetRemaining += budget;
		frameState.cycleBudgetGranted += budget;
		return true;
	}

	public startScheduledFrame(): boolean {
		let budget = this.carriedCycleBudget;
		const carry = budget;
		if (budget === 0) {
			budget = this.takeScheduledCycleBudget();
			if (budget < 0) return false;
		}
		this.carriedCycleBudget = 0;
		const runtime = this.runtime;
		this.lastTickCompleted = false;
		runtime.frameLoop.beginFrameState(budget, carry);
		return true;
	}
}
