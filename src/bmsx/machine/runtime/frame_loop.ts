import { $ } from '../../core/engine_core';
import type { FrameState, Runtime } from './runtime';
import * as runtimeIde from '../../ide/runtime/runtime_ide';
import { clearBackQueues } from '../../render/shared/render_queues';
import { clearHardwareLighting } from '../../render/shared/hardware_lighting';
import { RunResult } from '../cpu/cpu';
import { runtimeFault } from '../../ide/runtime/runtime_lua_pipeline';

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
		if (runtimeIde.isOverlayActive(runtime)) {
			if (this.currentFrameState !== null) {
				this.abandonFrameState(runtime);
				return true;
			}
			return false;
		}
		const previousState = this.currentFrameState;
		const previousRemaining = previousState?.cycleBudgetRemaining ?? -1;
		const previousPending = runtime.pendingCall === 'entry';
		const previousSequence = runtime.frameScheduler.lastTickSequence;
		if (this.currentFrameState === null) {
			if (!runtime.frameScheduler.startScheduledFrame(runtime)) {
				return false;
			}
		} else if (this.currentFrameState.cycleBudgetRemaining <= 0) {
			if (!runtime.frameScheduler.refillFrameBudget(runtime, this.currentFrameState)) {
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
		if ((runtime.pendingCall === 'entry') !== previousPending) {
			return true;
		}
		return runtime.frameScheduler.lastTickSequence !== previousSequence;
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
			runtimeIde.tickIdeInput(runtime);
			runtimeIde.tickTerminalInput(runtime);
			hostDeltaMs = Math.min(currentTime - this.currentTimeMs, MAX_FRAME_DELTA);
			this.currentTimeMs = currentTime;

			if ($.paused) {
				runtime.screen.presentPausedFrame(runtime, hostDeltaMs);
			} else {
				runtime.screen.clearPresentation();
				if (!runReady) {
					if (runtime.executionOverlayActive) {
						runtime.screen.runOverlay(runtime);
					} else {
						runtime.frameScheduler.clearQueuedTime();
					}
				} else if (runtime.executionOverlayActive) {
					runtime.screen.runOverlay(runtime);
				} else {
					const previousTickSequence = runtime.frameScheduler.lastTickSequence;
					$.deltatime = runtime.timing.frameDurationMs;
					runtime.frameScheduler.run(runtime, hostDeltaMs);
					runtime.screen.syncAfterRuntimeUpdate(runtime, previousTickSequence);
				}
				runtime.screen.presentPending(runtime, hostDeltaMs);
			}
		} catch (error) {
			try {
				runtimeIde.handleLuaError(runtime, error);
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
		let fault: unknown = null;
		try {
			if (runtime.pendingCall === 'entry') {
				this.runUpdatePhase(runtime, state);
				runtime.machine.vdp.flushAssetEdits();
				state.updateExecuted = runtime.pendingCall !== 'entry';
			}
			this.finalizeUpdateSlice(runtime, state);
		} catch (error) {
			fault = error;
			runtimeIde.handleLuaError(runtime, error);
		} finally {
			if (fault !== null && this.currentFrameState !== null) {
				this.abandonFrameState(runtime);
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
			while (true) {
				if (runtime.machine.cpu.isHaltedUntilIrq() && runtime.vblank.runHaltedUntilIrq(runtime, state)) {
					return;
				}
				if (runtime.vblank.consumeBackQueueClearAfterIrqWake()) {
					clearBackQueues();
				}
				if (runtime.pendingCall !== 'entry') {
					return;
				}
				const result = runtime.cpuExecution.runWithBudget(runtime, state);
				if (runtime.machine.cpu.isHaltedUntilIrq()) {
					if (runtime.vblank.runHaltedUntilIrq(runtime, state)) {
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
			runtimeIde.handleLuaError(runtime, error);
		}
	}
}
