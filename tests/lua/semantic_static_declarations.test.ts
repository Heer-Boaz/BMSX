import assert from 'node:assert/strict';
import test from 'node:test';
import { parseLuaChunkWithRecovery } from '../../toolchain/ts/lua/analysis/parse';
import { buildLuaFileSemanticData, LuaSemanticWorkspace } from '../../toolchain/ts/lua/semantic/model';
import { LuaSyntaxKind, type LuaSizeOfExpression } from '../../toolchain/ts/lua/syntax/ast';
import { walkLuaAst } from '../../toolchain/ts/lua/syntax/ast/traversal';
import { SourceChangeMap } from '../../toolchain/ts/text/source_changes';

test('static syntax is indexed once per file without running value inference', t => {
	const workspace = new LuaSemanticWorkspace();
	const file = workspace.updateFile('types.lua', `struct shape
	x: word
end
bss stored: shape
local read = function(...)
	struct shape
		y: word[3]
	end
	return sizeof(shape)
end
return sizeof(shape)`);
	const resolver = workspace.getSnapshot().symbolResolver;
	const metrics = resolver.getSemanticQueryMetrics();
	const declarations = resolver.staticDeclarations;
	const lookup = t.mock.method(file.declarationIdsBySyntax, 'get');
	const uses: LuaSizeOfExpression[] = [];
	walkLuaAst(file.chunk, node => { if (node.kind === LuaSyntaxKind.SizeOfExpression) uses.push(node); });
	const [outer, inner] = file.decls.filter(declaration => declaration.kind === 'type');
	assert.equal(declarations.typeAt(file, 'shape', uses[0].span), inner);
	assert.equal(declarations.typeAt(file, 'shape', uses[1].span), outer);
	const stored = file.decls.find(declaration => declaration.name === 'stored')!;
	assert.equal(declarations.storage(stored).name.name, 'stored');
	assert.equal(declarations.struct(outer).fields[0].name, 'x');
	assert.equal(declarations.struct(inner).fields[0].name, 'y');
	const coldLookups = lookup.mock.callCount();
	assert.equal(coldLookups, 3);
	for (let repeat = 0; repeat < 100; repeat++) {
		assert.equal(declarations.typeAt(file, 'shape', uses[0].span), inner);
		assert.equal(declarations.typeAt(file, 'shape', uses[1].span), outer);
		assert.equal(declarations.struct(outer).fields[0].name, 'x');
		assert.equal(declarations.storage(stored).name.name, 'stored');
	}
	assert.equal(lookup.mock.callCount(), coldLookups);
	assert.equal(resolver.staticDeclarations, declarations);
	assert.deepEqual(resolver.getSemanticQueryMetrics(), metrics);
});

test('retained type bodies use each snapshot position table and parent scope', () => {
	const workspace = new LuaSemanticWorkspace();
	const source = '-- retain body\n'.repeat(80) + `struct shape
	x: word
end
local read = function(...)
	struct shape
		x: word[3]
	end
	return sizeof(shape)
end
return sizeof(shape)`;
	const old = workspace.updateFile('retained.lua', source);
	const prior = workspace.getSnapshot().symbolResolver.staticDeclarations;
	const inserted = 'do struct shape\nx: word[9]\nend end\n';
	const current = workspace.updateFile(old.file, inserted + source,
		SourceChangeMap.unchanged(source.length).append([{ offset: 0, deletedLength: 0, insertedLength: inserted.length }]));
	assert.equal(current.bindingWork.boundFunctions, 0);
	assert.equal(current.bindingWork.reusedFunctions, 1);
	assert.equal(current.functionValueFlows[0], old.functionValueFlows[0]);
	const latest = workspace.getSnapshot().symbolResolver.staticDeclarations;
	assert.notEqual(latest, prior);
	for (const [file, query] of [[old, prior], [current, latest]] as const) {
		const uses: LuaSizeOfExpression[] = [];
		walkLuaAst(file.chunk, node => { if (node.kind === LuaSyntaxKind.SizeOfExpression) uses.push(node); });
		const root = file.decls.find(declaration => declaration.kind === 'type' && declaration.isGlobal)!;
		const inner = file.decls.find(declaration => declaration.kind === 'type' && declaration.scope === file.functionValueFlows[0].id)!;
		assert.equal(query.typeAt(file, 'shape', uses[0].span), inner);
		assert.equal(query.typeAt(file, 'shape', uses[1].span), root);
		assert.equal(query.struct(inner).fields[0].typeRef.arrayLengths.length, 1);
		assert.equal(query.struct(root).fields[0].typeRef.arrayLengths.length, 0);
	}
});

test('global type publication follows immutable file precedence across replacement and removal', () => {
	const workspace = new LuaSemanticWorkspace();
	const first = workspace.updateFile('first.lua', 'struct shape\nx: word\nend');
	const second = workspace.updateFile('second.lua', 'struct shape\ny: word\nend');
	const reader = workspace.updateFile('reader.lua', 'return sizeof(shape)');
	const prior = workspace.getSnapshot().symbolResolver.staticDeclarations;
	const firstType = first.decls.find(declaration => declaration.kind === 'type')!;
	const secondType = second.decls.find(declaration => declaration.kind === 'type')!;
	assert.equal(prior.typeAt(reader, 'shape', reader.chunk.span), firstType);
	workspace.updateFile('first.lua', 'shape = 3');
	const current = workspace.getSnapshot().symbolResolver.staticDeclarations;
	assert.equal(current.typeAt(reader, 'shape', reader.chunk.span), secondType);
	assert.equal(prior.typeAt(reader, 'shape', reader.chunk.span), firstType);
	assert.equal(prior.struct(firstType).fields[0].name, 'x');
	workspace.updateFiles([], ['second.lua']);
	assert.equal(workspace.getSnapshot().symbolResolver.staticDeclarations.typeAt(reader, 'shape', reader.chunk.span), undefined);
	assert.equal(current.typeAt(reader, 'shape', reader.chunk.span), secondType);
});

test('shared syntax does not merge static declarations from different files', () => {
	const source = 'struct shape\nx: word\nend\nbss stored: shape\nreturn sizeof(shape)';
	const parsed = parseLuaChunkWithRecovery(source, 'syntax.lua');
	const left = buildLuaFileSemanticData(source, 'left.lua', parsed);
	const right = buildLuaFileSemanticData(source, 'right.lua', parsed);
	assert.equal(left.chunk, right.chunk);
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFiles([left, right]);
	const query = workspace.getSnapshot().symbolResolver.staticDeclarations;
	const leftType = query.typeAt(left, 'shape', left.chunk.span)!;
	const rightType = query.typeAt(right, 'shape', right.chunk.span)!;
	assert.equal(leftType.file, left.file);
	assert.equal(rightType.file, right.file);
	assert.notEqual(leftType.id, rightType.id);
	assert.equal(query.struct(leftType), query.struct(rightType), 'syntax may be shared; declaration identity cannot');
	const leftStorage = left.decls.find(declaration => declaration.kind === 'bss')!;
	const rightStorage = right.decls.find(declaration => declaration.kind === 'bss')!;
	assert.notEqual(leftStorage.id, rightStorage.id);
	assert.equal(query.storage(leftStorage), query.storage(rightStorage));
});
