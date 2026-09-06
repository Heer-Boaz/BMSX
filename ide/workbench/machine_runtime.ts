import { updateGamePipelineExts } from './overlay_modes';
import type { HostRewind } from '../../hosts/common/rewind';
import type { HostExecutionControl } from '../../hosts/common/execution_control';
import type { HostOverlayMenu } from '../../hosts/common/host_overlay_menu';
import type { RuntimeTaskQueue } from '../../hosts/common/runtime_task_queue';
import { createRuntimeSourceState } from '../runtime/sources';
import type { RuntimeIdeState } from './state';
import { loadRomToolingMedia } from '../../toolchain/ts/rompack/media';
import { startPreparedRuntime } from './blua32_boot';
import * as workbenchMode from './mode';
import type { Clipboard } from '../common/clipboard';
import type { MicrotaskQueue } from '../common/microtask_queue';
import type { KeyValueStorage } from '../workspace/key_value_storage';
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
	display: EditorDisplay,
	input: Input,
	audioOutput: HostAudioOutput,
	runtimeTasks: RuntimeTaskQueue,
	execution: HostExecutionControl,
	rewind: HostRewind,
	hostMenu: HostOverlayMenu,
	storage: KeyValueStorage,
	clock: HostClock,
	clipboard: Clipboard,
	microtasks: MicrotaskQueue,
	logOutput: LogOutput,
	resourcePanelWidthRatio: number,
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
		display,
		input,
		audioOutput,
		runtimeTasks,
		execution,
		rewind,
		storage,
		clock,
		clipboard,
		microtasks,
		logOutput,
		resourcePanelWidthRatio,
		{ width: viewport.x, height: viewport.y },
		sources,
	);
	ide.editor.onDidChangeActive(active => {
		if (active) hostMenu.dismiss();
		updateGamePipelineExts(ide.editor, ide.overlayRenderer, audioOutput);
	});
	startPreparedRuntime(ide, runtime, logOutput);
	return ide;
}
