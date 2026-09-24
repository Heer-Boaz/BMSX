import { performHotResume, performReboot } from '../commands/actions';
import type { BootOperation } from '../workbench/services/execution/boot';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import type { HostAudioOutput } from '../../hosts/common/audio_output';
import { openLuaCodeTab } from '../workbench/ui/code_tab/io';
import { activeCodeEditor, type CodeEditorContext } from '../editor/ui/code_editor_state';
import { activateEditor } from '../workbench/overlay_modes';
import { selectAllSingleCursor } from '../editor/editing/cursor/state';
import { insertText } from '../editor/editing/text_editing_and_selection';
import {
	resolveRuntimeResourceForContext,
	type RuntimeSourceState,
} from '../runtime/sources';
import type { RuntimeIdeState } from '../workbench/state';
import type { StackTraceFrame } from '../runtime/stack_trace';
import { blua32ToolingImageForDomain } from '../../toolchain/ts/rompack/blua32_media';
import type { EditorCommandId } from '../common/commands';
import type { LuaSignatureHelp } from '../../toolchain/ts/lua/semantic/signature_help';
import type { HotResumeOperation } from '../workbench/services/execution/hot_resume';
import { getActiveCodeTabContext } from '../workbench/ui/code_tab/contexts';
import { updateHoverTooltip } from '../editor/contrib/hover/controller';
import { hoverState, type CodeHoverTooltip } from '../editor/contrib/hover/state';
import type { CodeTabContext } from '../workbench/ui/code_tab/model';
import type { EditorInput } from '../workbench/ui/tab/model';
import { getActiveTab, getTabs } from '../workbench/ui/tabs';
import type {
	RecordedLogMessage,
	RecordingLogOutput,
} from './recording_log_output';

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
	isWorkbenchActive(): boolean;
	isCartActive(): boolean;
	getTrackedLuaHeapBytes(): number;
	getLogMessageCount(): number;
	getLogMessage(index: number): RecordedLogMessage;
	getFaultStack(): ReadonlyArray<StackTraceFrame>;
	getSignatureHelp(): LuaSignatureHelp | null;
	getHover(row: number, column: number): CodeHoverTooltip | null;
	getActiveWorkbenchTab(): Readonly<EditorInput>;
	getActiveCodeContext(): Readonly<CodeTabContext> | null;
	getActiveEditorDocument(): Readonly<CodeEditorContext>;
	getWorkbenchTabs(): readonly EditorInput[];
	/** Full IDE operation: admission releases the queue; completion waits for physical init. */
	performHotResume(): HotResumeOperation;
	toggleLuaBreakpoint(path: string, line: number): void;
	isDebuggerStopped(): boolean;
	reboot(): BootOperation;
	executeCommand(command: EditorCommandId): void;
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

export function createHeadlessIdeHarness(
	ide: RuntimeIdeState,
	runtime: Runtime,
	audioOutput: HostAudioOutput,
	logOutput: RecordingLogOutput,
): HeadlessIdeHarness {
	return {
		getRuntime: () => runtime,
		getSourceState: () => ide.sources,
		isWorkbenchActive: () => ide.overlayRenderer.active,
		isCartActive: () => runtime.machine.cpu.isCartridgeExecutionActive(),
		getTrackedLuaHeapBytes: () => runtime.machine.cpu.luaHeap.usedBytes(),
		getLogMessageCount: () => logOutput.messages.length,
		getLogMessage: index => logOutput.messages[index],
		getFaultStack: () => ide.fault.lastLuaCallStack,
		getSignatureHelp: () => ide.editor.completion.hint,
		getActiveWorkbenchTab: () => getActiveTab(),
		getActiveCodeContext: () => getActiveCodeTabContext(),
		getActiveEditorDocument: () => activeCodeEditor,
		getWorkbenchTabs: () => getTabs(),
		getHover: (row, column) => {
			updateHoverTooltip(
				ide.luaTooling,
				ide.fault,
				runtime,
				getActiveCodeTabContext(),
				row,
				column,
			);
			return hoverState.tooltip;
		},
		performHotResume: () => performHotResume(
			ide.hotResumes, ide.editor, ide.execution, ide.overlayRenderer, audioOutput, logOutput,
		),
		toggleLuaBreakpoint: (path: string, line: number) => {
			const resource = resolveRuntimeResourceForContext(
				ide.sources,
				ide.sources.activeCartridgeSlot,
				path,
			)!;
			ide.debugger.breakpoints.toggle(resource, line);
		},
		isDebuggerStopped: () => ide.debugger.source.stop !== undefined,
		reboot: () => performReboot(
			ide.boots, ide.editor, ide.execution, ide.overlayRenderer, audioOutput, logOutput,
		),
		executeCommand: command => ide.editor.commands.execute(command),
		openLuaSource: (path: string) => {
			activateEditor(
				ide.editor,
				ide.sources,
				runtime,
				audioOutput,
			);
			const resource = resolveRuntimeResourceForContext(
				ide.sources,
				ide.sources.activeCartridgeSlot,
				path,
			)!;
			openLuaCodeTab(ide.editor.editorPanes, ide.sources, resource);
		},
		replaceActiveCodeSource: (source: string) => {
			const buffer = activeCodeEditor.model.buffer;
			const lastRow = buffer.getLineCount() - 1;
			selectAllSingleCursor(
				activeCodeEditor.view,
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
			cpu.collectTrackedHeapBytes();
			const tracked = cpu.luaHeap.usedBytes();
			const stringBytes = cpu.stringPool.trackedLuaHeapBytes();
			return {
				tracked,
				stringBytes,
				objectBytes: tracked - stringBytes,
				moduleFunctions: executable.symbols!.moduleFunctions.length,
				functions: executable.layout.functions.length,
				constants: executable.layout.constants.length,
				codeBytes: executable.layout.header.textByteCount,
				globals: cpu.globalSlotCount,
			};
		},
	};
}
