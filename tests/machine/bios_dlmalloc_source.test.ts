import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { LuaBinaryOperator, LuaSyntaxKind, LuaTableFieldKind, type LuaExpression } from '../../toolchain/ts/lua/syntax/ast';
import { walkLuaAst } from '../../toolchain/ts/lua/syntax/ast/traversal';
import type { LuaSyntaxSpan } from '../../toolchain/ts/lua/syntax/source_locations';
import { LuaTokenType } from '../../toolchain/ts/lua/syntax/token';

const allocatorPath = 'machine/bios/kernel/dlmalloc.lua';
// Source basis: 36231c25e842b4e3fd81b3d5b31e7fad616ec864.
const sources = {
	C: { file: 'machine/common/dlmalloc/dlmalloc.c', sha256: '8f2aab7de1a281c512357ab3dd835896498396680f3226dd96290d650ff1c4da' },
	H: { file: 'machine/common/dlmalloc/dlmalloc.h', sha256: '7b6c9a728bc212cbc09299ea542affa9934b233ed99d0f4d0dea2edd98197a7c' },
};

function wordAddress(expression: LuaExpression): boolean {
	switch (expression.kind) {
		case LuaSyntaxKind.IdentifierExpression:
		case LuaSyntaxKind.NumericLiteralExpression:
		case LuaSyntaxKind.OffsetOfExpression:
			return true;
		case LuaSyntaxKind.BinaryExpression:
			return (expression.operator === LuaBinaryOperator.Add
				|| expression.operator === LuaBinaryOperator.Subtract
				|| expression.operator === LuaBinaryOperator.Multiply)
				&& wordAddress(expression.left) && wordAddress(expression.right);
		default:
			return false;
	}
}

test('BIOS dlmalloc source map accounts for the pinned source and mapped BLua statements', () => {
	const pinned = (key: keyof typeof sources): string[] => {
		const { file, sha256 } = sources[key];
		const text = readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
		assert.equal(createHash('sha256').update(text).digest('hex'), sha256, `${file}: reference changed; audit the port before changing its pin`);
		// Preserve source coordinates when removing block-comment trivia.
		return text.replace(/\/\*[\s\S]*?\*\//g, comment => comment.replace(/[^\n]/g, ' ')).split('\n');
	};
	const reference = { C: pinned('C'), H: pinned('H') };
	const covered = { C: new Set<number>(), H: new Set<number>() };
	const lua = readFileSync(allocatorPath, 'utf8');
	const lines = lua.split('\n');
	const { chunk, tokens } = parseLuaChunk(lua, allocatorPath);
	const exportStatement = chunk.body.get(chunk.body.length - 1);
	assert.equal(exportStatement.kind, LuaSyntaxKind.ReturnStatement);
	assert.equal(exportStatement.expressions.length, 1);
	const exports = exportStatement.expressions[0];
	assert.equal(exports.kind, LuaSyntaxKind.TableConstructorExpression);
	const api = reference.H.flatMap((line, index) => {
		const match = /^(?:void|int|uint32_t) (bmsx_dlmalloc_\w+)\(/.exec(line);
		return match === null ? [] : [{ name: match[1], line: index + 1 }];
	});
	const bindings = new Set<string>();
	const locations: Partial<Record<keyof typeof sources, Set<number>>>[] = [];
	const destinations = new Set<number>();
	for (const token of tokens) {
		if (token.type !== LuaTokenType.SingleLineCommentTrivia) continue;
		const marks = token.lexeme.slice(2).split(';', 1)[0].trim();
		if (!/^[CH]:/.test(marks)) continue;
		const { line: position, column } = chunk.locations.range(token).start;
		if (lines[position - 1].slice(0, column - 1).trim() === '') continue;
		const mapping: Partial<Record<keyof typeof sources, Set<number>>> = {};
		locations[position] = mapping;
		for (const mark of marks.split(/\s+/)) {
			const parsed = /^([CH]):([0-9]+(?:-[0-9]+)?(?:,[0-9]+(?:-[0-9]+)?)*)$/.exec(mark);
			assert.ok(parsed, `${allocatorPath}:${position}: malformed source mark ${mark}`);
			const key = parsed[1] === 'C' ? 'C' : 'H';
			const origin = mapping[key] ??= new Set<number>();
			for (const interval of parsed[2].split(',')) {
				const [begin, end = begin] = interval.split('-').map(Number);
				assert.ok(begin >= 1 && begin <= end && end <= reference[key].length,
					`${allocatorPath}:${position}: out-of-range source mark ${mark}`);
				for (let from = begin; from <= end; ++from) origin.add(from);
			}
		}
	}

	const markAt = (span: LuaSyntaxSpan, required = true): number => {
		const line = chunk.locations.range(span).start.line;
		destinations.add(line);
		assert.ok(!required || locations[line] !== undefined, `${allocatorPath}:${line}: missing source mark: ${lines[line - 1].trim()}`);
		return line;
	};
	// These branch keywords don't have their own AST node.
	for (const token of tokens) {
		if (token.type === LuaTokenType.Else || token.type === LuaTokenType.ElseIf || token.type === LuaTokenType.Until) markAt(token);
	}
	const mapFunction = (span: LuaSyntaxSpan, name: string): void => {
		const line = markAt(span);
		const signature = new RegExp(`^(?:(?:static (?:inline )?)?(?:u32|int|void) ${name}|#define ${name.toUpperCase()})\\(`);
		assert.ok(Array.from(locations[line].C ?? [], n => reference.C[n - 1]).some(code => signature.test(code)),
			`${allocatorPath}:${line}: no C declaration for ${name}`);
		bindings.add(name);
	};
	walkLuaAst(chunk, node => {
		if (node === exportStatement) return false;
		// Statement and branch decisions use the frontend's actual source spans;
		// do not count comments, end tokens or other surrounding syntactic trivia.
		switch (node.kind) {
			case LuaSyntaxKind.StructDeclarationStatement:
				for (const field of node.fields) markAt(field.span);
				break;
			case LuaSyntaxKind.IfStatement:
				markAt(node.span);
				for (const clause of node.clauses) if (clause.condition !== null) markAt(clause.condition.span);
				break;
			case LuaSyntaxKind.RepeatStatement:
				markAt(node.span);
				markAt(node.condition.span);
				break;
			case LuaSyntaxKind.LocalAssignmentStatement: {
				if (node.values[0]?.kind === LuaSyntaxKind.FunctionExpression) {
					mapFunction(node.span, node.names[0].name);
					break;
				}
				const view = node.names.length === 1 && node.pointerTypeRefs[0] !== null
					&& node.values.length === 1 && wordAddress(node.values[0]);
				markAt(node.span, !view);
				break;
			}
			case LuaSyntaxKind.LocalFunctionStatement:
				mapFunction(node.span, node.name.name);
				break;
			case LuaSyntaxKind.AssignmentStatement:
			case LuaSyntaxKind.FunctionDeclarationStatement:
			case LuaSyntaxKind.ReturnStatement:
			case LuaSyntaxKind.BreakStatement:
			case LuaSyntaxKind.WhileStatement:
			case LuaSyntaxKind.ForNumericStatement:
			case LuaSyntaxKind.ForGenericStatement:
			case LuaSyntaxKind.HaltUntilIrqStatement:
			case LuaSyntaxKind.BssDeclarationStatement:
			case LuaSyntaxKind.DataDeclarationStatement:
			case LuaSyntaxKind.RodataDeclarationStatement:
			case LuaSyntaxKind.CallStatement:
			case LuaSyntaxKind.GotoStatement:
			case LuaSyntaxKind.LabelStatement:
				markAt(node.span);
				break;
		}
	});
	for (const { name, line } of api) {
		assert.ok(bindings.has(name), `${sources.H.file}:${line}: missing BLua declaration for ${name}`);
	}
	const internal: string[] = [];
	const external: string[] = [];
	for (const field of exports.fields) {
		assert.equal(field.kind, LuaTableFieldKind.IdentifierKey);
		if (field.name !== 'internal') {
			assert.equal(field.value.kind, LuaSyntaxKind.IdentifierExpression);
			assert.equal(field.name, field.value.name);
			external.push(field.name);
			continue;
		}
		assert.equal(field.value.kind, LuaSyntaxKind.TableConstructorExpression);
		for (const helper of field.value.fields) {
			assert.equal(helper.kind, LuaTableFieldKind.IdentifierKey);
			assert.equal(helper.value.kind, LuaSyntaxKind.IdentifierExpression);
			assert.equal(helper.name, helper.value.name);
			internal.push(helper.name);
		}
	}
	assert.deepEqual(external.sort(), api.map(entry => entry.name).sort());
	assert.deepEqual(internal.sort(), [...bindings].filter(name => !external.includes(name)).sort(),
		'Private link-time bindings name exactly the mapped helper functions');

	for (let line = 1; line < locations.length; ++line) {
		const mapping = locations[line];
		if (mapping === undefined) continue;
		assert.ok(destinations.has(line), `${allocatorPath}:${line}: source mark has no BLua operation or field`);
		for (const key of ['C', 'H'] as const) {
			for (const origin of mapping[key] ?? []) covered[key].add(origin);
		}
	}
	const missing: string[] = [];
	for (let index = 0; index < reference.C.length; ++index) {
		const line = reference.C[index].trim();
		// Pure preprocessor selection and brace-only gaps do not execute.
		// copy_word selects the host primitive behind mapped accesses.
		if (line === '' || line === '{' || line === '}' || /^#(?:include|if|else|endif)\b/.test(line)
			|| /^#define copy_word\b/.test(line)) continue;
		if (!covered.C.has(index + 1)) missing.push(`C:${index + 1}: ${line}`);
	}
	// Offset +0x400 is supplied by the arena owner. The native watch pointer
	// and masks map to the existing CPU memory-port effect, not guest data.
	for (const line of [13, 14, 15, 20, 21, 22]) {
		if (!covered.H.has(line)) missing.push(`H:${line}: ${reference.H[line - 1].trim()}`);
	}
	assert.deepEqual(missing, [], 'Reference operations/fields without a BLua destination');
});
