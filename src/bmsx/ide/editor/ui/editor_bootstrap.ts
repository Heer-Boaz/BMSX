import { $ } from '../../../core/engine_core';
import { completionController } from '../contrib/suggest/completion_controller';
import { initializeTabs } from '../../workbench/ui/tabs';
import { createEntryTabContext } from '../../workbench/ui/code_tab_contexts';
import { createInlineTextField } from './inline_text_field';
import { Scrollbar, ScrollbarController } from './scrollbar';
import { initializeResourcePanel } from '../../workbench/contrib/resources/resource_panel_controller';
import { editorDiagnosticsState } from '../contrib/diagnostics/diagnostics_state';
import { initializeDebuggerUiState } from '../../workbench/contrib/debugger/ide_debugger';
import { initializeWorkspaceStorage } from '../../workbench/common/workspace_storage';
import { Runtime } from '../../../machine/runtime/runtime';
import { resetSemanticWorkspace } from '../contrib/intellisense/semantic_workspace_sync';
import { assertMonospace } from '../common/text_layout';
import * as constants from '../../common/constants';
import type { Viewport } from '../../../rompack/rompack';
import { editorDocumentState } from '../editing/editor_document_state';
import { editorViewState } from './editor_view_state';
import { editorSearchState, lineJumpState } from '../contrib/find/find_widget_state';
import { symbolSearchState } from '../contrib/symbols/symbol_search_state';
import {
	applyViewportSize,
	configureFontVariant,
	resetResourcePanelState,
} from './editor_view';
import { applyResourceSearchFieldText } from '../../workbench/contrib/resources/resource_search';
import { applyLineJumpFieldText } from '../contrib/find/line_jump';
import { applyCreateResourceFieldText } from '../../workbench/contrib/resources/create_resource';
import { applySearchFieldText } from '../contrib/find/editor_search';
import { initializeNavigationState } from '../navigation/navigation_history';
import { applySymbolSearchFieldText } from '../contrib/symbols/symbol_search_shared';
import { editorRuntimeState } from '../common/editor_runtime_state';
import { problemsPanel } from '../../workbench/contrib/problems/problems_panel';
import { createResourceState, resourceSearchState } from '../../workbench/contrib/resources/resource_widget_state';

export function initializeCartEditor(viewport: Viewport): void {
	initializeDebuggerUiState();
	const runtime = Runtime.instance;
	editorViewState.fontVariant = runtime.activeIdeFontVariant;
	constants.setIdeThemeVariant(constants.DEFAULT_THEME);
	editorRuntimeState.themeVariant = constants.getActiveIdeThemeVariant();
	editorRuntimeState.canonicalization = Runtime.instance.cartCanonicalization;
	editorRuntimeState.caseInsensitive = editorRuntimeState.canonicalization !== 'none';
	editorDocumentState.preMutationSource = null;
	applyViewportSize(viewport);
	editorRuntimeState.clockNow = $.platform.clock.now;
	resetSemanticWorkspace();
	configureFontVariant(editorViewState.fontVariant);
	editorSearchState.field = createInlineTextField();
	symbolSearchState.field = createInlineTextField();
	resourceSearchState.field = createInlineTextField();
	lineJumpState.field = createInlineTextField();
	createResourceState.field = createInlineTextField();
	initializeWorkspaceStorage($.cart_project_root_path);
	applySearchFieldText(editorSearchState.query, true);
	applySymbolSearchFieldText(symbolSearchState.query, true);
	applyResourceSearchFieldText(resourceSearchState.query, true);
	applyLineJumpFieldText(lineJumpState.value, true);
	applyCreateResourceFieldText(createResourceState.path, true);
	editorViewState.scrollbars = {
		codeVertical: new Scrollbar('codeVertical', 'vertical'),
		codeHorizontal: new Scrollbar('codeHorizontal', 'horizontal'),
		resourceVertical: new Scrollbar('resourceVertical', 'vertical'),
		resourceHorizontal: new Scrollbar('resourceHorizontal', 'horizontal'),
		viewerVertical: new Scrollbar('viewerVertical', 'vertical'),
	};
	editorViewState.scrollbarController = new ScrollbarController(editorViewState.scrollbars);
	initializeResourcePanel({
		resourceVertical: editorViewState.scrollbars.resourceVertical,
		resourceHorizontal: editorViewState.scrollbars.resourceHorizontal,
	});
	completionController.closeSession();
	completionController.enterCommitsCompletion = false;
	problemsPanel.setDiagnostics(editorDiagnosticsState.diagnostics);
	editorViewState.codeVerticalScrollbarVisible = false;
	editorViewState.codeHorizontalScrollbarVisible = false;
	editorViewState.cachedVisibleRowCount = 1;
	editorViewState.cachedVisibleColumnCount = 1;
	initializeTabs(createEntryTabContext());
	resetResourcePanelState();
	editorDocumentState.desiredColumn = editorDocumentState.cursorColumn;
	assertMonospace();
	editorDocumentState.lastSavedSource = '';
	initializeNavigationState();
	editorRuntimeState.initialized = true;
}
