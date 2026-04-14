import { $ } from '../../core/engine_core';
import { CompletionController } from '../contrib/suggest/completion_controller';
import { createEntryTabContext, initializeTabs } from './editor_tabs';
import { createInlineTextField } from './inline_text_field';
import { Scrollbar, ScrollbarController } from './scrollbar';
import { initializeResourcePanel } from '../contrib/resources/resource_panel_controller';
import { editorDiagnosticsState } from '../contrib/problems/diagnostics_state';
import { initializeDebuggerUiState } from '../contrib/debugger/ide_debugger';
import { initializeWorkspaceStorage } from '../core/workspace_storage';
import { Runtime } from '../../emulator/runtime';
import { resetSemanticWorkspace } from '../contrib/intellisense/semantic_workspace_sync';
import { assertMonospace } from '../core/text_utils';
import * as constants from '../core/constants';
import type { Viewport } from '../../rompack/rompack';
import { editorDocumentState } from '../editing/editor_document_state';
import { editorViewState } from './editor_view_state';
import { editorFeatureState } from '../core/editor_feature_state';
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
import { editorRuntimeState } from '../core/editor_runtime_state';
import { problemsPanel } from '../contrib/problems/problems_panel';

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
	editorFeatureState.search.field = createInlineTextField();
	editorFeatureState.symbolSearch.field = createInlineTextField();
	editorFeatureState.resourceSearch.field = createInlineTextField();
	editorFeatureState.lineJump.field = createInlineTextField();
	editorFeatureState.createResource.field = createInlineTextField();
	initializeWorkspaceStorage($.cart_project_root_path);
	applySearchFieldText(editorFeatureState.search.query, true);
	applySymbolSearchFieldText(editorFeatureState.symbolSearch.query, true);
	applyResourceSearchFieldText(editorFeatureState.resourceSearch.query, true);
	applyLineJumpFieldText(editorFeatureState.lineJump.value, true);
	applyCreateResourceFieldText(editorFeatureState.createResource.path, true);
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
	editorFeatureState.completion = new CompletionController();
	editorFeatureState.completion.closeSession();
	editorFeatureState.completion.enterCommitsCompletion = false;
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
