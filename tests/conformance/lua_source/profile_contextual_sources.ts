import assert from 'node:assert/strict';
import { buildLuaFileSemanticData, buildLuaSemanticWorkspaceSnapshot } from '../../../toolchain/ts/lua/semantic/model';
import type { LuaSourceCall } from '../../../toolchain/ts/lua/semantic/source_call_graph';
import type { LuaSourceValueQuery } from '../../../toolchain/ts/lua/semantic/source_value_query';
import { medianMilliseconds } from '../../helpers/performance';

const members = process.argv.includes('--members');
for (const callers of [1, 64, 256, 1024]) {
	const lines = members ? ['local function observe(id, definition) end',
		'local function make(id, task) return { id = id, definition = { task = task } } end',
		'local function relay(object) observe(object.id, object.definition.task) end']
		: ['local function observe(id, definition) end', 'local function identity(value) return value end',
		'local function relay(id, definition) local alias = definition; observe(id, identity(alias)) end'];
	for (let index = 0; index < callers; index += 1) lines.push(members
		? `relay(make('id-${index}', 'definition-${index}'))` : `relay('id-${index}', 'definition-${index}')`);
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
		// Admit every requested field before capturing answers: discovering a
		// nested field can invalidate an earlier read of that same factory base.
		read(query, heads);
		read(query, heads);
	});
	const { resolver, heads, query } = create();
	read(query, heads);
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
	console.log(JSON.stringify({ kind: members ? 'factory-fields' : 'call-aliases', callers, coldQueryMilliseconds,
		retainedQueryMicroseconds, sourceEvaluations: evaluations, metrics: before,
		boundary: 'retained file facts; fresh workspace/query store, all argument demands then answer capture; no parse, guest execution or rendering' }));
}
