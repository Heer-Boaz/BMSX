import type { PlayerInput } from '../../../../hosts/common/input/player';
import type { HostClock } from '../../../../hosts/common/clock';
import type { Runtime } from '../../../../machine/ts/machine/runtime/runtime';
import type { CartEditor } from '../../../cart_editor';
import type { Clipboard } from '../../../common/clipboard';
import * as constants from '../../../common/constants';
import type { MicrotaskQueue } from '../../../common/microtask_queue';
import type { PointerSnapshot } from '../../../common/models';
import { showEditorMessage } from '../../../common/feedback_state';
import { editorRuntimeState } from '../../../editor/common/runtime_state';
import { editorCaretState } from '../../../editor/ui/view/caret/state';
import { editorViewState } from '../../../editor/ui/view/state';
import { getCodeAreaBounds, scrollRows } from '../../../editor/ui/view/view';
import { renderCodeArea } from '../../../editor/render/code_area/area';
import { drawEditorText } from '../../../editor/render/text_renderer';
import { measureText } from '../../../editor/common/text/layout';
import type { EditorTextSelection } from '../../../editor/navigation/text_selection';
import { handleEditorClipboardAndCommandBindings, handleCodeFormattingKeybinding, handleSearchNavigationKeybinding } from '../../../input/keyboard/edit_bindings';
import { handleEditorPromptBindings } from '../../input/keyboard/prompt_bindings';
import { handleInlineWidgetInput, renderInlineWidgets } from '../../../quick_input/inline_widget';
import { handleQuickInputPointer } from '../../../input/quick_input/pointer/dispatch';
import { handleCodeAreaPointerInput } from '../../../input/pointer/code/index';
import { editorPointerState } from '../../../input/pointer/state';
import { editorInput } from './input/keyboard/text_input';
import { renameController } from './rename/controller';
import { referenceState } from '../../../editor/contrib/references/state';
import { editorSearchState, lineJumpState } from './find/widget_state';
import { getBreakpointsForChunk } from '../debugger/controller';
import { problemsPanel } from '../problems/panel/controller';
import { createResourceState } from '../resources/widget_state';
import { renderEditorContextMenu } from '../../render/context_menu';
import { editorChromeState } from '../../ui/chrome_state';
import {
	activateCodeEditorTab,
	applyActiveCodeTabSelection,
	storeCodeTabContext,
} from '../../ui/code_tab/activation';
import type { CodeEditorInput } from '../../ui/tab/model';
import { EditorPane } from '../../services/editor/editor_pane';
import type { RuntimeSourceState } from '../../../runtime/sources';
import type { RuntimeLuaTooling } from '../../../runtime/lua_tooling';
import type { RuntimeFaultState } from '../../../runtime/fault_state';
import type { RuntimeDebuggerState } from '../../../runtime/debugger_state';
import type { KeyValueStorage } from '../../../workspace/key_value_storage';
import { workspaceRecordState } from '../../../workspace/records';
import { buildStatusLeftInfo } from '../../render/status_bar_info';

export class CodeEditorPane extends EditorPane<CodeEditorInput> {
	public constructor(
		private readonly editor: CartEditor,
		private readonly clipboard: Clipboard,
		private readonly microtasks: MicrotaskQueue,
		private readonly storage: KeyValueStorage,
		private readonly clock: HostClock,
		private readonly sources: RuntimeSourceState,
		private readonly luaTooling: RuntimeLuaTooling,
		private readonly fault: RuntimeFaultState,
		private readonly runtime: Runtime,
		private readonly debuggerState: RuntimeDebuggerState,
	) {
		super();
	}

	protected activate(selection?: EditorTextSelection): void {
		this.editor.resourcePanel.hide();
		editorChromeState.resourcePanelResizing = false;
		activateCodeEditorTab(this.input, selection);
	}

	public override setOptions(selection?: EditorTextSelection): void {
		if (selection) {
			applyActiveCodeTabSelection(selection);
		}
	}

	public override clearInput(): void {
		storeCodeTabContext(this.input.context);
		super.clearInput();
	}

	public override update(deltaSeconds: number): void {
		this.editor.completion.processPending(deltaSeconds);
		const semanticError = editorViewState.layout.getLastSemanticError();
		if (semanticError && semanticError !== editorRuntimeState.lastReportedSemanticError) {
			showEditorMessage(semanticError, constants.COLOR_STATUS_ERROR, 2.0);
			editorRuntimeState.lastReportedSemanticError = semanticError;
		} else if (!semanticError && editorRuntimeState.lastReportedSemanticError) {
			editorRuntimeState.lastReportedSemanticError = null;
		}
	}

	public draw(): void {
		renderInlineWidgets();
		const resourcePanel = this.editor.resourcePanel;
		const problemsPanelHasFocus = problemsPanel.isVisible && problemsPanel.isFocused;
		const cursorActive = !(editorSearchState.active || lineJumpState.active || resourcePanel.isFocused() || createResourceState.active || problemsPanelHasFocus);
		const renameActive = renameController.isActive();
		const codeAreaViewport = renderCodeArea(
			this.editor.completion,
			this.editor.completion.getInlineCompletionPreview(),
			cursorActive,
			getBreakpointsForChunk(
				this.debuggerState,
				this.input.context.model.resource,
			),
			renameActive ? renameController.getHighlightMatches() : referenceState.getMatches(),
			renameActive ? renameController.getActiveIndex() : referenceState.getActiveIndex(),
			editorSearchState.matches,
			editorSearchState.currentIndex,
			editorSearchState.scope === 'local' && editorSearchState.query.length > 0,
		);
		renderEditorContextMenu(codeAreaViewport);
	}

	public handleKeyboard(playerInput: PlayerInput): void {
		if (handleEditorPromptBindings(playerInput, this.editor)) {
			return;
		}
		if (handleInlineWidgetInput(
			playerInput,
			this.clipboard,
			this.microtasks,
			this.storage,
			this.clock,
			this.editor,
			this.sources,
			this.luaTooling,
			this.editor.crossFileRename,
		)) {
			return;
		}
		if (handleSearchNavigationKeybinding(playerInput)) {
			return;
		}
		if (handleEditorClipboardAndCommandBindings(playerInput, this.clipboard, this.editor.commands)) {
			return;
		}
		if (this.editor.completion.handleKeybindings(playerInput)) {
			return;
		}
		if (handleCodeFormattingKeybinding(playerInput)) {
			return;
		}
		editorInput.handleEditorInput(playerInput, this.editor);
	}

	public handlePointer(
		snapshot: PointerSnapshot,
		justPressed: boolean,
		pointerSecondaryJustPressed: boolean,
		playerInput: PlayerInput,
		now: number,
		gotoModifierActive: boolean,
	): void {
		if (handleQuickInputPointer(this.microtasks, this.editor, this.sources, snapshot, justPressed)) {
			return;
		}
		handleCodeAreaPointerInput(
			this.editor,
			this.luaTooling,
			this.fault,
			this.runtime,
			snapshot,
			justPressed,
			gotoModifierActive,
			this.input.context,
			pointerSecondaryJustPressed,
			playerInput,
			now,
			this.clipboard,
		);
	}

	public handleWheel(
		direction: number,
		steps: number,
		activePointer: PointerSnapshot | null,
		playerInput: PlayerInput,
	): void {
		if (this.editor.completion.handlePointerWheel(
			direction,
			steps,
			activePointer ? { x: activePointer.viewportX, y: activePointer.viewportY } : null,
		)) {
			playerInput.inputHandlers.pointer?.consumeButton('pointer_wheel');
			return;
		}
		const pointer = editorPointerState.lastPointerSnapshot;
		if (pointer !== null) {
			const bounds = getCodeAreaBounds();
			if (!pointer.valid || !pointer.insideViewport || pointer.viewportY < bounds.codeTop || pointer.viewportY >= bounds.codeBottom || pointer.viewportX < bounds.codeLeft || pointer.viewportX >= bounds.codeRight) {
				playerInput.inputHandlers.pointer?.consumeButton('pointer_wheel');
				return;
			}
		}
		scrollRows(direction * steps);
		editorCaretState.cursorRevealSuspended = true;
		playerInput.inputHandlers.pointer?.consumeButton('pointer_wheel');
	}

	public drawStatusBar(statusTop: number, textColor: number): void {
		const leftX = 0;
		const statusLeftInfo = buildStatusLeftInfo();
		const itemSize = measureText('•');
		const indicatorColor = workspaceRecordState.connected
			? constants.COLOR_SERVER_STATUS_CONNECTED
			: constants.COLOR_SERVER_STATUS_DISCONNECTED;
		drawEditorText(editorViewState.font, '•', leftX, statusTop + 2, 0, indicatorColor);
		const textX = leftX + itemSize;
		if (statusLeftInfo && statusLeftInfo.length > 0) {
			drawEditorText(editorViewState.font, statusLeftInfo, textX, statusTop + 2, 0, textColor);
		}
		const context = this.input.context;
		let detail = '';
		let detailColor = textColor;
		if (context.model.runtimeSyncState === 'diverged') {
			detail = 'SAVED, RUNTIME NOT APPLIED';
			detailColor = constants.COLOR_STATUS_WARNING;
		} else if (context.model.runtimeSyncState === 'runtime_update_pending') {
			detail = 'RUNTIME UPDATE PENDING';
		}
		if (detail.length > 0) {
			drawEditorText(
				editorViewState.font,
				detail,
				editorViewState.viewportWidth - measureText(detail) - 4,
				statusTop + 2,
				0,
				detailColor,
			);
		}
	}
}
