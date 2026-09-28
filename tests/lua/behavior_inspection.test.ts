import { semanticSnapshot } from './semantic_test_harness';
import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorTextModel } from '../../ide/editor/model/text_model';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { buildBehaviorSourceDocument } from '../../ide/workbench/contrib/behavior_lens/recognizer';
import { createBehaviorLensViewState } from '../../ide/workbench/contrib/behavior_lens/view_model';
import { buildBehaviorInspection } from '../../ide/workbench/contrib/behavior_lens/inspection';
import { readLuaSourceRange } from '../../ide/language/lua/source_edits';
import { uppercaseOutsideStrings } from '../../ide/common/text';
import { EditorFont } from '../../ide/editor/ui/view/font';
import { editorViewState } from '../../ide/editor/ui/view/state';

const SOURCE = `local machines<const> = require('cartlib/fsm/library')
local callback<const> = function(owner)
 if owner.ready then return '../active' end
 return nil
end
machines.register('fixture.inspect', {
 states = {
  idle = { transition_guards = { can_enter = function(owner) return owner.enabled end }, update = callback },
  active = { update = callbacks.dynamic },
 }
})`;

function fixture() {
	editorViewState.font = new EditorFont('tiny');
	const model = new EditorTextModel({ domain: 0, path: 'source_owned.lua', source: { type: 'lua', resid: 'independent', generated: true } }, 'lua', SOURCE);
	const document = buildBehaviorSourceDocument(model.resource, semanticSnapshot(buildLuaFileSemanticData(SOURCE, model.resource.path)));
	const view = createBehaviorLensViewState(document, model, 'state-graph', assert.fail);
	view.definitionRowKey = document.definitions[0].rowKey;
	return { model, view };
}

test('FSM inspection keeps guards, full callback/return evidence and actual file ranges off the cards', () => {
	const { model, view } = fixture();
	const idle = view.source.nodes.find(node => node.kind === 'state' && node.label === 'idle')!;
	view.selection = { kind: 'node', rowKey: idle.rowKey };
	const items = buildBehaviorInspection(view);
	for (const item of items) if (item.source !== undefined) {
		assert.equal(item.source!.range.path, 'source_owned.lua');
		assert.equal(item.value, uppercaseOutsideStrings(readLuaSourceRange(model.buffer, item.source!.range)));
	}
	assert.equal(model.readOnly, true, 'read-only authored documents still support full inspection');
	assert.equal(model.version, 1); assert.equal(model.dirty, false); assert.equal(model.canUndo, false);
});

test('implicit entry inspection does not invent a source target or modify the document', () => {
	const { model, view } = fixture();
	view.selection = { kind: 'node', rowKey: view.definitionRowKey! };
	const implicit = buildBehaviorInspection(view).find(item => item.label === 'INITIAL ENTRY')!;
	assert.equal(implicit.source, undefined); assert.equal(implicit.warning, false);
	assert.equal(model.version, 1);
});
