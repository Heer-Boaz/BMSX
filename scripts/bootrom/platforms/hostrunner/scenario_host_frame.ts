import type { HostAudioOutput } from '../../../../hosts/common/audio_output';
import {
	beginHostFrame,
	executeHostLogicalTick,
	HostFrameAction,
	type HostFrameSession,
	presentHostPresentation,
} from '../../../../hosts/common/host_frame';
import type { Input } from '../../../../hosts/common/input/manager';
import type { LogOutput } from '../../../../hosts/common/log';
import type { RenderPresentationState } from '../../../../hosts/common/presentation_state';
import type { SystemOutputLog } from '../../../../hosts/common/system_output_log';
import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import type { VideoPresenter } from '../../../../machine/ts/render/video_presenter';
import type { ScenarioExecutionService } from '../../../../ide/testing/scenario/execution_service';
import type { HeadlessCaptureCoordinator } from '../headless_capture';

/** Headless host adaptation for the shared logical-tick scenario execution owner. */
export function runHeadlessScenarioFrame(
	session: HostFrameSession,
	runtime: Runtime,
	presenter: VideoPresenter,
	input: Input,
	audioOutput: HostAudioOutput,
	systemOutput: SystemOutputLog,
	logOutput: LogOutput,
	screen: RenderPresentationState,
	execution: ScenarioExecutionService,
	capture: HeadlessCaptureCoordinator,
	currentTime: number,
): void {
	const hostDeltaMs = beginHostFrame(
		session,
		input,
		audioOutput,
		logOutput,
		currentTime,
	);
	if (execution.prepareLogicalTick()) {
		const completed = executeHostLogicalTick(
			session,
			runtime,
			presenter,
			input,
			audioOutput,
			screen,
		);
		execution.didRunLogicalTick(completed);
	}
	const previousPresentation = presenter.presentationSequence;
	presentHostPresentation(
		session,
		runtime,
		presenter,
		audioOutput,
		HostFrameAction.PresentPending,
		screen,
		hostDeltaMs,
	);
	if (presenter.presentationSequence !== previousPresentation
		&& execution.didPresent(presenter.presentationSequence) > 0) {
		capture.captureNow('scenario capture', 'scenario');
	}
	systemOutput.flush(runtime, logOutput);
}
