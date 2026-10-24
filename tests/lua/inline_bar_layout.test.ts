import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import * as constants from '../../ide/common/constants';
import { editorFeedbackState, showEditorMessage, updateEditorMessage } from '../../ide/common/feedback_state';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { configureFontVariant } from '../../ide/editor/ui/view/view';
import {
	getLineJumpBarBounds, getSearchBarBounds, getSearchBarHeight, getWorkbenchEditorBounds,
	refreshWorkbenchLayout, searchResultEntryHeight, searchVisibleResultCount, topMargin,
} from '../../ide/workbench/common/layout';
import { computeSearchPageStats, ensureSearchSelectionVisible, searchPageSize } from '../../ide/workbench/contrib/code_editor/find/search';
import { editorSearchState, lineJumpState } from '../../ide/workbench/contrib/code_editor/find/widget_state';
import { problemsPanel } from '../../ide/workbench/contrib/problems/panel/controller';
import { editorChromeState } from '../../ide/workbench/ui/chrome_state';
import { create_rect_bounds } from '../../machine/ts/common/rect';
import { writeResourcePanelBounds } from '../../ide/workbench/contrib/resources/panel/layout';
import { clearBackgroundTasks, runBackgroundTasks } from '../../ide/common/background_tasks';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { activeCodeEditor, createCodeEditorViewState } from '../../ide/editor/ui/code_editor_state';
import { resolveCodeAreaViewport } from '../../ide/editor/ui/code/area_viewport';
import { applySearchFieldText, EditorSearchController } from '../../ide/workbench/contrib/code_editor/find/search';
import { RenameController } from '../../ide/workbench/contrib/code_editor/rename/controller';
import type { RuntimeSourceState } from '../../ide/runtime/sources';

function fixture(t: TestContext) {
	const clock = new VirtualHeadlessClock();
	configureFontVariant(clock, 'tiny', null);
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288;
	editorViewState.codeAreaLeft = 0; editorChromeState.editorRightInset = 0;
	editorChromeState.runtimeTimelineHeight = 0; editorFeedbackState.message.visible = false;
	problemsPanel.hide(); problemsPanel.setFixedHeightPx(0);
	editorSearchState.visible = false; editorSearchState.scope = 'local';
	editorSearchState.matches = []; editorSearchState.globalMatches = [];
	editorSearchState.currentIndex = -1; editorSearchState.displayOffset = 0;
	lineJumpState.visible = false;
	refreshWorkbenchLayout();
	t.after(() => {
		editorSearchState.visible = false; editorSearchState.matches = []; editorSearchState.globalMatches = [];
		editorSearchState.displayOffset = 0; editorSearchState.currentIndex = -1; lineJumpState.visible = false;
		problemsPanel.hide(); problemsPanel.setFixedHeightPx(0);
		editorFeedbackState.message.visible = false; editorChromeState.runtimeTimelineHeight = 0;
		editorViewState.codeAreaLeft = 0; editorChromeState.editorRightInset = 0;
		refreshWorkbenchLayout();
	});
	return clock;
}

function manyResults(): void {
	editorSearchState.visible = true;
	editorSearchState.matches = Array.from({ length: 100 }, (_, row) => ({ row, start: 0, end: 1 }));
}

function capacityForBody(): number {
	const bounds = getWorkbenchEditorBounds();
	const fieldHeight = editorViewState.lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2;
	const available = bounds.bottom - bounds.top - fieldHeight - constants.SEARCH_RESULT_SPACING - editorViewState.lineHeight * 6;
	return Math.max(0, Math.min(constants.GLOBAL_SEARCH_RESULT_LIMIT, Math.floor(available / searchResultEntryHeight())));
}

test('inline search and line-jump bounds use the actual pane origin and right edge', t => {
	fixture(t);
	editorViewState.codeAreaLeft = 73; editorChromeState.editorRightInset = 80;
	editorSearchState.visible = true; refreshWorkbenchLayout();
	const root = getWorkbenchEditorBounds(), search = getSearchBarBounds()!;
	assert.equal(search.left, root.left); assert.equal(search.right, root.right);
	assert.equal(search.top, root.top); assert.equal(editorViewState.codeAreaTop, search.bottom);
	editorSearchState.visible = false; lineJumpState.visible = true; refreshWorkbenchLayout();
	const jump = getLineJumpBarBounds()!;
	assert.equal(jump.left, root.left); assert.equal(jump.right, root.right);
	assert.equal(jump.top, root.top); assert.equal(editorViewState.codeAreaTop, jump.bottom);
});

test('distinct viewport and split metrics cannot alias inline-bar layout cache keys', t => {
	fixture(t); editorSearchState.visible = true;
	editorViewState.viewportWidth = 256; editorChromeState.editorRightInset = 97; refreshWorkbenchLayout();
	const bounds = getSearchBarBounds()!;
	assert.equal(bounds.right, 159);
	// These real-width tuples collide in the old 32-bit layout hash.
	editorViewState.viewportWidth = 257; editorChromeState.editorRightInset = 0; refreshWorkbenchLayout();
	assert.equal(getSearchBarBounds(), bounds, 'the producer retains its actual rectangle');
	assert.equal(bounds.right, 257);
});

test('inline bars shift only their child text viewport, not the sibling Resources panel', t => {
	fixture(t);
	const resources = create_rect_bounds();
	assert.equal(writeResourcePanelBounds(resources, 0.3), true);
	const before = { ...resources };
	manyResults(); refreshWorkbenchLayout();
	assert.ok(editorViewState.codeAreaTop > getWorkbenchEditorBounds().top);
	assert.equal(writeResourcePanelBounds(resources, 0.3), true);
	assert.deepEqual(resources, before, 'Resources retains its own full pane-root reading area');
});

test('search results and keyboard paging consume the same status, Problems and timeline height budget', t => {
	fixture(t); manyResults();
	problemsPanel.show(); problemsPanel.setFixedHeightPx(83); editorChromeState.runtimeTimelineHeight = 24;
	showEditorMessage('A real multiline status message\nwith a second authored line', 'info', 1);
	refreshWorkbenchLayout();
	const capacity = capacityForBody(), bounds = getSearchBarBounds()!;
	assert.equal(searchVisibleResultCount(), capacity);
	assert.equal(searchPageSize(), Math.max(1, capacity));
	assert.ok(bounds.bottom <= getWorkbenchEditorBounds().bottom);
	editorSearchState.currentIndex = 99; ensureSearchSelectionVisible();
	const stats = computeSearchPageStats();
	assert.equal(stats.visible, capacity); assert.equal(stats.offset, 100 - capacity);
	updateEditorMessage(1); refreshWorkbenchLayout();
	assert.equal(searchVisibleResultCount(), capacityForBody());
	assert.ok(searchVisibleResultCount() > capacity, 'expired feedback returns its real height to the pane');
});

test('font and body-height changes republish the actual result capacity without stale cached bar bounds', t => {
	const clock = fixture(t); manyResults(); refreshWorkbenchLayout();
	const tinyCapacity = capacityForBody(), bounds = getSearchBarBounds()!;
	assert.equal(searchVisibleResultCount(), tinyCapacity);
	configureFontVariant(clock, 'msx', null); refreshWorkbenchLayout();
	assert.equal(getSearchBarBounds(), bounds);
	assert.equal(searchVisibleResultCount(), capacityForBody());
	assert.ok(searchVisibleResultCount() < tinyCapacity);
	assert.equal(getSearchBarHeight(), bounds.bottom - bounds.top);
	editorChromeState.runtimeTimelineHeight = 31; refreshWorkbenchLayout();
	assert.equal(searchVisibleResultCount(), capacityForBody());
	assert.equal(refreshWorkbenchLayout(), false, 'unchanged input metrics do not invalidate routed hover every frame');
});

test('short panes have zero physical result rows but a usable semantic keyboard step', t => {
	fixture(t); manyResults();
	editorViewState.viewportHeight = topMargin() + editorViewState.baseBottomMargin + editorViewState.lineHeight + 4;
	refreshWorkbenchLayout();
	const root = getWorkbenchEditorBounds(), bounds = getSearchBarBounds()!;
	assert.equal(searchVisibleResultCount(), 0); assert.equal(searchPageSize(), 1);
	assert.equal(bounds.bottom, root.bottom); assert.equal(editorViewState.codeAreaTop, root.bottom);
	editorSearchState.currentIndex = 99; ensureSearchSelectionVisible();
	assert.equal(editorSearchState.displayOffset, 99, 'zero physical rows do not invent an out-of-range result position');
	assert.equal(computeSearchPageStats().visible, 0);
});

test('a viewport shorter than permanent chrome publishes an empty pane and no phantom inline-bar rectangle', t => {
	fixture(t); manyResults(); editorViewState.viewportHeight = 8; refreshWorkbenchLayout();
	const root = getWorkbenchEditorBounds();
	assert.equal(root.bottom, root.top); assert.equal(editorViewState.codeAreaTop, root.bottom);
	assert.equal(editorViewState.codeAreaBottom, root.bottom);
	assert.equal(getSearchBarBounds(), null); assert.equal(getSearchBarHeight(), 0);
	assert.equal(searchVisibleResultCount(), 0); assert.equal(searchPageSize(), 1);
});

test('asynchronous local results publish the smaller child viewport before revealing their source match', t => {
	const clock = fixture(t);
	const source = Array.from({ length: 200 }, (_, row) => `local needle_${row} = ${row}`).join('\n');
	const model = new EditorTextModel({ domain: 0, path: 'inline-find.lua', source: { type: 'lua', resid: 'inline-find' } }, 'lua', source);
	const view = createCodeEditorViewState(); activeCodeEditor.attach(model, view);
	const search = new EditorSearchController({} as RuntimeSourceState, new RenameController());
	t.after(() => { search.closeSearch(true); activeCodeEditor.detach(); model.dispose(); clearBackgroundTasks(); });
	view.cursorRow = 199;
	applySearchFieldText('needle', true); search.openSearch(false);
	const fieldOnlyTop = editorViewState.codeAreaTop;
	runBackgroundTasks(clock);
	assert.equal(editorSearchState.matches.length, 200);
	assert.ok(editorViewState.codeAreaTop > fieldOnlyTop, 'the result producer publishes geometry before match reveal');
	const scroll = view.scrollRow, viewport = resolveCodeAreaViewport();
	const cursorVisual = editorViewState.layout.positionToVisualIndex(model.buffer, view.cursorRow, view.cursorColumn);
	assert.equal(view.cursorRow, 199);
	assert.ok(cursorVisual >= scroll && cursorVisual < scroll + viewport.rows);
	assert.equal(viewport.codeTop, getSearchBarBounds()!.bottom);
	assert.equal(model.buffer.getText(), source, 'Find changes presentation, never canonical source');
});

test('unchanged inline geometry retains its rectangles and performs no font work across repeated queries', t => {
	fixture(t); manyResults(); refreshWorkbenchLayout();
	const bounds = getSearchBarBounds(), count = searchVisibleResultCount();
	const advance = t.mock.method(editorViewState.font, 'advance');
	const measure = t.mock.method(editorViewState.font, 'measure');
	for (let index = 0; index < 1000; index++) {
		assert.equal(refreshWorkbenchLayout(), false);
		assert.equal(getSearchBarBounds(), bounds);
		assert.equal(searchVisibleResultCount(), count);
		assert.equal(getSearchBarHeight(), bounds!.bottom - bounds!.top);
	}
	assert.equal(advance.mock.callCount(), 0); assert.equal(measure.mock.callCount(), 0);
});
