import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLuaChunk, parseLuaChunkWithRecovery } from '../../toolchain/ts/lua/analysis/parse';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { walkLuaAst } from '../../toolchain/ts/lua/syntax/ast/traversal';

const nestedSource = [
	'local outer<const> = function(param)',
	'\tif param.flag then',
	'\t\tlocal view<const>: *tri[count] = base',
	'\t\tlocal values<const> = {',
	'\t\t\t[key] = function(inner)',
	'\t\t\t\treturn sink:emit(inner)',
	'\t\t\tend,',
	'\t\t}',
	'\tend',
	'end',
	'return outer',
].join('\n');

test('complete Lua AST traversal follows lexical order through nested function bodies', () => {
	const chunk = parseLuaChunk(nestedSource, 'nested.lua').chunk!;
	const identifiers: string[] = [];
	walkLuaAst(chunk, node => {
		if (node.kind === LuaSyntaxKind.IdentifierExpression) {
			identifiers.push(node.name);
		}
	});
	assert.deepEqual(identifiers, [
		'outer', 'param',
		'param', 'flag',
		'view', 'count', 'base',
		'values', 'key', 'inner',
		'sink', 'emit', 'inner',
		'outer',
	]);
});

test('complete Lua AST traversal can prune a retained subtree', () => {
	const chunk = parseLuaChunk(nestedSource, 'nested.lua').chunk!;
	const identifiers: string[] = [];
	walkLuaAst(chunk, node => {
		if (node.kind === LuaSyntaxKind.IdentifierExpression) {
			identifiers.push(node.name);
		}
		return node.kind === LuaSyntaxKind.FunctionExpression ? false : undefined;
	});
	assert.deepEqual(identifiers, ['outer', 'outer']);
});

test('complete Lua AST traversal retains recovery statements and missing identifiers', () => {
	const parsed = parseLuaChunkWithRecovery([
		'local owner<const> = {}',
		'owner.',
	].join('\n'), 'recovery.lua');
	const kinds: LuaSyntaxKind[] = [];
	walkLuaAst(parsed.chunk!, node => {
		kinds.push(node.kind);
	});
	assert.ok(kinds.includes(LuaSyntaxKind.ErrorStatement));
	assert.ok(kinds.includes(LuaSyntaxKind.MissingIdentifier));
});
