import { machineManager } from '../../core/machine_manager';
import { getTrackedLuaHeapBytes } from '../../machine/memory/lua_heap_usage';
import { captureRuntimeResumeSnapshot } from '../../machine/runtime/resume_snapshot';
import { resumeFromSnapshot } from '../runtime/hot_resume';
import { performHotResume } from '../commands/actions';
import { activateTerminalMode, deactivateTerminalMode } from '../workbench/overlay_modes';
import type { Runtime } from '../../machine/runtime/runtime';

/**
 * Host-side test surface for the IDE/runtime, exposed through the `bmsx` global so
 * headless hosts can drive editor/terminal/hot-resume flows that normally only run
 * in the browser. Everything binds to the live runtime via `machineManager`, so the
 * harness operates on the same singletons that are actually executing the cart.
 *
 * IDE actions must be invoked *between* frames (never re-entrantly from inside Lua
 * execution); the headless `--ide-test` runner guarantees this by running scenarios
 * as host-side async code while the frame loop ticks independently.
 */
export type HeadlessIdeHarness = {
	getRuntime(): Runtime;
	isCartActive(): boolean;
	getTrackedLuaHeapBytes(): number;
	/**
	 * Core hot-resume: capture a runtime snapshot and resume from it. This is the
	 * exact churn path (snapshot serialize/restore + entry recompile + module
	 * reload) that the IDE's hot-resume runs, minus the workspace-override I/O.
	 */
	hotResumeCore(preserveSystemModules?: boolean): Promise<void>;
	/** Full IDE hot-resume action (fire-and-forget; settle by advancing frames). */
	performHotResume(): void;
	activateTerminal(): void;
	deactivateTerminal(): void;
	isTerminalActive(): boolean;
	/** Diagnostic breakdown of tracked-heap contributors, for leak hunting. */
	debugStats(): HeadlessIdeHeapStats;
};

export type HeadlessIdeHeapStats = {
	tracked: number;
	stringBytes: number;
	objectBytes: number;
	moduleCache: number;
	moduleProtos: number;
	protos: number;
	constPool: number;
	globals: number;
};

function requireRuntime(): Runtime {
	const runtime = machineManager.runtime;
	if (!runtime) {
		throw new Error('[HeadlessIdeHarness] Runtime is not booted yet.');
	}
	return runtime;
}

export const headlessIdeHarness: HeadlessIdeHarness = {
	getRuntime: requireRuntime,
	isCartActive: () => {
		const runtime = machineManager.runtime;
		return !!runtime && runtime.cartProgramStarted && runtime.isInitialized;
	},
	getTrackedLuaHeapBytes,
	hotResumeCore: async (preserveSystemModules) => {
		const runtime = requireRuntime();
		const snapshot = captureRuntimeResumeSnapshot(runtime);
		await resumeFromSnapshot(runtime, snapshot, preserveSystemModules);
	},
	performHotResume: () => {
		performHotResume(requireRuntime());
	},
	activateTerminal: () => activateTerminalMode(requireRuntime()),
	deactivateTerminal: () => deactivateTerminalMode(requireRuntime()),
	isTerminalActive: () => machineManager.ideState.terminal.isActive,
	debugStats: () => {
		const runtime = requireRuntime();
		const cpu = runtime.machine.cpu;
		const program = cpu.program;
		const tracked = getTrackedLuaHeapBytes();
		const stringBytes = cpu.stringPool.trackedLuaHeapBytes();
		let globals = 0;
		cpu.globals.forEachEntry(() => { globals += 1; });
		return {
			tracked,
			stringBytes,
			objectBytes: tracked - stringBytes,
			moduleCache: runtime.moduleCache.size,
			moduleProtos: runtime.moduleProtos.size,
			protos: program ? program.protos.length : 0,
			constPool: program ? program.constPool.length : 0,
			globals,
		};
	},
};
