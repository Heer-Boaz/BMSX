import { $ } from '../../core/engine';
import type { FrameState, Runtime } from './runtime';
import * as workbenchMode from '../../ide/runtime/workbench_mode';
import { clearBackQueues } from '../../render/shared/queues';
import { clearHardwareLighting } from '../../render/shared/hardware_lighting';
import { RunResult } from '../cpu/cpu';
import { runtimeFault } from '../../ide/runtime/lua_pipeline';

const MAX_FRAME_DELTA = 250;

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
		clearHardwareLighting();
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
		const previousTickSequence = runtime.frameScheduler.lastTickSequence;
		const previous = {
			pendingCall: runtime.pendingCall,
			frameState: previousState,
		};
		if (this.currentFrameState === null) {
			if (!runtime.frameScheduler.startScheduledFrame(runtime)) {
				return false;
			}
		} else if (previousState !== null && previousState.cycleBudgetRemaining <= 0) {
			if (!runtime.frameScheduler.refillFrameBudget(runtime, this.currentFrameState)) {
				return false;
			}
		}
		this.runActiveFrameState(runtime, this.currentFrameState);
		const nextState = this.currentFrameState;
		if (nextState !== previousState) {
			return true;
		}
		if (nextState !== null && nextState.cycleBudgetRemaining !== (previous.frameState?.cycleBudgetRemaining ?? -1)) {
			return true;
		}
		if (runtime.pendingCall !== previous.pendingCall) {
			return true;
		}
		return runtime.frameScheduler.lastTickSequence !== previousTickSequence;
	}

	public abandonFrameState(runtime: Runtime): void {
		this.currentFrameState = null;
		runtime.vblank.abandonTick();
	}

	public runHostFrame(runtime: Runtime, currentTime: number, runReady: boolean): void {
		if (!$.running) {
			return;
		}
		let hostDeltaMs = 0;
		try {
			$.input.pollInput();
			runtime.screen.beginHostFrame(currentTime);
			workbenchMode.tickIdeInput(runtime);
			workbenchMode.tickTerminalInput(runtime);
			hostDeltaMs = Math.min(currentTime - this.currentTimeMs, MAX_FRAME_DELTA);
			this.currentTimeMs = currentTime;

			if ($.paused) {
				runtime.screen.presentPausedFrame(runtime, hostDeltaMs);
			} else {
				runtime.screen.clearPresentation();
				if (runtime.executionOverlayActive) {
					runtime.screen.runOverlay(runtime);
				} else if (runReady) {
					$.deltatime = runtime.timing.frameDurationMs;
					runtime.screen.syncAfterRuntimeUpdate(runtime, runtime.frameScheduler.run(runtime, hostDeltaMs));
				} else {
					runtime.frameScheduler.clearQueuedTime();
				}
				runtime.screen.presentPending(runtime, hostDeltaMs);
			}
		} catch (error) {
			try {
				workbenchMode.handleLuaError(runtime, error);
				this.abandonFrameState(runtime);
				runtime.screen.presentErrorOverlay(runtime, hostDeltaMs);
			} catch {
				console.error(`Error while handling surfaced game error in runtime: ${error}`);
				this.abandonFrameState(runtime);
			}
		}
		runtime.screen.flushDebugReport(currentTime, runtime);
	}

	private runActiveFrameState(runtime: Runtime, state: FrameState): void {
		try {
			if (runtime.pendingCall === 'entry') {
				this.runUpdatePhase(runtime, state);
				runtime.machine.vdp.flushAssetEdits();
				state.updateExecuted = runtime.pendingCall !== 'entry';
			}
			this.finalizeUpdateSlice(runtime, state);
		} catch (error) {
			runtime.pendingCall = null;
			runtime.vblank.clearHaltUntilIrq(runtime);
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
			while (runtime.pendingCall === 'entry') {
				if (this.runHaltedUntilIrq(runtime, state)) {
					return;
				}
				if (runtime.vblank.consumeBackQueueClearAfterIrqWake()) {
					clearBackQueues();
				}
				if (runtime.cpuExecution.runWithBudget(runtime, state, state.cycleBudgetRemaining) === RunResult.Halted) {
					return;
				}
				if (runtime.machine.cpu.isHaltedUntilIrq()) {
					if (this.runHaltedUntilIrq(runtime, state)) {
						return;
					}
					continue;
				}
				return;
			}
		} catch (error) {
			state.luaFaulted = true;
			runtime.vblank.clearHaltUntilIrq(runtime);
			throw error;
		}
	}

	private runHaltedUntilIrq(runtime: Runtime, state: FrameState): boolean {
		if (!runtime.machine.cpu.isHaltedUntilIrq()) {
			return false;
		}
		return runtime.vblank.runHaltedUntilIrq(runtime, state);
	}
}
