import assert from 'node:assert/strict';
import { buildLuaFileSemanticData, buildLuaSemanticWorkspaceSnapshot } from '../../../toolchain/ts/lua/semantic/model';
import { medianMilliseconds } from '../../helpers/performance';

// Same field spelling, distinct receiver owners. Navigation intentionally asks
// about uncalled methods; this is not a benchmark of executed-call certainty.
for (const receivers of [32, 256]) {
	const lines: string[] = [];
	for (let index = 0; index < receivers; index += 1) {
		lines.push(
			`local receiver_${index} = {}`,
			`function receiver_${index}:write() self.payload = ${index} end`,
			`function receiver_${index}:read() return self.payload end`,
		);
	}
	const source = lines.join('\n');
	const file = buildLuaFileSemanticData(source, 'receivers.lua');
	const references = file.refs.filter(reference => reference.name === 'payload' && !reference.isWrite);
	const declarations = file.decls.filter(declaration => declaration.name === 'payload');
	assert.equal(references.length, receivers);
	assert.equal(declarations.length, receivers);
	const input = [{ path: file.file, source, analysis: file }];
	let targetCount = 0;
	const queryMilliseconds = medianMilliseconds(() => {
		const snapshot = buildLuaSemanticWorkspaceSnapshot(input);
		targetCount = 0;
		for (const reference of references) targetCount += snapshot.symbolResolver.resolveReferenceTargets(reference).length;
	});
	assert.equal(targetCount, receivers);
	const snapshot = buildLuaSemanticWorkspaceSnapshot(input);
	for (let index = 0; index < references.length; index += 1) {
		assert.deepEqual(snapshot.symbolResolver.resolveReferenceTargets(references[index]), [declarations[index].id]);
	}
	let retainedCount = 0;
	const retainedQueryMicroseconds = medianMilliseconds(() => {
		for (let iteration = 0; iteration < 100; iteration += 1) {
			for (const reference of references) retainedCount += snapshot.symbolResolver.resolveReferenceTargets(reference).length;
		}
	}) * 10 / receivers;
	assert.ok(retainedCount > 0);
	console.log(JSON.stringify({ receivers, sourceUtf16: source.length, queryMilliseconds, retainedQueryMicroseconds,
		metrics: snapshot.symbolResolver.getSemanticQueryMetrics(),
		boundary: 'retained file facts; fresh workspace plus every uncalled receiver-field query; retained lookups separately; no parsing, rendering, guest execution, Hot Resume or heap-allocation measurement' }));
}
