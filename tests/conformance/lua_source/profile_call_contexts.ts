import assert from 'node:assert/strict';
import { medianMilliseconds } from '../../helpers/performance';
import { buildLuaFileSemanticData } from '../../../toolchain/ts/lua/semantic/model';
import { LuaSemanticQueryStore } from '../../../toolchain/ts/lua/semantic/query_store';

for (const callers of [1, 64, 256, 1024]) {
	const lines = ['local function consume(id, definition) end',
		'local function wrap(id, definition) consume(id, definition) end'];
	for (let index = 0; index < callers; index += 1) lines.push(`wrap('id_${index}', { task = 'task_${index}' })`);
	const file = buildLuaFileSemanticData(lines.join('\n'), 'contexts.lua');
	const call = file.functionValueFlows.find(flow => flow.calls.length === 1)!.calls[0];
	const coldQueryMilliseconds = medianMilliseconds(() => {
		const queries = new LuaSemanticQueryStore([file], new Map());
		const contexts = queries.callContexts(call);
		assert.equal(contexts.filter(context => context.ownerFrame > 0).length, callers);
	});
	const queries = new LuaSemanticQueryStore([file], new Map());
	const retained = queries.callContexts(call);
	const before = queries.metrics();
	let count = 0;
	const retainedQueryMicroseconds = medianMilliseconds(() => {
		for (let index = 0; index < 10000; index += 1) count += queries.callContexts(call).length;
	}) / 10;
	assert.ok(count > 0);
	assert.equal(queries.callContexts(call), retained);
	assert.deepEqual(queries.metrics(), before, 'retained queries do no semantic reevaluation');
	console.log(JSON.stringify({ callers, sourceUtf16: lines.join('\n').length, coldQueryMilliseconds,
		retainedQueryMicroseconds, metrics: before,
		boundary: 'retained binder facts; fresh query store+first contextual call query; 10000 retained lookups per sample; no guest execution or rendering' }));
}
