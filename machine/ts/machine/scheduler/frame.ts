import { Runtime } from '../runtime/runtime';
import { InstructionStepResult } from '../runtime/frame/state';
import { HistoryMode } from '../runtime/history/history';

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
	logicalTickRunPending: boolean;
	logicalTickRunTargetSequence: number;
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

const MAX_CATCH_UP_MS = 1000 / 12;
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
	private logicalTickRunPending = false;
	private logicalTickRunTargetSequence = 0;

	constructor(private readonly runtime: Runtime) {
	}

	private accumulateHostTime(deltaMs: number): void {
		this.accumulatedHostTimeMs += deltaMs;
		if (this.accumulatedHostTimeMs > MAX_CATCH_UP_MS) {
			this.accumulatedHostTimeMs = MAX_CATCH_UP_MS;
		}
	}

	private canRunScheduledUpdate(): boolean {
		const runtime = this.runtime;
		if (runtime.history.executionPaused) return false;
		if (runtime.machine.gxGpu.backendServiceBlocksMachine()) {
			return false;
		}
		return (runtime.frameLoop.frameActive && runtime.frameLoop.frameState.cycleBudgetRemaining > 0)
			|| this.carriedCycleBudget > 0
			|| this.accumulatedHostTimeMs > 0;
	}

	private takeScheduledCycleBudget(): number {
		if (this.accumulatedHostTimeMs <= 0) return -1;
		const exactBudget = this.accumulatedHostTimeMs * this.runtime.timing.cpuCyclesPerMillisecond
			+ this.cycleGrantRemainder;
		const budget = Math.trunc(exactBudget);
		this.cycleGrantRemainder = exactBudget - budget;
		this.accumulatedHostTimeMs = 0;
		return budget;
	}

	private beginScheduledExecution(hostDeltaMs: number): boolean {
		const runtime = this.runtime;
		if (runtime.history.executionPaused) return false;
		if (runtime.machine.gxGpu.backendServiceBlocksMachine()) {
			this.backendServiceSuspended = true;
			return false;
		}
		if (this.backendServiceSuspended) {
			// Backend submission/mapping latency is host time, not machine time.
			this.backendServiceSuspended = false;
			hostDeltaMs = 0;
		}
		this.accumulateHostTime(hostDeltaMs);
		return true;
	}

	private endScheduledExecution(): void {
		if (this.runtime.machine.gxGpu.backendServiceBlocksMachine()) {
			this.backendServiceSuspended = true;
		}
	}

	private beginScheduledFrame(budget: number, carry: number): void {
		this.carriedCycleBudget = 0;
		this.lastTickCompleted = false;
		this.runtime.frameLoop.beginFrameState(budget, carry);
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
		this.logicalTickRunPending = false;
		this.logicalTickRunTargetSequence = 0;
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
			logicalTickRunPending: this.logicalTickRunPending,
			logicalTickRunTargetSequence: this.logicalTickRunTargetSequence,
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
		this.logicalTickRunPending = state.logicalTickRunPending;
		this.logicalTickRunTargetSequence = state.logicalTickRunTargetSequence;
		this.backendServiceSuspended = false;
	}

	public run(hostDeltaMs: number): void {
		if (this.runtime.history.mode === HistoryMode.Replaying) return;
		const runtime = this.runtime;
		if (!this.beginScheduledExecution(hostDeltaMs)) {
			return;
		}
		while (this.canRunScheduledUpdate()) {
			const progressed = runtime.frameLoop.tickUpdate();
			if (runtime.frameLoop.frameActive && !progressed) {
				break;
			}
		}
		this.endScheduledExecution();
	}

	public runToNextLogicalTick(cycleGrant: number = this.runtime.timing.cycleBudgetPerFrame): boolean {
		const runtime = this.runtime;
		const tickBudget = cycleGrant;
		if (tickBudget === 0 || !this.beginScheduledExecution(0)) {
			return false;
		}
		if (!this.logicalTickRunPending) {
			this.logicalTickRunPending = true;
			this.logicalTickRunTargetSequence = this.lastTickSequence + 1;
			if (runtime.frameLoop.frameActive) {
				const frameState = runtime.frameLoop.frameState;
				frameState.cycleBudgetRemaining += tickBudget;
				frameState.cycleBudgetGranted += tickBudget;
			} else {
				const carry = this.carriedCycleBudget;
				this.beginScheduledFrame(carry + tickBudget, carry);
			}
		} else if (runtime.frameLoop.frameActive) {
			const frameState = runtime.frameLoop.frameState;
			if (frameState.cycleBudgetRemaining <= 0) {
				frameState.cycleBudgetRemaining += tickBudget;
				frameState.cycleBudgetGranted += tickBudget;
			}
		} else {
			const carry = this.carriedCycleBudget;
			this.beginScheduledFrame(carry + tickBudget, carry);
		}
		const targetSequence = this.logicalTickRunTargetSequence;
		while (this.lastTickSequence !== targetSequence && this.canRunScheduledUpdate()) {
			const progressed = runtime.frameLoop.tickUpdate();
			if (runtime.frameLoop.frameActive && !progressed) {
				break;
			}
		}
		this.endScheduledExecution();
		if (this.lastTickSequence !== targetSequence) {
			return false;
		}
		this.logicalTickRunPending = false;
		this.logicalTickRunTargetSequence = 0;
		return true;
	}

	public runScheduledToNextLogicalTick(hostDeltaMs: number): boolean {
		const runtime = this.runtime;
		const targetSequence = this.lastTickSequence + 1;
		if (!this.beginScheduledExecution(hostDeltaMs)) {
			return false;
		}
		while (this.lastTickSequence !== targetSequence && this.canRunScheduledUpdate()) {
			const progressed = runtime.frameLoop.tickUpdate();
			if (runtime.frameLoop.frameActive && !progressed) {
				break;
			}
		}
		this.endScheduledExecution();
		return this.lastTickSequence === targetSequence;
	}

	public stepInstruction(hostDeltaMs: number): InstructionStepResult {
		if (this.runtime.history.mode === HistoryMode.Replaying) return InstructionStepResult.Blocked;
		if (!this.beginScheduledExecution(hostDeltaMs)) {
			return InstructionStepResult.Blocked;
		}
		const result = this.canRunScheduledUpdate()
			? this.runtime.frameLoop.tickInstruction()
			: InstructionStepResult.Blocked;
		this.endScheduledExecution();
		return result;
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
		if (budget <= 0) return false;
		frameState.cycleBudgetRemaining += budget;
		frameState.cycleBudgetGranted += budget;
		return true;
	}

	public startScheduledFrame(): boolean {
		const carry = this.carriedCycleBudget;
		let budget = carry;
		if (budget === 0) {
			budget = this.takeScheduledCycleBudget();
			if (budget <= 0) return false;
		}
		this.beginScheduledFrame(budget, carry);
		return true;
	}
}
