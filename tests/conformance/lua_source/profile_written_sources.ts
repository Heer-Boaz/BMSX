import assert from 'node:assert/strict';
import { medianMilliseconds } from '../../helpers/performance';
import { buildLuaFileSemanticData } from '../../../toolchain/ts/lua/semantic/model';
import { LuaWrittenSourceQuery } from '../../../toolchain/ts/lua/semantic/written_sources';
import { LuaSyntaxKind } from '../../../toolchain/ts/lua/syntax/ast';

for (const aliases of [1, 64, 1024, 4096]) {
	const lines = ['local value_0 = {}'];
	for (let index = 1; index <= aliases; index += 1) lines.push(`local value_${index} = value_${index - 1}`);
	lines.push(`return value_${aliases}`);
	const source = lines.join('\n');
	const file = buildLuaFileSemanticData(source, 'written.lua');
	const statement = file.chunk.body[file.chunk.body.length - 1];
	assert.ok(statement.kind === LuaSyntaxKind.ReturnStatement);
	const expression = statement.expressions[0];
	const files = [file];
	const declarations = new Map(file.decls.map(declaration => [declaration.id, declaration]));
	const coldQueryMilliseconds = medianMilliseconds(() => {
		const query = new LuaWrittenSourceQuery(files, declarations);
		const trace = query.trace(query.expression(file, expression));
		assert.equal(trace.sources.length, aliases + 2);
		assert.equal(trace.terminals.length, 1);
		assert.equal(trace.boundaries.length, 0);
	});
	const query = new LuaWrittenSourceQuery(files, declarations);
	const root = query.expression(file, expression);
	const retained = query.trace(root);
	let count = 0;
	const retainedQueryMicroseconds = medianMilliseconds(() => {
		for (let index = 0; index < 10000; index += 1) count += query.trace(query.expression(file, expression)).sources.length;
	}) / 10;
	assert.ok(count > 0);
	assert.equal(query.trace(root), retained);
	console.log(JSON.stringify({ aliases, sourceUtf16: source.length, boundReads: file.readValuesBySyntax.size,
		coldQueryMilliseconds, retainedQueryMicroseconds, reachableSources: retained.sources.length,
		boundary: 'retained binder facts; fresh source-query owner+trace; 10000 retained expression+trace lookups per sample; no may-call activation or rendering' }));
}
