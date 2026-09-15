import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { HostAudioOutput } from '../../hosts/common/audio_output';
import { HostPauseReason, type HostExecutionControl } from '../../hosts/common/execution_control';
import type { KeyValueStorage } from '../workspace/key_value_storage';
import { clearFaultSnapshot } from '../runtime/fault_state';
import {
	blua32MediaRequiresRebuild,
	bootInstalledBlua32Media,
	installBlua32Media,
	prepareBlua32MediaBoot,
	type Blua32CartridgeEntry,
	type PreparedBlua32Boot,
} from '../runtime/lua_pipeline';
import { enterSystemSources } from '../runtime/sources';
import type { RuntimeIdeState } from './state';
import type { RuntimeSourceState } from '../runtime/sources';
import type { RuntimeFaultState } from '../runtime/fault_state';
import type { RuntimeLuaTooling } from '../runtime/lua_tooling';
import {
	discardRuntimeDebuggerPlans,
	resetRuntimeDebuggerExecution,
	type RuntimeDebuggerState,
} from '../runtime/debugger_state';
import type { CartEditor } from '../cart_editor';
import type { OverlayRenderer } from '../runtime/overlay_renderer';
import { applyAllWorkspaceSourceOverrides, applyLuaTextModelSources } from '../workspace/workspace';
import { workspaceDirtyRecords } from './workspace/state';
import { deactivateEditor } from './overlay_modes';
import { clearExecutionStopHighlights } from '../runtime_error/navigation';
import type { LuaTextModelSourceSnapshot } from './services/working_copy/lua_sources';

export function startPreparedRuntime(
	state: RuntimeIdeState,
	runtime: Runtime,
): boolean {
	// Initialize real reset registers before the workbench can inspect the CPU.
	// The host holds execution until the startup build succeeds; no old program
	// is executed when workspace source is rejected.
	enterSystemSources(state.sources);
	bootInstalledBlua32Media(state.fault, state.luaTooling, runtime, state.luaTooling.luaInterpreter);
	if (blua32MediaRequiresRebuild(state.sources)) {
		let prepared: PreparedBlua32Boot;
		try {
			prepared = prepareBlua32MediaBoot(state.sources, state.luaTooling, runtime, true);
		} catch (error) {
			console.error(error);
			state.editor.handleRuntimeTaskError(error, 'Build failed');
			return false;
		}
		if (prepared.installation !== null) installBlua32Media(state.sources, runtime, prepared.installation);
		bootInstalledBlua32Media(state.fault, state.luaTooling, runtime, prepared.interpreter);
	}
	clearFaultSnapshot(state.fault);
	state.editor.clearRuntimeErrorOverlay();
	resetRuntimeDebuggerExecution(state.debugger);
	state.execution.setPauseReason(HostPauseReason.AwaitingLaunch, false);
	return true;
}

export async function rebootPreparedRuntime(
	sources: RuntimeSourceState,
	fault: RuntimeFaultState,
	luaTooling: RuntimeLuaTooling,
	debuggerState: RuntimeDebuggerState,
	editor: CartEditor,
	overlayRenderer: OverlayRenderer,
	runtime: Runtime,
	audioOutput: HostAudioOutput,
	execution: HostExecutionControl,
	storage: KeyValueStorage,
	sourceSnapshots: ReadonlyArray<LuaTextModelSourceSnapshot>,
	entry?: Blua32CartridgeEntry,
): Promise<boolean> {
	let prepared: PreparedBlua32Boot;
	try {
		if (entry?.domain === 1) {
			const first = sources.cartridgeSlots[0];
			if (first !== null && first.rom.header.blua32ImageOffset !== 0
				&& first.rom.header.blua32StartupFunctionAddress !== 0) {
				throw new Error('CART 1 cannot launch: BIOS boots CART 0 first.');
			}
		}
		await applyAllWorkspaceSourceOverrides(storage, sources, workspaceDirtyRecords);
		applyLuaTextModelSources(sources, sourceSnapshots);
		prepared = prepareBlua32MediaBoot(sources, luaTooling, runtime,
			blua32MediaRequiresRebuild(sources), entry);
	} catch (error) {
		// Build rejection is not a guest fault: keep the installed execution,
		// debugger stop and editor available so the source can be corrected.
		console.error(error);
		editor.handleRuntimeTaskError(error, 'Build failed');
		return false;
	}
	console.info('[IDE] Performing cold reboot through bootrom');
	clearFaultSnapshot(fault);
	clearExecutionStopHighlights();
	discardRuntimeDebuggerPlans(debuggerState);
	deactivateEditor(editor, overlayRenderer, audioOutput);
	editor.clearRuntimeErrorOverlay();
	if (prepared.installation !== null) installBlua32Media(sources, runtime, prepared.installation);
	enterSystemSources(sources);
	bootInstalledBlua32Media(fault, luaTooling, runtime, prepared.interpreter);
	execution.setPauseReason(HostPauseReason.AwaitingLaunch, false);
	audioOutput.muteSystem(false);
	resetRuntimeDebuggerExecution(debuggerState);
	audioOutput.restart(runtime.timing.ufpsScaled);
	return true;
}
