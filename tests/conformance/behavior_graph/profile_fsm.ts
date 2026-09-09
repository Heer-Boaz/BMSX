import { medianMilliseconds } from '../../helpers/performance';
import { buildLuaFileSemanticData, type SymbolID } from '../../../toolchain/ts/lua/semantic/model';
import { buildBehaviorSourceDocument } from '../../../ide/workbench/contrib/behavior_lens/recognizer';
import { collectBehaviorRegistrations } from '../../../ide/workbench/contrib/behavior_lens/registrations';
import { buildStateMachineBody } from '../../../ide/workbench/contrib/behavior_lens/state_machine';
import { buildStateMachineRelations } from '../../../ide/workbench/contrib/behavior_lens/state_machine_relations';
import { collectMutatedDeclarations, resolveSourceTable, type BehaviorRecognizerContext } from '../../../ide/workbench/contrib/behavior_lens/source';


for (const siblings of [24, 1024]) {
	const source = `local machines<const> = require('cartlib/fsm/library')
local callback<const> = function(owner) if owner.done then return '../active' end return nil end
local shared<const> = { initial = 'idle', on = { reset = 'idle' }, states = {
	idle = { update = callback, on = { go = '../active' } }, active = {},
} }
machines.register('profile', { initial = 'lane0', states = { ${Array.from({ length: siblings }, (_, index) => `lane${index} = shared`).join(',')} } })`;
	const resource = { domain: 0 as const, path: 'fsm_profile.lua' };
	const semantic = buildLuaFileSemanticData(source, resource.path);
	const sourceProjectionMs = medianMilliseconds(() => { buildBehaviorSourceDocument(resource, semantic); });
	const document = buildBehaviorSourceDocument(resource, semantic);
	const registrationSet = collectBehaviorRegistrations(resource, semantic);
	const registration = registrationSet.registrations[0];
	const context: BehaviorRecognizerContext = {
		analysis: semantic, constInitializers: registrationSet.constInitializers, mutatedDeclarations: collectMutatedDeclarations(semantic),
		anchor: registration.anchor, registrationRange: registration.callSite.expression.range, sourceIncomplete: false, behaviorKind: 'state_machine',
	};
	const active = new Set<SymbolID>();
	const table = resolveSourceTable(context, registration.callSite.expression.arguments[1], active)!;
	const structureMs = medianMilliseconds(() => { buildStateMachineBody(context, '', table, active); });
	const { body } = buildStateMachineBody(context, '', table, active);
	const relationsMs = medianMilliseconds(() => { buildStateMachineRelations(context, document.definitions[0].rowKey, body); });
	const relations = buildStateMachineRelations(context, document.definitions[0].rowKey, body);
	if (relations.transitions.length !== siblings * 3 || relations.entries.length !== siblings + 1) throw new Error('profile must retain every authored scope and handler');
	console.log(JSON.stringify({ siblings, scopes: siblings * 3 + 1, transitions: relations.transitions.length,
		sourceProjectionMs, structureMs, relationsMs,
		boundary: 'source generation on cached semantic data; structure and binding isolated; excludes parsing, drawing and total Studio frame' }));
}
