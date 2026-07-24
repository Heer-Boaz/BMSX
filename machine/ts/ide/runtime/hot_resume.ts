import { machineManager } from '../../core/machine_manager';
import { convertToError } from '../../lua/value';
import {
	EMPTY_CALL_ARGS,
	type Blua32MediaRevision,
	type Closure,
} from '../../machine/cpu/cpu';
import type { Runtime } from '../../machine/runtime/runtime';
import { clearOverlayFrame } from '../../render/host_overlay/overlay_queue';
import { buildBlua32ExecutionRevision } from '../../rompack/tooling/blua32_revision';
import { callClosureIntoSuspended } from './closure_executor';
import { clearRuntimeDebuggerPause } from './debug_pause';
import { clearFaultSnapshot, resetHandledLuaErrors } from './fault_state';
import {
	buildBlua32Media,
	installBlua32Media,
	loadBlua32MediaSymbols,
} from './lua_pipeline';

export function hotResume(
	runtime: Runtime,
	rebuildSystem: boolean,
	rebuildCartridgeSlots: readonly [boolean, boolean],
): void {
	const interpreter = machineManager.ideState.nativeBridge.luaInterpreter;
	try {
		const rebuildMedia = rebuildSystem
			|| rebuildCartridgeSlots[0]
			|| rebuildCartridgeSlots[1];
		if (rebuildMedia) {
			const sourceState = machineManager.sourceState;
			const rebuilt = buildBlua32Media(interpreter, rebuildSystem, rebuildCartridgeSlots);
			const revision: Blua32MediaRevision = {
				system: null,
				cartridgeSlots: [null, null],
			};
			if (rebuilt.system !== null) {
				revision.system = buildBlua32ExecutionRevision(
					rebuilt.system.previousImage,
					rebuilt.system.previousSymbols,
					sourceState.systemInstalledBlua32Sources,
					rebuilt.system.linked,
					rebuilt.system.sources,
				);
			}
			for (let slot = 0; slot < rebuilt.cartridgeSlots.length; slot += 1) {
				const image = rebuilt.cartridgeSlots[slot];
				if (image === null) {
					continue;
				}
				const cartridge = sourceState.cartridgeSlots[slot]!;
				revision.cartridgeSlots[slot] = buildBlua32ExecutionRevision(
					image.previousImage,
					image.previousSymbols,
					cartridge.installedBlua32Sources,
					image.linked,
					image.sources,
				);
			}
			installBlua32Media(runtime, rebuilt);
			runtime.machine.cpu.applyExecutableMediaRevision(loadBlua32MediaSymbols(), revision);
			machineManager.ideState.editor.clearNativeMemberCompletionCache();
		}

		clearRuntimeDebuggerPause(runtime);
		interpreter.clearLastFaultEnvironment();
		clearFaultSnapshot();
		resetHandledLuaErrors();
		runtime.luaRuntimeFailed = false;
		clearOverlayFrame();

		const initClosure = runtime.machine.cpu.getGlobalByKey(runtime.internString('init')) as Closure;
		const results = runtime.luaScratch.values.acquire();
		try {
			callClosureIntoSuspended(runtime, initClosure, EMPTY_CALL_ARGS, results);
		} finally {
			runtime.luaScratch.values.release(results);
		}
	} catch (error) {
		throw convertToError(error);
	}
}
