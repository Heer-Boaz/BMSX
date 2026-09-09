import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { EditorTextModel } from '../../../ide/editor/model/text_model';
import { mapTrackedTextRange } from '../../../ide/editor/text/text_change';
import { luaSourceRangeToTextRange, luaSourcePositionToTextRange, luaSourcePositionMatchesTextRange } from '../../../ide/language/lua/source_edits';
import { createLuaTableFieldTransfer } from '../../../ide/language/lua/table_field_transfer';
import { buildLuaFileSemanticData } from '../../../toolchain/ts/lua/semantic/model';
import { LuaRelocationAnalysis } from '../../../toolchain/ts/lua/semantic/relocation';
import { findLuaFunctionScopeIndexAt, findLuaLexicalBindingAt } from '../../../toolchain/ts/lua/semantic/scope_query';
import { LuaSyntaxKind, type LuaTableConstructorExpression } from '../../../toolchain/ts/lua/syntax/ast';
import { walkLuaAst } from '../../../toolchain/ts/lua/syntax/ast/traversal';

// A real rebind after each transfer, rather than trusting a prospective query.
// Select the middle field of every nonempty constructor, then the next legal
// target. No game names, definition names or line-number fixtures.
const paths = execFileSync('git', ['ls-files', 'cartlib', 'machine/bios', 'carts'], { encoding: 'utf8' })
	.trim().split('\n').filter(path => path.endsWith('.lua'));
let transfers = 0;
let bindings = 0;
let changed = 0;
const begun = performance.now();
for (const path of paths) {
	const source = readFileSync(path, 'utf8');
	const original = buildLuaFileSemanticData(source, path);
	assert.equal(original.syntaxError, null, path);
	const all: LuaTableConstructorExpression[] = [];
	walkLuaAst(original.chunk, node => { if (node.kind === LuaSyntaxKind.TableConstructorExpression) all.push(node); });
	const model = new EditorTextModel({ domain: 0, path, source: { type: 'lua', resid: path } }, 'lua', source);
	const spans = all.map(table => luaSourceRangeToTextRange(model.buffer, table.range));
	for (let index = 0; index < all.length; index += 1) {
		const from = all[index];
		if (from.fields.length === 0) continue;
		const field = from.fields[from.fields.length >>> 1];
		const span = luaSourceRangeToTextRange(model.buffer, field.range);
		let target: LuaTableConstructorExpression | undefined;
		for (let step = 1; step < all.length; step += 1) {
			const candidate = (index + step) % all.length;
			if (spans[candidate].start >= span.start && spans[candidate].end <= span.end) continue;
			target = all[candidate];
			break;
		}
		if (target === undefined) continue;
		const analysis = new LuaRelocationAnalysis(original, field.range);
		const changes = analysis.getBindingChangesAt(target.range.start);
		const predicted = new Set(changes.map(change => change.kind === 'identifier' ? change.reference : change.expression));
		const evidence = analysis.bindings.map(entry => {
			const occurrence = entry.kind === 'identifier' ? entry.reference.range : entry.expression.range;
			const position = entry.kind === 'vararg' ? original.scopes[entry.scopeIndex].startInclusive
				: entry.binding.kind === 'declaration' ? entry.binding.declaration.range.start
					: entry.binding.kind === 'receiver' ? original.scopes[entry.binding.scopeIndex].startInclusive : undefined;
			return { entry, relativeOffset: luaSourceRangeToTextRange(model.buffer, occurrence).start - span.start,
				origin: position === undefined ? undefined : luaSourcePositionToTextRange(model.buffer, position) };
		});
		const transfer = createLuaTableFieldTransfer(model.buffer, path, field, target, target.fields.length);
		const unsubscribe = model.onDidChangeContent(event => {
			for (const proof of evidence) if (proof.origin !== undefined) mapTrackedTextRange(proof.origin, event.changes);
		});
		model.pushEditOperations(transfer.edits);
		unsubscribe();
		const after = buildLuaFileSemanticData(model.buffer.getText(), path);
		assert.equal(after.syntaxError, null, path);
		const cursor = { row: 0, column: 0 };
		for (const { entry, relativeOffset, origin } of evidence) {
			model.buffer.positionAt(transfer.fieldRange.start + relativeOffset, cursor);
			let same: boolean;
			if (entry.kind === 'identifier') {
				const binding = findLuaLexicalBindingAt(after, entry.reference.name, cursor.row + 1, cursor.column + 1);
				same = entry.binding.kind === binding.kind && (binding.kind === 'global'
					|| luaSourcePositionMatchesTextRange(model.buffer, binding.kind === 'declaration' ? binding.declaration.range.start
						: after.scopes[binding.scopeIndex].startInclusive, origin!));
			} else {
				const scope = findLuaFunctionScopeIndexAt(after, cursor.row + 1, cursor.column + 1);
				same = luaSourcePositionMatchesTextRange(model.buffer, after.scopes[scope].startInclusive, origin!);
			}
			assert.equal(!same, predicted.has(entry.kind === 'identifier' ? entry.reference : entry.expression),
				`${path}:${field.range.start.line}:${field.range.start.column}: destination binding must agree with the actual rebind`);
			bindings += 1;
			if (!same) changed += 1;
		}
		model.undo();
		assert.equal(model.buffer.getText(), source);
		transfers += 1;
	}
	model.dispose();
}
console.log(JSON.stringify({ files: paths.length, transfers, bindings, changed, elapsedMs: performance.now() - begun }));
