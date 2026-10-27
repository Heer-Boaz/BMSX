import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { createTestCodeControl } from '../helpers/code_control';
import { createTestCodeDocuments } from '../helpers/code_documents';
import { EMPTY_DIAGNOSTICS_BY_ROW } from '../../ide/editor/contrib/diagnostics/model';
import { navigationState } from '../../ide/navigation/navigation_history';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { createTestEditorGroup } from '../helpers/editor_panes';
import assert from 'node:assert/strict';
import test from 'node:test';
import { create_rect_bounds } from '../../machine/ts/common/rect';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { api } from '../../ide/runtime/overlay_api';
import { scrollWorkbenchList, workbenchListRowIndexAtPosition } from '../../ide/workbench/ui/list_view';

import { refreshWorkbenchLayout } from '../../ide/workbench/common/layout';
import { ScrollableWorkbenchTree } from '../../ide/workbench/ui/scrollable_tree';
import { appendWorkbenchTreeNode, rebuildWorkbenchTreeRows } from '../../ide/workbench/ui/tree_view';
import { createWorkbenchPropertyTree, layoutWorkbenchPropertyTree } from '../../ide/workbench/ui/property_tree';
import { drawWorkbenchPropertyTree } from '../../ide/workbench/render/property_tree';
import { resourcePanelIndexAtRelativeY } from '../../ide/workbench/contrib/resources/panel/navigation';
import { ResourceViewerInput } from '../../ide/workbench/contrib/resources/editor_input';
import { ResourceViewerEditorPane } from '../../ide/workbench/contrib/resources/editor_pane';
import { inputFocus } from '../../ide/input/focus';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';
import { createCodeEditorViewState } from '../../ide/editor/ui/code_editor_state';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { getCodeAreaBounds, resolvePointerTextPosition, resolveTextPositionBounds, scrollHorizontally, scrollRows } from '../../ide/editor/ui/view/view';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { ensureVisualLines } from '../../ide/editor/common/text/layout';
import { measureTextRange } from '../../ide/editor/common/text/layout';
import { renderCodeArea } from '../../ide/editor/render/code_area/area';
import { ProblemsPanelController } from '../../ide/workbench/contrib/problems/panel/controller';
import type { EditorDiagnostic } from '../../ide/common/models';

test('indexed list and tree retain tiny deltas across layout while hit tests address real rows', () => {
	const tree = new ScrollableWorkbenchTree<number>();
	for (let row = 0; row < 20; row++) appendWorkbenchTreeNode(tree, null, row);
	rebuildWorkbenchTreeRows(tree, null);
	tree.updateLayout(0, 0, 100, 40, 10, 8);
	for (let step = 1; step <= 6; step++) {
		scrollWorkbenchList(tree, 0.25);
		tree.updateLayout(0, 0, 100, 40, 10, 8);
		assert.equal(tree.scroll, step * 0.25);
		assert.equal(workbenchListRowIndexAtPosition(tree, 5, 1), step * 0.25 | 0);
		assert.equal(resourcePanelIndexAtRelativeY(tree.scroll, 11, 10, tree.rows.length), (step * 0.25 | 0) + 1);
	}
	assert.equal(tree.selectionIndex, -1);
	scrollWorkbenchList(tree, -0.25);
	assert.equal(tree.scroll, 1.25);
	assert.equal(workbenchListRowIndexAtPosition(tree, 5, 1), 1);
});

test('property and resource rendering preserves the actual retained fractional reading positions', t => {
	configureFontVariant('tiny');
	editorViewState.viewportWidth = 240; editorViewState.viewportHeight = 160;
	refreshWorkbenchLayout();
	const overlay = createHostOverlayFixture(240, 160);
	const tree = createWorkbenchPropertyTree();
	for (let row = 0; row < 20; row++) appendWorkbenchTreeNode(tree, null, {
		kind: 'property', label: String(row), value: 'value', description: '', warning: false,
		displayLabel: '', displayValue: '', displayValueLeft: 0,
	});
	rebuildWorkbenchTreeRows(tree, null);
	layoutWorkbenchPropertyTree(tree, editorViewState.font.renderFont(), measureTextRange, 0, 0, 240, 160);
	scrollWorkbenchList(tree, 1.5);
	const sources = createScenarioTestSourceState([createScenarioTestSourceRecord('rows.lua', 1,
		Array.from({ length: 80 }, (_, index) => `-- row ${index}`).join('\n'))]);
	const input = new ResourceViewerInput(sources.catalog, sources.catalog.luaResources[0]);
	const pane = new ResourceViewerEditorPane(inputFocus.workbenchScope);
	pane.setInput(input, { left: 0, top: 0, right: 240, bottom: 160 });
	t.after(() => { pane.clearInput(); pane.dispose(); input.dispose(); });
	for (let step = 0; step < 6; step++) pane.handleWheel({ viewportX: 5, viewportY: 5,
		valid: true, insideViewport: true, deltaX: 0, deltaY: 0.25, modifiers: 0 });
	overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
	drawWorkbenchPropertyTree(tree);
	pane.draw();
	overlay.renderer.endFrame();
	assert.equal(tree.scroll, 1.5);
	assert.equal(input.view.scroll, 1.5);
	assert.equal(workbenchListRowIndexAtPosition(tree, 5, 1), 1);
	assert.ok(overlay.queue.consumeOverlayFrame().commandCount > 0);
});

test('source scrolling retains fractional pixels while hit tests resolve source columns', t => {
	configureFontVariant('tiny');
	const { models, documents, clock } = createTestCodeDocuments(t);
	const model = models.retain({ contextLabel: 'Fixture project', sourceFilePath: 'wheel.lua', location: { kind: 'workspace' as const, path: 'wheel.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'wheel.lua', source: { type: 'lua', resid: 'wheel' } }, 'lua', ('abcdefghijklmnop'.repeat(20) + '\n').repeat(80));
	const view = createCodeEditorViewState();
	const code = createTestCodeControl(t, model, documents, clock, view);
	code.view.wordWrapEnabled = false;
	code.geometry.cachedVisibleRowCount = 4;
	code.geometry.cachedMaxScrollLeft = 8;
	ensureVisualLines(code);
	const bounds = { codeTop: 0, codeBottom: 100, codeLeft: 0, codeRight: 100, gutterLeft: 0, gutterRight: 0, textLeft: 0 };
	for (let step = 1; step <= 6; step++) {
		scrollRows(code, 0.25); scrollHorizontally(code, 0.25); ensureVisualLines(code);
		assert.equal(view.scrollRow, step * 0.25);
		assert.equal(view.scrollLeft, step * 0.25);
		const position = resolvePointerTextPosition(code, 0, 1, bounds);
		assert.equal(position.row, step * 0.25 | 0);
		assert.equal(position.column, Math.round(step * 0.25 / code.charAdvance));
	}
	const overlay = createHostOverlayFixture(240, 160);
	overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
	renderCodeArea(code, { session: null, hint: null, popupBounds: null, popupBoundsScratch: create_rect_bounds() }, false, new Set(), [], -1, [], -1, false, EMPTY_DIAGNOSTICS_BY_ROW);
	overlay.renderer.endFrame();
	assert.equal(view.scrollRow, 1.5);
	assert.equal(view.scrollLeft, 1.5);
	const caret = create_rect_bounds();
	resolveTextPositionBounds(code, 1, 1, caret);
	assert.ok(Number.isInteger(caret.top));
	assert.equal(caret.left, getCodeAreaBounds(code).textLeft + code.charAdvance - view.scrollLeft);
});

test('Problems wheel integrates sub-row distances without changing selection or being undone by focused drawing', t => {
	configureFontVariant('tiny');
	const model = new EditorTextModel({ contextLabel: 'Fixture project', sourceFilePath: 'problems.lua', location: { kind: 'workspace' as const, path: 'problems.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'problems.lua', source: { type: 'lua', resid: 'problems' } }, 'lua', 'x');
	const diagnostics: EditorDiagnostic[] = Array.from({ length: 10 }, (_, row) => ({ model, version: 1, row,
		startColumn: 0, endColumn: 1, message: 'A diagnostic message that wraps across several narrow panel lines.', severity: 'error' }));
	const controller = new ProblemsPanelController();
	controller.show(); controller.setDiagnostics(diagnostics, { ready: 1, pending: 0, unsupported: 0, failed: 0 });
	controller.setSelectionIndex(0); controller.setFocused(true);
	t.after(() => { controller.hide(); model.dispose(); });
	const bounds = { left: 0, top: 0, right: 160, bottom: 100 };
	controller.prepareLayout(bounds);
	const rowHeight = controller.getItemLayout(0).height;
	const delta = rowHeight / editorViewState.lineHeight / 4;
	for (let step = 1; step <= 4; step++) {
		assert.equal(controller.handlePointerWheel(delta, bounds), true);
		assert.equal(controller.getScrollIndex(), step === 4 ? 1 : 0);
	}
	const overlay = createHostOverlayFixture(160, 100);
	overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
	controller.draw(bounds); overlay.renderer.endFrame();
	assert.equal(controller.getSelectionIndex(), 0);
	assert.equal(controller.getScrollIndex(), 1);
	controller.handlePointerWheel(-delta, bounds);
	assert.equal(controller.getScrollIndex(), 0);
	assert.equal(controller.getSelectionIndex(), 0);
});

test('Problems wheel prepares current variable-height layout after show, resize and diagnostic refresh without painting', t => {
	configureFontVariant('tiny');
	const model = new EditorTextModel({ contextLabel: 'Fixture project', sourceFilePath: 'problems-layout.lua', location: { kind: 'workspace' as const, path: 'problems-layout.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'problems-layout.lua', source: { type: 'lua', resid: 'problems-layout' } }, 'lua', 'x');
	const diagnostic = (message: string, row: number): EditorDiagnostic => ({ model, version: 1, row, startColumn: 0, endColumn: 1, message, severity: 'error' });
	const diagnostics = [diagnostic('Short', 0), diagnostic('A diagnostic message that wraps across several narrow panel lines.', 1), diagnostic('Last', 2)];
	const coverage = { ready: 1, pending: 0, unsupported: 0, failed: 0 };
	const controller = new ProblemsPanelController();
	controller.show(); controller.setDiagnostics(diagnostics, coverage);
	t.after(() => { controller.hide(); model.dispose(); });
	const wide = { left: 0, top: 0, right: 320, bottom: 100 };
	assert.equal(controller.getCachedLayout(), null);
	const firstRowLines = controller.getItemLayout(0, controller.resolveAvailableWidth(wide)).height / editorViewState.lineHeight;
	assert.equal(controller.handlePointerWheel(firstRowLines, wide), true);
	assert.equal(controller.getScrollIndex(), 1, 'first wheel after showing and installing diagnostics is not dropped');
	const wideHeight = controller.getItemLayout(1).height;
	const narrow = { ...wide, right: 80 };
	controller.setFixedHeightPx(90);
	assert.equal(controller.getCachedLayout(), null);
	assert.equal(controller.handlePointerWheel(1, narrow), true);
	const narrowHeight = controller.getItemLayout(1).height;
	assert.ok(narrowHeight > wideHeight);
	assert.equal(controller.getScrollIndex(), 1, 'one line must not skip a multiline diagnostic');
	controller.setDiagnostics(diagnostics, coverage);
	assert.equal(controller.getCachedLayout(), null);
	assert.equal(controller.handlePointerWheel(narrowHeight / editorViewState.lineHeight - 1, narrow), true);
	assert.equal(controller.getScrollIndex(), 2, 'fractional progress survives invalidation and crosses the actual wrapped height');
	assert.equal(controller.getSelectionIndex(), 0);
});

test('actual Resource viewers keep arranged scrollbar gestures and retirement local to their groups', t => {
	configureFontVariant('tiny');
	const sources = createScenarioTestSourceState([createScenarioTestSourceRecord('read.lua', 1,
		Array.from({ length: 80 }, (_, row) => `-- retained row ${row}`).join('\n'))]);
	const first = createTestEditorGroup(), second = createTestEditorGroup();
	const firstInput = new ResourceViewerInput(sources.catalog, sources.catalog.luaResources[0]);
	const secondInput = new ResourceViewerInput(sources.catalog, sources.catalog.luaResources[0]);
	const bounds = { left: 10, top: 20, right: 150, bottom: 130 };
	first.panes.layout(bounds);
	second.panes.layout({ left: 190, top: 40, right: 350, bottom: 280 });
	first.openEditor(firstInput); second.openEditor(secondInput);
	const pane = first.panes.activePane!;
	pane.focus();
	assert.equal(navigationState.activeGroup, first);
	const focused = inputFocus.target;
	t.after(() => { first.dispose(); second.dispose(); pointerCapture.cancel(); inputFocus.setTarget(null); });
	// Address the actual component's arranged scrollbar, not root-workbench chrome.
	const down = { valid: true, insideViewport: true,
		viewportX: bounds.right - 1, viewportY: bounds.top + 1,
		pressedButtons: PointerButton.Primary, justPressedButtons: PointerButton.Primary, justReleasedButtons: 0,
		modifiers: 0, spaceDown: false };
	pointerCapture.beginRoute(first.captureScope, down);
	pane.handlePointer(down, true, false, 0, false);
	assert.equal(pointerCapture.active, true);
	const move = { ...down, viewportY: bounds.top + 30, justPressedButtons: 0 };
	pointerCapture.dispatch(move, false, 1, first.captureScope);
	assert.ok(firstInput.view.scroll > 0);
	assert.equal(secondInput.view.scroll, 0);
	second.clear();
	assert.equal(first.panes.activePane, pane);
	assert.equal(first.model.activeTab, firstInput);
	assert.equal(pointerCapture.active, true);
	assert.equal(inputFocus.target, focused);
	const before = firstInput.view.scroll;
	pointerCapture.dispatch({ ...move, viewportY: bounds.top + 40 }, false, 2, first.captureScope);
	assert.ok(firstInput.view.scroll > before);
	pointerCapture.dispatch({ ...move, pressedButtons: 0, justReleasedButtons: PointerButton.Primary }, false, 3, first.captureScope);
	assert.equal(pointerCapture.active, false);
	assert.equal(secondInput.view.scroll, 0);
});
