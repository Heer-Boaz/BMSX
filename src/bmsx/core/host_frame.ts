import { engineCore } from './engine';
import { flushHostRuntimeAssetEdits } from './host_asset_sync';
import * as workbenchMode from '../ide/workbench/mode';
import { applyRuntimeGameViewTableToState, syncRuntimeGameViewStateToTable } from '../machine/runtime/game/table';
import { applyGameViewStateToHost, syncGameViewViewportSizeFromHost } from '../machine/runtime/game/view_state';
import { Runtime } from '../machine/runtime/runtime';

const MAX_HOST_FRAME_DELTA_MS = 250;

export function runEngineHostFrame(currentTime: number, runReady: boolean): void {
	const engine = engineCore;
	if (!engine.running) {
		return;
	}
	const runtime = Runtime.instance;
	const screen = runtime.screen;
	let hostDeltaMs = 0;
	try {
		engine.input.pollInput();
		screen.beginHostFrame(currentTime);
		workbenchMode.tickIdeInput();
		workbenchMode.tickTerminalInput();
		syncGameViewViewportSizeFromHost(runtime.gameViewState, engine.view);
		syncRuntimeGameViewStateToTable();
		hostDeltaMs = Math.min(currentTime - runtime.frameLoop.currentTimeMs, MAX_HOST_FRAME_DELTA_MS);
		runtime.frameLoop.currentTimeMs = currentTime;

		if (engine.paused) {
			screen.presentPausedFrame(hostDeltaMs);
		} else {
			screen.clearPresentation();
			if (runtime.executionOverlayActive) {
				screen.runOverlay();
			} else if (!runReady) {
				runtime.frameScheduler.clearQueuedTime();
			} else {
				const previousTickSequence = runtime.frameScheduler.lastTickSequence;
				engine.deltatime = runtime.timing.frameDurationMs;
				runtime.frameScheduler.run(hostDeltaMs);
				applyRuntimeGameViewTableToState();
				applyGameViewStateToHost(runtime.gameViewState, engine.view);
				screen.syncAfterRuntimeUpdate(previousTickSequence);
				flushHostRuntimeAssetEdits(runtime.machine.memory, engine.texmanager);
			}
			screen.presentPending(hostDeltaMs);
		}
	} catch (error) {
		workbenchMode.surfaceHostFrameError(error, hostDeltaMs);
	}
	screen.flushDebugReport(currentTime, runtime);
}
