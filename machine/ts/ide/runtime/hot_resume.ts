import { convertToError } from '../../lua/value';
import { clearOverlayFrame } from '../../render/host_overlay/overlay_queue';
import { compileLuaChunkToProgram, encodeCompiledProgramImage } from '../../machine/program/compiler';
import { ROM_ASSET_SYMBOL_MODULE_PATH } from '../../rompack/asset_symbols';
import { inflateExecutableProgramImage } from '../../machine/program/linker';
import { RuntimeResumeSnapshot } from '../../machine/runtime/contracts';
import { restoreRuntimeLuaSnapshot } from '../../machine/runtime/resume_snapshot';
import { applyRuntimeMachineState } from '../../machine/runtime/machine_state';
import { restoreVdpContextState } from '../../render/vdp/context_state';
import { clearRuntimeDebuggerPause } from './debug_pause';
import { clearFaultSnapshot, resetHandledLuaErrors } from './fault_state';
import { buildModuleProtoMap, toLuaModulePath } from '../../machine/program/loader';
import { IRQ_IMG_DONE, IRQ_IMG_ERROR } from '../../machine/bus/io';
import {
	buildModuleChunks,
	clearEditorCompletionCache,
	refreshLuaHandlersForChunk,
	replaceMapEntries,
	resourceSourceForChunk,
} from './lua_pipeline';
import type { Runtime } from '../../machine/runtime/runtime';

/**
 * Hot-resume orchestration.
 *
 * Owns the IDE-side flow that swaps a running program's code underneath the live
 * world: the game keeps its state while closures are repatched in place (true
 * edit-and-continue). The machine primitives this builds on (compilation,
 * module/proto installation) stay in `lua_pipeline`; keeping the orchestration
 * here matches the lean C++ runtime split, where edit-and-continue is a host/IDE
 * concern, not a machine concern.
 *
 * A cold reboot is a separate, unrelated path (machineManager.rebootToBootRom).
 */

export async function resumeFromSnapshot(runtime: Runtime, state: RuntimeResumeSnapshot, preserveSystemModules?: boolean): Promise<void> {
	clearRuntimeDebuggerPause(runtime);
	if (!state) {
		runtime.luaRuntimeFailed = false;
		throw new Error('cannot resume from invalid state snapshot.');
	}
	const snapshot: RuntimeResumeSnapshot = { ...state, luaRuntimeFailed: false };
	runtime.interpreter.clearLastFaultEnvironment();
	clearFaultSnapshot(runtime);

	resetHandledLuaErrors(runtime);
	runtime.luaRuntimeFailed = false;
	clearOverlayFrame();
	applyRuntimeMachineState(runtime, snapshot.machineState);
	restoreVdpContextState(runtime.machine.vdp, runtime.view);
	resumeLuaProgramState(runtime, snapshot, preserveSystemModules);
}

export function resumeLuaProgramState(runtime: Runtime, snapshot: RuntimeResumeSnapshot, preserveSystemModules?: boolean): void {
	const binding = snapshot.luaPath;
	try {
		const source = resourceSourceForChunk(runtime, binding);
		runtime._luaPath = binding;
		hotResumeProgramEntry(runtime, {
			path: binding,
			source,
			preserveSystemModules: preserveSystemModules ?? runtime.cartProgramStarted,
		});
	}
	catch (error) {
		throw convertToError(error);
	}
	refreshLuaModulesOnResume(runtime, binding);
	clearEditorCompletionCache(runtime);
	runtime.finishLuaEntryLifecycle(true, false);
	restoreRuntimeLuaSnapshot(runtime, snapshot);
}

export function hotResumeProgramEntry(runtime: Runtime, params: { path: string; source: string; preserveSystemModules?: boolean }): void {
	const preserveRuntimeFailure = runtime.luaRuntimeFailed || (runtime.pauseCoordinator.hasSuspension() && runtime.pauseCoordinator.getPendingException() !== null);
	const { path: binding, source } = params;
	const baseMetadata = runtime.programMetadata;
	if (!baseMetadata) {
		throw new Error('hot reload requires program symbols.');
	}
	const interpreter = runtime.interpreter;
	interpreter.clearLastFaultEnvironment();
	const chunk = interpreter.compileChunk(source, binding);
	const { modules } = buildModuleChunks(runtime, toLuaModulePath(binding));
	const baseProgram = runtime.machine.cpu.program;
	if (!baseProgram) {
		throw new Error('hot reload requires active program.');
	}
	const compiled = compileLuaChunkToProgram(chunk, modules, {
		baseProgram,
		baseMetadata,
		optLevel: runtime.realtimeCompileOptLevel,
		entrySource: source,
		constModulePaths: [ROM_ASSET_SYMBOL_MODULE_PATH],
	});
	const programImage = encodeCompiledProgramImage(compiled);
	const program = inflateExecutableProgramImage(programImage, compiled.metadata, runtime.programDataBaseAddress, runtime.programBssBaseAddress);
	replaceMapEntries(runtime.moduleProtos, buildModuleProtoMap(programImage.sections.rodata.moduleProtos));
	if (!params.preserveSystemModules) {
		runtime.moduleCache.clear();
		runtime.machine.imgDecController.reset();
		runtime.machine.irqController.acknowledge(IRQ_IMG_DONE | IRQ_IMG_ERROR);
	}
	// True hot-resume: keep every live module object. Closures reference their
	// proto by index, and compiling against baseProgram replaces those protos in
	// place, so already-loaded modules run the new code without being re-required.
	// Re-requiring would build a redundant second module generation (the heap
	// doubling that pushed resume over the RAM budget) and discard live state.
	runtime.machine.vdp.resetIngressState();
	runtime.machine.cpu.setProgram(program, compiled.metadata);
	runtime.startLoadedProgram(programImage.entryProtoIndex, null, [], false, false);
	runtime.luaRuntimeFailed = preserveRuntimeFailure;
	runtime._luaPath = binding;
	runtime.programMetadata = compiled.metadata;
	clearEditorCompletionCache(runtime);
}

function refreshLuaModulesOnResume(runtime: Runtime, resumeModuleId: string): void {
	const paths = Object.keys(runtime.activeLuaSources.path2lua);
	for (let index = 0; index < paths.length; index += 1) {
		const moduleId = paths[index];
		if (resumeModuleId && moduleId === resumeModuleId) {
			continue;
		}
		refreshLuaHandlersForChunk(runtime, moduleId);
	}
}
