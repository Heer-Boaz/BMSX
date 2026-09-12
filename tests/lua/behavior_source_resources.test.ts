import { semanticSnapshot } from './semantic_test_harness';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { trackedTextLocationsEqual } from '../../ide/editor/text/text_location';
import { luaSourceRangeToTextLocation } from '../../ide/language/lua/source_location';
import { luaSourceRangeToTextRange, readLuaSourceRange } from '../../ide/language/lua/source_edits';
import { BehaviorLensInput } from '../../ide/workbench/contrib/behavior_lens/editor_input';
import { BehaviorLensNavigationSelection } from '../../ide/workbench/contrib/behavior_lens/navigation_selection';
import { buildBehaviorInspection } from '../../ide/workbench/contrib/behavior_lens/inspection';
import { installBehaviorLensDocument } from '../../ide/workbench/contrib/behavior_lens/layout';
import { buildBehaviorSourceDocument } from '../../ide/workbench/contrib/behavior_lens/recognizer';
import type { BehaviorSourceDocument, BehaviorSourceNode } from '../../ide/workbench/contrib/behavior_lens/model';
import { captureBehaviorSourceBookmark, behaviorSourceBookmarksEqual, resolveBehaviorSourceBookmark } from '../../ide/workbench/contrib/behavior_lens/source_bookmark';
import { mapBehaviorLensSourceRanges } from '../../ide/workbench/contrib/behavior_lens/source_correspondence';
import { selectStateMachineSource, stateMachineSourceRange } from '../../ide/workbench/contrib/behavior_lens/state_machine_selection';
import { createBehaviorLensViewState } from '../../ide/workbench/contrib/behavior_lens/view_model';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';

const MAIN = `local fsm<const> = require('cartlib/fsm/library')
local callback<const> = function(owner) return '../active' end
fsm.register('source.fixture', { states = { idle = { update = callback }, active = {} } })`;
const PROVIDER = "-- 🐉 different UTF-16 offsets\r\nreturn function(owner)\r\n return '../active'\r\nend";

/** Consumer fixture: join real parsed binding/body occurrences, not a claim about the current recognizer. */
function fixture() {
	editorViewState.font = new EditorFont('tiny');
	const main = new EditorTextModel({ domain: 0, path: 'main.lua', source: { type: 'lua', resid: 'main' } }, 'lua', MAIN);
	const provider = new EditorTextModel({ domain: 0, path: 'provider.lua', source: { type: 'lua', resid: 'provider' } }, 'lua', PROVIDER);
	const models = new Map([[main.resource.path, main], [provider.resource.path, provider]]);
	function project(): BehaviorSourceDocument {
		const analysis = buildLuaFileSemanticData(main.buffer.getText(), main.resource.path);
		const dependency = buildLuaFileSemanticData(provider.buffer.getText(), provider.resource.path);
		const document = buildBehaviorSourceDocument(main.identity, semanticSnapshot(analysis));
		const definition = document.definitions[0];
		assert.ok(definition.behaviorKind === 'state_machine');
		const original = definition.transitions[0];
		const outcome = original.outcomes[0];
		assert.ok(outcome.proof.kind === 'return');
		const body = dependency.functionValueFlows[0];
		const returned = body.returns[0].statement;
		const transition = { ...original, outcomes: [{ ...outcome, value: returned.expressions[0],
			proof: { kind: 'return' as const, binding: outcome.proof.binding, callback: body.expression, statement: returned } }] };
		// An independent foreign occurrence exercises the same generic source-tree index as BT nodes/properties.
		const providerNode: BehaviorSourceNode = { rowKey: 'provider-return', behaviorKind: 'state_machine', kind: 'property',
			label: 'provider return', detail: '', authoredRange: returned.range, referenceRange: null,
			occurrenceRange: returned.range, resolution: 'complete', children: [] };
		return { ...document, files: [analysis, dependency].map(file => ({ file: file.file, revision: file.revision })), definitions: [{ ...definition,
			children: [...definition.children, providerNode], transitions: [transition] }] };
	}
	const view = createBehaviorLensViewState(project(), main, 'outline', path => models.get(path)!);
	const input = new BehaviorLensInput(main, view, assert.fail);
	for (const model of models.values()) model.onDidChangeContent(event => mapBehaviorLensSourceRanges(view, model.identity, event));
	view.definitionRowKey = view.document.definitions[0].rowKey;
	function chooseReturn() {
		const reference = [...view.stateMachines.references.values()].find(items => items[0].kind === 'state-outcome')![0];
		view.selection = selectStateMachineSource(reference, view.source.models);
		return view.selection;
	}
	return { main, provider, models, view, input, project, chooseReturn,
		refresh() { installBehaviorLensDocument(view, project()); },
		dispose() { input.dispose(); for (const model of models.values()) model.dispose(); } };
}

test('binding and callback markers use their own resource, buffer and UTF-16 coordinates', t => {
	const f = fixture(); t.after(() => f.dispose());
	const selected = f.chooseReturn();
	assert.ok(selected.kind === 'state-outcome' && selected.tracked.kind === 'return' && selected.outcome.proof.kind === 'return');
	assert.equal(selected.tracked.binding.resource, f.main.identity);
	assert.equal(selected.tracked.callback.resource, f.provider.identity);
	assert.equal(selected.tracked.statementStart.resource, f.provider.identity);
	assert.deepEqual(selected.tracked.callback, { resource: f.provider.identity,
		...luaSourceRangeToTextRange(f.provider.buffer, selected.outcome.proof.callback.range) });
	const own = { ...selected.tracked.binding };
	const callbackStart = selected.tracked.callback.start;
	const rootStart = f.view.source.ranges.get(f.view.definitionRowKey!)!.start;
	const foreignStart = f.view.source.ranges.get('provider-return')!.start;
	f.provider.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- provider edit\n' }]);
	assert.equal(f.view.source.isCurrent, false);
	assert.deepEqual(selected.tracked.binding, own);
	assert.equal(selected.tracked.callback.start, callbackStart + 17);
	assert.equal(f.view.source.ranges.get(f.view.definitionRowKey!)!.start, rootStart);
	assert.equal(f.view.source.ranges.get('provider-return')!.start, foreignStart + 17);
	f.refresh();
	assert.equal(f.view.source.isCurrent, true);
	assert.ok(f.view.selection?.kind === 'state-outcome');
	assert.equal(readLuaSourceRange(f.provider.buffer, stateMachineSourceRange(f.view.selection)), "return '../active'");
	f.provider.undo(); f.refresh();
	assert.ok(f.view.selection?.kind === 'state-outcome' && f.view.selection.tracked.kind === 'return');
	assert.equal(f.view.selection.tracked.callback.start, callbackStart);
	assert.equal(f.main.dirty, false); assert.equal(f.provider.dirty, false);
});

test('inspection reads foreign evidence without opening a code tab or dirtying either working copy', t => {
	const f = fixture(); t.after(() => f.dispose()); f.chooseReturn();
	const items = buildBehaviorInspection(f.view);
	const returned = items.find(item => item.range?.path === 'provider.lua')!;
	assert.equal(returned.value, "RETURN '../active'");
	assert.ok(returned.description.startsWith('provider.lua:3:2'));
	assert.equal(f.main.version, 1); assert.equal(f.provider.version, 1);
	assert.equal(f.main.canUndo, false); assert.equal(f.provider.canUndo, false);
	assert.equal(f.main.dirty, false); assert.equal(f.provider.dirty, false);
});

test('navigation copies map provider edits while hidden and release those subscriptions independently', t => {
	const f = fixture(); t.after(() => f.dispose()); f.chooseReturn();
	const history = new BehaviorLensNavigationSelection(f.input);
	const captured = history.snapshot.selected!;
	assert.ok(captured.kind === 'state-outcome' && captured.tracked.kind === 'return');
	const before = captured.tracked.callback.start;
	f.provider.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- hidden\n' }]);
	assert.equal(captured.tracked.callback.start, before + 10);
	f.refresh(); history.restore(f.input);
	assert.ok(f.view.selection?.kind === 'state-outcome');
	assert.equal(stateMachineSourceRange(f.view.selection).start.line, 4);
	assert.equal(behaviorSourceBookmarksEqual(captured, captureBehaviorSourceBookmark(f.view, f.view.selection)), true);
	history.dispose();
	f.provider.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- after release\n' }]);
	assert.equal(captured.tracked.callback.start, before + 10, 'disposed navigation owns no live markers');
	assert.deepEqual(Object.keys(captured.tracked.callback.resource).sort(), ['domain', 'path'], 'history never serializes ROM asset metadata');
});

test('equal coordinates in another file or socket do not identify the same source', t => {
	const f = fixture(); t.after(() => f.dispose());
	f.view.selection = { kind: 'node', rowKey: 'provider-return' };
	const bookmark = captureBehaviorSourceBookmark(f.view, f.view.selection);
	const otherFile = { ...bookmark, path: bookmark.path.map(step => ({ ...step })) };
	const last = otherFile.path.length - 1;
	otherFile.path[last] = { ...otherFile.path[last], resource: f.main.identity };
	assert.equal(behaviorSourceBookmarksEqual(bookmark, otherFile), false);
	assert.equal(resolveBehaviorSourceBookmark(otherFile, f.view), undefined);
	const expression = buildLuaFileSemanticData(PROVIDER, f.provider.identity.path).chunk.body[0];
	assert.ok(expression.kind === LuaSyntaxKind.ReturnStatement);
	const location = luaSourceRangeToTextLocation(f.models, expression.range);
	assert.equal(trackedTextLocationsEqual(location, { ...location, resource: { domain: 1, path: location.resource.path } }), false);
});

test('source correspondence does not transfer a selection to an equal-offset foreign replacement', t => {
	const f = fixture(); t.after(() => f.dispose());
	f.view.selection = { kind: 'node', rowKey: 'provider-return' };
	const old = f.view.source.ranges.get('provider-return')!;
	const document = f.project();
	const definition = document.definitions[0];
	const providerNode = definition.children[definition.children.length - 1];
	const start = { row: 0, column: 0 }, end = { row: 0, column: 0 };
	f.main.buffer.positionAt(old.start, start);
	f.main.buffer.positionAt(old.end - 1, end);
	const range = { path: f.main.resource.path, start: { line: start.row + 1, column: start.column + 1 }, end: { line: end.row + 1, column: end.column + 1 } };
	const replacement = { ...providerNode, authoredRange: range, occurrenceRange: range };
	installBehaviorLensDocument(f.view, { ...document, definitions: [{ ...definition, children: [...definition.children.slice(0, -1), replacement] }] });
	assert.equal(f.view.selection, null);
});

test('a same-path source from another resource domain cannot inherit the previous occurrence', t => {
	const f = fixture(); t.after(() => f.dispose());
	f.view.selection = { kind: 'node', rowKey: 'provider-return' };
	const systemProvider = new EditorTextModel({ domain: -1, path: f.provider.identity.path,
		source: { type: 'lua', resid: 'system-provider' } }, 'lua', PROVIDER);
	t.after(() => f.provider.dispose());
	f.models.set(systemProvider.identity.path, systemProvider);
	installBehaviorLensDocument(f.view, f.project());
	assert.equal(f.view.selection, null);
});
