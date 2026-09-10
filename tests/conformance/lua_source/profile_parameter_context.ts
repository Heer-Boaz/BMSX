import assert from 'node:assert/strict';
import { medianMilliseconds } from '../../helpers/performance';
import { buildLuaFileSemanticData, buildLuaSemanticWorkspaceSnapshot } from '../../../toolchain/ts/lua/semantic/model';

// The same public snapshot/resolver entrypoints can be bundled against a baseline.
for (const [callSites, writtenParameter] of [[32, false], [256, false], [32, true], [256, true]] as const) {
	const lines = [
		'local function leaf(value) return value end',
		writtenParameter
			? 'local function middle(value) value = value; return leaf(value) end'
			: 'local function middle(value) return leaf(value) end',
		'local function root(value) return middle(value) end',
	];
	for (let index = 0; index < callSites; index += 1) {
		lines.push(
			`local value_${index}<const> = { token = ${index} }`,
			`local result_${index}<const> = root(value_${index})`,
			`local token_${index}<const> = result_${index}.token`,
		);
	}
	const source = lines.join('\n');
	const file = buildLuaFileSemanticData(source, 'parameters.lua');
	const references = file.refs.filter(reference => reference.name === 'token' && !reference.isWrite);
	assert.equal(references.length, callSites);
	const input = [{ path: file.file, source, analysis: file }];
	let targetCount = 0;
	const queryMilliseconds = medianMilliseconds(() => {
		const snapshot = buildLuaSemanticWorkspaceSnapshot(input);
		targetCount = 0;
		for (const reference of references) targetCount += snapshot.symbolResolver.resolveReferenceTargets(reference).length;
	});
	assert.equal(targetCount, callSites);
	const snapshot = buildLuaSemanticWorkspaceSnapshot(input);
	for (let index = 0; index < references.length; index += 1) {
		const targets = snapshot.symbolResolver.resolveReferenceTargets(references[index]);
		assert.equal(targets.length, 1);
		assert.equal(snapshot.symbolResolver.getDeclaration(targets[0])!.range.start.line, 4 + index * 3);
	}
	let retainedCount = 0;
	const retainedQueryMicroseconds = medianMilliseconds(() => {
		for (let iteration = 0; iteration < 100; iteration += 1) {
			for (const reference of references) retainedCount += snapshot.symbolResolver.resolveReferenceTargets(reference).length;
		}
	}) * 10 / callSites;
	assert.ok(retainedCount > 0);
	console.log(JSON.stringify({ callSites, writtenParameter, sourceUtf16: source.length, queryMilliseconds, retainedQueryMicroseconds,
		metrics: snapshot.symbolResolver.getSemanticQueryMetrics(),
		boundary: 'retained file facts; fresh workspace plus every returned-member query; three forwarding bodies; retained lookups separately; no parsing, rendering, guest execution, Hot Resume or heap-allocation measurement' }));
}
