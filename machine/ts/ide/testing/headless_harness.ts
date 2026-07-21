import { machineManager } from '../../core/machine_manager';
import { collectTrackedLuaHeapBytes, getTrackedLuaHeapBytes } from '../../machine/memory/lua_heap_usage';
import { hotResume } from '../runtime/hot_resume';
import { performHotResume } from '../commands/actions';
import type { Runtime } from '../../machine/runtime/runtime';
import { openLuaCodeTab } from '../workbench/ui/code_tab/io';
import { editorDocumentState } from '../editor/editing/document_state';
import { activateEditor } from '../workbench/overlay_modes';
import { selectAllSingleCursor } from '../editor/editing/cursor/state';
import { insertText } from '../editor/editing/text_editing_and_selection';

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
	 * Rebuild the physical program tail and link it into the live Lua state.
	 */
	hotResumeCore(): void;
	/** Full IDE hot-resume action (fire-and-forget; settle by advancing frames). */
	performHotResume(): void;
	openLuaSource(path: string): void;
	replaceActiveCodeSource(source: string): void;
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
	codeBytes: number;
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
	hotResumeCore: () => {
		const runtime = requireRuntime();
		const cartProgramStarted = runtime.cartProgramStarted;
		hotResume(runtime, !cartProgramStarted, cartProgramStarted);
	},
	performHotResume: () => {
		performHotResume(requireRuntime());
	},
	openLuaSource: (path: string) => {
		activateEditor(requireRuntime());
		openLuaCodeTab({ path, type: 'lua' });
	},
	replaceActiveCodeSource: (source: string) => {
		const buffer = editorDocumentState.buffer;
		const lastRow = buffer.getLineCount() - 1;
		selectAllSingleCursor(
			editorDocumentState,
			lastRow,
			buffer.getLineEndOffset(lastRow) - buffer.getLineStartOffset(lastRow),
		);
		insertText(source);
	},
	debugStats: () => {
		const runtime = requireRuntime();
		const cpu = runtime.machine.cpu;
		const program = cpu.program;
		collectTrackedLuaHeapBytes();
		const tracked = getTrackedLuaHeapBytes();
		const stringBytes = cpu.stringPool.trackedLuaHeapBytes();
		let globals = 0;
		cpu.globals.forEachEntry(() => { globals += 1; });
		return {
			tracked,
			stringBytes,
			objectBytes: tracked - stringBytes,
			moduleCache: runtime.moduleCache.size,
			moduleProtos: program.moduleProtos.length,
			protos: program.protos.length,
			constPool: program.constPool.length,
			codeBytes: program.code.byteLength,
			globals,
		};
	},
};
