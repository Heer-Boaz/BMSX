import type { LuaTableConstructorExpression } from '../../../toolchain/ts/lua/syntax/ast';
import { BehaviorSourceReader } from '../../../ide/workbench/contrib/behavior_lens/source_reader';
import { semanticSnapshot } from '../../lua/semantic_test_harness';
import assert from 'node:assert/strict';
import { indexStateMachineSource } from '../../../ide/workbench/contrib/behavior_lens/state_machine_index';
import { medianMilliseconds } from '../../helpers/performance';
import { buildLuaFileSemanticData } from '../../../toolchain/ts/lua/semantic/model';
import { buildBehaviorSourceDocument } from '../../../ide/workbench/contrib/behavior_lens/recognizer';
import { collectBehaviorRegistrations } from '../../../ide/workbench/contrib/behavior_lens/registrations';
import { buildStateMachineBody } from '../../../ide/workbench/contrib/behavior_lens/state_machine';
import { buildStateMachineRelations } from '../../../ide/workbench/contrib/behavior_lens/state_machine_relations';
import { resolveSourceTable, type BehaviorRecognizerContext } from '../../../ide/workbench/contrib/behavior_lens/source';
import { EditorTextModel } from '../../../ide/editor/model/text_model';
import { createBehaviorLensViewState } from '../../../ide/workbench/contrib/behavior_lens/view_model';
import { installBehaviorLensDocument } from '../../../ide/workbench/contrib/behavior_lens/layout';
import { mapStateMachineSourceSelection, selectStateMachineSource } from '../../../ide/workbench/contrib/behavior_lens/state_machine_selection';


for (const siblings of [24, 1024]) {
	const source = `local machines<const> = require('cartlib/fsm/library')
local callback<const> = function(owner) if owner.done then return '../active' end return nil end
local shared<const> = { initial = 'idle', on = { reset = 'idle' }, states = {
	idle = { update = callback, on = { go = '../active' } }, active = {},
} }
machines.register('profile', { initial = 'lane0', states = { ${Array.from({ length: siblings }, (_, index) => `lane${index} = shared`).join(',')} } })`;
	const resource = { domain: 0 as const, path: 'fsm_profile.lua' };
	const semantic = buildLuaFileSemanticData(source, resource.path);
	const snapshot = semanticSnapshot(semantic);
	const sourceProjectionMs = medianMilliseconds(() => { buildBehaviorSourceDocument(resource, snapshot); });
	const document = buildBehaviorSourceDocument(resource, snapshot);
	const referenceIndexMs = medianMilliseconds(() => { indexStateMachineSource(document); });
	const model = new EditorTextModel({ ...resource, source: { resid: 'fsm_profile', type: 'lua' } }, 'lua', source);
	const view = createBehaviorLensViewState(document, model, 'outline', assert.fail);
	const references = [...view.stateMachines.references.values()];
	const selected = selectStateMachineSource(references.findLast(items => items[0].kind === 'state-outcome' && items[0].outcome.proof.kind === 'return')![0], view.source.models);
	view.selection = selected;
	const inputRefreshMs = medianMilliseconds(() => { installBehaviorLensDocument(view, document); });
	const roundtrip = [{ offset: 0, deletedLength: 0, insertedLength: 1 }, { offset: 0, deletedLength: 1, insertedLength: 0 }];
	const selectedProofMapMs = medianMilliseconds(() => {
		for (let index = 0; index < 1000; index += 1) mapStateMachineSourceSelection(selected, model.resource, roundtrip);
	}) / 1000;
	const registrationSet = collectBehaviorRegistrations(resource, new BehaviorSourceReader(snapshot));
	const registration = registrationSet.registrations[0];
	const context: BehaviorRecognizerContext = {
		reader: new BehaviorSourceReader(snapshot),
		anchor: registration.anchor, registrationRange: registration.callSite.expression.range, sourceIncomplete: false, behaviorKind: 'state_machine',
	};
	const active = new Set<LuaTableConstructorExpression>();
	const table = resolveSourceTable(context, registration.callSite.expression.arguments[1], active)!;
	const structureMs = medianMilliseconds(() => { buildStateMachineBody(context, '', table, active); });
	const { body } = buildStateMachineBody(context, '', table, active);
	const relationsMs = medianMilliseconds(() => { buildStateMachineRelations(context, document.definitions[0].rowKey, body); });
	const relations = buildStateMachineRelations(context, document.definitions[0].rowKey, body);
	if (relations.transitions.length !== siblings * 3 || relations.entries.length !== siblings + 1) throw new Error('profile must retain every authored scope and handler');
	console.log(JSON.stringify({ siblings, scopes: siblings * 3 + 1, transitions: relations.transitions.length,
		sourceProjectionMs, structureMs, relationsMs, referenceIndexMs, inputRefreshMs, selectedProofMapMs,
		boundary: 'source generation on cached semantic data; structure and binding isolated; excludes parsing, drawing and total Studio frame' }));
}
