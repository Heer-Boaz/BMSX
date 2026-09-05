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
		storage,
		clock,
		clipboard,
		microtasks,
		logOutput,
		resourcePanelWidthRatio,
		{ width: viewport.x, height: viewport.y },
		sources,
	);
	startPreparedRuntime(ide, runtime, logOutput);
	return ide;
}
