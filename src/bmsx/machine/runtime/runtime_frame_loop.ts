import { $ } from '../../core/engine_core';
import type { FrameState, Runtime } from './runtime';
import * as runtimeIde from '../../ide/runtime/runtime_ide';

const MAX_FRAME_DELTA = 250;

export class RuntimeFrameLoopState {
	public currentTimeMs = 0;
	public frameDeltaMs = 0;
	public currentFrameState: FrameState = null;
	public drawFrameState: FrameState = null;

	public reset(): void {
		this.currentTimeMs = 0;
		this.frameDeltaMs = 0;
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
						runtime.machineScheduler.clearQueuedTime();
					}
				} else if (runtime.executionOverlayActive) {
					runtime.screen.runOverlay(runtime);
				} else {
					const previousTickSequence = runtime.machineScheduler.lastTickSequence;
					$.deltatime = runtime.timing.frameDurationMs;
					runtime.machineScheduler.run(runtime, hostDeltaMs);
					runtime.screen.syncAfterRuntimeUpdate(runtime, previousTickSequence);
				}
				runtime.screen.presentPending(runtime, hostDeltaMs);
			}
		} catch (error) {
			try {
				runtimeIde.handleLuaError(runtime, error);
				runtime.abandonFrameState();
				runtime.screen.presentErrorOverlay(runtime, hostDeltaMs);
			} catch {
				console.error(`Error while handling surfaced game error in runtime: ${error}`);
				runtime.abandonFrameState();
			}
		}
		runtime.screen.flushDebugReport(currentTime, runtime);
	}
}
