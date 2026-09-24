import { GameCaptureService } from '../../hosts/common/game_capture';
import type { RenderPresentationState } from '../../hosts/common/presentation_state';
import type { PngImageEncoder } from '../../hosts/common/image';
import type { AssistantConnectionFactory } from '../../hosts/common/assistant_protocol';
import type { GraphLayoutEngineFactory } from './services/graph_layout/engine';
import { OffscreenMachine } from '../../hosts/common/offscreen_machine';
import { activateEditor } from './overlay_modes';
import type { HostRewind } from '../../hosts/common/rewind';
import { HostPauseReason, type HostExecutionControl } from '../../hosts/common/execution_control';
import type { HostOverlayMenu } from '../../hosts/common/host_overlay_menu';
import type { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import { createRuntimeSourceState } from '../runtime/sources';
import type { RuntimeIdeState } from './state';
import { loadRomToolingMedia } from '../../toolchain/ts/rompack/media';
import * as workbenchMode from './mode';
import type { Clipboard } from '../../hosts/common/clipboard';
import type { MicrotaskQueue } from '../common/microtask_queue';
import type { KeyValueStorage } from '../workspace/key_value_storage';
import type { WorkspaceRecordProvider } from '../workspace/record_provider';
import type { EditorDisplay } from '../common/viewport';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { VideoPresenter } from '../../machine/ts/render/video_presenter';
import type { Input } from '../../hosts/common/input/manager';
import type { HostAudioOutput } from '../../hosts/common/audio_output';
import type { HostClock } from '../../hosts/common/clock';
import type { LogOutput } from '../../hosts/common/log';

export async function prepareWorkbenchRuntime(
	systemRom: Uint8Array,
	cartridgeSlots: readonly [Uint8Array | null, Uint8Array | null],
	runtime: Runtime,
	presenter: VideoPresenter,
	presentation: RenderPresentationState,
	encodePngImage: PngImageEncoder,
	display: EditorDisplay,
	input: Input,
	audioOutput: HostAudioOutput,
	runtimeTasks: RuntimeTaskQueue,
	execution: HostExecutionControl,
	rewind: HostRewind,
	hostMenu: HostOverlayMenu,
	storage: KeyValueStorage,
	workspaceFiles: WorkspaceRecordProvider,
	clock: HostClock,
	clipboard: Clipboard,
	microtasks: MicrotaskQueue,
	logOutput: LogOutput,
	resourcePanelWidthRatio: number,
	createGraphLayoutEngine: GraphLayoutEngineFactory,
	connectAssistant?: AssistantConnectionFactory,
): Promise<RuntimeIdeState> {
	const media = await loadRomToolingMedia(
		systemRom,
		cartridgeSlots,
	);
	const sources = createRuntimeSourceState(
		media.system,
		media.cartridgeSlots,
	);
	const viewport = presenter.viewportSize;
	const ide = await workbenchMode.initializeIdeFeatures(
		runtime,
		presenter,
		new GameCaptureService(presenter, presentation, runtimeTasks, encodePngImage),
		display,
		input,
		audioOutput,
		runtimeTasks,
		execution,
		rewind,
		storage,
		workspaceFiles,
		clock,
		clipboard,
		microtasks,
		logOutput,
		resourcePanelWidthRatio,
		{ width: viewport.x, height: viewport.y },
		sources,
		createGraphLayoutEngine,
		(systemRom, cartridgeSlots, model, input) => new OffscreenMachine(systemRom, cartridgeSlots, model, input),
		connectAssistant,
	);
	ide.editor.onDidChangeActive(active => {
		if (active) hostMenu.dismiss();
		execution.setPauseReason(HostPauseReason.Workbench, ide.editor.executionSuspended);
		input.setGuestInputCaptured(active);
		audioOutput.muteUi(ide.editor.executionSuspended);
	});
	const startup = ide.boots.start().result!;
	if (startup.status === 'rejected' || startup.status === 'failed') {
		ide.editor.handleRuntimeTaskError(startup.error, 'Startup failed');
		activateEditor(ide.editor, sources, runtime, audioOutput);
	}
	return ide;
}
