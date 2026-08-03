import { convertToError } from '../language/lua/interpreter/value';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import {
	buildBlua32ExecutionRevision,
} from '../../toolchain/ts/rompack/blua32_revision';
import { clearFaultSnapshot, resetHandledLuaErrors } from './fault_state';
import {
	buildBlua32Media,
	installBlua32Media,
	layoutBlua32MediaInstallation,
	type Blua32MediaInstallation,
	type RuntimeRomAssetRevision,
} from './lua_pipeline';
import { CARTRIDGE_RESOURCE_DOMAINS } from '../common/resource';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/spec/blua32/execution_domain';
import type { RuntimeSourceState } from './sources';
import type { RuntimeLuaTooling } from './lua_tooling';
import {
	buildRuntimeBreakpointPcs,
	finishRuntimeDebuggerHotResume,
	prepareRuntimeDebuggerForHotResume,
	type RuntimeDebuggerState,
} from './debugger_state';
import type { RuntimeFaultState } from './fault_state';
import type { CartEditor } from '../cart_editor';
import {
	applyHotResumeRelocation,
	buildHotResumeRelocation,
	type HotResumeRevision,
} from './hot_resume_relocation';
import { clearExecutionStopHighlights } from '../runtime_error/navigation';

export type BuiltBlua32Revision = {
	mediaInstallation: Blua32MediaInstallation;
	relocation: Uint32Array;
};

export function buildBlua32Revision(
	sources: RuntimeSourceState,
	luaTooling: RuntimeLuaTooling,
	runtime: Runtime,
	rebuildSystem: boolean,
	rebuildCartridgeSlots: readonly [boolean, boolean],
	assetRevision?: RuntimeRomAssetRevision,
): BuiltBlua32Revision {
	const rebuilt = buildBlua32Media(
		sources,
		luaTooling.luaInterpreter,
		runtime.machine.memory.ramByteCount(),
		rebuildSystem,
		rebuildCartridgeSlots,
		assetRevision,
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
	const relocation = buildHotResumeRelocation(cpu, revisions);
	return {
		mediaInstallation: layoutBlua32MediaInstallation(sources, rebuilt, assetRevision),
		relocation,
	};
}

export function installBlua32Revision(
	sources: RuntimeSourceState,
	editor: CartEditor,
	runtime: Runtime,
	built: BuiltBlua32Revision,
): void {
	const rebuilt = built.mediaInstallation.rebuilt;
	const cpu = runtime.machine.cpu;
	const executionAddressSpace = runtime.machine.executionAddressSpace;
	installBlua32Media(sources, runtime, built.mediaInstallation);
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
	applyHotResumeRelocation(cpu, built.relocation);
	editor.clearNativeMemberCompletionCache();
}

export function hotResume(
	sources: RuntimeSourceState,
	luaTooling: RuntimeLuaTooling,
	fault: RuntimeFaultState,
	debuggerState: RuntimeDebuggerState,
	editor: CartEditor,
	runtime: Runtime,
	rebuildSystem: boolean,
	rebuildCartridgeSlots: readonly [boolean, boolean],
): void {
	const interpreter = luaTooling.luaInterpreter;
	try {
		const rebuildCartridgeSlot0 = rebuildCartridgeSlots[0];
		const rebuildCartridgeSlot1 = rebuildCartridgeSlots[1];
		const rebuildMedia = rebuildSystem
			|| rebuildCartridgeSlot0
			|| rebuildCartridgeSlot1;
		const built = rebuildMedia
			? buildBlua32Revision(
				sources,
				luaTooling,
				runtime,
				rebuildSystem,
				rebuildCartridgeSlots,
			)
			: null;
		const freshMedia = built === null
			? sources.currentBlua32Media
			: built.mediaInstallation.sourceMedia;
		const breakpointPcs = buildRuntimeBreakpointPcs(debuggerState, freshMedia);
		if (built !== null) {
			installBlua32Revision(
				sources,
				editor,
				runtime,
				built,
			);
		}

		interpreter.clearLastFaultEnvironment();
		clearFaultSnapshot(fault);
		resetHandledLuaErrors(fault);
		clearExecutionStopHighlights();
		const resumeStoppedExecution = prepareRuntimeDebuggerForHotResume(
			debuggerState,
			breakpointPcs,
		);
		const cpu = runtime.machine.cpu;
		const activeCartridgeSlot = cpu.activeCartridgeSlot();
		const systemInitFunctionAddress = rebuildSystem
			? freshMedia.system!.symbols!.initFunctionAddress
			: 0;
		let cartridgeInitFunctionAddress = 0;
		switch (activeCartridgeSlot) {
			case 0:
				if (rebuildCartridgeSlot0 || !rebuildMedia) {
					cartridgeInitFunctionAddress = freshMedia.cartridgeSlots[0]!.symbols!.initFunctionAddress;
				}
				break;
			case 1:
				if (rebuildCartridgeSlot1 || !rebuildMedia) {
					cartridgeInitFunctionAddress = freshMedia.cartridgeSlots[1]!.symbols!.initFunctionAddress;
				}
				break;
		}
		const suspendedDepth = cpu.getFrameDepth();
		if (cartridgeInitFunctionAddress !== 0) {
			cpu.beginCompletionCallInExecutionDomain(
				activeCartridgeSlot,
				cartridgeInitFunctionAddress,
			);
		}
		if (systemInitFunctionAddress !== 0) {
			cpu.beginCompletionCallInExecutionDomain(
				SYSTEM_EXECUTION_DOMAIN_ID,
				systemInitFunctionAddress,
			);
		}
		if (cpu.getFrameDepth() !== suspendedDepth) {
			runtime.cpuExecution.runSuspendedUntilDepth(suspendedDepth);
		}
		finishRuntimeDebuggerHotResume(debuggerState, resumeStoppedExecution);
	} catch (error) {
		throw convertToError(error);
	}
}
