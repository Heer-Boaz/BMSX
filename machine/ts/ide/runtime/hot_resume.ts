import { convertToError } from '../../lua/value';
import { clearOverlayFrame } from '../../render/host_overlay/overlay_queue';
import { compileLuaChunkToProgram, encodeCompiledProgramImage } from '../../lua/compiler';
import { ROM_GENERATED_CONST_MODULE_PATHS } from '../../rompack/format';
import { inflateExecutableProgramImage } from '../../machine/program/linker';
import { callClosureIntoSuspended } from './closure_executor';
import type { Closure } from '../../machine/cpu/cpu';
import type { RuntimeResumeSnapshot } from './resume_snapshot';
import { restoreRuntimeLuaSnapshot } from './resume_snapshot';
import { applyRuntimeMachineState } from '../../machine/runtime/machine_state';
import { machineManager } from '../../core/machine_manager';
import { clearRuntimeDebuggerPause } from './debug_pause';
import { clearFaultSnapshot, resetHandledLuaErrors } from './fault_state';
import { toLuaModulePath } from '../../machine/program/loader';
import {
	buildModuleChunks,
	refreshLuaHandlersForChunk,
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
	machineManager.ideState.nativeBridge.luaInterpreter.clearLastFaultEnvironment();
	clearFaultSnapshot();

	resetHandledLuaErrors();
	runtime.luaRuntimeFailed = false;
	clearOverlayFrame();
	applyRuntimeMachineState(runtime, snapshot.machineState);
	resumeLuaProgramState(runtime, snapshot, preserveSystemModules);
}

export function resumeLuaProgramState(runtime: Runtime, snapshot: RuntimeResumeSnapshot, preserveSystemModules?: boolean): void {
	const binding = snapshot.luaPath;
	try {
		const source = resourceSourceForChunk(binding);
		machineManager.sourceState.currentPath = binding;
		hotResumeProgramEntry(runtime, {
			path: binding,
			source,
			preserveSystemModules: preserveSystemModules ?? runtime.cartProgramStarted,
		});
		restoreRuntimeLuaSnapshot(snapshot);
		refreshLuaModulesOnResume(binding);
		machineManager.ideState.editor.clearNativeMemberCompletionCache();
		runHotResumeInit(runtime);
	}
	catch (error) {
		throw convertToError(error);
	}
}

export function hotResumeProgramEntry(runtime: Runtime, params: { path: string; source: string; preserveSystemModules?: boolean }): void {
	const preserveRuntimeFailure = runtime.luaRuntimeFailed || (machineManager.ideState.debugger.pauseCoordinator.hasSuspension() && machineManager.ideState.debugger.pauseCoordinator.getPendingException() !== null);
	const { path: binding, source } = params;
	const baseMetadata = runtime.programMetadata;
	if (!baseMetadata) {
		throw new Error('hot reload requires program symbols.');
	}
	const interpreter = machineManager.ideState.nativeBridge.luaInterpreter;
	interpreter.clearLastFaultEnvironment();
	const chunk = interpreter.compileChunk(source, binding);
	const { modules } = buildModuleChunks(
		toLuaModulePath(binding),
		params.preserveSystemModules ? [machineManager.sourceState.activeLuaSources] : undefined,
	);
	const baseProgram = runtime.machine.cpu.program;
	if (!baseProgram) {
		throw new Error('hot reload requires active program.');
	}
	const compiled = compileLuaChunkToProgram(chunk, modules, {
		baseProgram,
		baseMetadata,
		optLevel: machineManager.sourceState.realtimeCompileOptLevel,
		entrySource: source,
		constModulePaths: ROM_GENERATED_CONST_MODULE_PATHS,
	});
	const programImage = encodeCompiledProgramImage(compiled);
	const program = inflateExecutableProgramImage(programImage, runtime.programDataBaseAddress, runtime.programBssBaseAddress);
	if (!params.preserveSystemModules) {
		runtime.moduleCache.clear();
	}
	// True hot-resume: keep every live module object. Closures reference their
	// proto by index, and compiling against baseProgram replaces those protos in
	// place, so already-loaded modules run the new code without being re-required.
	// Re-requiring would build a redundant second module generation (the heap
	// doubling that pushed resume over the RAM budget) and discard live state.
	runtime.machine.cpu.setProgram(program, programImage.link.symbols, compiled.metadata);
	runtime.luaRuntimeFailed = preserveRuntimeFailure;
	machineManager.sourceState.currentPath = binding;
	runtime.programRuntimeSymbols = programImage.link.symbols;
	runtime.programMetadata = compiled.metadata;
}

function runHotResumeInit(runtime: Runtime): void {
	const initClosure = runtime.machine.cpu.getGlobalByKey(runtime.internString('init')) as Closure;
	const results = runtime.luaScratch.values.acquire();
	try {
		callClosureIntoSuspended(runtime, initClosure, [], results);
	} finally {
		runtime.luaScratch.values.release(results);
	}
}

function refreshLuaModulesOnResume(resumeModuleId: string): void {
	const records = machineManager.sourceState.activeLuaSources.records;
	for (let index = 0; index < records.length; index += 1) {
		const moduleId = records[index].source_path;
		if (moduleId === resumeModuleId) {
			continue;
		}
		refreshLuaHandlersForChunk(moduleId);
	}
}
