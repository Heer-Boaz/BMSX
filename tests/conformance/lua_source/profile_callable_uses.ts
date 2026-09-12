import assert from 'node:assert/strict';
import { buildLuaFileSemanticData } from '../../../toolchain/ts/lua/semantic/model';
import { LuaSemanticQueryStore } from '../../../toolchain/ts/lua/semantic/query_store';
import { medianMilliseconds } from '../../helpers/performance';

for (const owners of [1, 128, 1024]) {
	const lines = ['local function consume(value) return value end'];
	for (let index = 0; index < owners; index += 1) {
		lines.push(`local function entry_${index}(value)`,
			' local callback = function() return consume(value) end',
			' local alias = callback; callback = alias',
			' local result = alias(); return result == value',
			'end', `entry_${index}(${index + 1})`);
	}
	const file = buildLuaFileSemanticData(lines.join('\n'), 'uses.lua');
	const call = file.refs.find(ref => ref.name === 'consume' && ref.call !== undefined)!.call!;
	const coldQueryMilliseconds = medianMilliseconds(() => {
		const queries = new LuaSemanticQueryStore([file], new Map());
		const graph = queries.callSources(call);
		assert.equal(graph.calls.filter(call => call.caller.kind === 'module').length, 1);
		const entry = graph.applications.find(edge => edge.call.caller.kind === 'module')!.target;
		const callback = graph.applications.find(edge => edge.call.caller === entry)!.target;
		assert.ok(graph.heads.some(head => head.caller === callback));
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
	console.log(JSON.stringify({ owners, coldQueryMilliseconds, retainedQueryMicroseconds, metrics: before,
		boundary: 'retained binder facts; fresh query store and source query inside one body-local callback; module-rooted application checked, no prerequisite caller query, parse, guest or render' }));
}
