import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import type { EditorModelEdit, EditorTextModel } from '../../ide/editor/model/text_model';
import { EditorWorkspaceEditConflict } from '../../ide/editor/model/undo_redo_service';
import { createTextEditPreview } from '../../ide/editor/text/edit_preview';
import { PieceTreeBuffer } from '../../ide/editor/text/piece_tree_buffer';
import { writeWrappedSourceLine } from '../../ide/common/text';
import { advanceLuaSourceRevision, registerLuaSourceRecord } from '../../ide/runtime/source_registry';
import { WorkspaceEditProposal } from '../../ide/workbench/services/working_copy/workspace_edit';
import { WorkspaceSourceContext } from '../../ide/workbench/services/working_copy/source_context';
import { WorkspaceEditReviewInput } from '../../ide/workbench/contrib/edit_review/editor_input';
import { layoutEditReviewRows } from '../../ide/workbench/contrib/edit_review/projection';
import { EditorTabGroupModel } from '../../ide/workbench/ui/tab/group_model';
import { GameViewInput } from '../../ide/workbench/contrib/game_view/editor_input';
import type { EditorInputSerializers } from '../../ide/workbench/services/editor/editor_serialization';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';

function fixture(t: TestContext) {
	const models = new EditorTextModelService();
	const source = createScenarioTestSourceRecord('main.lua', 1, 'return old, old');
	const sources = createScenarioTestSourceState([source]);
	const a = models.retain({ domain: 0, path: 'main.lua', source }, 'lua', source.src);
	const b = models.retain({ domain: 0, path: 'other.yaml', source: { resid: 'other', type: 'data' } }, 'yaml', '# trivia\r\nvalue: old\r\n');
	const edits = new Map<EditorTextModel, EditorModelEdit>([
		[a, { version: a.version, edits: [{ offset: 7, deleteLength: 3, text: 'new' }, { offset: 12, deleteLength: 3, text: 'new' }] }],
		[b, { version: b.version, edits: [{ offset: 17, deleteLength: 3, text: 'new' }] }],
	]);
	const context = new WorkspaceSourceContext(models, sources);
	const proposal = new WorkspaceEditProposal('Rename old to new', context, edits);
	t.after(() => { proposal.dispose(); models.clear(); });
	return { models, sources, a, b, proposal, edits, context };
}

test('review retains exact Lua/YAML bytes without snapshots, mutations, history or edit-array aliasing', t => {
	const f = fixture(t);
	assert.equal(f.proposal.state, 'pending');
	assert.equal(f.a.canUndo, false);
	assert.equal(f.b.dirty, false);
	assert.deepEqual(f.proposal.files[0].hunks, [{ offset: 0, line: 1, before: 'return old, old', after: 'return new, new' }]);
	f.edits.get(f.a)!.edits[0].text = 'unreviewed';
	f.proposal.apply();
	assert.equal(f.proposal.state, 'applied');
	assert.equal(f.a.buffer.getText(), 'return new, new');
	assert.equal(f.b.buffer.getText(), '# trivia\r\nvalue: new\r\n');
	f.b.undo();
	assert.equal(f.a.buffer.getText(), 'return old, old');
	assert.equal(f.b.buffer.getText(), '# trivia\r\nvalue: old\r\n');
	f.a.redo();
	assert.equal(f.a.buffer.getText(), 'return new, new');
	assert.throws(() => f.proposal.apply(), /applied/);
	assert.equal(f.proposal.lifetime.isDisposed, true);
});

test('closing a review discards its proposal without acquiring source ownership', t => {
	const f = fixture(t);
	const input = new WorkspaceEditReviewInput(f.proposal);
	input.dispose();
	assert.equal(f.proposal.state, 'discarded');
	assert.throws(() => f.proposal.apply(), /discarded/);
	assert.equal(f.a.canUndo, false);
	assert.equal(f.models.get(f.a.identity), f.a);
});

for (const outcome of ['applied', 'discarded', 'stale', 'conflict', 'failed'] as const) {
	test(`proposal settlement publishes the final ${outcome} outcome once, after retiring edit authority`, t => {
		const f = fixture(t), states: string[] = [];
		const removed = f.proposal.onDidSettle(() => assert.fail('detached observer'));
		removed();
		f.proposal.onDidSettle(() => {
			assert.equal(f.proposal.lifetime.isDisposed, true);
			if (f.proposal.state === 'applied') {
				assert.equal(f.a.buffer.getText(), 'return new, new');
				assert.equal(f.b.buffer.getText(), '# trivia\r\nvalue: new\r\n');
			}
			states.push(f.proposal.state);
		});
		if (outcome === 'applied') { f.proposal.apply(); f.a.undo(); }
		else if (outcome === 'discarded') f.proposal.dispose();
		else if (outcome === 'stale') f.a.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- later\n' }]);
		else if (outcome === 'conflict') {
			f.b.refreshResource({ ...f.b.resource, source: { ...f.b.resource.source, generated: true } });
			assert.throws(() => f.proposal.apply(), EditorWorkspaceEditConflict);
		} else {
			f.models.history.applyEdits = () => { throw new Error('Injected history failure'); };
			assert.throws(() => f.proposal.apply(), /Injected history failure/);
		}
		f.proposal.dispose(); f.proposal.invalidate('Later retirement');
		assert.deepEqual(states, [outcome === 'conflict' ? 'stale' : outcome]);
	});
}

test('target edits and dependency edits both retire pending workspace context, even after Undo', t => {
	const f = fixture(t);
	const dependency = f.models.retain({ domain: 0, path: 'dep.lua', source: { resid: 'dep', type: 'lua' } }, 'lua', 'x');
	dependency.pushEditOperations([{ offset: 0, deleteLength: 1, text: 'y' }]);
	dependency.undo();
	assert.equal(f.proposal.state, 'stale');
	assert.match(f.proposal.reason, /dep.lua/);
	assert.throws(() => f.proposal.apply(), /stale/);
	assert.equal(f.a.canUndo, false);
});

test('document retirement cannot be reversed by same-path/version reopening', t => {
	const f = fixture(t);
	f.models.clear();
	const reopened = f.models.retain(f.a.resource, f.a.mode, f.a.buffer.getText());
	assert.equal(reopened.version, f.a.version);
	assert.equal(f.proposal.state, 'stale');
	assert.throws(() => f.proposal.apply(), /stale/);
	assert.equal(reopened.canUndo, false);
});

test('catalog changes outside models invalidate review, while a model saving its base does not', t => {
	const f = fixture(t);
	const registry = f.sources.cartridgeSlots[0]!.luaSources;
	advanceLuaSourceRevision(registry, f.a.resource.path);
	assert.equal(f.proposal.state, 'pending');
	registerLuaSourceRecord(registry, createScenarioTestSourceRecord('unopened.lua', 2, 'return old'));
	assert.equal(f.proposal.state, 'stale');
	assert.throws(() => f.proposal.apply(), /stale/);
});

test('replacing a socket source catalog retires an accepted proposal at apply admission', t => {
	const f = fixture(t);
	f.sources.cartridgeSlots[0]!.luaSources = createScenarioTestSourceState([]).cartridgeSlots[0]!.luaSources;
	assert.throws(() => f.proposal.apply(), /catalog was replaced/);
	assert.equal(f.proposal.state, 'stale');
	assert.equal(f.a.canUndo, false);
});

test('new read-only rights reject the whole operation before any source notifications or writes', t => {
	const f = fixture(t);
	let notifications = 0;
	f.a.onWillChangeContent(() => notifications++);
	f.b.refreshResource({ ...f.b.resource, source: { ...f.b.resource.source, generated: true } });
	assert.throws(() => f.proposal.apply(), EditorWorkspaceEditConflict);
	assert.equal(f.proposal.state, 'stale');
	assert.equal(notifications, 0);
	assert.equal(f.a.canUndo, false);
});

test('review admission rejects foreign models and leaves its reading context with the caller', t => {
	const f = fixture(t), other = new EditorTextModelService();
	const context = new WorkspaceSourceContext(other, f.sources);
	t.after(() => { context.dispose(); other.clear(); });
	assert.throws(() => new WorkspaceEditProposal('Foreign', context, f.edits), /no longer belongs to this workspace/);
	assert.equal(context.reason, undefined);
});

test('a reading context starts before an asynchronous proposal, not when edits arrive', async t => {
	const f = fixture(t);
	const read = f.context.read(f.a);
	assert.equal(f.context.read(f.a), read, 'repeated reads retain snapshot identity');
	assert.equal(f.a.canUndo, false, 'context reads are not history/Save boundaries');
	await Promise.resolve();
	f.b.pushEditOperations([{ offset: 0, deleteLength: 0, text: '# external edit\n' }]);
	assert.equal(read.source, 'return old, old', 'captured evidence remains immutable');
	assert.throws(() => f.context.read(f.a), /Source changed/);
	assert.throws(() => new WorkspaceEditProposal('Late result', f.context, f.edits), /Source changed/);
});

test('workspace teardown retires contexts with no captured or retained models', t => {
	const models = new EditorTextModelService();
	const context = new WorkspaceSourceContext(models, createScenarioTestSourceState([]));
	t.after(() => context.dispose());
	let retired = 0;
	context.onDidInvalidate(() => retired++);
	models.clear();
	assert.equal(retired, 1);
	assert.throws(() => context.assertCurrent(), /Workspace closed/);
	models.clear();
	assert.equal(retired, 1);
});

test('line-context preview reproduces multi-line replacements, adjacent edits, CRLF and EOF exactly', () => {
	const cases = [
		{ source: 'a\r\nb\r\nc\n', edits: [{ offset: 1, deleteLength: 2, text: '\n' }, { offset: 3, deleteLength: 1, text: 'bb' }] },
		{ source: 'one\ntwo\nthree', edits: [{ offset: 0, deleteLength: 8, text: '' }, { offset: 13, deleteLength: 0, text: '\nlast\n' }] },
		{ source: '', edits: [{ offset: 0, deleteLength: 0, text: '\t🐉\n' }] },
		{ source: 'old\nmore\nlast', edits: [{ offset: 0, deleteLength: 3, text: 'first\nextra' }, { offset: 9, deleteLength: 4, text: '' }] },
	];
	for (const { source, edits } of cases) {
		const expected = new PieceTreeBuffer(source);
		for (const edit of edits.toReversed()) expected.replace(edit.offset, edit.deleteLength, edit.text);
		const hunks = createTextEditPreview(new PieceTreeBuffer(source), edits);
		let actual = source;
		for (const hunk of hunks.toReversed()) {
			assert.equal(actual.slice(hunk.offset, hunk.offset + hunk.before.length), hunk.before);
			actual = actual.slice(0, hunk.offset) + hunk.after + actual.slice(hunk.offset + hunk.before.length);
		}
		assert.equal(actual, expected.getText());
	}
});

test('preview wrapping preserves source whitespace, long lines and Unicode without truncating changes', t => {
	const source = '  long  🐉\t  text ';
	const lines: string[] = [];
	writeWrappedSourceLine(lines, source, 3, (_text, start, end) => end - start);
	assert.equal(lines.join(''), source);
	assert.ok(lines.some(line => line.includes('🐉')));
	const f = fixture(t), input = new WorkspaceEditReviewInput(f.proposal);
	t.after(() => input.dispose());
	layoutEditReviewRows(input, 12, (_text, start, end) => end - start);
	assert.ok(input.rows.some(row => row.kind === 'after'));
	assert.ok(input.rows.map(row => row.text).join('').includes('return new, new'));
});

test('session producer excludes transient proposals and remaps selection before serialization', async t => {
	const f = fixture(t), group = new EditorTabGroupModel();
	t.after(() => group.clear());
	const review = new WorkspaceEditReviewInput(f.proposal), game = new GameViewInput();
	group.add(review); group.add(game, { pinned: false }); group.activate(review);
	const unused = { serialize: () => assert.fail('unexpected serialization'), deserialize: () => assert.fail('unexpected reconstruction') };
	const serializers: EditorInputSerializers = { game_view: { serialize: () => '', deserialize: () => new GameViewInput() },
		actor_lab: unused, code_editor: unused, behavior_lens: unused, scene_editor: unused, scenario_lab: unused, resource_view: unused };
	const data = group.serialize(serializers);
	assert.deepEqual(data, { inputs: [{ kind: 'game_view', value: '' }], active: 0, preview: 0 });
	assert.equal(group.serialize(serializers, data), data);
	await group.deserialize(data, serializers);
	assert.equal(f.proposal.state, 'discarded');
	assert.equal(group.tabs.length, 1);
	assert.equal(group.activeTab!.kind, 'game_view');
});

test('session restore reports failed reconstruction rather than selecting a different resource', async t => {
	const group = new EditorTabGroupModel(); t.after(() => group.clear());
	const error = new Error('missing resource');
	const serializers = { game_view: { deserialize() { throw error; } } } as unknown as EditorInputSerializers;
	await assert.rejects(group.deserialize({ inputs: [{ kind: 'game_view', value: '' }], active: 0, preview: null }, serializers), error);
	assert.equal(group.activeTab, null);
});
