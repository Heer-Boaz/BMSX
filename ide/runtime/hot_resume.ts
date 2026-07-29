import { convertToError } from '../language/lua/interpreter/value';
import type { Closure } from '../../machine/ts/machine/cpu/closure';
import { EMPTY_CALL_ARGS, StringValue } from '../../machine/ts/machine/cpu/value';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { clearOverlayFrame } from '../../machine/ts/render/host_overlay/overlay_queue';
import {
	buildBlua32ExecutionRevision,
} from '../../toolchain/ts/rompack/blua32_revision';
import { clearFaultSnapshot, resetHandledLuaErrors } from './fault_state';
import {
	buildBlua32Media,
	installBlua32Media,
} from './lua_pipeline';
import { CARTRIDGE_RESOURCE_DOMAINS } from '../common/resource';
import type { RuntimeSourceState } from './sources';
import type { RuntimeLuaTooling } from './lua_tooling';
import type { RuntimeFaultState } from './fault_state';
import type { CartEditor } from '../cart_editor';
import {
	applyHotResumeRelocation,
	buildHotResumeRelocation,
	type HotResumeRevision,
} from './hot_resume_relocation';

export function hotResume(
	sources: RuntimeSourceState,
	luaTooling: RuntimeLuaTooling,
	fault: RuntimeFaultState,
	editor: CartEditor,
	runtime: Runtime,
	rebuildSystem: boolean,
	rebuildCartridgeSlots: readonly [boolean, boolean],
): void {
	const interpreter = luaTooling.luaInterpreter;
	try {
		if (fault.hostFrameFailed) {
			throw new Error('Hot Resume cannot continue a failed host frame. Reboot the machine.');
		}
		const rebuildMedia = rebuildSystem
			|| rebuildCartridgeSlots[0]
			|| rebuildCartridgeSlots[1];
		if (rebuildMedia) {
			const rebuilt = buildBlua32Media(
				sources,
				interpreter,
				runtime.machine.memory.ramByteCount(),
				rebuildSystem,
				rebuildCartridgeSlots,
			);
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
				cpu.replaceExecutionImage(executionAddressSpace.resolveSystemDomain());
			}
			for (const slot of CARTRIDGE_RESOURCE_DOMAINS) {
				if (rebuilt.cartridgeSlots[slot] !== null
					&& cpu.isExecutionDomainResident(slot)) {
					const image = executionAddressSpace.resolveDomain(slot);
					if (!image) {
						throw new Error('Active execution domain has no BLua32 executable image.');
					}
					cpu.replaceExecutionImage(image);
				}
			}
			applyHotResumeRelocation(cpu, relocation);
			editor.clearNativeMemberCompletionCache();
		}

		interpreter.clearLastFaultEnvironment();
		clearFaultSnapshot(fault);
		resetHandledLuaErrors(fault);
		clearOverlayFrame();

		const cpu = runtime.machine.cpu;
		const initClosure = cpu.getGlobalByKey(
			StringValue.get(cpu.stringPool.intern('init')),
		) as Closure;
		runtime.callClosure(initClosure, EMPTY_CALL_ARGS);
	} catch (error) {
		throw convertToError(error);
	}
}
