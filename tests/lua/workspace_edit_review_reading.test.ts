import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { TAB_SPACES } from '../../ide/common/constants';
import { measureTextRange } from '../../ide/editor/common/text/layout';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { WorkspaceEditReviewInput } from '../../ide/workbench/contrib/edit_review/editor_input';
import { layoutEditReviewRows } from '../../ide/workbench/contrib/edit_review/projection';
import { WorkspaceEditProposal } from '../../ide/workbench/services/working_copy/workspace_edit';
import { WorkspaceSourceContext } from '../../ide/workbench/services/working_copy/source_context';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';

function fixture(t: TestContext, before: string, after: string) {
	const models = new EditorTextModelService(), record = createScenarioTestSourceRecord('review.lua', 1, before);
	const sources = createScenarioTestSourceState([record]);
	const model = models.retain(sources.luaResources[0], 'lua', before);
	const proposal = new WorkspaceEditProposal('Source reading', new WorkspaceSourceContext(models, sources), {
		kind: 'edit', edits: new Map([[model, { version: model.version, edits: [{ offset: 0, deleteLength: before.length, text: after }] }]]),
	});
	const input = new WorkspaceEditReviewInput(proposal);
	t.after(() => { input.dispose(); models.clear(); });
	return { input, model, proposal };
}

const unitMeasure = (_text: string, start: number, end: number): number => end - start;
const SOURCE = Array.from({ length: 60 }, (_, index) => `line_${index} = '  🐉\t${'source words '.repeat(8)}'\r\n`).join('');

function project(input: WorkspaceEditReviewInput, width: number, height: number, variant: 'tiny' | 'msx'): void {
	input.reading.capture(input.viewport, input.rows);
	configureFontVariant(variant);
	layoutEditReviewRows(input, width, measureTextRange);
	input.viewport.layout(0, 0, width, height, input.rows.length * editorViewState.lineHeight);
	input.reading.restore(input.viewport, input.rows, editorViewState.lineHeight);
}

test('projection maps original UTF-16 offsets through prefixes, tabs, CR/LF and trailing empty source', t => {
	const { input, proposal } = fixture(t, ' \t🐉\r\nZ \n', ' \t🐉\r\nZ! \n');
	const line = input.lines.find(line => line.part === 'before' && line.sourceOffset === 0)!;
	assert.equal(line.file, proposal.files[0]);
	assert.equal(line.hunk, proposal.files[0].hunks[0]);
	assert.equal(line.text, `- ${' '.repeat(1 + TAB_SPACES)}🐉 [CR] [LF]`);
	assert.deepEqual(line.sourceToDisplay, [2, 3, 3 + TAB_SPACES, 4 + TAB_SPACES, 5 + TAB_SPACES, 10 + TAB_SPACES, 15 + TAB_SPACES]);
	layoutEditReviewRows(input, 1, unitMeasure);
	const rows = input.rows.filter(row => row.line === line);
	assert.equal(rows.map(row => row.text).join(''), line.text);
	assert.deepEqual(rows.slice(0, 2).map(row => [row.start, row.decoration]), [[0, -2], [0, -1]]);
	assert.deepEqual(rows.filter(row => row.start === 1).map(row => row.decoration), Array.from({ length: TAB_SPACES }, (_, index) => index));
	const emoji = rows.find(row => row.text === '🐉')!;
	assert.equal(emoji.start, 2); assert.equal(emoji.end, 4);
	assert.deepEqual(rows.filter(row => row.start === 4).map(row => row.decoration), [0, 1, 2, 3, 4]);
	assert.deepEqual(rows.filter(row => row.start === 5).map(row => row.decoration), [0, 1, 2, 3, 4]);
	const empty = input.lines.find(line => line.part === 'before' && line.sourceOffset === 9)!;
	assert.equal(empty.text, '- '); assert.deepEqual(empty.sourceToDisplay, [2]);
	assert.equal(input.rows.filter(row => row.line === empty).map(row => row.text).join(''), '- ');
});

test('every wrapped decoration row has a reversible original-source affinity', t => {
	const { input } = fixture(t, '\t\r\n\t\n', '\t!\r\n\t!\n');
	layoutEditReviewRows(input, 1, unitMeasure);
	input.viewport.layout(0, 0, 20, 1, input.rows.length * 8);
	input.reading.restore(input.viewport, input.rows, 8);
	const cases = input.rows.map((row, index) => ({ line: row.line, offset: row.start, decoration: row.decoration, index }));
	for (const expected of cases) {
		input.viewport.scrollbar.setScroll((expected.index + 0.25) * 8);
		input.reading.capture(input.viewport, input.rows);
		assert.equal(input.reading.line, expected.line);
		assert.equal(input.reading.offset, expected.offset);
		assert.equal(input.reading.decoration, expected.decoration);
		layoutEditReviewRows(input, 80, unitMeasure);
		input.viewport.layout(0, 0, 80, 1, input.rows.length * 8);
		input.reading.restore(input.viewport, input.rows, 8);
		input.reading.capture(input.viewport, input.rows);
		layoutEditReviewRows(input, 1, unitMeasure);
		input.viewport.layout(0, 0, 20, 1, input.rows.length * 8);
		input.reading.restore(input.viewport, input.rows, 8);
		assert.equal(input.viewport.scrollTop, (expected.index + 0.25) * 8);
	}
});

test('middle source offsets and intra-row intent survive two-way font/width reflow without drift', t => {
	const { input, model, proposal } = fixture(t, SOURCE, SOURCE.replaceAll('source', 'changed'));
	project(input, 118, 80, 'msx');
	const index = input.rows.findIndex(row => row.kind === 'after' && row.start > 500 && row.decoration === 0);
	assert.ok(index > 0);
	input.viewport.scrollbar.setScroll((index + 0.375) * editorViewState.lineHeight);
	input.reading.capture(input.viewport, input.rows);
	const { line, offset, decoration, fraction } = input.reading, original = input.viewport.scrollTop;
	for (let pass = 0; pass < 5; pass++) {
		project(input, 384, 160, 'tiny');
		assert.equal(input.reading.line, line); assert.equal(input.reading.offset, offset);
		assert.equal(input.reading.decoration, decoration); assert.equal(input.reading.fraction, fraction);
		project(input, 118, 80, 'msx');
		assert.equal(input.viewport.scrollTop, original);
	}
	assert.equal(model.buffer.getText(), SOURCE); assert.equal(model.dirty, false); assert.equal(model.canUndo, false);
	assert.equal(proposal.state, 'pending');
});

test('zero-height and all-content-fit clamps preserve logical intent until a positive viewport returns', t => {
	const { input } = fixture(t, SOURCE, SOURCE.replaceAll('source', 'changed'));
	project(input, 118, 80, 'msx');
	input.viewport.scrollbar.setScroll(400.5);
	input.reading.capture(input.viewport, input.rows);
	const { line, offset, decoration, fraction } = input.reading;
	project(input, 384, 0, 'tiny');
	input.viewport.scrollbar.setScroll(input.viewport.contentHeight);
	input.reading.capture(input.viewport, input.rows);
	assert.equal(input.reading.line, line); assert.equal(input.reading.offset, offset);
	project(input, 20_000, 20_000, 'tiny');
	assert.equal(input.viewport.scrollTop, 0);
	project(input, 118, 80, 'msx');
	assert.equal(input.reading.line, line); assert.equal(input.reading.offset, offset);
	assert.equal(input.reading.decoration, decoration); assert.equal(input.reading.fraction, fraction);
	assert.equal(input.viewport.scrollTop, 400.5);
});

test('explicit Home at a projected zero replaces old hidden intent, while End stays at the new bottom', t => {
	const { input } = fixture(t, SOURCE, SOURCE.replaceAll('source', 'changed'));
	project(input, 118, 80, 'msx'); input.viewport.scrollbar.setScroll(400);
	project(input, 20_000, 20_000, 'tiny'); assert.equal(input.viewport.scrollTop, 0);
	// The shared scroll control publishes this intent even when Home leaves the pixels at zero.
	input.reading.noteUserScroll('start');
	input.reading.capture(input.viewport, input.rows);
	project(input, 118, 80, 'msx'); assert.equal(input.viewport.scrollTop, 0);
	input.reading.noteUserScroll('end');
	input.viewport.scrollbar.setScroll(input.viewport.scrollbar.getMaximumScroll());
	project(input, 384, 160, 'tiny');
	assert.equal(input.reading.edge, 'end');
	assert.equal(input.viewport.scrollTop, input.viewport.scrollbar.getMaximumScroll());
	project(input, 118, 80, 'msx');
	assert.equal(input.viewport.scrollTop, input.viewport.scrollbar.getMaximumScroll());
});

for (const height of [0, 20_000]) for (const edge of ['start', 'end'] as const) {
	test(`explicit ${edge} survives ${height === 0 ? 'zero-height' : 'all-content-fit'} geometry and later source-relative input replaces it`, t => {
		const { input } = fixture(t, SOURCE, SOURCE.replaceAll('source', 'changed'));
		project(input, 118, 80, 'msx');
		input.viewport.scrollbar.setScroll(400.5);
		project(input, 20_000, height, 'tiny');
		input.reading.noteUserScroll(edge);
		input.viewport.scrollbar.setScroll(edge === 'start' ? 0 : input.viewport.contentHeight);
		input.reading.capture(input.viewport, input.rows);
		assert.equal(input.reading.edge, edge); assert.equal(input.reading.line, undefined);
		project(input, 118, 80, 'msx');
		assert.equal(input.viewport.scrollTop, edge === 'start' ? 0 : input.viewport.scrollbar.getMaximumScroll());
		project(input, 20_000, height, 'tiny'); project(input, 118, 80, 'msx');
		assert.equal(input.viewport.scrollTop, edge === 'start' ? 0 : input.viewport.scrollbar.getMaximumScroll());
		input.reading.noteUserScroll(); input.viewport.scrollbar.setScroll(200.5);
		input.reading.capture(input.viewport, input.rows);
		assert.equal(input.reading.edge, undefined); assert.notEqual(input.reading.line, undefined);
		project(input, 384, 160, 'tiny'); project(input, 118, 80, 'msx');
		assert.equal(input.viewport.scrollTop, 200.5);
	});
}

test('successive absolute commands replace each other without waiting for a visible row or reflow', t => {
	const { input } = fixture(t, SOURCE, SOURCE.replaceAll('source', 'changed'));
	project(input, 20_000, 0, 'tiny');
	for (const edges of [['start', 'end'], ['end', 'start']] as const) {
		for (const edge of edges) {
			input.reading.noteUserScroll(edge);
			input.viewport.scrollbar.setScroll(edge === 'start' ? 0 : input.viewport.contentHeight);
		}
		project(input, 118, 80, 'msx');
		assert.equal(input.reading.edge, edges[1]);
		assert.equal(input.viewport.scrollTop, edges[1] === 'start' ? 0 : input.viewport.scrollbar.getMaximumScroll());
		project(input, 20_000, 0, 'tiny');
	}
});

for (const edge of ['start', 'end'] as const) test(`relative input after ${edge} captures logical source rows even while covered`, t => {
	const { input } = fixture(t, SOURCE, SOURCE.replaceAll('source', 'changed'));
	project(input, 118, 0, 'msx');
	input.reading.noteUserScroll(edge);
	input.viewport.scrollbar.setScroll(edge === 'start' ? 0 : input.viewport.contentHeight);
	input.reading.noteUserScroll();
	const index = edge === 'start' ? 1 : input.rows.length - 1, expected = input.rows[index];
	input.viewport.scrollbar.setScroll(index * editorViewState.lineHeight);
	input.reading.capture(input.viewport, input.rows);
	assert.equal(input.reading.edge, undefined); assert.equal(input.reading.line, expected.line);
	assert.equal(input.reading.offset, expected.start); assert.equal(input.reading.decoration, expected.decoration);
	project(input, 118, 80, 'msx');
	assert.equal(input.viewport.scrollTop, edge === 'start' ? editorViewState.lineHeight : input.viewport.scrollbar.getMaximumScroll());
});

test('an admitted zero-height relative scroll to the document endpoint never reads a one-past row', t => {
	const { input } = fixture(t, SOURCE, SOURCE.replaceAll('source', 'changed'));
	project(input, 118, 0, 'msx');
	input.reading.noteUserScroll(); input.viewport.scrollbar.setScroll(input.viewport.contentHeight);
	input.reading.capture(input.viewport, input.rows);
	assert.equal(input.reading.edge, 'end'); assert.equal(input.reading.line, undefined);
	project(input, 118, 80, 'msx');
	assert.equal(input.viewport.scrollTop, input.viewport.scrollbar.getMaximumScroll());
});

test('warm reflow reuses row records and immutable source correspondence', t => {
	const { input } = fixture(t, '\t🐉\r\n'.repeat(20), '\tchanged🐉\r\n'.repeat(20));
	layoutEditReviewRows(input, 1, unitMeasure);
	const slots = [...input.rows], lines = input.lines, maps = lines.map(line => line.sourceToDisplay);
	for (let pass = 0; pass < 10; pass++) {
		layoutEditReviewRows(input, 200, unitMeasure);
		layoutEditReviewRows(input, 1, unitMeasure);
	}
	assert.equal(input.lines, lines);
	for (let index = 0; index < slots.length; index++) assert.equal(input.rows[index], slots[index]);
	for (let index = 0; index < lines.length; index++) assert.equal(lines[index].sourceToDisplay, maps[index]);
});

test('file and hunk headings retain their own display offsets rather than borrowing source identity', t => {
	const { input, proposal } = fixture(t, SOURCE, SOURCE.replaceAll('source', 'changed'));
	for (const part of ['file', 'hunk'] as const) {
		layoutEditReviewRows(input, 1, unitMeasure);
		input.viewport.layout(0, 0, 20, 1, input.rows.length * 8);
		input.reading.restore(input.viewport, input.rows, 8);
		const index = input.rows.findIndex(row => row.line.part === part && row.start === 5);
		assert.ok(index >= 0);
		input.viewport.scrollbar.setScroll((index + 0.5) * 8);
		input.reading.capture(input.viewport, input.rows);
		const line = input.reading.line!;
		assert.equal(line.file, proposal.files[0]);
		assert.equal(line.hunk, part === 'file' ? undefined : proposal.files[0].hunks[0]);
		assert.equal(input.reading.offset, 5); assert.equal(input.reading.decoration, 0);
		layoutEditReviewRows(input, 80, unitMeasure);
		input.viewport.layout(0, 0, 80, 1, input.rows.length * 8);
		input.reading.restore(input.viewport, input.rows, 8);
		input.reading.capture(input.viewport, input.rows);
		layoutEditReviewRows(input, 1, unitMeasure);
		input.viewport.layout(0, 0, 20, 1, input.rows.length * 8);
		input.reading.restore(input.viewport, input.rows, 8);
		assert.equal(input.reading.line, line);
		assert.equal(input.viewport.scrollTop, (index + 0.5) * 8);
	}
});

test('repeated source text keeps exact file/hunk/part identity and offsets within the captured hunk', t => {
	const models = new EditorTextModelService(), source = 'keep\nold\nkeep\nkeep\nold\nkeep';
	const records = ['one.lua', 'two.lua'].map(path => createScenarioTestSourceRecord(path, 1, source));
	const sources = createScenarioTestSourceState(records);
	const retained = records.map(record => models.retain(sources.luaResources.find(resource => resource.domain === 0 && resource.path === record.source_path)!, 'lua', source));
	const proposal = new WorkspaceEditProposal('Repeated source', new WorkspaceSourceContext(models, sources), {
		kind: 'edit', edits: new Map(retained.map(model => [model, { version: model.version, edits: [
			{ offset: source.indexOf('old'), deleteLength: 3, text: 'longer' },
			{ offset: source.lastIndexOf('old'), deleteLength: 3, text: 'longer' },
		] }])),
	});
	const input = new WorkspaceEditReviewInput(proposal);
	t.after(() => { input.dispose(); models.clear(); });
	assert.equal(proposal.files[1].hunks.length, 2);
	project(input, 118, 1, 'msx');
	const file = proposal.files[1], hunk = file.hunks[1];
	assert.ok(hunk.offset > 0);
	const index = input.rows.findIndex(row => row.line.file === file && row.line.hunk === hunk && row.line.part === 'after');
	input.viewport.scrollbar.setScroll((index + 0.25) * editorViewState.lineHeight);
	input.reading.capture(input.viewport, input.rows);
	assert.equal(input.reading.offset, 0, 'after offsets belong to the hunk after-text, not absolute before-source coordinates');
	project(input, 384, 1, 'tiny'); project(input, 118, 1, 'msx');
	assert.equal(input.reading.line!.file, file); assert.equal(input.reading.line!.hunk, hunk);
	assert.equal(input.reading.line!.part, 'after');
	assert.equal(input.viewport.scrollTop, (index + 0.25) * editorViewState.lineHeight);
});
