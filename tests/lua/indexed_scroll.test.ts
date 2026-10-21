import assert from 'node:assert/strict';
import test from 'node:test';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { create_rect_bounds } from '../../machine/ts/common/rect';
import { createHostOverlayFixture } from '../helpers/host_overlay';
import { api } from '../../ide/runtime/overlay_api';
import { scrollWorkbenchList, workbenchListRowIndexAtPosition } from '../../ide/workbench/ui/list_view';
import { Scrollbar } from '../../ide/workbench/ui/scrollbar';
import { refreshWorkbenchLayout } from '../../ide/workbench/common/layout';
import { ScrollableWorkbenchTree } from '../../ide/workbench/ui/scrollable_tree';
import { appendWorkbenchTreeNode, rebuildWorkbenchTreeRows } from '../../ide/workbench/ui/tree_view';
import { createWorkbenchPropertyTree, layoutWorkbenchPropertyTree } from '../../ide/workbench/ui/property_tree';
import { drawWorkbenchPropertyTree } from '../../ide/workbench/render/property_tree';
import { resourcePanelIndexAtRelativeY } from '../../ide/workbench/contrib/resources/panel/navigation';
import { applyResourceViewerScroll } from '../../ide/workbench/contrib/resources/viewer';
import type { ResourceViewerState } from '../../ide/workbench/contrib/resources/model';
import { drawResourceViewer } from '../../ide/workbench/render/resource_panel';
import { activeCodeEditor, createCodeEditorViewState } from '../../ide/editor/ui/code_editor_state';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { configureFontVariant, resolvePointerTextPosition, resolveTextPositionBounds, scrollColumns, scrollRows } from '../../ide/editor/ui/view/view';
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

test('property and resource renderers project fractional positions without losing their retained viewport', () => {
	configureFontVariant(new VirtualHeadlessClock(), 'tiny', null);
	editorViewState.viewportWidth = 240; editorViewState.viewportHeight = 160;
	editorViewState.scrollbars = {
		codeVertical: new Scrollbar('vertical'), codeHorizontal: new Scrollbar('horizontal'),
		resourceVertical: new Scrollbar('vertical'), resourceHorizontal: new Scrollbar('horizontal'), viewerVertical: new Scrollbar('vertical'),
	};
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
	const viewer: ResourceViewerState = { scroll: 0, content: {
		resource: { domain: 0, path: 'rows.lua', source: { type: 'lua', resid: 'rows' } },
		lines: Array.from({ length: 80 }, (_, index) => String(index)), error: '', title: 'rows',
	} };
	for (let step = 0; step < 6; step++) applyResourceViewerScroll(viewer, 4, viewer.scroll + 0.25);
	overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
	drawWorkbenchPropertyTree(tree);
	drawResourceViewer(viewer);
	overlay.renderer.endFrame();
	assert.equal(tree.scroll, 1.5);
	assert.equal(viewer.scroll, 1.5);
	assert.equal(workbenchListRowIndexAtPosition(tree, 5, 1), 1);
	assert.ok(overlay.queue.consumeOverlayFrame().commandCount > 0);
});

test('source scrolling retains fractions but source hit and caret geometry use integral rows and columns', t => {
	configureFontVariant(new VirtualHeadlessClock(), 'tiny', null);
	const model = new EditorTextModel({ domain: 0, path: 'wheel.lua', source: { type: 'lua', resid: 'wheel' } }, 'lua', ('abcdefghijklmnop'.repeat(20) + '\n').repeat(80));
	const view = createCodeEditorViewState();
	activeCodeEditor.attach(model, view);
	t.after(() => { activeCodeEditor.detach(); model.dispose(); });
	editorViewState.wordWrapEnabled = false;
	editorViewState.cachedVisibleRowCount = 4;
	editorViewState.cachedMaxScrollColumn = 8;
	ensureVisualLines();
	const bounds = { codeTop: 0, codeBottom: 100, codeLeft: 0, codeRight: 100, gutterLeft: 0, gutterRight: 0, textLeft: 0 };
	for (let step = 1; step <= 6; step++) {
		scrollRows(0.25); scrollColumns(0.25); ensureVisualLines();
		assert.equal(view.scrollRow, step * 0.25);
		assert.equal(view.scrollColumn, step * 0.25);
		const position = resolvePointerTextPosition(0, 1, bounds);
		assert.equal(position.row, step * 0.25 | 0);
		assert.equal(position.column, step * 0.25 | 0);
	}
	const overlay = createHostOverlayFixture(240, 160);
	overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
	renderCodeArea({ session: null, hint: null, popupBounds: null, popupBoundsScratch: create_rect_bounds() }, null, false, new Set(), [], -1, [], -1, false);
	overlay.renderer.endFrame();
	assert.equal(view.scrollRow, 1.5);
	assert.equal(view.scrollColumn, 1.5);
	const caret = create_rect_bounds();
	resolveTextPositionBounds(1, 1, caret);
	assert.ok(Number.isInteger(caret.top));
	assert.ok(Number.isInteger(caret.left));
});

test('Problems wheel integrates sub-row distances without changing selection or being undone by focused drawing', t => {
	configureFontVariant(new VirtualHeadlessClock(), 'tiny', null);
	const model = new EditorTextModel({ domain: 0, path: 'problems.lua', source: { type: 'lua', resid: 'problems' } }, 'lua', 'x');
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
		assert.equal(controller.handlePointerWheel(delta), true);
		assert.equal(controller.getScrollIndex(), step === 4 ? 1 : 0);
	}
	const overlay = createHostOverlayFixture(160, 100);
	overlay.renderer.beginFrame(overlay.presenter); api.beginFrame(overlay.renderer);
	controller.draw(bounds); overlay.renderer.endFrame();
	assert.equal(controller.getSelectionIndex(), 0);
	assert.equal(controller.getScrollIndex(), 1);
	controller.handlePointerWheel(-delta);
	assert.equal(controller.getScrollIndex(), 0);
	assert.equal(controller.getSelectionIndex(), 0);
});
