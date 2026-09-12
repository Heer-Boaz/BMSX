import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import type { TrackedTextRange } from '../../ide/editor/text/text_change';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { BehaviorLensInput } from '../../ide/workbench/contrib/behavior_lens/editor_input';
import { installBehaviorLensDocument } from '../../ide/workbench/contrib/behavior_lens/layout';
import { buildBehaviorSourceDocument } from '../../ide/workbench/contrib/behavior_lens/recognizer';
import { BehaviorSourceIndex } from '../../ide/workbench/contrib/behavior_lens/source_index';
import { createBehaviorLensViewState } from '../../ide/workbench/contrib/behavior_lens/view_model';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';

const SOURCE = "local trees<const> = require('cartlib/behaviour_tree/library')\ntrees.register('fixture', { root = { type = 'wait', duration_ticks = 1 } })";

class CountingModel extends EditorTextModel {
	public activeRangeSets = 0;
	public constructor() { super({ domain: 0, path: 'source.lua', source: { type: 'lua', resid: 'source' } }, 'lua', SOURCE); }
	public override trackRanges<Key>(ranges: ReadonlyMap<Key, TrackedTextRange>): () => void {
		this.activeRangeSets += 1;
		const release = super.trackRanges(ranges);
		return () => { this.activeRangeSets -= 1; release(); };
	}
}

test('multiple source-index users share model tracking until the last release', () => {
	const model = new CountingModel();
	const document = buildBehaviorSourceDocument(model.resource, buildLuaFileSemanticData(SOURCE, model.resource.path));
	const first = BehaviorSourceIndex.acquire(document, model, assert.fail);
	const second = BehaviorSourceIndex.acquire(document, model, assert.fail);
	assert.equal(first, second); assert.equal(first.model, model);
	assert.equal(model.activeRangeSets, 1);
	const span = first.ranges.get(document.definitions[0].rowKey)!;
	const initial = { ...span };
	first.release();
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- moved\n' }]);
	assert.deepEqual(span, { resource: model.identity, start: initial.start + 9, end: initial.end + 9 });
	assert.equal(model.activeRangeSets, 1);
	second.release();
	assert.equal(model.activeRangeSets, 0);
	model.undo();
	assert.deepEqual(span, { resource: model.identity, start: initial.start + 9, end: initial.end + 9 }, 'retired ranges are no longer mutated');
	const reopened = BehaviorSourceIndex.acquire(document, model, assert.fail);
	assert.notEqual(reopened, first, 'last release removes the cache entry, not just its tracking callback');
	assert.deepEqual(reopened.ranges.get(document.definitions[0].rowKey), initial);
	reopened.release(); model.dispose();
});

test('retained behavior inputs release retired generations and retain hidden-view positions', t => {
	const font = editorViewState.font;
	editorViewState.font = new EditorFont('tiny');
	t.after(() => { editorViewState.font = font; });
	const model = new CountingModel();
	const project = () => buildBehaviorSourceDocument(model.resource, buildLuaFileSemanticData(model.buffer.getText(), model.resource.path));
	const document = project();
	const first = new BehaviorLensInput(model, createBehaviorLensViewState(document, model, 'graph', assert.fail), () => assert.fail('BT does not create an FSM layout engine'));
	const hidden = new BehaviorLensInput(model, createBehaviorLensViewState(document, model, 'graph', assert.fail), () => assert.fail('BT does not create an FSM layout engine'));
	assert.equal(model.activeRangeSets, 1);
	const original = hidden.view.source.ranges.get(document.definitions[0].rowKey)!.start;
	for (let edit = 0; edit < 20; edit += 1) {
		model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- x\n' }]);
		const next = project();
		installBehaviorLensDocument(first.view, next);
		assert.equal(model.activeRangeSets, 2, 'only the visible and hidden generations remain alive');
	}
	assert.equal(hidden.view.source.ranges.get(document.definitions[0].rowKey)!.start, original + 100);
	const current = first.view.document;
	installBehaviorLensDocument(hidden.view, current);
	assert.equal(first.view.source, hidden.view.source);
	assert.equal(model.activeRangeSets, 1);
	first.dispose(); assert.equal(model.activeRangeSets, 1);
	hidden.dispose(); assert.equal(model.activeRangeSets, 0);
	model.dispose();
});

test('source positions are updated before any feature forwards the edit notification', t => {
	const font = editorViewState.font;
	editorViewState.font = new EditorFont('tiny');
	t.after(() => { editorViewState.font = font; });
	const model = new CountingModel();
	const document = buildBehaviorSourceDocument(model.resource, buildLuaFileSemanticData(SOURCE, model.resource.path));
	const view = createBehaviorLensViewState(document, model, 'graph', assert.fail);
	const span = view.source.ranges.get(document.definitions[0].rowKey)!;
	const start = span.start;
	let notifications = 0;
	model.onDidChangeContent(() => { notifications += 1; assert.equal(span.start, start + 9); });
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- moved\n' }]);
	assert.equal(notifications, 1);
	view.source.release(); model.dispose();
});

test('a text roundtrip can reuse binder facts without reviving collapsed markers or deleting a newer lease', () => {
	const model = new CountingModel();
	const document = buildBehaviorSourceDocument(model.identity, buildLuaFileSemanticData(SOURCE, model.resource.path));
	const hidden = BehaviorSourceIndex.acquire(document, model, assert.fail);
	const key = document.definitions[0].rowKey;
	const original = { ...hidden.ranges.get(key)! };
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: '' }]);
	model.undo();
	assert.equal(model.buffer.getText(), SOURCE);
	assert.equal(hidden.isCurrent, false);
	assert.equal(hidden.ranges.get(key)!.start, hidden.ranges.get(key)!.end);
	const current = BehaviorSourceIndex.acquire(document, model, assert.fail);
	assert.notEqual(current, hidden);
	assert.deepEqual(current.ranges.get(key), original);
	assert.equal(model.activeRangeSets, 2);
	hidden.release();
	const shared = BehaviorSourceIndex.acquire(document, model, assert.fail);
	assert.equal(shared, current, 'releasing a stale generation must not remove the replacement cache entry');
	assert.equal(model.activeRangeSets, 1);
	current.release(); shared.release();
	assert.equal(model.activeRangeSets, 0);
	model.dispose();
});
