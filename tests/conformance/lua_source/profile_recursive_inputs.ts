import assert from 'node:assert/strict';
import { medianMilliseconds } from '../../helpers/performance';
import { buildLuaFileSemanticData, buildLuaSemanticWorkspaceSnapshot } from '../../../toolchain/ts/lua/semantic/model';

for (const chainLength of [8, 64]) {
	const lines = [
		'local function walk(value)',
		'\tif value.next then return walk(value.next) end',
		'\treturn value',
		'end',
	];
	const declarationLines: number[] = [];
	for (const side of ['left', 'right']) {
		declarationLines.push(lines.length + 1);
		lines.push(`local ${side}_0 = { marker = true }`);
		for (let index = 1; index <= chainLength; index += 1) {
			lines.push(`local ${side}_${index} = { next = ${side}_${index - 1} }`);
		}
		lines.push(`local ${side}_result = walk(${side}_${chainLength})`);
		lines.push(`local ${side}_marker = ${side}_result.marker`);
	}
	const source = lines.join('\n');
	const file = buildLuaFileSemanticData(source, 'recursive.lua');
	const references = file.refs.filter(reference => reference.name === 'marker' && !reference.isWrite);
	assert.equal(references.length, 2);
	const input = [{ path: file.file, source, analysis: file }];
	let targetCount = 0;
	const queryMilliseconds = medianMilliseconds(() => {
		const snapshot = buildLuaSemanticWorkspaceSnapshot(input);
		targetCount = 0;
		for (const reference of references) targetCount += snapshot.symbolResolver.resolveReferenceTargets(reference).length;
	});
	assert.equal(targetCount, 2);
	const snapshot = buildLuaSemanticWorkspaceSnapshot(input);
	for (let index = 0; index < references.length; index += 1) {
		const targets = snapshot.symbolResolver.resolveReferenceTargets(references[index]);
		assert.equal(targets.length, 1);
		assert.equal(snapshot.symbolResolver.getDeclaration(targets[0])!.range.start.line, declarationLines[index]);
	}
	const metrics = snapshot.symbolResolver.getSemanticQueryMetrics();
	assert.equal(metrics.instantiatedCalls, 2);
	console.log(JSON.stringify({ chainLength, sourceUtf16: source.length, queryMilliseconds, metrics,
		boundary: 'retained file facts; fresh workspace plus both leaf-member queries; no parsing, guest execution, rendering or heap-allocation measurement' }));
}
