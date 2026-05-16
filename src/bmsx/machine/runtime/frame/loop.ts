import { FrameState, Runtime } from '../runtime';

export class FrameLoopState {
	public currentTimeMs = 0;
	public frameDeltaMs = 0;
	public currentFrameState: FrameState = null;
	public drawFrameState: FrameState = null;

	constructor(private readonly runtime: Runtime) {
	}

	public reset(): void {
		this.currentTimeMs = 0;
		this.frameDeltaMs = 0;
	}

	public beginFrameState(): FrameState {
		if (this.currentFrameState) {
			throw new Error('attempted to begin a new frame while another frame is active.');
		}
		const runtime = this.runtime;
		this.frameDeltaMs = runtime.timing.frameDurationMs;
		const budget = runtime.timing.cycleBudgetPerFrame;
		const state: FrameState = {
			haltGame: runtime.debuggerPaused,
			updateExecuted: false,
			luaFaulted: runtime.luaRuntimeFailed,
			cycleBudgetRemaining: budget,
			cycleBudgetGranted: budget,
			cycleCarryGranted: 0,
			activeCpuUsedCycles: 0,
		};
		runtime.machine.vdp.beginFrame();
		runtime.vblank.beginTick();
		this.currentFrameState = state;
		return state;
	}

	public tickUpdate(): boolean {
		const runtime = this.runtime;
		if (!runtime.tickEnabled) {
			return false;
		}
		runtime.cartBoot.processPending();
		if (runtime.executionOverlayActive) {
			if (this.currentFrameState !== null) {
				this.abandonFrameState();
				return true;
			}
			return false;
		}
		const previousState = this.currentFrameState;
		const previousRemaining = previousState?.cycleBudgetRemaining ?? -1;
		const frameScheduler = runtime.frameScheduler;
		const previousPendingEntry = runtime.pendingCall === 'entry';
		const previousSequence = frameScheduler.lastTickSequence;
		if (this.currentFrameState === null) {
			if (!frameScheduler.startScheduledFrame()) {
				return false;
			}
		} else if (this.currentFrameState.cycleBudgetRemaining <= 0) {
			if (!frameScheduler.refillFrameBudget(this.currentFrameState)) {
				return false;
			}
		}
		const haltedUntilIrq = this.runActiveFrameState(this.currentFrameState);
		if (haltedUntilIrq) {
			return false;
		}
		const nextState = this.currentFrameState;
		if (nextState !== previousState) {
			return true;
		}
		if (nextState !== null && nextState.cycleBudgetRemaining !== previousRemaining) {
			return true;
		}
		const nextPendingCall = runtime.pendingCall;
		if ((nextPendingCall === 'entry') !== previousPendingEntry) {
			return true;
		}
		const nextSequence = frameScheduler.lastTickSequence;
		return nextSequence !== previousSequence;
	}

	public abandonFrameState(): void {
		this.currentFrameState = null;
		const runtime = this.runtime;
		runtime.vblank.abandonTick();
	}

	private runActiveFrameState(state: FrameState): boolean {
		const runtime = this.runtime;
		if (runtime.pendingCall === 'entry') {
			const haltedUntilIrq = this.runUpdatePhase(state);
			state.updateExecuted = runtime.pendingCall !== 'entry';
			this.finalizeUpdateSlice(state);
			return haltedUntilIrq;
		}
		this.finalizeUpdateSlice(state);
		return false;
	}

	private finalizeUpdateSlice(frameState: FrameState): void {
		const runtime = this.runtime;
		this.currentFrameState = frameState;
		if (runtime.vblank.tickCompleted || runtime.pendingCall !== 'entry') {
			this.abandonFrameState();
		}
	}

	private runUpdatePhase(state: FrameState): boolean {
		const runtime = this.runtime;
		const cpu = runtime.machine.cpu;
		const cpuExecution = runtime.cpuExecution;
		if (!runtime.cartEntryAvailable) {
			return false;
		}
		if (!runtime.luaGate.ready) {
			return false;
		}
		if (state.luaFaulted || runtime.luaRuntimeFailed) {
			state.luaFaulted = true;
			return false;
		}
		if (state.haltGame) {
			return false;
		}
		try {
			while (true) {
				if (cpu.isHaltedUntilIrq()) {
					const tickCompleted = cpuExecution.runHaltedUntilIrq(state);
					if (tickCompleted || cpu.isHaltedUntilIrq()) {
						return true;
					}
					continue;
				}
				if (runtime.pendingCall !== 'entry') {
					return false;
				}
				runtime.cpuExecution.runWithBudget(state);
				if (cpu.isHaltedUntilIrq()) {
					return true;
				}
				return false;
			}
		} catch (error) {
			state.luaFaulted = true;
			runtime.machine.cpu.clearHaltUntilIrq();
			runtime.pendingCall = null;
			throw error;
		}
	}
}
