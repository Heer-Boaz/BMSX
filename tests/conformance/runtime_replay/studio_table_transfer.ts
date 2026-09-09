import { activeCodeEditor } from '../../../ide/editor/ui/code_editor_state';
import { hasSelection } from '../../../ide/editor/editing/text_editing_and_selection';
import { readLuaSourceRange } from '../../../ide/language/lua/source_edits';
import { createLuaTableFieldTransfer } from '../../../ide/language/lua/table_field_transfer';
import { parseLuaChunk } from '../../../toolchain/ts/lua/analysis/parse';
import { LuaSyntaxKind } from '../../../toolchain/ts/lua/syntax/ast';
import { LUA_TABLE_TRANSFER_SOURCE } from '../../helpers/lua_table_transfer_fixture';
import { check, type StudioFixture } from './studio_fixture';

/** Explicit language operation, not a synthetic graph gesture or a claimed reparent UI. */
export async function testStudioTableTransfer(test: StudioFixture): Promise<void> {
	const { ide, harness, frame, press, cycles, runPaletteCommand } = test;
	console.info('STUDIO: Lua table transfer / exact source result / ordinary history');
	const position = cycles();
	const media = ide.sources.currentBlua32Media;
	harness.openLuaSource('cart.lua');
	const model = activeCodeEditor.model;
	const original = model.buffer.getText();
	model.pushEditOperations([{ offset: 0, deleteLength: model.buffer.length, text: LUA_TABLE_TRANSFER_SOURCE }]);
	await frame();
	const cursor = { row: 0, column: 0 };
	for (const reverse of [false, true]) {
		const parsed = parseLuaChunk(model.buffer.getText(), model.resource.path);
		const from = parsed.chunk!.body[reverse ? 1 : 0];
		const to = parsed.chunk!.body[reverse ? 0 : 1];
		if (from.kind !== LuaSyntaxKind.LocalAssignmentStatement || to.kind !== LuaSyntaxKind.LocalAssignmentStatement
			|| from.values[0].kind !== LuaSyntaxKind.TableConstructorExpression || to.values[0].kind !== LuaSyntaxKind.TableConstructorExpression) {
			throw new Error('transfer: expected independent source constructors');
		}
		const field = from.values[0].fields[1];
		const expected = readLuaSourceRange(model.buffer, field.range);
		const result = createLuaTableFieldTransfer(model.buffer, model.resource.path, field, to.values[0], 1);
		let version = model.version;
		model.pushEditOperations(result.edits);
		await frame();
		check(model.version === version + 1 && model.buffer.getTextRange(result.fieldRange.start, result.fieldRange.end) === expected,
			'transfer: one ordinary working-copy edit identifies exact destination syntax');
		const transferred = model.buffer.getText();
		model.buffer.positionAt(result.fieldRange.start, cursor);
		version = model.version;
		ide.editor.navigation.focusChunkSourceForContext(model.resource.domain, model.resource.path,
			{ row: cursor.row, startColumn: cursor.column, endColumn: cursor.column });
		await frame();
		check(activeCodeEditor.model === model && activeCodeEditor.view.cursorRow === cursor.row
			&& activeCodeEditor.view.cursorColumn === cursor.column && !hasSelection() && model.version === version,
			'transfer: normal source navigation consumes the result range without editing text or selecting a namesake');
		await press('ArrowRight');
		check(activeCodeEditor.view.cursorColumn === cursor.column + 1 && model.version === version,
			'transfer: source remains responsive after navigation');
		await runPaletteCommand('Edit: Undo');
		check(model.buffer.getText() === LUA_TABLE_TRANSFER_SOURCE, 'transfer: palette Undo restores both constructors and every original byte');
		await press('ControlLeft', 'ShiftLeft', 'KeyZ');
		check(model.buffer.getText() === transferred, 'transfer: one normal Redo restores the exact transfer');
		await press('ControlLeft', 'KeyZ');
		check(model.buffer.getText() === LUA_TABLE_TRANSFER_SOURCE, 'transfer: no extra punctuation or private graph history');
	}
	await press('ControlLeft', 'KeyZ');
	check(model.buffer.getText() === original && cycles() === position && ide.sources.currentBlua32Media === media,
		'transfer: independent source fixture undoes entirely without running or mutating the paused machine');
}
