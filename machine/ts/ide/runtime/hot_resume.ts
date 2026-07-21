import { machineManager } from '../../core/machine_manager';
import { convertToError } from '../../lua/value';
import { EMPTY_CALL_ARGS, type Closure } from '../../machine/cpu/cpu';
import type { ProgramImage } from '../../machine/program/loader';
import type { Runtime } from '../../machine/runtime/runtime';
import { clearOverlayFrame } from '../../render/host_overlay/overlay_queue';
import { linkProgramRevision, type LinkedProgramRevision } from '../../rompack/tooling/program_linker';
import { composeProgramCounterRelocations } from '../../rompack/tooling/program_revision';
import { callClosureIntoSuspended } from './closure_executor';
import { clearRuntimeDebuggerPause } from './debug_pause';
import { clearFaultSnapshot, resetHandledLuaErrors } from './fault_state';
import {
	buildProgramMedia,
	installProgramMedia,
	loadProgramImagesForSource,
	type RebuiltProgramMedia,
} from './lua_pipeline';

function assertLiveStorageLayoutUnchanged(previous: ProgramImage, rebuilt: ProgramImage): void {
	if (rebuilt.staticLayoutToken.lo !== previous.staticLayoutToken.lo
		|| rebuilt.staticLayoutToken.hi !== previous.staticLayoutToken.hi) {
		throw new Error('Hot resume cannot change the static storage layout.');
	}
}

/** Rebuilds changed physical ROM tails and links their protos into the live Lua state. */
export function hotResume(
	runtime: Runtime,
	rebuildSystem: boolean,
	rebuildCart: boolean,
): void {
	const interpreter = machineManager.ideState.nativeBridge.luaInterpreter;
	try {
		let rebuilt: RebuiltProgramMedia | null = null;
		let revision: LinkedProgramRevision | null = null;
		let systemVectors = runtime.systemVectors;
		let cartVectors = runtime.cartVectors;
		if (rebuildSystem || rebuildCart) {
			const sourceState = machineManager.sourceState;
			rebuilt = buildProgramMedia(
				interpreter,
				rebuildSystem,
				rebuildCart,
			);
			if (rebuilt.system !== null) {
				assertLiveStorageLayoutUnchanged(loadProgramImagesForSource('system').program, rebuilt.system.image);
			}
			if (rebuilt.cart !== null) {
				assertLiveStorageLayoutUnchanged(loadProgramImagesForSource('cart').program, rebuilt.cart.image);
			}

			if (rebuilt.system !== null) {
				revision = linkProgramRevision(
					runtime.machine.cpu.program,
					runtime.programMetadata!,
					rebuilt.system.object,
					rebuilt.system.objectMetadata,
					rebuilt.system.image,
					rebuilt.system.programAddress,
					sourceState.systemProgramSources,
					rebuilt.system.sources,
				);
				systemVectors = revision.vectors;
			}
			if (rebuilt.cart !== null) {
				const baseProgram = revision === null ? runtime.machine.cpu.program : revision.program;
				const baseMetadata = revision === null ? runtime.programMetadata! : revision.metadata;
				const next = linkProgramRevision(
					baseProgram,
					baseMetadata,
					rebuilt.cart.object,
					rebuilt.cart.objectMetadata,
					rebuilt.cart.image,
					rebuilt.cart.programAddress,
					sourceState.cartProgramSources!,
					rebuilt.cart.sources,
				);
				if (revision !== null) {
					composeProgramCounterRelocations(revision.pcRelocations, next.pcRelocations);
					next.pcRelocations = revision.pcRelocations;
				}
				revision = next;
				cartVectors = revision.vectors;
			}
		}

		clearRuntimeDebuggerPause(runtime);
		interpreter.clearLastFaultEnvironment();
		clearFaultSnapshot();
		resetHandledLuaErrors();
		runtime.luaRuntimeFailed = false;
		clearOverlayFrame();
		machineManager.sndmaster.resetPlaybackState();

		if (rebuilt !== null) {
			const linkedRevision = revision!;
			runtime.machine.cpu.setProgram(
				linkedRevision.program,
				linkedRevision.metadata,
				linkedRevision.metadata,
				systemVectors.irqProtoIndex,
				cartVectors.irqProtoIndex,
				systemVectors.exceptionProtoIndex,
			);
			runtime.machine.cpu.relocateActiveFrames(linkedRevision.pcRelocations);
			runtime.systemVectors = systemVectors;
			runtime.cartVectors = cartVectors;
			runtime.programRuntimeSymbols = linkedRevision.metadata;
			runtime.programMetadata = linkedRevision.metadata;
			installProgramMedia(runtime, rebuilt);
			machineManager.ideState.editor.clearNativeMemberCompletionCache();
		}
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
