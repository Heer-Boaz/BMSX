import { convertToError } from '../language/lua/interpreter/value';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { EMPTY_CALL_ARGS } from '../../machine/ts/machine/cpu/value';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/machine/execution_address_space';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { clearOverlayFrame } from '../../machine/ts/render/host_overlay/overlay_queue';
import {
	buildBlua32ExecutionRevision,
} from '../../machine/ts/rompack/tooling/blua32_revision';
import { callClosureSuspended } from './closure_executor';
import { clearFaultSnapshot, resetHandledLuaErrors } from './fault_state';
import {
	buildBlua32Media,
	installBlua32Media,
} from './lua_pipeline';
import { CARTRIDGE_RESOURCE_DOMAINS } from '../common/resource';
import type { RuntimeSourceState } from './sources';
import type { RuntimeNativeBridge } from './native_bridge';
import type { RuntimeFaultState } from './fault_state';
import type { CartEditor } from '../cart_editor';
import {
	applyHotResumeRelocation,
	buildHotResumeRelocation,
	type HotResumeRevision,
} from './hot_resume_relocation';

export function hotResume(
	sources: RuntimeSourceState,
	nativeBridge: RuntimeNativeBridge,
	fault: RuntimeFaultState,
	editor: CartEditor,
	runtime: Runtime,
	rebuildSystem: boolean,
	rebuildCartridgeSlots: readonly [boolean, boolean],
): void {
	const interpreter = nativeBridge.luaInterpreter;
	try {
		const rebuildMedia = rebuildSystem
			|| rebuildCartridgeSlots[0]
			|| rebuildCartridgeSlots[1];
		if (rebuildMedia) {
			const rebuilt = buildBlua32Media(sources, interpreter, rebuildSystem, rebuildCartridgeSlots);
			const revisions: [
				HotResumeRevision | null,
				HotResumeRevision | null,
				HotResumeRevision | null,
			] = [null, null, null];
			if (rebuilt.system !== null) {
				revisions[0] = {
					previousImage: rebuilt.system.previousImage,
					freshImage: rebuilt.system.linked.layout,
					revision: buildBlua32ExecutionRevision(
						rebuilt.system.previousImage,
						rebuilt.system.previousSymbols,
						sources.systemInstalledBlua32Sources,
						rebuilt.system.linked,
						rebuilt.system.sources,
					),
				};
			}
			for (const slot of CARTRIDGE_RESOURCE_DOMAINS) {
				const image = rebuilt.cartridgeSlots[slot];
				if (image === null) {
					continue;
				}
				const cartridge = sources.cartridgeSlots[slot]!;
				revisions[slot + 1] = {
					previousImage: image.previousImage,
					freshImage: image.linked.layout,
					revision: buildBlua32ExecutionRevision(
						image.previousImage,
						image.previousSymbols,
						cartridge.installedBlua32Sources,
						image.linked,
						image.sources,
					),
				};
			}

			const cpu = runtime.machine.cpu;
			const executionAddressSpace = runtime.machine.executionAddressSpace;
			const relocation = buildHotResumeRelocation(cpu, revisions);
			installBlua32Media(sources, runtime, rebuilt);

			if (rebuilt.system !== null) {
				cpu.replaceExecutionImage(executionAddressSpace.reloadDomain(SYSTEM_EXECUTION_DOMAIN_ID)!);
			}
			for (const slot of CARTRIDGE_RESOURCE_DOMAINS) {
				if (rebuilt.cartridgeSlots[slot] !== null) {
					const image = executionAddressSpace.reloadDomain(slot);
					if (image) {
						cpu.replaceExecutionImage(image);
					}
				}
			}
			applyHotResumeRelocation(cpu, relocation);
			editor.clearNativeMemberCompletionCache();
		}

		interpreter.clearLastFaultEnvironment();
		clearFaultSnapshot(fault);
		resetHandledLuaErrors(fault);
		runtime.luaRuntimeFailed = false;
		clearOverlayFrame();

		const initClosure = runtime.machine.cpu.getGlobalByKey(runtime.internString('init')) as Closure;
		callClosureSuspended(runtime, initClosure, EMPTY_CALL_ARGS);
	} catch (error) {
		throw convertToError(error);
	}
}
