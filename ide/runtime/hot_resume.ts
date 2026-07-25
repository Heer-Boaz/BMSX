import { machineManager } from '../../machine/ts/core/machine_manager';
import { convertToError } from '../../machine/ts/lua/value';
import {
	EMPTY_CALL_ARGS,
	type Closure,
} from '../../machine/ts/machine/cpu/cpu';
import type { Blua32ImageLayout } from '../../machine/ts/machine/cpu/blua32_image';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { clearOverlayFrame } from '../../machine/ts/render/host_overlay/overlay_queue';
import {
	buildBlua32ExecutionRevision,
	relocatedCallSitePc,
	relocatedContinuationPc,
	type Blua32ExecutionImageRevision,
} from '../../machine/ts/rompack/tooling/blua32_revision';
import { callClosureIntoSuspended } from './closure_executor';
import { clearRuntimeDebuggerPause } from './debug_pause';
import { clearFaultSnapshot, resetHandledLuaErrors } from './fault_state';
import {
	buildBlua32Media,
	installBlua32Media,
	loadBlua32MediaSymbols,
	setActiveBlua32MediaSymbols,
} from './lua_pipeline';

type TargetRevision = {
	previousImage: Blua32ImageLayout;
	revision: Blua32ExecutionImageRevision;
};

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
			const revisionsBySlot = new Map<number, TargetRevision>();
			if (rebuilt.system !== null) {
				revisionsBySlot.set(-1, {
					previousImage: rebuilt.system.previousImage,
					revision: buildBlua32ExecutionRevision(
						rebuilt.system.previousImage,
						rebuilt.system.previousSymbols,
						sourceState.systemInstalledBlua32Sources,
						rebuilt.system.linked,
						rebuilt.system.sources,
					),
				});
			}
			for (let slot = 0; slot < rebuilt.cartridgeSlots.length; slot += 1) {
				const image = rebuilt.cartridgeSlots[slot];
				if (image === null) {
					continue;
				}
				const cartridge = sourceState.cartridgeSlots[slot]!;
				revisionsBySlot.set(slot, {
					previousImage: image.previousImage,
					revision: buildBlua32ExecutionRevision(
						image.previousImage,
						image.previousSymbols,
						cartridge.installedBlua32Sources,
						image.linked,
						image.sources,
					),
				});
			}

			installBlua32Media(runtime, rebuilt);

			const cpu = runtime.machine.cpu;
			if (rebuilt.system !== null) {
				cpu.installExecutionImage('system');
			}
			for (let slot = 0; slot < rebuilt.cartridgeSlots.length; slot += 1) {
				if (rebuilt.cartridgeSlots[slot] !== null) {
					cpu.installExecutionImage(slot as 0 | 1);
				}
			}

			let unmappedCount = 0;
			for (const continuation of cpu.rawContinuations()) {
				const target = revisionsBySlot.get(continuation.slot);
				if (target === undefined) {
					continue;
				}
				const pc = relocatedContinuationPc(target.revision, target.previousImage, continuation.pc);
				const callSitePc = continuation.callSitePc === null ? null
					: relocatedCallSitePc(target.revision, target.previousImage, continuation.callSitePc);
				const epcWord = continuation.epcWord === null ? null
					: relocatedContinuationPc(target.revision, target.previousImage, continuation.epcWord);
				const nmiReturnEpcWord = continuation.nmiReturnEpcWord === null ? null
					: relocatedContinuationPc(target.revision, target.previousImage, continuation.nmiReturnEpcWord);
				if (pc < 0 || callSitePc === -1 || epcWord === -1 || nmiReturnEpcWord === -1) {
					unmappedCount += 1;
					continue;
				}
				cpu.relocateFrame(
					continuation.frameIndex,
					target.revision.functionAddresses[continuation.functionIndex],
					pc,
					callSitePc,
					epcWord,
					nmiReturnEpcWord,
				);
			}
			if (unmappedCount > 0) {
				throw new Error(
					`Hot resume could not relocate ${unmappedCount} active continuation(s) after an incompatible edit.`,
				);
			}
			setActiveBlua32MediaSymbols(loadBlua32MediaSymbols());
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
