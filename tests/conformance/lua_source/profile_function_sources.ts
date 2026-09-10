import assert from 'node:assert/strict';
import { medianMilliseconds } from '../../helpers/performance';
import { parseLuaChunk } from '../../../toolchain/ts/lua/analysis/parse';
import { FunctionSummaryStore } from '../../../toolchain/ts/lua/semantic/function_summary';
import { WorkspaceValueIdentityIndex } from '../../../toolchain/ts/lua/semantic/identity';
import { buildLuaFileSemanticData, buildLuaSemanticWorkspaceSnapshot } from '../../../toolchain/ts/lua/semantic/model';

// Uses the pre-existing public owners so the same harness can bundle a baseline.
for (const [declarationStyle, functions] of [['function', 32], ['function', 1024], ['method', 32], ['method', 1024]] as const) {
	const declarations = ['local api<const> = {}'];
	for (let index = 0; index < functions; index += 1) {
		declarations.push(declarationStyle === 'method'
			? `function api:create_${index}() return self end`
			: `function api.create_${index}(value) return value end`);
	}
	declarations.push('local result<const> = api.create_0({ token = true })', 'return result.token');
	const source = declarations.join('\n');
	const parsed = parseLuaChunk(source, 'profile.lua');
	assert.equal(parsed.syntaxError, null);
	const binderMilliseconds = medianMilliseconds(() => {
		for (let index = 0; index < 10; index += 1) buildLuaFileSemanticData(source, 'profile.lua', parsed);
	}) / 10;
	const file = buildLuaFileSemanticData(source, 'profile.lua', parsed);
	let summaryCount = 0;
	const summaryMilliseconds = medianMilliseconds(() => {
		const identities = new WorkspaceValueIdentityIndex({ files: [file], globalValues: new Map() });
		summaryCount = new FunctionSummaryStore([file], identities).count;
	});
	assert.equal(summaryCount, functions);
	const reference = file.refs[file.refs.length - 1];
	assert.equal(reference.name, 'token');
	let targetCount = 0;
	const queryMilliseconds = medianMilliseconds(() => {
		const snapshot = buildLuaSemanticWorkspaceSnapshot([{ path: file.file, source, analysis: file }]);
		targetCount = snapshot.symbolResolver.resolveReferenceTargets(reference).length;
	});
	assert.equal(targetCount, 1);
	const snapshot = buildLuaSemanticWorkspaceSnapshot([{ path: file.file, source, analysis: file }]);
	assert.equal(snapshot.symbolResolver.resolveReferenceTargets(reference).length, 1);
	let retainedCount = 0;
	const retainedQueryMicroseconds = medianMilliseconds(() => {
		for (let index = 0; index < 10000; index += 1) retainedCount += snapshot.symbolResolver.resolveReferenceTargets(reference).length;
	}) / 10;
	assert.ok(retainedCount > 0);
	console.log(JSON.stringify({ declarationStyle, functions, sourceUtf16: source.length, binderMilliseconds, summaryMilliseconds,
		queryMilliseconds, retainedQueryMicroseconds, metrics: snapshot.symbolResolver.getSemanticQueryMetrics(),
		boundary: 'retained parse; ten binds per sample; fresh identities+summaries or fresh workspace+first member query per sample; 10000 retained lookups per sample; no parsing, rendering, guest execution or Hot Resume' }));
}
