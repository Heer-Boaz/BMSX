import { pointerCapture } from '../../ide/input/pointer/capture';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { resourceIdentityKey } from '../../ide/common/resource';
import { EditorLuaSemanticProject } from '../../ide/editor/contrib/intellisense/semantic/workspace/project';
import { buildLuaSemanticFrontendFromSnapshot } from '../../toolchain/ts/lua/semantic/frontend';
import { searchMatchFromSourceRange } from '../../ide/editor/navigation/source_range';
import { buildReferenceSources } from '../../ide/editor/contrib/references/sources';
import { ReferenceState } from '../../ide/editor/contrib/references/state';
import { createReferenceQuickPickProvider } from '../../ide/workbench/contrib/code_editor/references/quick_access';
import { buildDefinitionQuickPickItems } from '../../ide/workbench/contrib/code_editor/definitions/quick_access';
import { buildSymbolQuickPickItems } from '../../ide/workbench/contrib/code_editor/symbols/quick_access';
import { SymbolQuickPickProvider } from '../../ide/workbench/contrib/code_editor/symbols/quick_pick_provider';
import { TextQuickPickProvider } from '../../ide/workbench/services/quick_input/text_provider';
import { QuickInputController } from '../../ide/workbench/services/quick_input/controller';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { subscribeToLuaModelChanges } from '../../ide/editor/contrib/intellisense/model_lifetime';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import type { EditorLuaSymbolEntry } from '../../ide/editor/contrib/intellisense/engine';
import type { LuaDefinitionTarget } from '../../ide/editor/contrib/definitions/query';
import { SOURCE_CHOICES_DEFINITIONS, SOURCE_CHOICES_USAGE } from '../fixtures/studio/source_choices';

const definitionResource = { domain: 0 as const, path: 'definitions.lua' };
const usageResource = { domain: 0 as const, path: 'usage.lua' };

function referenceFixture(t: TestContext) {
	const project = new EditorLuaSemanticProject(0, new EditorTextModelService());
	project.updateDocuments([{ resource: definitionResource, source: SOURCE_CHOICES_DEFINITIONS },
		{ resource: usageResource, source: SOURCE_CHOICES_USAGE }]);
	t.after(() => project.dispose());
	const snapshot = project.getSnapshot();
	for (const file of snapshot.files) assert.equal(file.syntaxError, null);
	const frontend = buildLuaSemanticFrontendFromSnapshot(snapshot);
	const query = frontend.findReferencesByPosition(resourceIdentityKey(usageResource), 6, 10)!;
	assert.ok(query);
	const info = { query, snapshot, project, expression: query.label,
		matches: query.references.filter(reference => reference.file === resourceIdentityKey(usageResource)).map(reference => searchMatchFromSourceRange(snapshot.getFileData(reference.file)!.chunk.locations.range(reference.span))) };
	return { project, info };
}

function pickerFixture(t: TestContext) {
	configureFontVariant('tiny');
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288;
	const menu = new ContextMenuController(inputFocus, pointerCapture);
	const picker = new QuickInputController(menu);
	t.after(() => { picker.dispose(); menu.dispose(); inputFocus.setTarget(null); });
	return picker;
}

test('reference choices use workspace source identity, not the current-file highlight index', t => {
	const { info } = referenceFixture(t);
	const highlights = new ReferenceState();
	highlights.apply(info, 1);
	assert.equal(highlights.getActiveIndex(), 1);
	const sources = buildReferenceSources(info);
	assert.deepEqual(sources.map(source => [source.resource.path, source.range.start.line, source.kind]), [
		['definitions.lua', 1, 'definition'], ['definitions.lua', 7, 'reference'],
		['usage.lua', 1, 'reference'], ['usage.lua', 6, 'reference'],
	]);
	const provider = createReferenceQuickPickProvider(sources, usageResource, 6, 10);
	const projection = provider.getPicks('');
	assert.equal(projection.selectionIndex, 3);
	assert.equal(provider.items[projection.matches[3].itemIndex].source, sources[3]);
	assert.notEqual(projection.selectionIndex, highlights.getActiveIndex());
	assert.equal(provider.getPicks('definitions.lua').selectionIndex, 0);
	assert.equal(provider.getPicks('no such source').selectionIndex, -1);
	assert.equal(provider.getPicks('').selectionIndex, 3);
	assert.equal(createReferenceQuickPickProvider(sources, { domain: 0, path: 'unrelated.lua' }, 1, 1).getPicks('').selectionIndex, 0,
		'no containing occurrence is a valid navigation context; choose the first result');
});

test('reference text and range identities come from the captured snapshot, read once per file', t => {
	const { project, info } = referenceFixture(t);
	const lookups: string[] = [];
	const getFileData = info.snapshot.getFileData.bind(info.snapshot);
	info.snapshot.getFileData = path => { lookups.push(path); return getFileData(path); };
	project.updateDocument(usageResource, '-- later source generation\n' + SOURCE_CHOICES_USAGE);
	const sources = buildReferenceSources(info);
	assert.deepEqual(lookups.sort(), [resourceIdentityKey(definitionResource), resourceIdentityKey(usageResource)]);
	assert.equal(sources[0].range, info.query.targets[0].range);
	assert.equal(sources[0].lineText, 'source_choice_beacon = 1');
	for (const source of sources.slice(1)) assert.ok(info.query.references.some(reference => getFileData(reference.file)!.chunk.locations.range(reference.span) === source.range));
	assert.equal(sources[3].lineText, 'return source_choice_beacon');
	assert.equal(sources[3].range.start.line, 6);
});

test('symbol choices retain same-name declarations and match case-insensitively', () => {
	const symbols: EditorLuaSymbolEntry[] = [
		{ name: 'mixed_case', path: 'owner.mixed_case', kind: 'function', resource: { domain: 0, path: 'first/shared.lua' },
			location: { path: resourceIdentityKey({ domain: 0, path: 'first/shared.lua' }), range: { startLine: 1, startColumn: 2, endLine: 1, endColumn: 10 } } },
		{ name: 'mixed_case', path: 'owner.mixed_case', kind: 'function', resource: { domain: 0, path: 'second/shared.lua' },
			location: { path: resourceIdentityKey({ domain: 0, path: 'second/shared.lua' }), range: { startLine: 7, startColumn: 4, endLine: 7, endColumn: 12 } } },
	];
	const items = buildSymbolQuickPickItems(symbols, 'workspace');
	assert.equal(items[0].symbol, symbols[0]); assert.equal(items[1].symbol, symbols[1]);
	const provider = new SymbolQuickPickProvider(items, 'workspace');
	assert.deepEqual(provider.getPicks('mixed_case').matches.map(match => match.item), items);
	assert.equal(provider.getPicks('MIXED_CASE SECOND/SHARED.LUA').matches[0].item, items[1]);
	assert.deepEqual(items.map(item => item.description), ['first/shared.lua', 'second/shared.lua'],
		'same-named files must remain distinguishable without a legacy status-bar popup');
});

test('definition choices keep module and declaration targets, including unqualified names', () => {
	const targets: LuaDefinitionTarget[] = [
		{ name: 'plain', namePath: [], kind: 'local', resource: { domain: 0, path: 'a.lua' }, location: { path: resourceIdentityKey({ domain: 0, path: 'a.lua' }), range: { startLine: 1, startColumn: 7, endLine: 1, endColumn: 11 } } },
		{ name: 'library', namePath: ['library'], kind: 'module', resource: { domain: -1, path: 'library.lua' }, location: { path: resourceIdentityKey({ domain: -1, path: 'library.lua' }), range: { startLine: 1, startColumn: 1, endLine: 5, endColumn: 3 } } },
	];
	const items = buildDefinitionQuickPickItems(targets);
	assert.equal(items[0].target, targets[0]); assert.equal(items[0].label, 'plain');
	assert.equal(items[1].target, targets[1]);
	assert.deepEqual(items.map(item => item.description), ['a.lua', 'library.lua'], 'labels use authored resource paths, not opaque semantic addresses');
});

test('initial source choice is revealed and accepted through the shared picker without index translation', t => {
	const picker = pickerFixture(t);
	const { info } = referenceFixture(t);
	const sources = buildReferenceSources(info);
	const provider = createReferenceQuickPickProvider(sources, usageResource, 6, 10);
	editorViewState.viewportHeight = 80;
	const origin = inputFocus.createTarget(); origin.focus();
	let accepted = false;
	picker.pick('REFERENCES', 'Filter', () => provider, item => {
		assert.equal(picker.visible, false);
		assert.equal(inputFocus.target, origin);
		assert.equal(item.source, sources[3]); accepted = true;
	});
	assert.equal(picker.model.list.selectionIndex, 3);
	assert.ok(picker.model.viewport.scrollTop > 0);
	assert.ok(picker.model.firstVisibleIndex <= 3 && picker.model.endVisibleIndex > 3);
	picker.accept(); assert.equal(accepted, true);
});

test('Lua choice subscriptions retire only the captured project and end before a replacement', t => {
	const picker = pickerFixture(t);
	const models = new EditorTextModelService();
	const source = models.retain({ sourceFilePath: 'main.lua', location: { kind: 'workspace' as const, path: 'main.lua' }, domain: 0, path: 'main.lua', source: { resid: 'main', type: 'lua' } }, 'lua', 'return 1');
	const other = models.retain({ sourceFilePath: 'main.lua', location: { kind: 'workspace' as const, path: 'main.lua' }, domain: 1, path: 'main.lua', source: { resid: 'main', type: 'lua' } }, 'lua', 'return 2');
	const data = models.retain({ sourceFilePath: 'data.aem', location: { kind: 'workspace' as const, path: 'data.aem' }, domain: 0, path: 'data.aem', source: { resid: 'data', type: 'data' } }, 'aem', '{}');
	const provider = new TextQuickPickProvider([{ label: 'symbol', description: '', detail: '' }]);
	let invalidations = 0;
	const open = () => picker.pick('SYMBOLS', 'Filter', (_origin, lifetime) => {
		lifetime.add(subscribeToLuaModelChanges(models, 0, () => { invalidations += 1; picker.hide(); }));
		return provider;
	}, () => {});
	open();
	other.pushEditOperations([{ offset: 7, deleteLength: 1, text: '3' }]);
	data.pushEditOperations([{ offset: 1, deleteLength: 0, text: ' ' }]);
	assert.equal(picker.visible, true); assert.equal(invalidations, 0);
	source.pushEditOperations([{ offset: 7, deleteLength: 1, text: '4' }]);
	assert.equal(picker.visible, false); assert.equal(invalidations, 1);
	picker.pick('FILES', 'Filter', () => provider, () => {}); source.undo();
	assert.equal(picker.visible, true); assert.equal(invalidations, 1);
	open(); models.retain({ sourceFilePath: 'base.lua', location: { kind: 'workspace' as const, path: 'base.lua' }, domain: -1, path: 'base.lua', source: { resid: 'base', type: 'lua' } }, 'lua', 'return {}');
	assert.equal(picker.visible, false); assert.equal(invalidations, 2);
	open(); models.clear();
	assert.equal(picker.visible, false); assert.equal(invalidations, 3, 'removal listener detaches during retirement');
	open(); picker.hide();
	models.retain({ sourceFilePath: 'next.lua', location: { kind: 'workspace' as const, path: 'next.lua' }, domain: 0, path: 'next.lua', source: { resid: 'next', type: 'lua' } }, 'lua', 'return 1');
	assert.equal(invalidations, 3, 'ordinary cancellation also releases the source generation');
});
