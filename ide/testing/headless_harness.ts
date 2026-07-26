import { collectTrackedLuaHeapBytes, getTrackedLuaHeapBytes } from '../../machine/ts/machine/memory/lua_heap_usage';
import { hotResume } from '../runtime/hot_resume';
import { performHotResume } from '../commands/actions';
import { rebootPreparedRuntime } from '../workbench/blua32_boot';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { openLuaCodeTab } from '../workbench/ui/code_tab/io';
import { editorDocumentState } from '../editor/editing/document_state';
import { activateEditor } from '../workbench/overlay_modes';
import { selectAllSingleCursor } from '../editor/editing/cursor/state';
import { insertText } from '../editor/editing/text_editing_and_selection';
import { resolveResourceDescriptorForContext } from '../workbench/contrib/resources/lookup';
import type { RuntimeSourceState } from '../runtime/sources';
import type { RuntimeIdeState } from '../runtime/state';
import { blua32ToolingImageForDomain } from '../../machine/ts/rompack/tooling/blua32_media';

/**
 * Host-side test surface for the IDE/runtime. The headless composition root creates
 * it from the retained IDE and runtime owners, so every action targets the machine
 * that is actually executing the cart.
 *
 * IDE actions must be invoked *between* frames (never re-entrantly from inside Lua
 * execution); the headless `--ide-test` runner guarantees this by running scenarios
 * as host-side async code while the frame loop ticks independently.
 */
export type HeadlessIdeHarness = {
	getRuntime(): Runtime;
	getSourceState(): RuntimeSourceState;
	isCartActive(): boolean;
	getTrackedLuaHeapBytes(): number;
	/**
	 * Rebuild the physical BLua32 cartridge image and apply it to the live CPU state.
	 */
	hotResumeCore(): void;
	/** Full IDE hot-resume action (fire-and-forget; settle by advancing frames). */
	performHotResume(): void;
	reboot(): Promise<void>;
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

export function createHeadlessIdeHarness(ide: RuntimeIdeState, runtime: Runtime): HeadlessIdeHarness {
	return {
		getRuntime: () => runtime,
		getSourceState: () => ide.sources,
		isCartActive: () => runtime.machine.cpu.isCartridgeExecutionActive() && runtime.isInitialized,
		getTrackedLuaHeapBytes,
		hotResumeCore: () => {
			const slot = runtime.machine.cpu.activeCartridgeSlot();
			hotResume(
				ide.sources,
				ide.nativeBridge,
				ide.fault,
				ide.editor,
				runtime,
				slot < 0,
				[slot === 0, slot === 1],
			);
		},
		performHotResume: () => {
			performHotResume(
				ide.editor,
				ide.sources,
				ide.fault,
				ide.nativeBridge,
				ide.overlayRenderer,
				runtime,
			);
		},
		reboot: () => rebootPreparedRuntime(
			ide.sources,
			ide.fault,
			ide.nativeBridge,
			ide.editor,
			ide.luaGate,
			ide.overlayRenderer,
			runtime,
		),
		openLuaSource: (path: string) => {
			activateEditor(ide.editor, ide.sources, ide.overlayRenderer, runtime);
			const descriptor = resolveResourceDescriptorForContext(
				ide.sources,
				ide.sources.activeCartridgeSlot,
				path,
			);
			openLuaCodeTab(ide.editor.resourcePanel, ide.sources, descriptor);
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
			const cpu = runtime.machine.cpu;
			const slot = cpu.activeCartridgeSlot();
			const sourceState = ide.sources;
			const executable = blua32ToolingImageForDomain(sourceState.currentBlua32Media, slot)!;
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
				functions: executable.layout.functions.length,
				constants: executable.layout.constants.length,
				codeBytes: executable.layout.header.textByteCount,
				globals,
			};
		},
	};
}
