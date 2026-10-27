import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { createPathModuleProjectFixture } from '../helpers/lua_semantic_project';
import { createTestCodeControl } from '../helpers/code_control';
import { createTestCodeDocuments } from '../helpers/code_documents';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';
import assert from 'node:assert/strict';
import { resourceIdentityKey } from '../../ide/common/resource';
import { registerLuaSourceRecord } from '../../ide/runtime/source_registry';
import { test } from 'node:test';
import { getLuaTextContext, LuaTextContext } from '../../ide/common/text';
import { resolveModuleCompletionRange } from '../../ide/editor/contrib/suggest/completion_model';
import { getOrCreateSemanticProject, resetSemanticProjects } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { createCodeEditorViewState } from '../../ide/editor/ui/code_editor_state';
import { PieceTreeBuffer } from '../../ide/editor/text/piece_tree_buffer';
import { CompletionController } from '../../ide/workbench/contrib/code_editor/suggest/completion_controller';
import { buildLuaSemanticFrontend, buildLuaSemanticFrontendFromSnapshot } from '../../toolchain/ts/lua/semantic/frontend';

test('module completion replaces a whole path while preserving its Lua delimiters', () => {
	for (const [open, close] of [["'", "'"], ['"', '"'], ['[[', ']]'], ['[=[', ']=]']]) {
		for (const path of ['', 'cartlib/co_tail']) {
			const source = `local m = require(${open}${path}${close})`;
			const start = source.indexOf(open) + open.length;
			const cursor = start + (path ? 'cartlib/co'.length : 0);
			const file = buildLuaSemanticFrontend(...createPathModuleProjectFixture([{ path: 'main.lua', source }])).getFile('main.lua');
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
	const file = buildLuaSemanticFrontend(...createPathModuleProjectFixture([{ path: 'main.lua', source: lines.join('\n') }])).getFile('main.lua');
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
		resetSemanticProjects(editorTextModelService);
		editorTextModelService.clear();
	});
	const resource = (path: string) => ({ contextLabel: 'Fixture project', sourceFilePath: path, location: { kind: 'workspace' as const, path }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path, source: { resid: path, type: 'lua' as const, source_path: path } });
	const importer = editorTextModelService.retain(resource('carts/example/main.lua'), 'lua', "local m = require('authoring/')");
	const view = createCodeEditorViewState();
	view.cursorColumn = importer.buffer.getText().indexOf("')");
	const { documents, clock } = createTestCodeDocuments(t, editorTextModelService);
	const code = createTestCodeControl(t, importer, documents, clock, view);
	const sources = createScenarioTestSourceState([{ ...createScenarioTestSourceRecord(importer.resource.path, 1, importer.buffer.getText()), module_path: 'main' }]);

	class ReadyCompletionController extends CompletionController {
		protected override isCompletionReady() { return true; }
	}
	const controller = new ReadyCompletionController(code, sources, null, null, null);
	t.after(() => controller.clearInput());
	const version = importer.version;
	assert.deepEqual(controller.listCompletionCandidates()!.filteredItems, []);
	const path = 'carts/example/authoring/palette.lua';
	editorTextModelService.retain(resource(path), 'lua', 'return {}');
	registerLuaSourceRecord(sources.catalog.getContext(TEST_CARTRIDGE_CONTEXT_IDS[0]).luaSources, { ...createScenarioTestSourceRecord(path, 1, 'return {}'), module_path: 'authoring/palette' });
	const candidates = controller.listCompletionCandidates()!;
	assert.equal(importer.version, version);
	assert.equal(candidates.context.kind, 'module');
	assert.deepEqual(candidates.filteredItems.map(item => item.label), ['authoring/palette']);
	assert.equal(candidates.filteredItems[0].detail, 'carts/example/authoring/palette.lua');
});


test('resolved require spellings do not become duplicate completion insertions outside the declared module catalog', t => {
	t.after(() => { resetSemanticProjects(editorTextModelService); editorTextModelService.clear(); });
	const source = "local existing = require('res/palette.lua')\nlocal candidate = require('')\nreturn existing.value";
	const sources = createScenarioTestSourceState([
		createScenarioTestSourceRecord('main.lua', 1, source),
		createScenarioTestSourceRecord('palette.lua', 1, 'return {value=42}'),
	]);
	const importerResource = sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'main.lua' })!;
	const paletteResource = sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'palette.lua' })!;
	const importer = editorTextModelService.retain(importerResource, 'lua', source), view = createCodeEditorViewState();
	view.cursorRow = 1; view.cursorColumn = importer.buffer.getLineContent(1).indexOf("')");
	const { documents, clock } = createTestCodeDocuments(t, editorTextModelService);
	const code = createTestCodeControl(t, importer, documents, clock, view);
	code.focusTarget.focus();
	const controller = new CompletionController(code, sources, null, null, null);
	t.after(() => controller.clearInput());
	const candidates = controller.listCompletionCandidates()!;
	assert.equal(candidates.context.kind, 'module');
	assert.deepEqual(candidates.filteredItems.map(item => item.insertText).sort(), ['main', 'palette'],
		'inserted source paths come once from declared module_path metadata, never written aliases or opaque addresses');
	const project = getOrCreateSemanticProject(editorTextModelService, importerResource.contextId);
	const frontend = buildLuaSemanticFrontendFromSnapshot(project.getSnapshot());
	const reference = frontend.findSymbolsByPosition(resourceIdentityKey(importerResource), 3, importer.buffer.getLineContent(2).indexOf('value') + 1)!;
	assert.ok(reference);
	assert.deepEqual(reference.targets.map(target => target.range.path), [resourceIdentityKey(paletteResource)],
		'the differently spelled existing require still resolves through the exact written import edge');
	const item = candidates.filteredItems.find(item => item.insertText === 'palette')!;
	controller.applyCompletionItem(candidates.context, item);
	assert.equal(importer.buffer.getText(), source.replace("require('')", "require('palette')"));
});
