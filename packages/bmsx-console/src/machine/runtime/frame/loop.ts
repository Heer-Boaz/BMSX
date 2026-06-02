import { FrameState, Runtime } from '../runtime';

export class FrameLoopState {
	public currentTimeMs = 0;
	public frameDeltaMs = 0;
	public readonly frameState: FrameState = {
		haltGame: false,
		updateExecuted: false,
		luaFaulted: false,
		cycleBudgetRemaining: 0,
		cycleBudgetGranted: 0,
		cycleCarryGranted: 0,
		activeCpuUsedCycles: 0,
	};
	public frameActive = false;

	constructor(private readonly runtime: Runtime) {
	}

	public reset(): void {
		this.currentTimeMs = 0;
		this.frameDeltaMs = 0;
	}

	public resetFrameState(): void {
		const runtime = this.runtime;
		this.abandonFrameState();
		const state = this.frameState;
		state.haltGame = false;
		state.updateExecuted = false;
		state.luaFaulted = false;
		state.cycleBudgetRemaining = 0;
		state.cycleBudgetGranted = 0;
		state.cycleCarryGranted = 0;
		state.activeCpuUsedCycles = 0;
		runtime.machine.cpu.clearHaltUntilIrq();
		runtime.frameScheduler.reset();
		this.reset();
		runtime.screen.reset();
		runtime.frameScheduler.resetTickTelemetry();
	}

	public beginFrameState(): FrameState {
		if (this.frameActive) {
			throw new Error('attempted to begin a new frame while another frame is active.');
		}
		const runtime = this.runtime;
		this.frameDeltaMs = runtime.timing.frameDurationMs;
		const budget = runtime.timing.cycleBudgetPerFrame;
		const state = this.frameState;
		state.haltGame = runtime.debuggerPaused;
		state.updateExecuted = false;
		state.luaFaulted = runtime.luaRuntimeFailed;
		state.cycleBudgetRemaining = budget;
		state.cycleBudgetGranted = budget;
		state.cycleCarryGranted = 0;
		state.activeCpuUsedCycles = 0;
		runtime.machine.vdp.beginFrame();
		runtime.vblank.beginTick();
		this.frameActive = true;
		return state;
	}

	public tickUpdate(): boolean {
		const runtime = this.runtime;
		if (!runtime.tickEnabled) {
			return false;
		}
		if (runtime.cartBoot.processPending()) {
			return true;
		}
		if (runtime.executionOverlayActive) {
			if (this.frameActive) {
				this.abandonFrameState();
				return true;
			}
			return false;
		}
		const previousFrameActive = this.frameActive;
		const previousRemaining = previousFrameActive ? this.frameState.cycleBudgetRemaining : -1;
		const frameScheduler = runtime.frameScheduler;
		const previousPendingEntry = runtime.pendingCall === 'entry';
		const previousSequence = frameScheduler.lastTickSequence;
		if (!this.frameActive) {
			if (!frameScheduler.startScheduledFrame()) {
				return false;
			}
		} else if (this.frameState.cycleBudgetRemaining <= 0) {
			if (!frameScheduler.refillFrameBudget(this.frameState)) {
				return false;
			}
		}
		const haltedUntilIrq = this.runActiveFrameState();
		if (haltedUntilIrq) {
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

	public abandonFrameState(): void {
		this.frameActive = false;
		const runtime = this.runtime;
		runtime.vblank.abandonTick();
	}

	private runActiveFrameState(): boolean {
		const runtime = this.runtime;
		const state = this.frameState;
		if (runtime.pendingCall === 'entry') {
			const haltedUntilIrq = this.runUpdatePhase();
			state.updateExecuted = runtime.pendingCall !== 'entry';
			this.finalizeUpdateSlice();
			return haltedUntilIrq;
		}
		this.finalizeUpdateSlice();
		return false;
	}

	private finalizeUpdateSlice(): void {
		const runtime = this.runtime;
		if (runtime.pendingCall === 'entry' && !runtime.vblank.tickCompleted) {
			return;
		}
		this.abandonFrameState();
	}

	private runUpdatePhase(): boolean {
		const runtime = this.runtime;
		const state = this.frameState;
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
			cpu.clearHaltUntilIrq();
			runtime.pendingCall = null;
			throw error;
		}
	}
}
