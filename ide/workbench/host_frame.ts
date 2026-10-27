import { HostPauseReason } from '../../hosts/common/execution_control';
import type { HostAudioOutput } from '../../hosts/common/audio_output';
import { beginHostFrame, HostFrameAction, HostFrameRunResult, type HostFramePresentation, presentHostPresentation } from '../../hosts/common/host_frame';
import { type HostFrameSession } from '../../hosts/common/frame_session';
import { HostMenuExecution, HostMenuInput, type HostOverlayMenu } from '../../hosts/common/host_overlay_menu';
import type { Input } from '../../hosts/common/input/manager';
import type { LogOutput } from '../../hosts/common/log';
import type { RenderPresentationState } from '../../hosts/common/presentation_state';
import type { SystemOutputLog } from '../../hosts/common/system_output_log';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import type { RuntimeIdeState } from './state';
import { performReboot } from '../commands/actions';
import * as workbenchMode from './mode';
import { advanceStudioFrame, finishStudioFrame } from './frame';

function executeWorkbenchHostMenuAction(
	ide: RuntimeIdeState,
	screen: RenderPresentationState,
	input: HostMenuInput,
	runtime: Runtime,
	presenter: VideoPresenter,
): boolean {
	switch (input) {
		case HostMenuInput.Inactive:
		case HostMenuInput.Active:
			return false;
		case HostMenuInput.RebootCart: {
			const operation = performReboot(ide.boots, ide.editor, ide.execution, ide.overlayRenderer, ide.logOutput,
				ide.runTargets, { action: 'reboot' });
			void operation.completion.then(result => {
				if (result.status === 'reset' && ide.boots.latestOperation === operation) screen.reset(presenter, runtime);
			}).catch(error => ide.failHostFrame(error));
			return true;
		}
		case HostMenuInput.ExitGame:
			return true;
	}
}

function runWorkbenchOverlay(
	ide: RuntimeIdeState,
	screen: RenderPresentationState,
	hostDeltaMs: number,
): void {
	workbenchMode.tickIDE(ide, hostDeltaMs / 1000);
	screen.requestHeldPresentation();
}

function presentWorkbenchFrame(
	session: HostFrameSession,
	runtime: Runtime,
	presenter: VideoPresenter,
	audioOutput: HostAudioOutput,
	ide: RuntimeIdeState,
	action: HostFramePresentation,
	screen: RenderPresentationState,
	hostDeltaMs: number,
): void {
	if (
		action === HostFrameAction.PresentPending
		&& !screen.pending
	) {
		return;
	}
	if (action === HostFrameAction.PresentPending) {
		workbenchMode.tickIDEDraw(ide, presenter);
	}
	presentHostPresentation(
		session,
		runtime,
		presenter,
		audioOutput,
		action,
		screen,
		hostDeltaMs,
	);
}

function presentWorkbenchError(
	session: HostFrameSession,
	runtime: Runtime,
	presenter: VideoPresenter,
	audioOutput: HostAudioOutput,
	ide: RuntimeIdeState,
	screen: RenderPresentationState,
	hostDeltaMs: number,
): void {
	if (!ide.overlayRenderer.active) {
		return;
	}
	runWorkbenchOverlay(ide, screen, hostDeltaMs);
	presentWorkbenchFrame(
		session,
		runtime,
		presenter,
		audioOutput,
		ide,
		HostFrameAction.PresentPending,
		screen,
		hostDeltaMs,
	);
}

export function runWorkbenchHostFrame(
	session: HostFrameSession,
	runtime: Runtime,
	presenter: VideoPresenter,
	input: Input,
	audioOutput: HostAudioOutput,
	systemOutput: SystemOutputLog,
	logOutput: LogOutput,
	ide: RuntimeIdeState,
	screen: RenderPresentationState,
	hostOverlayMenu: HostOverlayMenu,
	currentTime: number,
): HostFrameRunResult {
	let hostDeltaMs = 0;
	ide.frame.outputDrained = false;
	let presented = false;
	let menuPaused = false;
	try {
		hostDeltaMs = beginHostFrame(
			session,
			input,
			logOutput,
			currentTime,
		);
		const hostMenuInput = hostOverlayMenu.tickInput();
		const menuExecution = hostOverlayMenu.executionMode;
		menuPaused = menuExecution === HostMenuExecution.Paused;
		audioOutput.muteMenu(menuPaused || (menuExecution === HostMenuExecution.Rewind && !session.rewind.playing));
		if (hostMenuInput === HostMenuInput.ExitGame) {
			return HostFrameRunResult.ExitRequested;
		}
		if (executeWorkbenchHostMenuAction(
			ide,
			screen,
			hostMenuInput,
			runtime,
			presenter,
		)) {
			runtime.frameScheduler.clearQueuedTime();
			systemOutput.flush(runtime, logOutput, ide.luaEvaluation.receiveOutput);
			return HostFrameRunResult.Continue;
		}
		if (hostMenuInput !== HostMenuInput.Active) {
			workbenchMode.tickIdeInput(ide, input);
		}
		input.guestInputRecipient = ide.editor.guestInputRecipient;
		const play = ide.play.current?.session;
		if (play !== undefined) {
			play.execution.setPauseReason(HostPauseReason.HostSuspended, !ide.editor.isActive || hostMenuInput !== HostMenuInput.Inactive);
			play.audio.muteMenu(hostMenuInput !== HostMenuInput.Inactive);
		}
		ide.play.advance(hostDeltaMs);
		let action = advanceStudioFrame(session, runtime, presenter, audioOutput, systemOutput, ide, screen,
			hostDeltaMs, hostMenuInput, menuPaused);
		if (hostMenuInput !== HostMenuInput.Active && ide.overlayRenderer.active) {
			runWorkbenchOverlay(ide, screen, hostDeltaMs);
			ide.microtasks.flush();
			action = HostFrameAction.PresentPending;
		}
		if (hostOverlayMenu.queueFrameOverlayCommands(session.hostFps)
			|| session.rewind.active || !ide.runtimeTasks.ready) screen.requestHeldPresentation();
		presentWorkbenchFrame(
			session,
			runtime,
			presenter,
			audioOutput,
			ide,
			action,
			screen,
			hostDeltaMs,
		);

		presented = true;
	} catch (error) {
		session.execution.finishFrameStep();
		ide.failHostFrame(error);
		presentWorkbenchError(
			session,
			runtime,
			presenter,
			audioOutput,
			ide,
			screen,
			hostDeltaMs,
		);
	}
	finishStudioFrame(session, runtime, input, systemOutput, ide, menuPaused, presented);
	return HostFrameRunResult.Continue;
}
