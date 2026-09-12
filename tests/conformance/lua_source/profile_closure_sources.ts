import assert from 'node:assert/strict';
import { buildLuaFileSemanticData } from '../../../toolchain/ts/lua/semantic/model';
import { LuaSemanticQueryStore } from '../../../toolchain/ts/lua/semantic/query_store';
import { medianMilliseconds } from '../../helpers/performance';

for (const creators of [1, 128, 1024]) {
	const lines = ['local function consume(value) return value end'];
	for (let index = 0; index < creators; index += 1) {
		lines.push(`local function make_${index}(value) return function() return consume(value) end end`,
			`local callback_${index} = make_${index}(${index + 1})`, `callback_${index}()`);
	}
	const file = buildLuaFileSemanticData(lines.join('\n'), 'creators.lua');
	const call = file.refs.find(ref => ref.name === 'consume' && ref.call !== undefined)!.call!;
	const coldQueryMilliseconds = medianMilliseconds(() => {
		const queries = new LuaSemanticQueryStore([file], new Map());
		const graph = queries.callSources(call);
		assert.equal(graph.heads.filter(head => head.caller.kind === 'invocation').length, 1);
		assert.equal(graph.calls.filter(call => call.caller.kind === 'module').length, 2);
	});
	const queries = new LuaSemanticQueryStore([file], new Map());
	const graph = queries.callSources(call);
	const before = queries.metrics();
	let heads = 0;
	const retainedQueryMicroseconds = medianMilliseconds(() => {
		for (let index = 0; index < 10000; index += 1) heads += queries.callSources(call).heads.length;
	}) / 10;
	assert.ok(heads > 0);
	assert.equal(queries.callSources(call), graph);
	assert.deepEqual(queries.metrics(), before);
	console.log(JSON.stringify({ creators, coldQueryMilliseconds, retainedQueryMicroseconds, metrics: before,
		boundary: 'retained binder facts; fresh query store and cold source query inside one returned closure; no prerequisite caller query, parse, guest execution or rendering' }));
}
