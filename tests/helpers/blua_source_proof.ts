import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseLuaChunk } from '../../toolchain/ts/lua/analysis/parse';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { walkLuaAst } from '../../toolchain/ts/lua/syntax/ast/traversal';
import type { LuaSyntaxSpan } from '../../toolchain/ts/lua/syntax/source_locations';
import { LuaTokenType } from '../../toolchain/ts/lua/syntax/token';

/** Match executable statements and layout fields to frozen source coordinates. */
export function verifyPinnedBluaSource(
	port: string, basis: string, sources: Record<string, readonly [path: string, sha256: string]>,
	required: ReadonlyArray<readonly [key: string, begin: number, end: number]>,
): void {
	const reference = new Map(Object.entries(sources).map(([key, [path, sha256]]) => {
		const text = execFileSync('git', ['show', `${basis}:${path}`], { encoding: 'utf8' });
		assert.equal(createHash('sha256').update(text).digest('hex'), sha256, path);
		return [key, { lines: text.split('\n'), covered: new Set<number>() }];
	}));
	const source = readFileSync(port, 'utf8'), lines = source.split('\n');
	const { chunk, tokens } = parseLuaChunk(source, port);
	const mappings = new Map<number, string>();
	for (const token of tokens) {
		if (token.type !== LuaTokenType.SingleLineCommentTrivia) continue;
		const { line, column } = chunk.locations.range(token).start;
		if (lines[line - 1].slice(0, column - 1).trim() === '') continue;
		const marks = token.lexeme.slice(2).split(';', 1)[0].trim();
		assert.match(marks, /^[A-Z]:[0-9,-]+(?: [A-Z]:[0-9,-]+)*$/, `${port}:${line}`);
		mappings.set(line, marks);
	}
	const destinations = new Set<number>();
	const mapOperation = (span: LuaSyntaxSpan) => {
		const { line } = chunk.locations.range(span).start;
		destinations.add(line);
		assert.ok(mappings.has(line), `${port}:${line}: no source for ${lines[line - 1].trim()}`);
	};
	const exported = chunk.body.get(chunk.body.length - 1);
	assert.equal(exported.kind, LuaSyntaxKind.ReturnStatement);
	assert.equal(exported.expressions[0].kind, LuaSyntaxKind.TableConstructorExpression);
	walkLuaAst(chunk, node => {
		if (node.kind === LuaSyntaxKind.Block || node.kind === LuaSyntaxKind.Chunk) {
			for (let i = 0; i < node.body.length; ++i) {
				const statement = node.body.get(i);
				if (statement === exported) continue;
				if (statement.kind === LuaSyntaxKind.StructDeclarationStatement) {
					for (const field of statement.fields) mapOperation(field.span);
				} else mapOperation(statement.span);
			}
		}
	});
	for (const token of tokens) {
		if (token.type === LuaTokenType.Else || token.type === LuaTokenType.ElseIf || token.type === LuaTokenType.Until)
			mapOperation(token);
	}
	for (const [line, marks] of mappings) {
		assert.ok(destinations.has(line), `${port}:${line}: source mark does not point to a field or an AST operation`);
		for (const mark of marks.split(' ')) {
			const [key, ranges] = mark.split(':'), origin = reference.get(key);
			assert.ok(origin, mark);
			for (const interval of ranges.split(',')) {
				const [start, end = start] = interval.split('-').map(Number);
				assert.ok(start >= 1 && end >= start && end <= origin.lines.length, mark);
				for (let row = start; row <= end; ++row) origin.covered.add(row);
			}
		}
	}
	for (const [key, begin, end] of required) {
		const origin = reference.get(key)!;
		for (let row = begin; row <= end; ++row)
			assert.ok(origin.covered.has(row), `${key}:${row}: ${origin.lines[row - 1]}`);
	}
}
