import { $ } from '../../core/engine_core';
import { CompletionController } from './completion_controller';
import { ProblemsPanelController } from './problems_panel';
import { createEntryTabContext, initializeTabs } from './editor_tabs';
import { createInlineTextField } from './inline_text_field';
import { Scrollbar, ScrollbarController } from './scrollbar';
import { ResourcePanelController } from './contrib/resources/resource_panel_controller';
import { InputController } from './input/keyboard/editor_text_input';
import { ide_state } from './ide_state';
import { initializeDebuggerUiState } from './ide_debugger';
import { initializeWorkspaceStorage } from './workspace_storage';
import { Runtime } from '../runtime';
import { renameController } from './contrib/rename/rename_controller';
import { resetSemanticWorkspace } from './semantic_workspace_sync';
import { assertMonospace } from './text_utils';
import * as constants from './constants';
import type { Viewport } from '../../rompack/rompack';
import {
	applyViewportSize,
	configureFontVariant,
	resetResourcePanelState,
} from './editor_view';
import { applyResourceSearchFieldText } from './contrib/resources/resource_search';
import { applyLineJumpFieldText } from './line_jump';
import { applyCreateResourceFieldText } from './contrib/resources/create_resource';
import { applySearchFieldText } from './editor_search';
import { createNavigationEntry } from './navigation_history';
import { applySymbolSearchFieldText } from './contrib/symbols/symbol_search_shared';

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
	ide_state.completion = new CompletionController();
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
