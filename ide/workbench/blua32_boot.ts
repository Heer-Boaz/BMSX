import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { SoundMaster } from '../../machine/ts/audio/soundmaster';
import type { Input } from '../../machine/ts/input/manager';
import type {
	LogOutput,
	StorageService,
} from '../../machine/ts/platform/platform';
import { clearFaultSnapshot } from '../runtime/fault_state';
import { bootActiveBlua32Media } from '../runtime/lua_pipeline';
import { enterSystemSources } from '../runtime/sources';
import type { RuntimeIdeState } from '../runtime/state';
import type { RuntimeSourceState } from '../runtime/sources';
import type { RuntimeFaultState } from '../runtime/fault_state';
import type { RuntimeLuaTooling } from '../runtime/lua_tooling';
import type { CartEditor } from '../cart_editor';
import type { GateGroup } from '../../machine/ts/common/taskgate';
import type { OverlayRenderer } from '../runtime/overlay_renderer';
import { applyAllWorkspaceSourceOverrides } from '../workspace/workspace';
import { workspaceDirtyRecords } from './workspace/state';
import { deactivateEditor } from './overlay_modes';
import { handleLuaError } from './runtime_errors';

function blua32MediaOverridesRequireRebuild(sources: RuntimeSourceState): boolean {
	return sources.systemBlua32MediaDirty
		|| sources.cartridgeBlua32MediaDirty[0]
		|| sources.cartridgeBlua32MediaDirty[1];
}

export async function startPreparedRuntime(
	state: RuntimeIdeState,
	runtime: Runtime,
	logOutput: LogOutput,
): Promise<void> {
	enterSystemSources(state.sources);
	await bootPreparedBlua32Media(
		state.sources,
		state.fault,
		state.luaTooling,
		state.editor,
		state.luaGate,
		runtime,
		logOutput,
		blua32MediaOverridesRequireRebuild(state.sources),
	);
}

async function prepareRebootToBootRom(
	sources: RuntimeSourceState,
	fault: RuntimeFaultState,
	editor: CartEditor,
	overlayRenderer: OverlayRenderer,
	input: Input,
	soundMaster: SoundMaster,
	storage: StorageService,
): Promise<boolean> {
	clearFaultSnapshot(fault);
	deactivateEditor(editor, overlayRenderer, input, soundMaster);
	editor.clearRuntimeErrorOverlay();
	await applyAllWorkspaceSourceOverrides(
		storage,
		sources,
		workspaceDirtyRecords,
	);
	enterSystemSources(sources);
	return blua32MediaOverridesRequireRebuild(sources);
}

export async function rebootPreparedRuntime(
	sources: RuntimeSourceState,
	fault: RuntimeFaultState,
	luaTooling: RuntimeLuaTooling,
	editor: CartEditor,
	luaGate: GateGroup,
	overlayRenderer: OverlayRenderer,
	runtime: Runtime,
	input: Input,
	soundMaster: SoundMaster,
	storage: StorageService,
	logOutput: LogOutput,
): Promise<void> {
	const gateToken = luaGate.begin({ blocking: true, tag: 'reboot_bootrom' });
	try {
		const rebuildBlua32Media = await prepareRebootToBootRom(
			sources,
			fault,
			editor,
			overlayRenderer,
			input,
			soundMaster,
			storage,
		);
		try {
			bootActiveBlua32Media(
				sources,
				fault,
				luaTooling,
				runtime,
				rebuildBlua32Media,
			);
		} catch (error) {
			handleLuaError(logOutput, fault, sources, runtime, error);
			throw error;
		}
		soundMaster.bootstrapRuntimeAudio(
			runtime.timing.ufpsScaled,
			soundMaster.volume,
		);
	} finally {
		luaGate.end(gateToken);
	}
}

async function bootPreparedBlua32Media(
	sources: RuntimeSourceState,
	fault: RuntimeFaultState,
	luaTooling: RuntimeLuaTooling,
	editor: CartEditor,
	luaGate: GateGroup,
	runtime: Runtime,
	logOutput: LogOutput,
	rebuildBlua32Media: boolean,
): Promise<void> {
	const gateToken = luaGate.begin({ blocking: true, tag: 'boot' });
	try {
		clearFaultSnapshot(fault);
		editor.clearRuntimeErrorOverlay();
		bootActiveBlua32Media(
			sources,
			fault,
			luaTooling,
			runtime,
			rebuildBlua32Media,
		);
	} catch (error) {
		handleLuaError(logOutput, fault, sources, runtime, error);
		throw new Error(`failed to boot runtime: ${error}`);
	} finally {
		luaGate.end(gateToken);
	}
}
