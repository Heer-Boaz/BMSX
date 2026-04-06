import { $ } from '../../core/engine_core';
import { completionController, setCompletionContextSource, type CompletionContextSource } from './completion_controller';
import { ProblemsPanelController } from './problems_panel';
import { createEntryTabContext, initializeTabs } from './editor_tabs';
import { getActiveCodeTabContext } from './editor_tabs';
import { createInlineTextField } from './inline_text_field';
import { Scrollbar, ScrollbarController } from './scrollbar';
import { ResourcePanelController } from './resource_panel_controller';
import { InputController } from './ide_input';
import { ide_state } from './ide_state';
import * as TextEditing from './text_editing_and_selection';
import { revealCursor } from './caret';
import { resetBlink } from './render/render_caret';
import { initializeDebuggerUiState } from './ide_debugger';
import { initializeWorkspaceStorage } from './workspace_storage';
import { Runtime } from '../runtime';
import { renameController } from './rename_controller';
import { resetSemanticWorkspace } from './semantic_workspace_sync';
import { assertMonospace } from './text_utils';
import { measureText } from './text_utils';
import { drawEditorText } from './render/text_renderer';
import { getActiveSemanticDefinitions, getLuaModuleAliases, updateDesiredColumn, applySearchFieldText, createNavigationEntry } from './cart_editor';
import { intellisenseUiReady, shouldAutoTriggerCompletions } from './intellisense';
import * as constants from './constants';
import { clamp } from '../../utils/clamp';
import type { ModuleAliasEntry } from './semantic_model';
import type { Viewport } from '../../rompack/rompack';
import {
	applyViewportSize,
	configureFontVariant,
	resetResourcePanelState,
} from './editor_view';
import { applyLineJumpFieldText, applyResourceSearchFieldText, applySymbolSearchFieldText } from './search_bars';
import { applyCreateResourceFieldText } from './create_resource';

const editorCompletionContext: CompletionContextSource = {
	isCompletionReady: () => intellisenseUiReady(),
	shouldAutoTriggerCompletions: () => shouldAutoTriggerCompletions(),
	getBuffer: () => ide_state.buffer,
	getCursorPosition: () => ({ row: ide_state.cursorRow, column: ide_state.cursorColumn }),
	getTextVersion: () => ide_state.textVersion,
	getCursorScreenInfo: () => ide_state.cursorScreenInfo,
	getLineHeight: () => ide_state.lineHeight,
	getFont: () => ide_state.font,
	measureText: (value: string): number => measureText(value),
	drawText: (font, text, x, y, color): void => drawEditorText(font, text, x, y, undefined, color),
	getActivePath: () => {
		const context = getActiveCodeTabContext();
		return context.descriptor.path;
	},
	getActiveSemanticDefinitions: () => getActiveSemanticDefinitions(),
	getLuaModuleAliases: (path: string): Map<string, ModuleAliasEntry> => getLuaModuleAliases(path),
	getCharAt: (row: number, column: number): string => TextEditing.charAt(row, column),
	setCursorPosition: (row: number, column: number): void => {
		const rowCount = ide_state.buffer.getLineCount();
		const clampedRow = clamp(row, 0, Math.max(0, rowCount - 1));
		const line = ide_state.buffer.getLineContent(clampedRow);
		ide_state.cursorRow = clampedRow;
		ide_state.cursorColumn = clamp(column, 0, line.length);
	},
	setSelectionAnchor: (anchor: { row: number; column: number }): void => {
		const target = ide_state.selectionAnchor;
		if (!target) {
			ide_state.selectionAnchor = {
				row: anchor.row,
				column: anchor.column,
			};
			return;
		}
		target.row = anchor.row;
		target.column = anchor.column;
	},
	replaceSelectionWithText: (text: string): void => {
		TextEditing.replaceSelectionWith(text);
	},
	clampBufferPosition: (position: { row: number; column: number }): { row: number; column: number } => {
		return ide_state.layout.clampBufferPosition(ide_state.buffer, position);
	},
	afterCompletionApplied: () => {
		updateDesiredColumn();
		resetBlink();
		revealCursor();
	},
	clearSelectionAnchor: () => {
		ide_state.selectionAnchor = null;
	},
};

export function initializeCartEditor(viewport: Viewport): void {
	initializeDebuggerUiState();
	const runtime = Runtime.instance;
	ide_state.fontVariant = runtime.activeIdeFontVariant;
	constants.setIdeThemeVariant(constants.DEFAULT_THEME);
	ide_state.themeVariant = constants.getActiveIdeThemeVariant();
	ide_state.canonicalization = Runtime.instance.cartCanonicalization;
	ide_state.caseInsensitive = ide_state.canonicalization !== 'none';
	ide_state.preMutationSource = null;
	applyViewportSize(viewport);
	ide_state.clockNow = $.platform.clock.now;
	resetSemanticWorkspace();
	configureFontVariant(ide_state.fontVariant);
	ide_state.searchField = createInlineTextField();
	ide_state.symbolSearchField = createInlineTextField();
	ide_state.resourceSearchField = createInlineTextField();
	ide_state.lineJumpField = createInlineTextField();
	ide_state.createResourceField = createInlineTextField();
	initializeWorkspaceStorage($.cart_project_root_path);
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
	setCompletionContextSource(editorCompletionContext);
	ide_state.completion = completionController;
	ide_state.completion.closeSession();
	ide_state.completion.enterCommitsCompletion = false;
	ide_state.input = new InputController();
	ide_state.problemsPanel = new ProblemsPanelController();
	ide_state.problemsPanel.setDiagnostics(ide_state.diagnostics);
	ide_state.renameController = renameController;
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
