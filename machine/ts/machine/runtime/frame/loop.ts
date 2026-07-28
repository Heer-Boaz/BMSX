import {
	InstructionStepResult,
	type FrameState,
} from './state';
import { Runtime } from '../runtime';
import { RunResult } from '../../cpu/cpu';

export type FrameLoopStateSnapshot = {
	frameState: FrameState;
	frameActive: boolean;
	frameDeltaMs: number;
};

export class FrameLoopState {
	public currentTimeMs = 0;
	public frameDeltaMs = 0;
	public readonly frameState: FrameState = {
		updateExecuted: false,
		cycleBudgetRemaining: 0,
		cycleBudgetGranted: 0,
		cycleCarryGranted: 0,
		activeCpuUsedCycles: 0,
	};
	public frameActive = false;

	/** The in-flight frame state while a frame is active, or null when idle. */
	public get currentFrameState(): FrameState | null {
		return this.frameActive ? this.frameState : null;
	}

	constructor(private readonly runtime: Runtime) {
	}

	public reset(): void {
		this.currentTimeMs = 0;
		this.frameDeltaMs = 0;
		this.frameActive = false;
		const state = this.frameState;
		state.updateExecuted = false;
		state.cycleBudgetRemaining = 0;
		state.cycleBudgetGranted = 0;
		state.cycleCarryGranted = 0;
		state.activeCpuUsedCycles = 0;
	}

	public captureState(): FrameLoopStateSnapshot {
		return {
			frameState: { ...this.frameState },
			frameActive: this.frameActive,
			frameDeltaMs: this.frameDeltaMs,
		};
	}

	public restoreState(snapshot: FrameLoopStateSnapshot): void {
		this.reset();
		const state = this.frameState;
		state.updateExecuted = snapshot.frameState.updateExecuted;
		state.cycleBudgetRemaining = snapshot.frameState.cycleBudgetRemaining;
		state.cycleBudgetGranted = snapshot.frameState.cycleBudgetGranted;
		state.cycleCarryGranted = snapshot.frameState.cycleCarryGranted;
		state.activeCpuUsedCycles = snapshot.frameState.activeCpuUsedCycles;
		this.frameActive = snapshot.frameActive;
		this.frameDeltaMs = snapshot.frameDeltaMs;
	}

	public resetFrameState(): void {
		const runtime = this.runtime;
		this.abandonFrameState();
		runtime.machine.cpu.clearHaltUntilIrq();
		runtime.frameScheduler.reset();
		this.reset();
		runtime.frameScheduler.resetTickTelemetry();
	}

	public beginFrameState(budget: number, carry: number): FrameState {
		const runtime = this.runtime;
		this.frameDeltaMs = runtime.timing.frameDurationMs;
		const state = this.frameState;
		state.updateExecuted = false;
		state.cycleBudgetRemaining = budget;
		state.cycleBudgetGranted = budget;
		state.cycleCarryGranted = carry;
		state.activeCpuUsedCycles = 0;
		runtime.vblank.beginTick();
		this.frameActive = true;
		return state;
	}

	public tickUpdate(): boolean {
		const runtime = this.runtime;
		if (this.consumeSystemReset()) {
			return true;
		}
		const previousFrameActive = this.frameActive;
		const previousRemaining = previousFrameActive ? this.frameState.cycleBudgetRemaining : -1;
		const frameScheduler = runtime.frameScheduler;
		const previousPendingEntry = runtime.pendingCall === 'entry';
		const previousSequence = frameScheduler.lastTickSequence;
		if (!this.prepareScheduledFrame()) {
			return false;
		}
		this.runActiveFrameState();
		if (this.frameActive
			&& (runtime.machine.cpu.isHaltedUntilIrq() || runtime.machine.systemController.cpuHeld())
			&& runtime.machine.scheduler.nextDeadline() === Number.MAX_SAFE_INTEGER) {
			// Cart parked waiting for an interrupt that nothing has scheduled: report
			// no progress so the scheduler yields the host slice instead of spinning.
			return false;
		}
		const nextFrameActive = this.frameActive;
		if (nextFrameActive !== previousFrameActive) {
			return true;
		}
		if (nextFrameActive && this.frameState.cycleBudgetRemaining !== previousRemaining) {
			return true;
		}
		const nextPendingCall = runtime.pendingCall;
		if ((nextPendingCall === 'entry') !== previousPendingEntry) {
			return true;
		}
		const nextSequence = frameScheduler.lastTickSequence;
		return nextSequence !== previousSequence;
	}

	public tickInstruction(): InstructionStepResult {
		const runtime = this.runtime;
		if (this.consumeSystemReset()) {
			return InstructionStepResult.Advanced;
		}
		const previousFrameActive = this.frameActive;
		const previousRemaining = previousFrameActive ? this.frameState.cycleBudgetRemaining : -1;
		const previousPendingEntry = runtime.pendingCall === 'entry';
		const previousSequence = runtime.frameScheduler.lastTickSequence;
		if (!this.prepareScheduledFrame()) {
			return InstructionStepResult.Blocked;
		}
		const result = this.runActiveFrameInstruction();
		if (result === InstructionStepResult.Executed) {
			return result;
		}
		if (this.frameActive !== previousFrameActive
			|| (this.frameActive && this.frameState.cycleBudgetRemaining !== previousRemaining)
			|| ((runtime.pendingCall === 'entry') !== previousPendingEntry)
			|| runtime.frameScheduler.lastTickSequence !== previousSequence) {
			return InstructionStepResult.Advanced;
		}
		return result;
	}

	public abandonFrameState(): void {
		this.frameActive = false;
		const runtime = this.runtime;
		runtime.vblank.abandonTick();
	}

	private consumeSystemReset(): boolean {
		const runtime = this.runtime;
		if (!runtime.machine.systemController.takeResetRequest()) {
			return false;
		}
		runtime.rebootSystem();
		return true;
	}

	private prepareScheduledFrame(): boolean {
		if (!this.frameActive) {
			return this.runtime.frameScheduler.startScheduledFrame();
		}
		if (this.frameState.cycleBudgetRemaining <= 0) {
			return this.runtime.frameScheduler.refillFrameBudget(this.frameState);
		}
		return true;
	}

	private runActiveFrameState(): void {
		const runtime = this.runtime;
		const state = this.frameState;
		if (runtime.pendingCall === 'entry') {
			this.runUpdatePhase();
			state.updateExecuted = runtime.pendingCall !== 'entry';
			this.finalizeUpdateSlice();
			return;
		}
		this.finalizeUpdateSlice();
	}

	private runActiveFrameInstruction(): InstructionStepResult {
		const runtime = this.runtime;
		if (runtime.pendingCall !== 'entry') {
			this.finalizeUpdateSlice();
			return InstructionStepResult.Advanced;
		}
		const result = this.runUpdateInstruction();
		this.frameState.updateExecuted = runtime.pendingCall !== 'entry';
		this.finalizeUpdateSlice();
		return result;
	}

	private finalizeUpdateSlice(): void {
		const runtime = this.runtime;
		if (runtime.pendingCall === 'entry' && !runtime.vblank.tickCompleted) {
			return;
		}
		this.abandonFrameState();
	}

	private runUpdatePhase(): void {
		const runtime = this.runtime;
		const state = this.frameState;
		const cpu = runtime.machine.cpu;
		const cpuExecution = runtime.cpuExecution;
		while (true) {
			if (cpu.isHaltedUntilIrq() || runtime.machine.systemController.cpuHeld()) {
				const tickCompleted = cpuExecution.runStoppedCpu(state);
				if (tickCompleted || cpu.isHaltedUntilIrq() || runtime.machine.systemController.cpuHeld()) {
					return;
				}
				continue;
			}
			if (runtime.pendingCall !== 'entry') {
				return;
			}
			const result = runtime.cpuExecution.runWithBudget(state);
			if (this.consumeSystemReset()) {
				return;
			}
			if (result === RunResult.Halted && cpu.getFrameDepth() === 0) {
				runtime.pendingCall = null;
				runtime.frameScheduler.clearQueuedTime();
				this.abandonFrameState();
				return;
			}
			if (cpu.isHaltedUntilIrq()) {
				return;
			}
			return;
		}
	}

	private runUpdateInstruction(): InstructionStepResult {
		const runtime = this.runtime;
		const state = this.frameState;
		const cpu = runtime.machine.cpu;
		if (cpu.isHaltedUntilIrq() || runtime.machine.systemController.cpuHeld()) {
			const previousRemaining = state.cycleBudgetRemaining;
			const tickCompleted = runtime.cpuExecution.runStoppedCpu(state);
			if (tickCompleted || cpu.isHaltedUntilIrq() || runtime.machine.systemController.cpuHeld()) {
				return tickCompleted || state.cycleBudgetRemaining !== previousRemaining
					? InstructionStepResult.Advanced
					: InstructionStepResult.Blocked;
			}
		}
		if (runtime.pendingCall !== 'entry') {
			return InstructionStepResult.Blocked;
		}
		const result = runtime.cpuExecution.runInstruction(state);
		if (cpu.getFrameDepth() === 0) {
			runtime.pendingCall = null;
			runtime.frameScheduler.clearQueuedTime();
			this.abandonFrameState();
		}
		return result;
	}
}
