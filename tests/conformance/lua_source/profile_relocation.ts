import assert from 'node:assert/strict';
import { medianMilliseconds } from '../../helpers/performance';
import { parseLuaChunk } from '../../../toolchain/ts/lua/analysis/parse';
import { buildLuaFileSemanticData } from '../../../toolchain/ts/lua/semantic/model';
import { LuaRelocationAnalysis } from '../../../toolchain/ts/lua/semantic/relocation';
import { LuaSyntaxKind } from '../../../toolchain/ts/lua/syntax/ast';

// --binder-only also permits a baseline bundle with the previous model.ts.
const binderOnly = process.argv.includes('--binder-only');
for (const functions of [32, 1024]) {
	const declarations: string[] = [];
	for (let index = 0; index < functions; index += 1) declarations.push(`local function unrelated_${index}(x) return x+${index} end`);
	const source = `local value=1\nlocal from={function() local held=value; return held+value end}\n${declarations.join('\n')}\nlocal value=2\nlocal target={}`;
	const parsed = parseLuaChunk(source, 'profile.lua');
	assert.equal(parsed.syntaxError, null);
	const binderMilliseconds = medianMilliseconds(() => {
		for (let index = 0; index < 10; index += 1) buildLuaFileSemanticData(source, 'profile.lua', parsed);
	}) / 10;
	const file = buildLuaFileSemanticData(source, 'profile.lua', parsed);
	console.log(JSON.stringify({ functions, sourceUtf16: source.length, scopes: file.scopes.length,
		declarations: file.decls.length, binderMilliseconds, boundary: '10 binds per sample on the same retained parse; no parsing, workspace resolution or compilation' }));
	if (binderOnly) continue;
	const from = file.chunk.body[1];
	const target = file.chunk.body[file.chunk.body.length - 1];
	assert.ok(from.kind === LuaSyntaxKind.LocalAssignmentStatement && from.values[0].kind === LuaSyntaxKind.TableConstructorExpression);
	assert.ok(target.kind === LuaSyntaxKind.LocalAssignmentStatement);
	const field = from.values[0].fields[0];
	const destination = target.values[0].range.start;
	let dependencies = 0;
	const collectionMicroseconds = medianMilliseconds(() => {
		for (let index = 0; index < 1000; index += 1) dependencies += new LuaRelocationAnalysis(file, field.range).bindings.length;
	});
	assert.ok(dependencies > 0);
	const analysis = new LuaRelocationAnalysis(file, field.range);
	assert.equal(analysis.bindings.length, 1);
	let changes = 0;
	const destinationMicroseconds = medianMilliseconds(() => {
		for (let index = 0; index < 10000; index += 1) changes += analysis.getBindingChangesAt(destination).length;
	}) / 10;
	assert.ok(changes > 0);
	console.log(JSON.stringify({ functions, collectionMicroseconds, destinationMicroseconds, dependencies: analysis.bindings.length,
		boundary: '1000 collections / 10000 destination checks per sample; 10 warmups, median of 25. No parse/bind, edit, render or Hot Resume; not heap profiling' }));
}
