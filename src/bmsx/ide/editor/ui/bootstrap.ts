import { $ } from '../../../core/engine';
import { completionController } from '../contrib/suggest/completion_controller';
import { initializeTabs } from '../../workbench/ui/tabs';
import { createEntryTabContext } from '../../workbench/ui/code_tab/contexts';
import { createInlineTextField } from './inline_text_field';
import { Scrollbar, ScrollbarController } from './scrollbar';
import { initializeResourcePanel } from '../../workbench/contrib/resources/panel/controller';
import { editorDiagnosticsState } from '../contrib/diagnostics/state';
import { initializeDebuggerUiState } from '../../workbench/contrib/debugger/controller';
import { initializeWorkspaceStorage } from '../../workbench/workspace/storage';
import { Runtime } from '../../../machine/runtime/runtime';
import { resetSemanticWorkspace } from '../contrib/intellisense/semantic_workspace_sync';
import { assertMonospace } from '../common/text_layout';
import * as constants from '../../common/constants';
import type { Viewport } from '../../../rompack/format';
import { editorDocumentState } from '../editing/document_state';
import { editorViewState } from './view_state';
import { editorSearchState, lineJumpState } from '../contrib/find/widget_state';
import { symbolSearchState } from '../contrib/symbols/search_state';
import {
	applyViewportSize,
	configureFontVariant,
	resetResourcePanelState,
} from './view';
import { applyResourceSearchFieldText } from '../../workbench/contrib/resources/search';
import { applyLineJumpFieldText } from '../contrib/find/line_jump';
import { applyCreateResourceFieldText } from '../../workbench/contrib/resources/create';
import { applySearchFieldText } from '../contrib/find/search';
import { initializeNavigationState } from '../navigation/navigation_history';
import { applySymbolSearchFieldText } from '../contrib/symbols/shared';
import { editorRuntimeState } from '../common/runtime_state';
import { problemsPanel } from '../../workbench/contrib/problems/panel/controller';
import { createResourceState, resourceSearchState } from '../../workbench/contrib/resources/widget_state';

export function initializeCartEditor(viewport: Viewport): void {
	initializeDebuggerUiState();
	const runtime = Runtime.instance;
	editorViewState.fontVariant = runtime.activeIdeFontVariant;
	constants.setIdeThemeVariant(constants.DEFAULT_THEME);
	editorRuntimeState.themeVariant = constants.getActiveIdeThemeVariant();
	editorRuntimeState.caseInsensitive = false;
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
