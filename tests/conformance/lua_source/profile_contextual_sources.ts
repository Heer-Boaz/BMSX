import assert from 'node:assert/strict';
import { buildLuaFileSemanticData, buildLuaSemanticWorkspaceSnapshot } from '../../../toolchain/ts/lua/semantic/model';
import type { LuaSourceCall } from '../../../toolchain/ts/lua/semantic/source_call_graph';
import type { LuaSourceValueQuery } from '../../../toolchain/ts/lua/semantic/source_value_query';
import { medianMilliseconds } from '../../helpers/performance';

for (const callers of [1, 64, 256, 1024]) {
	const lines = ['local function observe(id, definition) end', 'local function identity(value) return value end',
		'local function relay(id, definition) local alias = definition; observe(id, identity(alias)) end'];
	for (let index = 0; index < callers; index += 1) lines.push(`relay('id-${index}', 'definition-${index}')`);
	const file = buildLuaFileSemanticData(lines.join('\n'), 'source-tuples.lua');
	const site = file.callSites.find(site => site.reference?.name === 'observe')!;
	function create() {
		const resolver = buildLuaSemanticWorkspaceSnapshot([{ path: file.file, source: file.source, analysis: file }]).symbolResolver;
		const heads = resolver.callSources(site).heads.filter(call => call.caller.kind === 'invocation');
		assert.equal(heads.length, callers);
		return { resolver, heads, query: resolver.contextualSources };
	}
	function read(query: LuaSourceValueQuery, heads: readonly LuaSourceCall[]) {
		let terminals = 0;
		for (const head of heads) for (let lane = 0; lane < 2; lane += 1) terminals += query.trace(query.argument(head, lane)).terminals.length;
		assert.equal(terminals, callers * 2);
	}
	const coldQueryMilliseconds = medianMilliseconds(() => {
		const { heads, query } = create();
		read(query, heads);
	});
	const { resolver, heads, query } = create();
	read(query, heads);
	const before = resolver.getSemanticQueryMetrics();
	const evaluations = query.evaluations;
	let resultCount = 0;
	const retainedQueryMicroseconds = medianMilliseconds(() => {
		for (let index = 0; index < 10000; index += 1) {
			resultCount += query.trace(query.argument(heads[index % heads.length], index % 2)).terminals.length;
		}
	}) / 10;
	assert.ok(resultCount > 0);
	assert.equal(query.evaluations, evaluations);
	assert.deepEqual(resolver.getSemanticQueryMetrics(), before);
	console.log(JSON.stringify({ callers, coldQueryMilliseconds, retainedQueryMicroseconds, sourceEvaluations: evaluations, metrics: before,
		boundary: 'retained file facts; fresh workspace/query store, discovery and both argument traces through aliases and a return call; no parse, guest execution or rendering' }));
}
