import type { FrameState, Runtime } from '../runtime';
import * as workbenchMode from '../../../ide/runtime/workbench_mode';
import { flushRuntimeAssetEdits } from '../../../runtime/assets/edits';
import { clearBackQueues } from '../../../render/shared/queues';
import { RunResult } from '../../cpu/cpu';
import { runtimeFault } from '../../../ide/runtime/lua_pipeline';

export class FrameLoopState {
	public currentTimeMs = 0;
	public frameDeltaMs = 0;
	public currentFrameState: FrameState = null;
	public drawFrameState: FrameState = null;

	public reset(): void {
		this.currentTimeMs = 0;
		this.frameDeltaMs = 0;
	}

	public beginFrameState(runtime: Runtime): FrameState {
		if (this.currentFrameState) {
			throw runtimeFault('attempted to begin a new frame while another frame is active.');
		}
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

	public tickUpdate(runtime: Runtime): boolean {
		if (!runtime.tickEnabled) {
			return false;
		}
		runtime.cartBoot.processPending(runtime);
		if (workbenchMode.isOverlayActive(runtime)) {
			if (this.currentFrameState !== null) {
				this.abandonFrameState(runtime);
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
			if (!frameScheduler.startScheduledFrame(runtime)) {
				return false;
			}
		} else if (this.currentFrameState.cycleBudgetRemaining <= 0) {
			if (!frameScheduler.refillFrameBudget(runtime, this.currentFrameState)) {
				return false;
			}
		}
		this.runActiveFrameState(runtime, this.currentFrameState);
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

	public abandonFrameState(runtime: Runtime): void {
		this.currentFrameState = null;
		runtime.vblank.abandonTick();
	}

	private runActiveFrameState(runtime: Runtime, state: FrameState): void {
		try {
			if (runtime.pendingCall === 'entry') {
				this.runUpdatePhase(runtime, state);
				flushRuntimeAssetEdits(runtime.machine.memory);
				state.updateExecuted = runtime.pendingCall !== 'entry';
			}
			this.finalizeUpdateSlice(runtime, state);
		} catch (error) {
			try {
				workbenchMode.handleLuaError(runtime, error);
			} finally {
				if (this.currentFrameState !== null) {
					this.abandonFrameState(runtime);
				}
			}
		}
	}

	private finalizeUpdateSlice(runtime: Runtime, frameState: FrameState): void {
		this.currentFrameState = frameState;
		if (runtime.vblank.tickCompleted || runtime.pendingCall !== 'entry') {
			this.abandonFrameState(runtime);
		}
	}

	private runUpdatePhase(runtime: Runtime, state: FrameState): void {
		const cpu = runtime.machine.cpu;
		const vblank = runtime.vblank;
		if (!runtime.cartEntryAvailable) {
			return;
		}
		if (!runtime.luaGate.ready) {
			return;
		}
		if (state.luaFaulted || runtime.luaRuntimeFailed) {
			state.luaFaulted = true;
			return;
		}
		if (state.haltGame) {
			return;
		}
		try {
			while (true) {
				if (cpu.isHaltedUntilIrq() && vblank.runHaltedUntilIrq(runtime, state)) {
					return;
				}
				if (vblank.consumeBackQueueClearAfterIrqWake()) {
					clearBackQueues();
				}
				if (runtime.pendingCall !== 'entry') {
					return;
				}
				const result = runtime.cpuExecution.runWithBudget(runtime, state);
				if (cpu.isHaltedUntilIrq()) {
					if (vblank.runHaltedUntilIrq(runtime, state)) {
						return;
					}
					continue;
				}
				if (result === RunResult.Halted) {
					runtime.pendingCall = null;
				}
				return;
			}
		} catch (error) {
			state.luaFaulted = true;
			runtime.vblank.clearHaltUntilIrq(runtime);
			runtime.pendingCall = null;
			workbenchMode.handleLuaError(runtime, error);
		}
	}
}
