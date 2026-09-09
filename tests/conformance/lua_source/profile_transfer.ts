import assert from 'node:assert/strict';
import { medianMilliseconds } from '../../helpers/performance';
import { EditorTextModel } from '../../../ide/editor/model/text_model';
import { createLuaTableFieldTransfer } from '../../../ide/language/lua/table_field_transfer';
import { parseLuaChunk } from '../../../toolchain/ts/lua/analysis/parse';
import { LuaSyntaxKind } from '../../../toolchain/ts/lua/syntax/ast';

for (const lines of [64, 4096]) {
	const gap = '\n-- unrelated contents 🐉'.repeat(lines);
	const source = `local first={1,2}${gap}\nlocal second={3,4}`;
	const model = new EditorTextModel({ domain: 0, path: 'transfer.lua', source: { type: 'lua', resid: 'transfer' } }, 'lua', source);
	const parsed = parseLuaChunk(source, model.resource.path).chunk!;
	const first = parsed.body[0];
	const second = parsed.body[1];
	assert.ok(first.kind === LuaSyntaxKind.LocalAssignmentStatement && first.values[0].kind === LuaSyntaxKind.TableConstructorExpression);
	assert.ok(second.kind === LuaSyntaxKind.LocalAssignmentStatement && second.values[0].kind === LuaSyntaxKind.TableConstructorExpression);
	const field = first.values[0].fields[0];
	const target = second.values[0];
	let constructed = 0;
	const constructMicroseconds = medianMilliseconds(() => {
		for (let index = 0; index < 100; index += 1) {
			const result = createLuaTableFieldTransfer(model.buffer, model.resource.path, field, target, 2);
			constructed += result.fieldRange.end - result.fieldRange.start;
		}
	}) * 10;
	assert.ok(constructed > 0);
	const result = createLuaTableFieldTransfer(model.buffer, model.resource.path, field, target, 2);
	const applyUndoMicroseconds = medianMilliseconds(() => {
		for (let index = 0; index < 1000; index += 1) {
			model.pushEditOperations(result.edits);
			model.undo();
		}
	});
	const transferUndoMicroseconds = medianMilliseconds(() => {
		for (let index = 0; index < 100; index += 1) {
			model.pushEditOperations(createLuaTableFieldTransfer(model.buffer, model.resource.path, field, target, 2).edits);
			model.undo();
		}
	}) * 10;
	assert.equal(model.buffer.getText(), source);
	assert.equal(model.canUndo, false);
	assert.equal(model.dirty, false);
	const copiedUtf16 = result.edits.reduce((sum, edit) => sum + edit.text.length, 0);
	assert.equal(copiedUtf16, 3);
	console.log(JSON.stringify({ sourceUtf16: source.length, gapUtf16: gap.length, constructMicroseconds, applyUndoMicroseconds,
		transferUndoMicroseconds, editCount: result.edits.length, copiedUtf16,
		boundary: '100-operation construction/transfer batches; 1000-operation apply+Undo batches; 10 warmups, median of 25. One explicit lossless scan; no parsing, semantics, layout, render, autosave, Hot Resume or full frame; not heap allocation profiling' }));
	model.dispose();
}
