import { engineCore } from '../../../core/engine';
import type { Runtime } from '../runtime';
import * as workbenchMode from '../../../ide/runtime/workbench_mode';
import { applyRuntimeGameViewTableToState, syncRuntimeGameViewStateToTable } from '../game/table';
import { applyGameViewStateToHost, syncGameViewViewportSizeFromHost } from '../game/view_state';
import { flushRuntimeAssetEdits } from '../../../runtime/assets/edits';

const MAX_FRAME_DELTA = 250;

export function runRuntimeHostFrame(runtime: Runtime, currentTime: number, runReady: boolean): void {
	if (!engineCore.running) {
		return;
	}
	const screen = runtime.screen;
	let hostDeltaMs = 0;
	try {
		engineCore.input.pollInput();
		screen.beginHostFrame(currentTime);
		workbenchMode.tickIdeInput(runtime);
		workbenchMode.tickTerminalInput(runtime);
		syncGameViewViewportSizeFromHost(runtime.gameViewState, engineCore.view);
		syncRuntimeGameViewStateToTable(runtime);
		hostDeltaMs = Math.min(currentTime - runtime.frameLoop.currentTimeMs, MAX_FRAME_DELTA);
		runtime.frameLoop.currentTimeMs = currentTime;

		if (engineCore.paused) {
			screen.presentPausedFrame(runtime, hostDeltaMs);
		} else {
			screen.clearPresentation();
			if (runtime.executionOverlayActive) {
				screen.runOverlay(runtime);
			} else if (!runReady) {
				runtime.frameScheduler.clearQueuedTime();
				} else {
					const previousTickSequence = runtime.frameScheduler.lastTickSequence;
					engineCore.deltatime = runtime.timing.frameDurationMs;
					runtime.frameScheduler.run(runtime, hostDeltaMs);
					applyRuntimeGameViewTableToState(runtime);
					applyGameViewStateToHost(runtime.gameViewState, engineCore.view);
					screen.syncAfterRuntimeUpdate(runtime, previousTickSequence);
					flushRuntimeAssetEdits(runtime.machine.memory);
				}
			screen.presentPending(runtime, hostDeltaMs);
		}
	} catch (error) {
		try {
			runtime.handleLuaError(error);
			runtime.frameLoop.abandonFrameState(runtime);
			screen.presentErrorOverlay(runtime, hostDeltaMs);
		} catch {
			console.error(`Error while handling surfaced game error in runtime: ${error}`);
			runtime.frameLoop.abandonFrameState(runtime);
		}
	}
	screen.flushDebugReport(currentTime, runtime);
}
