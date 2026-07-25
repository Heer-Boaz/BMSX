import { machineManager } from '../../machine/ts/core/machine_manager';
import { collectTrackedLuaHeapBytes, getTrackedLuaHeapBytes } from '../../machine/ts/machine/memory/lua_heap_usage';
import { hotResume } from '../runtime/hot_resume';
import { performHotResume } from '../commands/actions';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { openLuaCodeTab } from '../workbench/ui/code_tab/io';
import { editorDocumentState } from '../editor/editing/document_state';
import { activateEditor } from '../workbench/overlay_modes';
import { selectAllSingleCursor } from '../editor/editing/cursor/state';
import { insertText } from '../editor/editing/text_editing_and_selection';
import { loadBlua32Image } from '../runtime/lua_pipeline';
import { CART_ROM_BASE, SYSTEM_ROM_BASE } from '../../machine/ts/machine/memory/map';
import { SYSTEM_EXECUTION_DOMAIN_ID } from '../../machine/ts/machine/cpu/execution_address_space';
import { findResourceDescriptorForContext } from '../workbench/contrib/resources/lookup';

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
	 * Rebuild the physical BLua32 cartridge image and apply it to the live CPU state.
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
	moduleFunctions: number;
	functions: number;
	constants: number;
	codeBytes: number;
	globals: number;
};

function requireRuntime(): Runtime {
	const runtime = machineManager.runtime;
	if (!runtime) {
		throw new Error('Runtime is not booted yet.');
	}
	return runtime;
}

export const headlessIdeHarness: HeadlessIdeHarness = {
	getRuntime: requireRuntime,
	isCartActive: () => {
		const runtime = machineManager.runtime;
		return !!runtime && runtime.machine.cpu.isCartridgeExecutionActive() && runtime.isInitialized;
	},
	getTrackedLuaHeapBytes,
	hotResumeCore: () => {
		const runtime = requireRuntime();
		const slot = runtime.machine.cpu.activeCartridgeSlot();
		hotResume(runtime, slot < 0, [slot === 0, slot === 1]);
	},
	performHotResume: () => {
		performHotResume(requireRuntime());
	},
	openLuaSource: (path: string) => {
		activateEditor(requireRuntime());
		const descriptor = findResourceDescriptorForContext(
			machineManager.sourceState.activeCartridgeSlot,
			path,
		)!;
		openLuaCodeTab(descriptor);
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
		const slot = cpu.activeCartridgeSlot();
		const sourceState = machineManager.sourceState;
		const layer = slot === SYSTEM_EXECUTION_DOMAIN_ID
			? sourceState.systemRom
			: sourceState.cartridgeSlots[slot]!.rom;
		const source = slot === SYSTEM_EXECUTION_DOMAIN_ID
			? sourceState.systemRomSource
			: sourceState.cartridgeSlots[slot]!.romSource;
		const executable = loadBlua32Image(
			source,
			slot === SYSTEM_EXECUTION_DOMAIN_ID ? SYSTEM_ROM_BASE : CART_ROM_BASE,
			layer.header.blua32ImageOffset,
		);
		collectTrackedLuaHeapBytes();
		const tracked = getTrackedLuaHeapBytes();
		const stringBytes = cpu.stringPool.trackedLuaHeapBytes();
		let globals = 0;
		cpu.globals.forEachEntry(() => { globals += 1; });
		return {
			tracked,
			stringBytes,
			objectBytes: tracked - stringBytes,
			moduleFunctions: executable.symbols!.moduleFunctions.length,
			functions: executable.image.functions.length,
			constants: executable.image.constants.length,
			codeBytes: executable.image.header.textByteCount,
			globals,
		};
	},
};
