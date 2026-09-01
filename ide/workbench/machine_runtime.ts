import { createRuntimeSourceState } from '../runtime/sources';
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
import { StudioWorkbench } from './contrib/studio/chrome';
import { studioSocketPairFromMedia } from './contrib/studio/media_admission';
import { WorkbenchState } from './state';

export async function prepareWorkbenchRuntime(
	systemRom: Uint8Array,
	cartridgeSlots: readonly [Uint8Array | null, Uint8Array | null],
	runtime: Runtime,
	presenter: VideoPresenter,
	display: EditorDisplay,
	input: Input,
	audioOutput: HostAudioOutput,
	storage: KeyValueStorage,
	clock: HostClock,
	clipboard: Clipboard,
	microtasks: MicrotaskQueue,
	logOutput: LogOutput,
	resourcePanelWidthRatio: number,
): Promise<WorkbenchState> {
	const media = await loadRomToolingMedia(
		systemRom,
		cartridgeSlots,
	);
	const sources = createRuntimeSourceState(
		media.system,
		media.cartridgeSlots,
	);
	const studioSockets = studioSocketPairFromMedia(media.cartridgeSlots);
	const viewport = presenter.viewportSize;
	const ide = await workbenchMode.initializeIdeFeatures(
		runtime,
		presenter,
		display,
		input,
		audioOutput,
		storage,
		clock,
		clipboard,
		microtasks,
		logOutput,
		resourcePanelWidthRatio,
		{ width: viewport.x, height: viewport.y },
		sources,
	);
	let studio: StudioWorkbench | null = null;
	if (studioSockets !== null) {
		studio = new StudioWorkbench(
			runtime.machine.memory,
			presenter,
			input,
			ide.overlayRenderer,
			studioSockets,
		);
	}
	startPreparedRuntime(ide, runtime, logOutput);
	return new WorkbenchState(ide, studio);
}
