import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getLuaTextContext, LuaTextContext } from '../../ide/common/text';
import { resolveModuleCompletionRange } from '../../ide/editor/contrib/suggest/completion_model';
import { resetSemanticProjects } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { activeCodeEditor, createCodeEditorViewState } from '../../ide/editor/ui/code_editor_state';
import { PieceTreeBuffer } from '../../ide/editor/text/piece_tree_buffer';
import type { RuntimeLuaTooling } from '../../ide/runtime/lua_tooling';
import { CompletionController } from '../../ide/workbench/contrib/code_editor/suggest/completion_controller';
import { buildLuaSemanticFrontend } from '../../toolchain/ts/lua/semantic/frontend';

test('module completion replaces a whole path while preserving its Lua delimiters', () => {
	for (const [open, close] of [["'", "'"], ['"', '"'], ['[[', ']]'], ['[=[', ']=]']]) {
		for (const path of ['', 'cartlib/co_tail']) {
			const source = `local m = require(${open}${path}${close})`;
			const start = source.indexOf(open) + open.length;
			const cursor = start + (path ? 'cartlib/co'.length : 0);
			const file = buildLuaSemanticFrontend([{ path: 'main.lua', source }]).getFile('main.lua');
			const range = file.findModuleCompletionRangeAt(1, cursor + 1)!;
			assert.ok(range);
			const replacement = resolveModuleCompletionRange(source, cursor, range)!;
			assert.equal(replacement.prefix, path ? 'cartlib/co' : '');
			assert.equal(replacement.replacementText, path);
			assert.equal(source.slice(0, replacement.replaceFromColumn) + 'cartlib/component' + source.slice(replacement.replaceToColumn),
				`local m = require(${open}cartlib/component${close})`);
			assert.equal(resolveModuleCompletionRange(source, start - 1, range), null);
		}
	}
});

test('module completion uses bound builtin require arguments, not arbitrary strings or shadowed calls', () => {
	const lines = [
		'require("module")',
		'local message = "module"',
		'-- require("module")',
		'object.require("module")',
		'local function load(require) return require("module") end',
		'require("module", "second")',
	];
	const file = buildLuaSemanticFrontend([{ path: 'main.lua', source: lines.join('\n') }]).getFile('main.lua');
	for (let row = 0; row < lines.length; row += 1) {
		assert.equal(file.findModuleCompletionRangeAt(row + 1, lines[row].indexOf('module') + 2) !== null, row === 0 || row === 5);
	}
	assert.equal(file.findModuleCompletionRangeAt(6, lines[5].indexOf('second') + 2), null);
});

test('Lua completion context distinguishes escaped and multiline strings from code and comments after edits', () => {
	const buffer = new PieceTreeBuffer('local value = [=[\n-- string\n]=]\n-- comment\nlocal s = "escaped \\" quote"; call()');
	assert.equal(getLuaTextContext(buffer, 1, 6), LuaTextContext.String);
	assert.equal(getLuaTextContext(buffer, 3, 5), LuaTextContext.Comment);
	assert.equal(getLuaTextContext(buffer, 4, 24), LuaTextContext.String);
	assert.equal(getLuaTextContext(buffer, 4, buffer.getLineContent(4).length), LuaTextContext.Code);
	buffer.replace(0, 'local value = '.length, '--');
	assert.equal(getLuaTextContext(buffer, 1, 6), LuaTextContext.Comment);
});

test('completion sees a newly created module without editing the importer or rebooting', t => {
	t.after(() => {
		activeCodeEditor.detach();
		resetSemanticProjects();
		editorTextModelService.clear();
	});
	const resource = (path: string) => ({ domain: 0 as const, path, source: { resid: path, type: 'lua', source_path: path } });
	const importer = editorTextModelService.retain(resource('carts/example/main.lua'), 'lua', "local m = require('authoring/')");
	const view = createCodeEditorViewState();
	view.cursorColumn = importer.buffer.getText().indexOf("')");
	activeCodeEditor.attach(importer, view);
	const bridge = {
		luaInterpreter: { globalEnvironment: new Map() },
		sources: {
			systemLuaSources: { records: [], revision: 0 },
			cartridgeSlots: [null, null],
		},
	} as unknown as RuntimeLuaTooling;
	class ReadyCompletionController extends CompletionController {
		protected override isCompletionReady() { return true; }
	}
	const controller = new ReadyCompletionController(bridge, null, null);
	const version = importer.version;
	assert.deepEqual(controller.listCompletionCandidates()!.filteredItems, []);
	editorTextModelService.retain(resource('carts/example/authoring/palette.lua'), 'lua', 'return {}');
	const candidates = controller.listCompletionCandidates()!;
	assert.equal(importer.version, version);
	assert.equal(candidates.context.kind, 'module');
	assert.deepEqual(candidates.filteredItems.map(item => item.label), ['authoring/palette']);
	assert.equal(candidates.filteredItems[0].detail, 'carts/example/authoring/palette.lua');
});
