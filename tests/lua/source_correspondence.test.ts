import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchLuaTokens } from '../../toolchain/ts/lua/analysis/token_match';
import { LuaLexer } from '../../toolchain/ts/lua/syntax/lexer';
import { LuaTokenType } from '../../toolchain/ts/lua/syntax/token';
import { LuaSourceCorrespondence } from '../../toolchain/ts/lua/semantic/source_correspondence';
import { buildLuaFileSemanticData } from '../../toolchain/ts/lua/semantic/model';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { walkLuaAst } from '../../toolchain/ts/lua/syntax/ast/traversal';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import type { SourceRange } from '../../toolchain/ts/lua/source_range';

const PATH = 'correspondence.lua';

test('Myers token matches agree with an exhaustive LCS oracle', () => {
	const sequences = [''];
	for (let length = 1; length <= 6; length += 1) {
		for (let bits = 0; bits < (1 << length); bits += 1) {
			let sequence = '';
			for (let index = 0; index < length; index += 1) sequence += (bits & (1 << index)) ? 'a ' : 'b ';
			sequences.push(sequence);
		}
	}
	const lexed = sequences.map(source => new LuaLexer(source, PATH).scanTokens().filter(token => token.type !== LuaTokenType.Eof));
	for (const old of lexed) {
		for (const fresh of lexed) {
			const oracle = Array.from({ length: old.length + 1 }, () => new Int32Array(fresh.length + 1));
			for (let x = 1; x <= old.length; x += 1) {
				for (let y = 1; y <= fresh.length; y += 1) {
					oracle[x][y] = old[x - 1].lexeme === fresh[y - 1].lexeme
						? oracle[x - 1][y - 1] + 1 : Math.max(oracle[x - 1][y], oracle[x][y - 1]);
				}
			}
			const matches = matchLuaTokens(old, fresh);
			let count = 0;
			let previous = -1;
			for (let index = 0; index < matches.length; index += 1) {
				const target = matches[index];
				if (target < 0) continue;
				assert.ok(target > previous);
				assert.equal(old[index].lexeme, fresh[target].lexeme);
				previous = target;
				count += 1;
			}
			assert.equal(count, oracle[old.length][fresh.length]);
		}
	}
});

test('token correspondence requires both token kind and raw spelling', () => {
	const old = new LuaLexer('word', PATH).scanTokens().slice(0, 1);
	assert.deepEqual(Array.from(matchLuaTokens(old, [{ ...old[0], type: LuaTokenType.String }])), [-1]);
	assert.deepEqual(Array.from(matchLuaTokens(old, [{ ...old[0], lexeme: 'another' }])), [-1]);
});

function compare(before: string, after: string) {
	return {
		match: new LuaSourceCorrespondence(new Map([[PATH, before]]), new Map([[PATH, after]])),
		old: buildLuaFileSemanticData(before, PATH),
		fresh: buildLuaFileSemanticData(after, PATH),
	};
}

test('declarations survive separate edits and CRLF/comment shifts without name lookup', () => {
	const before = 'local value = 1\ndo\nlocal value = 2\nprint(value)\nend\nlocal value = 3\nprint(value)';
	const after = '-- heading\r\n' + before.replace('= 1', '= 41').replace('= 3', '= 43').replaceAll('\n', '\r\n');
	const { match, old, fresh } = compare(before, after);
	const definitions = fresh.decls.filter(decl => decl.name === 'value');
	for (const [index, decl] of old.decls.filter(decl => decl.name === 'value').entries()) {
		assert.deepEqual(match.declaration(decl.range), definitions[index].range);
	}
});

test('moving a declaration into a new scope cannot reuse the old captured local', () => {
	const { match, old } = compare('local value = 1\nprint(value)', 'do\nlocal value = 1\nprint(value)\nend');
	assert.equal(match.declaration(old.decls[0].range), undefined);
});

test('deleting a scope does not map its local onto an equal root declaration', () => {
	const { match, old } = compare('do\nlocal value = 1\nprint(value)\nend', 'local value = 1\nprint(value)');
	assert.equal(match.declaration(old.decls[0].range), undefined);
});

test('a captured parameter remains in the corresponding function body scope', () => {
	const { match, old, fresh } = compare('function read(value) return value end', '\nfunction read(value) return value + 1 end');
	const previous = old.decls.find(decl => decl.name === 'value')!;
	assert.deepEqual(match.declaration(previous.range), fresh.decls.find(decl => decl.name === 'value')!.range);
});

test('repeat scope correspondence includes its unchanged opening, not an edited until condition', () => {
	const { match, old, fresh } = compare('repeat local value = 1 until value == 2', 'repeat local value = 1 until value > 10');
	assert.deepEqual(match.declaration(old.decls[0].range), fresh.decls[0].range);
});

test('anonymous function body edits map both directions, but reparenting does not', () => {
	const before = 'return function() return 1 end';
	const after = '\nreturn function() return 2 end';
	const functions = (source: string) => {
		const ranges: SourceRange[] = [];
		walkLuaAst(parseLuaChunk(source, PATH).chunk!, node => {
			if (node.kind === LuaSyntaxKind.FunctionExpression) ranges.push(node.range);
		});
		return ranges;
	};
	const old = functions(before)[0];
	const fresh = functions(after)[0];
	const { match } = compare(before, after);
	assert.deepEqual(match.functionRange(old), fresh);
	assert.deepEqual(match.previousFunctionRange(fresh), old);
	assert.equal(compare(before, 'do ' + after + ' end').match.functionRange(old), undefined);
});

test('deleted declarations and missing source files are not identity matches', () => {
	const { match, old } = compare('local removed = 1\nlocal retained = 2', 'local retained = 2');
	assert.equal(match.declaration(old.decls[0].range), undefined);
	const absent = new LuaSourceCorrespondence(new Map(), new Map());
	assert.equal(absent.declaration(old.decls[1].range), undefined);
});
