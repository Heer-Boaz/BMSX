import { $ } from '../../core/engine_core';
import { drawEditorText } from './text_renderer';
import { CompletionController } from './completion_controller';
import { ProblemsPanelController } from './problems_panel';
import { createEntryTabContext, getActiveCodeTabContext, initializeTabs, isCodeTabActive } from './editor_tabs';
import { applyInlineFieldEditing, createInlineTextField } from './inline_text_field';
import { buildMemberCompletionItems, intellisenseUiReady, shouldAutoTriggerCompletions } from './intellisense';
import { Scrollbar, ScrollbarController } from './scrollbar';
import { ResourcePanelController } from './resource_panel_controller';
import { InputController, shouldRepeatKeyFromPlayer } from './ide_input';
import { ide_state } from './ide_state';
import { initializeDebuggerUiState } from './ide_debugger';
import { revealCursor } from './caret';
import { initializeWorkspaceStorage } from './workspace_storage';
import * as TextEditing from './text_editing_and_selection';
import { resetBlink } from './render/render_caret';
import { api, Runtime } from '../runtime';
import { RenameController } from './rename_controller';
import type { CodeTabContext } from './types';
import { LuaSemanticWorkspace } from './semantic_model';
import { assertMonospace, measureText } from './text_utils';
import * as constants from './constants';
import type { Viewport } from '../../rompack/rompack';
import {
	applyViewportSize,
	configureFontVariant,
	resetResourcePanelState,
} from './editor_view';
import {
	applyCreateResourceFieldText,
	applyLineJumpFieldText,
	applyResourceSearchFieldText,
	applySearchFieldText,
	applySymbolSearchFieldText,
	commitRename,
	createNavigationEntry,
	focusEditorFromRename,
	getActiveSemanticDefinitions,
	getLuaModuleAliases,
	redo,
	undo,
	updateDesiredColumn,
} from './cart_editor';

export function initializeCartEditor(viewport: Viewport): void {
	initializeDebuggerUiState();
	const runtime = Runtime.instance;
	ide_state.playerIndex = runtime.playerIndex;
	ide_state.fontVariant = runtime.activeIdeFontVariant;
	constants.setIdeThemeVariant(constants.DEFAULT_THEME);
	ide_state.themeVariant = constants.getActiveIdeThemeVariant();
	ide_state.canonicalization = $.assets.canonicalization;
	ide_state.caseInsensitive = ide_state.canonicalization !== 'none';
	ide_state.preMutationSource = null;
	applyViewportSize(viewport);
	ide_state.clockNow = $.platform.clock.now;
	ide_state.semanticWorkspace = new LuaSemanticWorkspace();
	configureFontVariant(ide_state.fontVariant);
	ide_state.searchField = createInlineTextField();
	ide_state.symbolSearchField = createInlineTextField();
	ide_state.resourceSearchField = createInlineTextField();
	ide_state.lineJumpField = createInlineTextField();
	ide_state.createResourceField = createInlineTextField();
	initializeWorkspaceStorage($.assets.project_root_path);
	applySearchFieldText(ide_state.searchQuery, true);
	applySymbolSearchFieldText(ide_state.symbolSearchQuery, true);
	applyResourceSearchFieldText(ide_state.resourceSearchQuery, true);
	applyLineJumpFieldText(ide_state.lineJumpValue, true);
	applyCreateResourceFieldText(ide_state.createResourcePath, true);
	ide_state.scrollbars = {
		codeVertical: new Scrollbar('codeVertical', 'vertical'),
		codeHorizontal: new Scrollbar('codeHorizontal', 'horizontal'),
		resourceVertical: new Scrollbar('resourceVertical', 'vertical'),
		resourceHorizontal: new Scrollbar('resourceHorizontal', 'horizontal'),
		viewerVertical: new Scrollbar('viewerVertical', 'vertical'),
	};
	ide_state.scrollbarController = new ScrollbarController(ide_state.scrollbars);
	ide_state.resourcePanel = new ResourcePanelController({
		resourceVertical: ide_state.scrollbars.resourceVertical,
		resourceHorizontal: ide_state.scrollbars.resourceHorizontal,
	});
	ide_state.completion = new CompletionController({
		isCodeTabActive: () => isCodeTabActive(),
		getBuffer: () => ide_state.buffer,
		getCursorRow: () => ide_state.cursorRow,
		getCursorColumn: () => ide_state.cursorColumn,
		setCursorPosition: (row, column) => {
			ide_state.cursorRow = row;
			ide_state.cursorColumn = column;
		},
		setSelectionAnchor: (row, column) => {
			ide_state.selectionAnchor = { row, column };
		},
		replaceSelectionWith: (text) => TextEditing.replaceSelectionWith(text),
		updateDesiredColumn: () => updateDesiredColumn(),
		resetBlink: () => resetBlink(),
		revealCursor: () => revealCursor(),
		measureText: (text) => measureText(text),
		drawText: (text, x, y, color) => drawEditorText(ide_state.font, text, x, y, undefined, color),
		fillRect: (left, top, right, bottom, color) => api.put_rectfill(left, top, right, bottom, undefined, color),
		strokeRect: (left, top, right, bottom, color) => api.put_rect(left, top, right, bottom, undefined, color),
		getCursorScreenInfo: () => ide_state.cursorScreenInfo,
		characterAdvance: (char) => ide_state.font.advance(char),
		get lineHeight(): number { return ide_state.font.lineHeight; },
		getActiveCodeTabContext: () => getActiveCodeTabContext(),
		resolveHoverPath: (ctx: CodeTabContext) => ctx.descriptor.path,
		getSemanticDefinitions: () => getActiveSemanticDefinitions(),
		getLuaModuleAliases: (path) => getLuaModuleAliases(path),
		getMemberCompletionItems: (request) => buildMemberCompletionItems(request),
		charAt: (r, c) => TextEditing.charAt(r, c),
		getTextVersion: () => ide_state.textVersion,
		shouldFireRepeat: (code) => shouldRepeatKeyFromPlayer(code),
		shouldAutoTriggerCompletions: () => shouldAutoTriggerCompletions(),
		shouldShowParameterHints: () => intellisenseUiReady(),
	});
	ide_state.completion.enterCommitsCompletion = false;
	ide_state.input = new InputController();
	ide_state.problemsPanel = new ProblemsPanelController();
	ide_state.problemsPanel.setDiagnostics(ide_state.diagnostics);
	ide_state.renameController = new RenameController({
		processFieldEdit: (field, options) => applyInlineFieldEditing(field, options),
		shouldFireRepeat: (code) => shouldRepeatKeyFromPlayer(code),
		undo: () => undo(),
		redo: () => redo(),
		showMessage: (text, color, duration) => ide_state.showMessage(text, color, duration),
		commitRename: (payload) => commitRename(payload),
		onRenameSessionClosed: () => focusEditorFromRename(),
	}, ide_state.referenceState);
	ide_state.codeVerticalScrollbarVisible = false;
	ide_state.codeHorizontalScrollbarVisible = false;
	ide_state.cachedVisibleRowCount = 1;
	ide_state.cachedVisibleColumnCount = 1;
	initializeTabs(createEntryTabContext());
	resetResourcePanelState();
	ide_state.desiredColumn = ide_state.cursorColumn;
	assertMonospace();
	ide_state.lastSavedSource = '';
	ide_state.navigationHistory.current = createNavigationEntry();
	ide_state.initialized = true;
}
