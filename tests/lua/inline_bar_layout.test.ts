import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import * as constants from '../../ide/common/constants';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { resolveCodeAreaViewport } from '../../ide/editor/ui/code/area_viewport';
import { EditorSearchController } from '../../ide/workbench/contrib/code_editor/find/search';
import { CodeEditorLineJump } from '../../ide/workbench/contrib/code_editor/find/line_jump';
import { RenameController } from '../../ide/workbench/contrib/code_editor/rename/controller';
import { CrossFileRenameManager } from '../../ide/workbench/contrib/code_editor/rename/operations';
import { SourceInlineBars } from '../../ide/workbench/contrib/code_editor/inline_bar/source_inline_bars';
import type { RuntimeSourceState } from '../../ide/runtime/sources';
import { clearBackgroundTasks, runBackgroundTasks } from '../../ide/common/background_tasks';
import { inputFocus } from '../../ide/input/focus';
import { createTestCodeDocuments } from '../helpers/code_documents';
import { createTestCodeControl } from '../helpers/code_control';

function fixture(t: TestContext, source = Array.from({ length: 200 }, () => 'x').join('\n')) {
	const { models, documents, clock } = createTestCodeDocuments(t);
	const model = models.retain({ contextLabel: 'Fixture project', sourceFilePath: 'inline.lua', location: { kind: 'workspace', path: 'inline.lua' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'inline.lua',
		source: { type: 'lua', resid: 'inline' } }, 'lua', source);
	const client = { left: 0, top: 10, right: 384, bottom: 270 };
	const code = createTestCodeControl(t, model, documents, clock, undefined, new EditorFont('tiny'), client);
	const sources = {} as RuntimeSourceState;
	const find = new EditorSearchController(code, sources.catalog), lineJump = new CodeEditorLineJump(code);
	const rename = new RenameController(code, sources.catalog, new CrossFileRenameManager(sources.catalog));
	const bars = new SourceInlineBars(code, find, rename, lineJump);
	const layout = () => { bars.layout(client); resolveCodeAreaViewport(code); };
	const unbind = [find.onDidChangeLayout(layout), rename.onDidChangeLayout(layout), lineJump.onDidChangeLayout(layout)];
	t.after(() => {
		for (const release of unbind) release();
		find.dispose(); rename.dispose(); lineJump.dispose(); inputFocus.setTarget(null); clearBackgroundTasks();
	});
	layout();
	return { code, find, lineJump, rename, bars, client, clock, model, layout };
}

function manyResults(find: EditorSearchController): void {
	find.state.visible = true;
	find.state.matches = Array.from({ length: 100 }, (_, row) => ({ row, start: 0, end: 1 }));
}

function capacityForBody(f: ReturnType<typeof fixture>): number {
	const field = f.code.lineHeight + constants.SEARCH_BAR_MARGIN_Y * 2;
	const available = f.client.bottom - f.client.top - field - constants.SEARCH_RESULT_SPACING - f.code.lineHeight * 6;
	return Math.max(0, Math.min(constants.GLOBAL_SEARCH_RESULT_LIMIT, Math.trunc(available / (f.code.lineHeight * 2))));
}

test('Source inline bars arrange inside the supplied pane origin and right edge', t => {
	const f = fixture(t); f.client.left = 73; f.client.right = 304;
	f.find.state.visible = true; f.layout();
	const search = f.bars.searchBounds!;
	assert.equal(search.left, f.client.left); assert.equal(search.right, f.client.right);
	assert.equal(search.top, f.client.top); assert.equal(f.code.geometry.clientBounds.top, search.bottom);
	f.find.closeSearch(false); f.lineJump.open();
	const jump = f.bars.lineJumpBounds!;
	assert.equal(jump.left, f.client.left); assert.equal(jump.right, f.client.right);
	assert.equal(jump.top, f.client.top); assert.equal(f.code.geometry.clientBounds.top, jump.bottom);
});

test('different pane widths republish the retained inline rectangle without hash aliasing', t => {
	const f = fixture(t); f.find.state.visible = true;
	f.client.right = 159; f.layout();
	const bounds = f.bars.searchBounds!;
	assert.equal(bounds.right, 159);
	f.client.right = 257; f.layout();
	assert.equal(f.bars.searchBounds, bounds, 'the layout retains its rectangle rather than replacing it');
	assert.equal(bounds.right, 257);
});

test('Find fields and results resize only their own child text viewport', t => {
	const first = fixture(t), sibling = fixture(t);
	const siblingBounds = { ...sibling.code.geometry.clientBounds };
	manyResults(first.find); first.layout();
	assert.ok(first.code.geometry.clientBounds.top > first.client.top);
	assert.deepEqual(sibling.code.geometry.clientBounds, siblingBounds);
	assert.equal(sibling.bars.searchBounds, null);
});

test('result rows and keyboard paging consume the same supplied pane-height budget', t => {
	const f = fixture(t); manyResults(f.find);
	// Chrome owns its space; Source receives only the remaining client rectangle.
	f.client.bottom -= 83 + 24 + f.code.lineHeight * 2; f.layout();
	const capacity = capacityForBody(f), bounds = f.bars.searchBounds!;
	assert.equal(f.bars.visibleSearchResults, capacity);
	assert.equal(f.find.searchPageSize(), Math.max(1, capacity));
	assert.ok(bounds.bottom <= f.client.bottom);
	f.find.state.currentIndex = 99; f.find.ensureSearchSelectionVisible();
	const stats = f.find.computeSearchPageStats();
	assert.equal(stats.visible, capacity); assert.equal(stats.offset, 100 - capacity);
	f.client.bottom += f.code.lineHeight * 2; f.layout();
	assert.equal(f.bars.visibleSearchResults, capacityForBody(f));
	assert.ok(f.bars.visibleSearchResults > capacity);
});

test('font and body-height changes publish actual capacity on the same retained bar', t => {
	const f = fixture(t); manyResults(f.find); f.layout();
	const tinyCapacity = capacityForBody(f), bounds = f.bars.searchBounds!;
	f.code.setFont(new EditorFont('msx')); f.layout();
	assert.equal(f.bars.searchBounds, bounds);
	assert.equal(f.bars.visibleSearchResults, capacityForBody(f));
	assert.ok(f.bars.visibleSearchResults < tinyCapacity);
	f.client.bottom -= 31; f.layout();
	assert.equal(f.bars.visibleSearchResults, capacityForBody(f));
});

test('short Source panes have no physical results but retain semantic keyboard paging', t => {
	const f = fixture(t); manyResults(f.find);
	f.client.bottom = f.client.top + f.code.lineHeight + 4; f.layout();
	assert.equal(f.bars.visibleSearchResults, 0); assert.equal(f.find.searchPageSize(), 1);
	assert.equal(f.bars.searchBounds!.bottom, f.client.bottom);
	assert.equal(f.code.geometry.clientBounds.top, f.client.bottom);
	f.find.state.currentIndex = 99; f.find.ensureSearchSelectionVisible();
	assert.equal(f.find.state.displayOffset, 99);
	assert.equal(f.find.computeSearchPageStats().visible, 0);
});

test('an empty Source client publishes no phantom inline field', t => {
	const f = fixture(t); manyResults(f.find); f.client.bottom = f.client.top; f.layout();
	assert.equal(f.code.geometry.clientBounds.top, f.client.bottom);
	assert.equal(f.code.geometry.clientBounds.bottom, f.client.bottom);
	assert.equal(f.bars.searchBounds, null); assert.equal(f.bars.visibleSearchResults, 0);
	assert.equal(f.find.searchPageSize(), 1);
});

test('asynchronous local results resize the actual control before revealing their match', t => {
	const source = Array.from({ length: 200 }, (_, row) => `local needle_${row} = ${row}`).join('\n');
	const f = fixture(t, source); f.code.view.cursorRow = 199;
	f.find.applySearchFieldText('needle', true); f.find.openSearch(false); f.find.focus();
	const fieldOnlyTop = f.code.geometry.clientBounds.top;
	runBackgroundTasks(f.clock);
	assert.equal(f.find.state.matches.length, 200);
	assert.ok(f.code.geometry.clientBounds.top > fieldOnlyTop);
	const view = f.code.view, viewport = resolveCodeAreaViewport(f.code);
	const cursorVisual = f.code.layout.positionToVisualIndex(view.cursorRow, view.cursorColumn);
	assert.equal(view.cursorRow, 199);
	assert.ok(cursorVisual >= view.scrollRow && cursorVisual < view.scrollRow + viewport.rows);
	assert.equal(viewport.codeTop, f.bars.searchBounds!.bottom);
	assert.equal(f.model.buffer.getText(), source);
});

test('unchanged inline geometry reuses rectangles and measured font work', t => {
	const f = fixture(t); manyResults(f.find); f.layout();
	const bounds = f.bars.searchBounds, count = f.bars.visibleSearchResults;
	const advance = t.mock.method(f.code.font, 'advance'), measure = t.mock.method(f.code.font, 'measure');
	for (let index = 0; index < 1000; index++) {
		f.layout();
		assert.equal(f.bars.searchBounds, bounds); assert.equal(f.bars.visibleSearchResults, count);
	}
	assert.equal(advance.mock.callCount(), 0); assert.equal(measure.mock.callCount(), 0);
});

test('closing a field expands its Source client before returning focus from a zero-text-area pane', t => {
	const f = fixture(t); f.client.bottom = f.client.top + f.code.lineHeight + constants.LINE_JUMP_BAR_MARGIN_Y * 2;
	f.code.focusTarget.canFocus = () => f.code.geometry.clientBounds.top < f.code.geometry.clientBounds.bottom;
	f.lineJump.open(); f.lineJump.focus();
	assert.equal(f.code.geometry.clientBounds.top, f.code.geometry.clientBounds.bottom);
	assert.equal(inputFocus.target, f.lineJump.state.field.focusTarget);
	f.lineJump.close(false);
	assert.ok(f.code.geometry.clientBounds.top < f.code.geometry.clientBounds.bottom);
	assert.equal(inputFocus.target, f.code.focusTarget);
});
