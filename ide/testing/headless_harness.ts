import { performHotResume, performReboot } from '../commands/actions';
import type { BootOperation } from '../workbench/services/execution/boot';
import type { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { openLuaCodeTab } from '../workbench/ui/code_tab/io';
import type { CodeEditorContext } from '../editor/ui/code_editor_state';
import type { CodeEditorPane } from '../workbench/contrib/code_editor/editor_pane';
import { activateEditor } from '../workbench/overlay_modes';
import { selectAllSingleCursor } from '../editor/editing/cursor/state';
import { insertText } from '../editor/editing/text_editing_and_selection';
import {
	type RuntimeSourceState,
} from '../runtime/sources';
import type { RuntimeIdeState } from '../workbench/state';
import type { StackTraceFrame } from '../runtime/stack_trace';
import { blua32ToolingImageForDomain } from '../../toolchain/ts/rompack/blua32_media';
import type { EditorCommandId } from '../common/commands';
import type { ContextMenuController } from '../workbench/services/context_menu/controller';
import type { LuaSignatureHelp } from '../../toolchain/ts/lua/semantic/signature_help';
import type { HotResumeOperation } from '../workbench/services/execution/hot_resume';
import { getActiveCodeTabContext } from '../workbench/ui/code_tab/contexts';
import type { CodeHoverTooltip } from '../editor/contrib/hover/state';
import type { CodeTabContext } from '../workbench/ui/code_tab/model';
import type { EditorInput } from '../workbench/common/editor_inputs';
import type { EditorGroupView } from '../workbench/services/editor/editor_group';
import type { WorkbenchMainAreaLayout } from '../workbench/common/main_area_layout';
import type { ResourcePanelController } from '../workbench/contrib/resources/panel/controller';
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
	getActiveEditorDocument(): Readonly<CodeEditorContext> | null;
	getWorkbenchTabs(): readonly EditorInput[];
	/** Observe existing UI owners; workflows still deliver gestures through host control input. */
	getActiveEditorGroup(): Readonly<EditorGroupView>;
	getMainAreaLayout(): Readonly<WorkbenchMainAreaLayout>;
	getResourcePanel(): Readonly<ResourcePanelController>;
	getContextMenu(): Readonly<Pick<ContextMenuController, 'visible' | 'model' | 'invocationOrigin' | 'returnFocus'>>;
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
		getSignatureHelp: () => {
			const pane = ide.editor.editorParts.activeGroup.panes.activePane;
			return pane?.input.kind === 'code_editor' ? (pane as CodeEditorPane).completion.hint : null;
		},
		getActiveWorkbenchTab: () => ide.editor.editorParts.activeGroup.model.activeTab,
		getActiveCodeContext: () => getActiveCodeTabContext(ide.editor.editorParts.activeGroup),
		getActiveEditorDocument: () => {
			const pane = ide.editor.editorParts.activeGroup.panes.activePane;
			return pane?.input.kind === 'code_editor' ? (pane as CodeEditorPane).code : null;
		},
		getWorkbenchTabs: () => ide.editor.editorParts.activeGroup.model.tabs,
		getActiveEditorGroup: () => ide.editor.editorParts.activeGroup,
		getMainAreaLayout: () => ide.editor.editorParts.mainArea,
		getResourcePanel: () => ide.editor.resourcePanel,
		getContextMenu: () => ide.editor.contextMenu,
		getHover: (row, column) => {
			const pane = ide.editor.editorParts.activeGroup.panes.activePane;
			if (pane?.input.kind !== 'code_editor') return null;
			const source = pane as CodeEditorPane;
			source.hover.update(row, column);
			return source.code.hoverTooltip;
		},
		performHotResume: () => performHotResume(
			ide.hotResumes, ide.editor, ide.execution, ide.overlayRenderer, logOutput,
			ide.runTargets, { action: 'hot-resume', presentation: { group: ide.editor.editorParts.activeGroup, generation: ide.editor.editorParts.activeGroup.panes.openGeneration } },
		),
		toggleLuaBreakpoint: (path: string, line: number) => {
			const resource = (ide.sources.catalog.resolveResource({ contextId: ide.sources.activeContextId, path })
				?? ide.sources.catalog.resolveModule(ide.sources.activeContextId, path))!;
			ide.debugger.breakpoints.toggle(resource, line);
		},
		isDebuggerStopped: () => ide.debugger.source.stop !== undefined,
		reboot: () => performReboot(
			ide.boots, ide.editor, ide.execution, ide.overlayRenderer, logOutput,
			ide.runTargets, { action: 'reboot', presentation: { group: ide.editor.editorParts.activeGroup, generation: ide.editor.editorParts.activeGroup.panes.openGeneration } },
		),
		executeCommand: command => ide.editor.commands.execute(command),
		openLuaSource: (path: string) => {
			activateEditor(
				ide.editor,
				ide.sources,
				runtime,
			);
			const resource = (ide.sources.catalog.resolveResource({ contextId: ide.sources.activeContextId, path })
				?? ide.sources.catalog.resolveModule(ide.sources.activeContextId, path))!;
			openLuaCodeTab(ide.editor.editorParts.activeGroup, ide.sources.catalog, ide.sources.catalog.resolveResource(resource)!);
		},
		replaceActiveCodeSource: (source: string) => {
			const code = (ide.editor.editorParts.activeGroup.panes.activePane as CodeEditorPane).code;
			const buffer = code.model.buffer;
			const lastRow = buffer.getLineCount() - 1;
			selectAllSingleCursor(
				code.view,
				lastRow,
				buffer.getLineEndOffset(lastRow) - buffer.getLineStartOffset(lastRow),
			);
			insertText(code, source);
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
