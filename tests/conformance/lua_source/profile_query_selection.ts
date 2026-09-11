import assert from 'node:assert/strict';
import { SemanticDemandIndex } from '../../../toolchain/ts/lua/semantic/demand_index';
import { FunctionSummaryStore } from '../../../toolchain/ts/lua/semantic/function_summary';
import { WorkspaceValueIdentityIndex } from '../../../toolchain/ts/lua/semantic/identity';
import { buildLuaFileSemanticData } from '../../../toolchain/ts/lua/semantic/model';
import { medianMilliseconds } from '../../helpers/performance';

for (const callSites of [32, 256]) {
	const lines = ['local object = {}', 'function object:run() end'];
	for (let index = 0; index < 32; index += 1) {
		lines.push(`local alias_${index}`, `alias_${index} = ${index === 0 ? 'object' : `alias_${index - 1}`}`);
	}
	for (let index = 0; index < callSites; index += 1) lines.push('alias_31:run()', 'alias_31:missing()');
	const file = buildLuaFileSemanticData(lines.join('\n'), 'selection.lua');
	const files = [file];
	const globalValues = new Map();
	const queryMilliseconds = medianMilliseconds(() => {
		const summaries = new FunctionSummaryStore(files, new WorkspaceValueIdentityIndex({ files, globalValues }));
		const demand = new SemanticDemandIndex(files, summaries);
		assert.equal(demand.directTargets(file.callValues[0]).length, 1);
		assert.equal(demand.directTargets(file.callValues[1]).length, 0);
	});
	console.log(JSON.stringify({ callSites, aliases: 32, queryMilliseconds,
		boundary: 'retained immutable binder facts; fresh identity, summary and demand indices; positive and negative calls; no parse or guest execution' }));
}
