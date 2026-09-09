import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { EditorTextModel } from '../../../ide/editor/model/text_model';
import { luaSourceRangeToTextRange, readLuaSourceRange } from '../../../ide/language/lua/source_edits';
import { createLuaTableFieldTransfer } from '../../../ide/language/lua/table_field_transfer';
import { parseLuaChunk } from '../../../toolchain/ts/lua/analysis/parse';
import { LuaSyntaxKind, type LuaTableConstructorExpression } from '../../../toolchain/ts/lua/syntax/ast';
import { walkLuaAst } from '../../../toolchain/ts/lua/syntax/ast/traversal';

// First/middle/last fields of every constructor, both ends of the next legal
// constructor. Whole-AST and PieceTree oracle; no hardcoded game names or lines.
const paths = execFileSync('git', ['ls-files', 'cartlib', 'machine/bios', 'carts'], { encoding: 'utf8' })
	.trim().split('\n').filter(path => path.endsWith('.lua'));
const locations = new Set(['range', 'startInclusive', 'endExclusive', 'line', 'column']);
let transfers = 0;
let tables = 0;
let bytes = 0;
const begun = performance.now();
for (const path of paths) {
	const source = readFileSync(path, 'utf8');
	bytes += Buffer.byteLength(source);
	const original = parseLuaChunk(source, path);
	assert.equal(original.syntaxError, null, path);
	const all: LuaTableConstructorExpression[] = [];
	walkLuaAst(original.chunk!, node => { if (node.kind === LuaSyntaxKind.TableConstructorExpression) all.push(node); });
	const model = new EditorTextModel({ domain: 0, path, source: { type: 'lua', resid: path } }, 'lua', source);
	const spans = all.map(table => luaSourceRangeToTextRange(model.buffer, table.range));
	for (let fromIndex = 0; fromIndex < all.length; fromIndex += 1) {
		const from = all[fromIndex];
		if (from.fields.length === 0) continue;
		tables += 1;
		for (const index of new Set([0, from.fields.length >>> 1, from.fields.length - 1])) {
			const field = from.fields[index];
			const span = luaSourceRangeToTextRange(model.buffer, field.range);
			let target: LuaTableConstructorExpression | undefined;
			for (let step = 1; step < all.length; step += 1) {
				const candidate = (fromIndex + step) % all.length;
				if (spans[candidate].start >= span.start && spans[candidate].end <= span.end) continue;
				target = all[candidate];
				break;
			}
			if (target === undefined) continue; // No distinct destination outside the selected field exists.
			for (const gap of new Set([0, target.fields.length])) {
				const label = `${path}: ${field.range.start.line}:${field.range.start.column} -> ${target.range.start.line}:${target.range.start.column}/${gap}`;
				const selected = readLuaSourceRange(model.buffer, field.range);
				const transfer = createLuaTableFieldTransfer(model.buffer, path, field, target, gap);
				model.pushEditOperations(transfer.edits);
				const parsed = parseLuaChunk(model.buffer.getText(), path);
				assert.equal(parsed.syntaxError, null, label);
				const fields = [...target.fields];
				fields.splice(gap, 0, field);
				const expected = JSON.stringify(original.chunk, (key, value) => locations.has(key) ? undefined
					: value === from ? { ...from, fields: from.fields.filter(candidate => candidate !== field) }
						: value === target ? { ...target, fields } : value);
				assert.equal(JSON.stringify(parsed.chunk, (key, value) => locations.has(key) ? undefined : value), expected, label);
				assert.equal(model.buffer.getTextRange(transfer.fieldRange.start, transfer.fieldRange.end), selected, label);
				model.undo();
				assert.equal(model.buffer.getText(), source, label);
				assert.equal(model.canUndo, false, label);
				transfers += 1;
			}
		}
	}
	model.dispose();
}
console.log(JSON.stringify({ files: paths.length, bytes, tables, transfers, elapsedMs: performance.now() - begun }));
