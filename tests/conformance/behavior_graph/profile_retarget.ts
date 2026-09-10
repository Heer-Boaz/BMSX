import assert from 'node:assert/strict';
import { medianMilliseconds } from '../../helpers/performance';
import { buildLuaFileSemanticData } from '../../../toolchain/ts/lua/semantic/model';
import { buildBehaviorSourceDocument } from '../../../ide/workbench/contrib/behavior_lens/recognizer';
import { StateMachineRetargetAnalysis } from '../../../ide/workbench/contrib/behavior_lens/state_machine_retarget';

for (const registrations of [32, 1024]) {
	const source = `local machines<const> = require('cartlib/fsm/library')
local shared<const> = { on={go=function() return 'idle' end}, initial='idle', states={idle={},active={}} }
${Array.from({ length: registrations }, (_, index) => `machines.register('fixture.${index}',shared)`).join('\n')}`;
	const resource = { domain: 0 as const, path: 'profile.lua' };
	const semantic = buildLuaFileSemanticData(source, resource.path);
	const document = buildBehaviorSourceDocument(resource, semantic);
	const definition = document.definitions[0];
	assert.ok(definition.behaviorKind === 'state_machine');
	const transition = definition.transitions[0];
	const target = definition.scopes[0].children.get('active')!;
	const analysis = new StateMachineRetargetAnalysis(document, transition, transition.outcomes[0]);
	const result = analysis.checkTarget(target);
	assert.ok(result.kind === 'available');
	assert.equal(result.uses.length, registrations);
	let observed = 0;
	const constructionAndFirstCheckMicroseconds = medianMilliseconds(() => {
		for (let index = 0; index < 100; index += 1) {
			const probe = new StateMachineRetargetAnalysis(document, transition, transition.outcomes[0]);
			if (probe.checkTarget(target).kind === 'available') observed += 1;
		}
	}) * 10;
	const retainedCheckMicroseconds = medianMilliseconds(() => {
		for (let index = 0; index < 10000; index += 1) if (analysis.checkTarget(target) === result) observed += 1;
	}) / 10;
	const projectionMilliseconds = medianMilliseconds(() => {
		for (let index = 0; index < 10; index += 1) observed += buildBehaviorSourceDocument(resource, semantic).definitions.length;
	}) / 10;
	assert.ok(observed > 0);
	console.log(JSON.stringify({ registrations, sourceUtf16: source.length, uses: result.uses.length,
		constructionAndFirstCheckMicroseconds, retainedCheckMicroseconds, projectionMilliseconds,
		boundary: 'retained semantic source; 10 warmups/median of 25, batches of 100 construction+first check, 10000 cached checks, 10 projections. No parser, layout, pointer routing, GPU, guest, Hot Resume, total frame or heap/GC profiling.' }));
}
