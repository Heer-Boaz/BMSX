import assert from 'node:assert/strict';
import { medianMilliseconds } from '../../helpers/performance';
import { buildLuaFileSemanticData } from '../../../toolchain/ts/lua/semantic/model';
import { buildBehaviorSourceDocument } from '../../../ide/workbench/contrib/behavior_lens/recognizer';
import { BehaviorTreeTransferAnalysis } from '../../../ide/workbench/contrib/behavior_lens/behavior_tree_transfer';

for (const registrations of [32, 1024]) {
	const source = `local trees<const> = require('cartlib/behaviour_tree/library')
local leaf<const> = {type='wait',duration_ticks=1}
local destination<const> = {type='sequence',children={leaf}}
trees.register('origin',{root={type='sequence',children={leaf}}})
${Array.from({ length: registrations }, (_, i) => `trees.register('target.${i}',{root=destination})`).join('\n')}`;
	const resource = { domain: 0 as const, path: 'profile.lua' };
	const semantic = buildLuaFileSemanticData(source, resource.path);
	const document = buildBehaviorSourceDocument(resource, semantic);
	const origin = document.definitions[0];
	const target = document.definitions[registrations];
	assert.ok(origin.behaviorKind === 'behavior_tree' && origin.root?.kind === 'node');
	assert.ok(target.behaviorKind === 'behavior_tree' && target.root?.kind === 'node');
	const branch = origin.root.branches[0];
	const destination = target.root.branches[0];
	assert.ok(branch.role === 'children' && branch.source.kind === 'section' && destination.role === 'children');
	const member = { table: branch.source.table, branch, index: 0 };
	const analysis = new BehaviorTreeTransferAnalysis(document, semantic, member);
	const check = analysis.checkTarget(destination);
	assert.ok(check.kind === 'available' && check.targetUses.length === registrations);
	let observed = 0;
	const constructionAndFirstCheckMicroseconds = medianMilliseconds(() => {
		for (let i = 0; i < 100; i += 1) {
			const probe = new BehaviorTreeTransferAnalysis(document, semantic, member);
			if (probe.checkTarget(destination).kind === 'available') observed += 1;
		}
	}) * 10;
	const retainedCheckMicroseconds = medianMilliseconds(() => {
		for (let i = 0; i < 10000; i += 1) if (analysis.checkTarget(destination) === check) observed += 1;
	}) / 10;
	const projectionMilliseconds = medianMilliseconds(() => {
		for (let i = 0; i < 10; i += 1) observed += buildBehaviorSourceDocument(resource, semantic).definitions.length;
	}) / 10;
	assert.ok(observed > 0);
	console.log(JSON.stringify({ registrations, sourceUtf16: source.length, listUses: analysis.listUses.length,
		constructionAndFirstCheckMicroseconds, retainedCheckMicroseconds, projectionMilliseconds,
		boundary: 'retained semantic source; 10 warmups, median of 25. 100 construction+check, 10000 cached-check, 10 projection operations/sample. No parse, UI, guest, Hot Resume, full frame or heap/GC profiling.' }));
}
