import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { walkLuaAst } from '../../toolchain/ts/lua/syntax/ast/traversal';
import { LuaTokenType } from '../../toolchain/ts/lua/syntax/token';

const port = 'machine/bios/kernel/table_grow.lua';
const basis = '45025f5cd2063d4c4b2315b9de8ea19f1956b4ae';
const pins = [
	['T', 'machine/ts/machine/cpu/table.ts', '43943fc1e988e8bb032938d3f178c14f20a896bae3ea4fd8a48606e7201a03fe'],
	['C', 'machine/cpp/machine/cpu/table.cpp', '783f0ca0f9d55a227d430a360ed19556c50c0d233bcfe7b715b3c1a441a4233e'],
	['P', 'machine/ts/machine/cpu/cpu.ts', '19b058735e0648a41318fa00ded351efddc0d0161cfdba36d289ea3c8c8bea7f'],
	['Q', 'machine/cpp/machine/cpu/cpu_table.cpp', '0e4568244c8e43fd7aa4efa0245e586e650de94935a6f6560295a0e6e99f3c9d'],
	['H', 'machine/ts/machine/cpu/lua_heap.ts', '90fd01485f0319193f4ca29196ea75cc00391741948d18ca7443a2ddbb7b38cf'],
	['N', 'machine/cpp/machine/cpu/lua_heap.cpp', '0d892040e7d5e379c31545c5676060602c932ce82c521d69364290eea284079e'],
	['G', 'machine/ts/machine/cpu/gc_heap.ts', '32e1e5788353e936e9868bc1cf8d3d1446e5808ea54480a5eaad0db2e40d37e2'],
	['K', 'machine/cpp/machine/cpu/gc_heap.cpp', 'bcace4a8618f7efdbc316a8a7498cc87c92c280bdce74b7f5bb8c774f9d450f9'],
	['X', 'machine/cpp/machine/cpu/cpu_heap_service.inl', 'a158c9eb720f7f727b0c67c238d8ab933a20cb523206fd22b43cf80ae6c7b2fe'],
	['Y', 'machine/cpp/machine/cpu/cpu.cpp', '1d8e0d4738989fa01ae5db8676aa968ead36106b0db99d69f7294133591113ad'],
	['S', 'machine/ts/machine/cpu/string_pool.ts', '74237f91f471aff25b1dceb96fa48279e764d02ac970e709d68441ebb9f07f97'],
	['J', 'machine/cpp/machine/cpu/string_pool.cpp', '45a273980d49d552245c6950f5adfcb687e9f2bb479291c1375f0913872f7686'],
] as const;

test('the linked TableGrow planner, assists and retry branches trace to the fixed mirrors', () => {
	const sources = new Map(pins.map(([name, file, digest]) => {
		const pinned = execFileSync('git', ['show', `${basis}:${file}`], { encoding: 'utf8' });
		assert.equal(createHash('sha256').update(pinned).digest('hex'), digest, file);
		return [name as string, { size: pinned.split('\n').length, covered: new Set<number>() }] as const;
	}));
	const text = readFileSync(port, 'utf8');
	const lines = text.split('\n');
	assert.ok(lines.includes(`-- Source basis: ${basis}.`));
	const { chunk, tokens } = parseLuaChunk(text, port);
	const mapped = new Set<number>();
	for (const token of tokens) {
		if (token.type !== LuaTokenType.SingleLineCommentTrivia) continue;
		const { line, column } = chunk.locations.range(token).start;
		if (lines[line - 1].slice(0, column - 1).trim() === '') continue;
		const marks = token.lexeme.slice(2).split(';', 1)[0].trim();
		for (const mark of marks.split(/\s+/)) {
			const match = /^([A-Z]):([0-9]+(?:-[0-9]+)?(?:,[0-9]+(?:-[0-9]+)?)*)$/.exec(mark);
			assert.ok(match, `${port}:${line}: malformed source mark ${mark}`);
			const source = sources.get(match[1]);
			assert.ok(source, `${port}:${line}: unknown source ${mark}`);
			for (const span of match[2].split(',')) {
				const [first, last = first] = span.split('-').map(Number);
				assert.ok(first > 0 && first <= last && last <= source.size, `${port}:${line}: bad interval ${mark}`);
				for (let n = first; n <= last; ++n) source.covered.add(n);
			}
		}
		mapped.add(line);
	}
	const requireMark = (line: number) => assert.ok(mapped.has(line), `${port}:${line}: ${lines[line - 1].trim()}`);
	const exportStatement = chunk.body.get(chunk.body.length - 1);
	walkLuaAst(chunk, node => {
		if (node === exportStatement) return false;
		switch (node.kind) {
			case LuaSyntaxKind.StructDeclarationStatement:
				for (const field of node.fields) requireMark(chunk.locations.range(field.span).start.line);
				break;
			case LuaSyntaxKind.AssignmentStatement:
			case LuaSyntaxKind.LocalAssignmentStatement:
			case LuaSyntaxKind.CallStatement:
			case LuaSyntaxKind.IfStatement:
			case LuaSyntaxKind.WhileStatement:
			case LuaSyntaxKind.ForNumericStatement:
			case LuaSyntaxKind.BreakStatement:
			case LuaSyntaxKind.GotoStatement:
			case LuaSyntaxKind.LabelStatement:
			case LuaSyntaxKind.ReturnStatement:
				requireMark(chunk.locations.range(node.span).start.line);
				break;
		}
	});
	for (const token of tokens) {
		if (token.type === LuaTokenType.Else || token.type === LuaTokenType.ElseIf)
			requireMark(chunk.locations.range(token).start.line);
	}
	for (const [name, decisions] of [
		['T', [769, 778, 781, 786, 788, 791, 793, 795, 798, 799, 802, 803, 805, 806, 807, 808, 809]],
		['C', [322, 330, 334, 349, 351, 353, 255, 357, 360, 361, 364, 367, 369, 370, 371, 372, 373, 847]],
		['P', [807, 827, 853, 863, 867]],
		['Q', [197, 216, 248, 259, 265]],
		['G', [1111, 1115, 1121, 1123, 1124]], ['K', [1214, 1220, 1224, 1226, 1227]],
		['X', [169, 172, 181]], ['Y', [3260, 3263, 3265]], ['S', [454]], ['J', [444]],
	] as const) {
		for (const line of decisions) assert.ok(sources.get(name)!.covered.has(line), `missing ${name}:${line}`);
	}
});
