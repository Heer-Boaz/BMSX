import { $ } from '../../core/engine_core';
import { CompletionController } from '../contrib/suggest/completion_controller';
import { ProblemsPanelController } from '../contrib/problems/problems_panel';
import { createEntryTabContext, initializeTabs } from './editor_tabs';
import { createInlineTextField } from './inline_text_field';
import { Scrollbar, ScrollbarController } from './scrollbar';
import { ResourcePanelController } from '../contrib/resources/resource_panel_controller';
import { InputController } from '../input/keyboard/editor_text_input';
import { ide_state } from '../core/ide_state';
import { editorDiagnosticsState } from '../contrib/problems/diagnostics_state';
import { initializeDebuggerUiState } from '../contrib/debugger/ide_debugger';
import { initializeWorkspaceStorage } from '../core/workspace_storage';
import { Runtime } from '../../emulator/runtime';
import { renameController } from '../contrib/rename/rename_controller';
import { resetSemanticWorkspace } from '../contrib/intellisense/semantic_workspace_sync';
import { assertMonospace } from '../core/text_utils';
import * as constants from '../core/constants';
import type { Viewport } from '../../rompack/rompack';
import {
	applyViewportSize,
	configureFontVariant,
	resetResourcePanelState,
} from './editor_view';
import { applyResourceSearchFieldText } from '../contrib/resources/resource_search';
import { applyLineJumpFieldText } from '../contrib/find/line_jump';
import { applyCreateResourceFieldText } from '../contrib/resources/create_resource';
import { applySearchFieldText } from '../contrib/find/editor_search';
import { initializeNavigationState } from '../navigation/navigation_history';
import { applySymbolSearchFieldText } from '../contrib/symbols/symbol_search_shared';

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
	ide_state.search.field = createInlineTextField();
	ide_state.symbolSearch.field = createInlineTextField();
	ide_state.resourceSearch.field = createInlineTextField();
	ide_state.lineJump.field = createInlineTextField();
	ide_state.createResource.field = createInlineTextField();
	initializeWorkspaceStorage($.cart_project_root_path);
	applySearchFieldText(ide_state.search.query, true);
	applySymbolSearchFieldText(ide_state.symbolSearch.query, true);
	applyResourceSearchFieldText(ide_state.resourceSearch.query, true);
	applyLineJumpFieldText(ide_state.lineJump.value, true);
	applyCreateResourceFieldText(ide_state.createResource.path, true);
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
	ide_state.problemsPanel.setDiagnostics(editorDiagnosticsState.diagnostics);
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
	initializeNavigationState();
	ide_state.initialized = true;
}
