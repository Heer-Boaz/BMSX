import { luaSyntaxSnapshot } from '../helpers/lua_syntax_snapshot';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseLuaChunkWithRecovery } from '../../toolchain/ts/lua/analysis/parse';
import { LuaParser } from '../../toolchain/ts/lua/syntax/parser';
import { EditorLuaSemanticProject } from '../../ide/editor/contrib/intellisense/semantic/workspace/project';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import type { ResourceDomain, RuntimeResource } from '../../ide/common/resource';
import type { LuaSourceRecord, LuaSourceRegistry } from '../../ide/runtime/source_registry';
import type { RuntimeSourceState } from '../../ide/runtime/sources';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';
import { readLuaSourceRange } from '../../ide/language/lua/source_edits';

function sourceRecord(path: string, source: string): LuaSourceRecord {
	return {
		resid: path,
		type: 'lua',
		src: source,
		base_src: source,
		base_update_timestamp: 0,
		source_path: path,
		normalized_source_path: path,
		module_path: path.slice(0, -4),
		update_timestamp: 0,
		generated: false,
		program_module: true,
	};
}

function sourceRegistry(entries: ReadonlyArray<readonly [string, string]>): LuaSourceRegistry {
	const records = new Array<LuaSourceRecord>(entries.length);
	const path2lua: Record<string, LuaSourceRecord> = {};
	const module2lua: Record<string, LuaSourceRecord> = {};
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		const record = sourceRecord(entry[0], entry[1]);
		records[index] = record;
		path2lua[record.source_path] = record;
		module2lua[record.module_path] = record;
	}
	return {
		records,
		path2lua,
		module2lua,
		entrySourcePath: records[0].source_path,
		projectRootPath: '',
		can_boot_from_source: records.length > 0,
		revision: 1,
	};
}

function runtimeSources(system: LuaSourceRegistry, cartridge: LuaSourceRegistry | null): RuntimeSourceState {
	return {
		systemLuaSources: system,
		cartridgeSlots: [
			cartridge === null ? null : { luaSources: cartridge },
			null,
		],
	} as RuntimeSourceState;
}

function resource(domain: ResourceDomain, path: string): RuntimeResource {
	return { domain, path, source: { resid: path, type: 'lua', source_path: path } };
}

test('editor semantic project retains its immutable snapshot while source generations are unchanged', () => {
	const system = sourceRegistry([['system.lua', 'system_value = 1']]);
	const sources = runtimeSources(system, null);
	const project = new EditorLuaSemanticProject(-1, new EditorTextModelService());
	project.synchronizeRuntimeSources(sources);
	const snapshot = project.getSnapshot();

	project.synchronizeRuntimeSources(sources);

	assert.equal(project.getSnapshot(), snapshot);
});

test('document syntax survives unrelated reads and is isolated across domains with equal paths', t => {
	const models = new EditorTextModelService();
	const first = new EditorLuaSemanticProject(0, models);
	const second = new EditorLuaSemanticProject(1, models);
	t.after(() => { first.dispose(); second.dispose(); models.clear(); });
	const parse = t.mock.method(LuaParser.prototype, 'parseChunkWithRecovery');
	const left = models.retain(resource(0, 'same.lua'), 'lua', 'return { left = 1 }');
	models.retain(resource(1, 'same.lua'), 'lua', 'return { right = 2 }');
	for (let index = 0; index < 40; index++) models.retain(resource(0, `other_${index}.lua`), 'lua', `return ${index}`);
	const initial = first.getSnapshot();
	const firstSyntax = initial.getFileData('same.lua')!.chunk;
	const secondSyntax = second.getFileData('same.lua')!.chunk;
	const count = parse.mock.callCount();
	for (let index = 0; index < 40; index++) {
		assert.equal(first.getFileData('same.lua')!.chunk, firstSyntax);
		assert.equal(second.getFileData('same.lua')!.chunk, secondSyntax);
		assert.equal(first.getFileData(`other_${index}.lua`)!.chunk.source, `return ${index}`);
	}
	assert.notEqual(firstSyntax, secondSyntax);
	assert.equal(parse.mock.callCount(), count, 'reads never reparse because other files evicted syntax');
	left.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- first\n' }]);
	left.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- second\n' }]);
	assert.equal(parse.mock.callCount(), count, 'model events queue work only');
	const updated = first.getFileData('same.lua')!;
	assert.equal(parse.mock.callCount(), count + 1, 'coalesced edits parse once');
	assert.equal(updated.chunk.source, '-- second\n-- first\nreturn { left = 1 }');
	assert.equal(initial.getFileData('same.lua')!.chunk, firstSyntax);
	assert.equal(firstSyntax.source, 'return { left = 1 }');
	assert.equal(second.getFileData('same.lua')!.chunk, secondSyntax);
});

test('editor document source remains authoritative across a newer runtime registry generation', () => {
	const system = sourceRegistry([['system.lua', 'system_value = 1']]);
	const cartridge = sourceRegistry([['entry.lua', 'return "rom"']]);
	const sources = runtimeSources(system, cartridge);
	const project = new EditorLuaSemanticProject(0, new EditorTextModelService());
	project.synchronizeRuntimeSources(sources);
	project.updateDocument('entry.lua', 'return "editor"');

	cartridge.records[0].src = 'return "new rom"';
	cartridge.revision += 1;
	project.synchronizeRuntimeSources(sources);

	assert.equal(project.getFileData('entry.lua')?.source, 'return "editor"');
});

test('editor semantic project removes files that disappear from a replaced runtime registry', () => {
	const system = sourceRegistry([['system.lua', 'system_value = 1']]);
	const sources = runtimeSources(system, sourceRegistry([
		['entry.lua', 'return "entry"'],
		['removed.lua', 'return "removed"'],
	]));
	const project = new EditorLuaSemanticProject(0, new EditorTextModelService());
	project.synchronizeRuntimeSources(sources);
	assert.ok(project.getFileData('removed.lua'));

	sources.cartridgeSlots[0] = {
		luaSources: sourceRegistry([['entry.lua', 'return "replacement"']]),
	} as RuntimeSourceState['cartridgeSlots'][0];
	project.synchronizeRuntimeSources(sources);

	assert.equal(project.getFileData('removed.lua'), undefined);
});

test('cartridge semantic projects prefer cartridge modules while retaining system-only modules', () => {
	const system = sourceRegistry([
		['shared.lua', 'return "system"'],
		['system_only.lua', 'return "system only"'],
	]);
	const cartridge = sourceRegistry([['shared.lua', 'return "cartridge"']]);
	const sources = runtimeSources(system, cartridge);
	const project = new EditorLuaSemanticProject(0, new EditorTextModelService());
	project.synchronizeRuntimeSources(sources);

	assert.equal(project.getFileData('shared.lua')?.source, 'return "cartridge"');
	assert.equal(project.getFileData('system_only.lua')?.source, 'return "system only"');
});

test('semantic projects seed retained models without a code tab or a behavior view', () => {
	const models = new EditorTextModelService();
	models.retain(resource(0, 'hidden.lua'), 'lua', 'return "unsaved"');
	const project = new EditorLuaSemanticProject(0, models);
	project.synchronizeRuntimeSources(runtimeSources(sourceRegistry([['system.lua', 'return true']]),
		sourceRegistry([['hidden.lua', 'return "rom"']])));
	assert.equal(project.getSnapshot().getFileData('hidden.lua')!.source, 'return "unsaved"');
});

test('model addition and hidden dependency edits are visible at the next semantic read, including Undo', () => {
	const models = new EditorTextModelService();
	const project = new EditorLuaSemanticProject(0, models);
	project.synchronizeRuntimeSources(runtimeSources(sourceRegistry([['system.lua', 'return true']]),
		sourceRegistry([['main.lua', "return require('dependency')"], ['dependency.lua', 'return {}']])));
	const old = project.getSnapshot();
	const importer = old.getFileData('main.lua')!;
	const statement = importer.chunk.body.get(0)!;
	assert.equal(statement.kind, LuaSyntaxKind.ReturnStatement);
	if (statement.kind !== LuaSyntaxKind.ReturnStatement) throw new Error('fixture must return its import');
	const oldQuery = old.symbolResolver.writtenSources;
	const oldTrace = oldQuery.trace(oldQuery.expression(importer, statement.expressions[0]));
	assert.equal(oldTrace.terminals[0].file.source, 'return {}');
	const model = models.retain(resource(0, 'dependency.lua'), 'lua', 'return {}');
	assert.equal(project.getSnapshot(), old, 'opening unchanged source is not an edit');
	model.pushEditOperations([{ offset: 8, deleteLength: 0, text: 'value = 1' }]);
	assert.equal(old.getFileData('dependency.lua')!.source, 'return {}', 'snapshots remain immutable');
	const edited = project.getSnapshot();
	assert.notEqual(edited, old);
	assert.equal(edited.getFileData('dependency.lua')!.source, 'return {value = 1}');
	assert.equal(edited.getFileData('main.lua'), old.getFileData('main.lua'));
	const query = edited.symbolResolver.writtenSources;
	const trace = query.trace(query.expression(importer, statement.expressions[0]));
	assert.equal(trace.terminals[0].file.source, 'return {value = 1}');
	assert.equal(oldTrace.terminals[0].file.source, 'return {}');
	model.undo();
	assert.equal(project.getFileData('dependency.lua')!.source, 'return {}');
});

test('factory source origins follow a hidden working copy through edit and Undo without touching the importer', t => {
	const provider = 'local function make()\n return 1\nend\nreturn make()';
	const models = new EditorTextModelService();
	const project = new EditorLuaSemanticProject(0, models);
	t.after(() => { project.dispose(); models.clear(); });
	project.synchronizeRuntimeSources(runtimeSources(sourceRegistry([['system.lua', 'return true']]),
		sourceRegistry([['main.lua', "local function consume(value) end; consume(require('dependency'))"], ['dependency.lua', provider]])));
	const initial = project.getSnapshot();
	const importer = initial.getFileData('main.lua')!;
	const site = importer.callSites.find(site => site.reference?.name === 'consume')!;
	const model = models.retain(resource(0, 'dependency.lua'), 'lua', provider);
	const version = model.version;
	function read() {
		const snapshot = project.getSnapshot();
		assert.equal(snapshot.getFileData('main.lua'), importer);
		const resolver = snapshot.symbolResolver;
		const query = resolver.contextualSources;
		const head = resolver.callSources(site).heads[0];
		const trace = query.trace(query.argument(head, 0));
		assert.equal(trace.terminals.length, 1);
		const source = trace.terminals[0].source;
		assert.ok(source.kind === 'function-return');
		assert.equal(source.file, snapshot.getFileData(model.resource.path));
		return { source, text: readLuaSourceRange(model.buffer, source.file.chunk.locations.range(source.entry.statement.span)) };
	}
	const first = read();
	assert.equal(first.text, 'return 1');
	assert.equal(model.version, version);
	assert.equal(model.dirty, false);
	model.pushEditOperations([{ offset: provider.indexOf('1'), deleteLength: 1, text: '2' }]);
	const second = read();
	assert.equal(second.text, 'return 2');
	assert.equal(first.source.file.source, provider);
	assert.equal(model.version, version + 1);
	assert.equal(model.dirty, true);
	model.undo();
	assert.equal(read().text, 'return 1');
	assert.equal(model.dirty, false);
});

test('queued model changes do not enumerate retained models on content changes or warm reads', () => {
	class CountingModels extends EditorTextModelService {
		public enumerations = 0;
		public override get models() { this.enumerations += 1; return super.models; }
	}
	const models = new CountingModels();
	const model = models.retain(resource(0, 'hidden.lua'), 'lua', 'return {}');
	let sourceReads = 0;
	const readText = model.buffer.getText.bind(model.buffer);
	model.buffer.getText = () => { sourceReads += 1; return readText(); };
	const project = new EditorLuaSemanticProject(0, models);
	const seeded = models.enumerations;
	const first = project.getSnapshot();
	for (let index = 0; index < 1000; index += 1) assert.equal(project.getSnapshot(), first);
	const previousReads = sourceReads;
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- first\n' }]);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- second\n' }]);
	assert.equal(models.enumerations, seeded);
	assert.equal(sourceReads, previousReads, 'content callbacks queue paths; they do not read/parse new source');
	assert.equal(project.getFileData('hidden.lua')!.source, '-- second\n-- first\nreturn {}');
	assert.equal(sourceReads, previousReads + 1, 'two queued changes bind only the latest text');
	assert.equal(models.enumerations, seeded);
});

test('model removal releases source to the current registry and removes model-only files', () => {
	const models = new EditorTextModelService();
	const project = new EditorLuaSemanticProject(0, models);
	const cartridge = sourceRegistry([['main.lua', 'return "old"']]);
	const sources = runtimeSources(sourceRegistry([['system.lua', 'return true']]), cartridge);
	project.synchronizeRuntimeSources(sources);
	models.retain(resource(0, 'main.lua'), 'lua', 'return "unsaved"');
	models.retain(resource(0, 'new.lua'), 'lua', 'return "new"');
	project.updateDocument('main.lua', 'return "unsaved"');
	cartridge.records[0].src = 'return "new base"';
	cartridge.revision += 1;
	project.synchronizeRuntimeSources(sources);
	assert.equal(project.getFileData('main.lua')!.source, 'return "unsaved"');
	assert.ok(project.getFileData('new.lua'));
	models.clear();
	assert.equal(project.getFileData('main.lua')!.source, 'return "new base"');
	assert.equal(project.getFileData('new.lua'), undefined);
});

test('clear and re-add before a query publishes the new model rather than a removed source', () => {
	const models = new EditorTextModelService();
	const project = new EditorLuaSemanticProject(0, models);
	models.retain(resource(0, 'main.lua'), 'lua', 'return 1');
	assert.equal(project.getFileData('main.lua')!.source, 'return 1');
	models.clear();
	models.retain(resource(0, 'main.lua'), 'lua', 'return 2');
	assert.equal(project.getFileData('main.lua')!.source, 'return 2');
});

test('identical paths in two cart domains have separate model overlays', () => {
	const models = new EditorTextModelService();
	const left = new EditorLuaSemanticProject(0, models);
	const right = new EditorLuaSemanticProject(1, models);
	const model = models.retain(resource(0, 'same.lua'), 'lua', 'return "left"');
	models.retain(resource(1, 'same.lua'), 'lua', 'return "right"');
	assert.equal(left.getFileData('same.lua')!.source, 'return "left"');
	const rightSnapshot = right.getSnapshot();
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- changed\n' }]);
	assert.equal(right.getSnapshot(), rightSnapshot);
	assert.equal(rightSnapshot.getFileData('same.lua')!.source, 'return "right"');
});

test('SYSTEM models update cart projects unless the cart supplies that resource', () => {
	const models = new EditorTextModelService();
	const system = sourceRegistry([['shared.lua', 'return "system"'], ['system_only.lua', 'return "base"']]);
	const sources = runtimeSources(system, sourceRegistry([['shared.lua', 'return "cart"']]));
	const cart = new EditorLuaSemanticProject(0, models);
	const firmware = new EditorLuaSemanticProject(-1, models);
	cart.synchronizeRuntimeSources(sources); firmware.synchronizeRuntimeSources(sources);
	models.retain(resource(-1, 'shared.lua'), 'lua', 'return "system edit"');
	const dependency = models.retain(resource(-1, 'system_only.lua'), 'lua', 'return "dependency edit"');
	assert.equal(cart.getFileData('shared.lua')!.source, 'return "cart"');
	assert.equal(firmware.getFileData('shared.lua')!.source, 'return "system edit"');
	assert.equal(cart.getFileData('system_only.lua')!.source, 'return "dependency edit"');
	dependency.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- edited\n' }]);
	assert.equal(cart.getFileData('system_only.lua')!.source, '-- edited\nreturn "dependency edit"');
});

test('registry replacement can shadow and uncover a retained SYSTEM model without another edit', () => {
	const models = new EditorTextModelService();
	const system = sourceRegistry([['shared.lua', 'return "system"']]);
	const sources = runtimeSources(system, sourceRegistry([['entry.lua', 'return true']]));
	const project = new EditorLuaSemanticProject(0, models);
	models.retain(resource(-1, 'shared.lua'), 'lua', 'return "system edit"');
	project.synchronizeRuntimeSources(sources);
	assert.equal(project.getFileData('shared.lua')!.source, 'return "system edit"');
	sources.cartridgeSlots[0] = { luaSources: sourceRegistry([['shared.lua', 'return "cart"']]) } as RuntimeSourceState['cartridgeSlots'][0];
	project.synchronizeRuntimeSources(sources);
	assert.equal(project.getFileData('shared.lua')!.source, 'return "cart"');
	sources.cartridgeSlots[0] = { luaSources: sourceRegistry([['entry.lua', 'return true']]) } as RuntimeSourceState['cartridgeSlots'][0];
	project.synchronizeRuntimeSources(sources);
	assert.equal(project.getFileData('shared.lua')!.source, 'return "system edit"');
});

test('disposing a semantic project disconnects its model subscriptions', () => {
	const models = new EditorTextModelService();
	const project = new EditorLuaSemanticProject(0, models);
	const model = models.retain(resource(0, 'main.lua'), 'lua', 'return {}');
	const before = project.getSnapshot();
	project.dispose();
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- new\n' }]);
	models.retain(resource(0, 'added.lua'), 'lua', 'return true');
	models.clear();
	assert.equal(project.getSnapshot(), before);
});

test('non-Lua model changes do not invalidate a Lua semantic project', () => {
	const models = new EditorTextModelService();
	const project = new EditorLuaSemanticProject(0, models);
	const before = project.getSnapshot();
	const model = models.retain({ domain: 0, path: 'art.aem', source: { resid: 'art', type: 'data' } }, 'aem', '{}');
	model.pushEditOperations([{ offset: 1, deleteLength: 0, text: ' ' }]);
	models.clear();
	assert.equal(project.getSnapshot(), before);
});


test('explicit editor parses replace same-text generations without replacing retained snapshots', t => {
	const models = new EditorTextModelService();
	const project = new EditorLuaSemanticProject(0, models);
	t.after(() => { project.dispose(); models.clear(); });
	const path = 'explicit.lua';
	const source = 'local value = 1; return value';
	project.updateDocument(path, source);
	const old = project.getSnapshot();
	const parsed = parseLuaChunkWithRecovery(source, path);
	project.updateDocuments([{ path, source, parsed }]);
	const updated = project.getSnapshot();
	assert.equal(updated.getFileData(path)!.chunk, parsed.chunk);
	assert.notEqual(old.getFileData(path)!.chunk, parsed.chunk);
	project.updateDocuments([{ path, source, parsed }]);
	assert.equal(project.getSnapshot(), updated);
});

test('model deltas compose across multiple events and preserve lexical identities through Undo and Redo', t => {
	const models = new EditorTextModelService();
	const project = new EditorLuaSemanticProject(0, models);
	t.after(() => { project.dispose(); models.clear(); });
	const source = Array.from({ length: 90 }, (_, index) => `local value_${index} = ${index}\n`).join('') + 'return value_89';
	const model = models.retain(resource(0, 'composed.lua'), 'lua', source);
	const first = project.getFileData('composed.lua')!;
	const tail = Array.from(first.chunk.tokens).find(token => token.lexeme === 'value_70')!;
	const parse = t.mock.method(LuaParser.prototype, 'parseChunkWithRecovery');
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- first\n' }]);
	model.pushEditOperations([{ offset: 3, deleteLength: 5, text: 'changed' }]);
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: '\n' }]);
	assert.equal(parse.mock.callCount(), 0, 'event callbacks compose lengths without parsing');
	const edited = project.getFileData('composed.lua')!;
	assert.equal(parse.mock.callCount(), 1);
	assert.equal(edited.source, model.buffer.getText());
	assert.ok(Array.from(edited.chunk.tokens).includes(tail), 'unchanged lexical blocks survive the composed edit');
	model.undo(); model.undo(); model.undo();
	const undone = project.getFileData('composed.lua')!;
	assert.equal(undone.source, source);
	assert.ok(Array.from(undone.chunk.tokens).includes(tail));
	model.redo(); model.redo(); model.redo();
	const redone = project.getFileData('composed.lua')!;
	assert.equal(redone.source, edited.source);
	assert.ok(Array.from(redone.chunk.tokens).includes(tail));
	assert.equal(first.source, source);
});

test('explicit same-text parses replace the model baseline and the next model analysis starts from that generation', t => {
	const models = new EditorTextModelService();
	const project = new EditorLuaSemanticProject(0, models);
	t.after(() => { project.dispose(); models.clear(); });
	const source = Array.from({ length: 90 }, (_, index) => `local value_${index} = ${index}\n`).join('') + 'return value_89';
	const model = models.retain(resource(0, 'explicit_model.lua'), 'lua', source);
	project.analyzeDocument(model.resource.path, model.buffer);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- pending\n' }]);
	const parsed = parseLuaChunkWithRecovery(model.buffer.getText(), model.resource.path);
	project.updateDocuments([{ path: model.resource.path, source: model.buffer.getText(), parsed }]);
	assert.equal(project.analyzeDocument(model.resource.path, model.buffer).chunk, parsed.chunk,
		'the pending model event cannot replace a supplied same-text parse');
	const retained = parsed.tokens.get(parsed.tokens.length - 2);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- next\n' }]);
	assert.ok(Array.from(project.analyzeDocument(model.resource.path, model.buffer).chunk.tokens).includes(retained));
	const detached = new EditorTextModelService();
	t.after(() => detached.clear());
	const other = detached.retain(resource(0, model.resource.path), 'lua', 'return 77');
	assert.equal(project.analyzeDocument(model.resource.path, other.buffer).source, 'return 77', 'detached buffers are explicit full-source input');
	assert.equal(project.analyzeDocument(model.resource.path, model.buffer).source, model.buffer.getText(), 'retained input reestablishes its own baseline');
});

test('ownership changes discard queued deltas before SYSTEM models are uncovered or a path is re-added', t => {
	const models = new EditorTextModelService();
	const project = new EditorLuaSemanticProject(0, models);
	t.after(() => { project.dispose(); models.clear(); });
	const sources = runtimeSources(sourceRegistry([['shared.lua', 'return 1']]), sourceRegistry([['entry.lua', 'return 0']]));
	const system = models.retain(resource(-1, 'shared.lua'), 'lua', 'return 1');
	project.synchronizeRuntimeSources(sources);
	assert.equal(project.getFileData('shared.lua')!.source, 'return 1');
	system.pushEditOperations([{ offset: 7, deleteLength: 1, text: '222' }]);
	sources.cartridgeSlots[0] = { luaSources: sourceRegistry([['shared.lua', 'return 33333']]) } as RuntimeSourceState['cartridgeSlots'][0];
	project.synchronizeRuntimeSources(sources);
	assert.equal(project.getFileData('shared.lua')!.source, 'return 33333');
	system.pushEditOperations([{ offset: 7, deleteLength: 3, text: '4' }]);
	sources.cartridgeSlots[0] = { luaSources: sourceRegistry([['entry.lua', 'return 0']]) } as RuntimeSourceState['cartridgeSlots'][0];
	project.synchronizeRuntimeSources(sources);
	assert.equal(project.getFileData('shared.lua')!.source, 'return 4');
	system.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- discarded\n' }]);
	models.clear();
	const next = models.retain(resource(-1, 'shared.lua'), 'lua', 'return 56789');
	next.pushEditOperations([{ offset: 7, deleteLength: 5, text: '6' }]);
	assert.equal(project.getFileData('shared.lua')!.source, 'return 6');
});

test('actual editor frontend and context token queries consume queued model edits instead of publishing full-source replacements', async t => {
	const { editorTextModelService } = await import('../../ide/editor/model/model_service');
	const { resetSemanticProject, resetSemanticProjects } = await import('../../ide/editor/contrib/intellisense/semantic/workspace/state');
	const { buildEditorSemanticSnapshot } = await import('../../ide/editor/contrib/intellisense/frontend');
	const { resolveContextMenuToken } = await import('../../ide/editor/contrib/intellisense/engine');
	const { activeCodeEditor, createCodeEditorViewState } = await import('../../ide/editor/ui/code_editor_state');
	const path = 'frontend_incremental.lua';
	const source = Array.from({ length: 90 }, (_, index) => `local value_${index} = ${index}\n`).join('') + 'return value_89';
	const model = editorTextModelService.retain(resource(0, path), 'lua', source);
	const project = resetSemanticProject(editorTextModelService, 0);
	const sources = runtimeSources(sourceRegistry([['system.lua', 'return 0']]), sourceRegistry([[path, source]]));
	const bridge = { sources } as import('../../ide/runtime/lua_tooling').RuntimeLuaTooling;
	t.after(() => { activeCodeEditor.detach(); resetSemanticProjects(editorTextModelService); editorTextModelService.clear(); });
	const initial = buildEditorSemanticSnapshot(bridge, model.resource, model.buffer);
	const retained = initial.getFileData(path)!.chunk.tokens.get(initial.getFileData(path)!.chunk.tokens.length - 2);
	const explicit = t.mock.method(project, 'updateDocument');
	activeCodeEditor.attach(model, createCodeEditorViewState());
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- frontend\n' }]);
	const next = buildEditorSemanticSnapshot(bridge, model.resource, model.buffer);
	assert.ok(Array.from(next.getFileData(path)!.chunk.tokens).includes(retained));
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- context\n' }]);
	assert.equal(resolveContextMenuToken(2, 7, path)?.text, 'value_0');
	assert.ok(Array.from(project.getFileData(path)!.chunk.tokens).includes(retained));
	assert.equal(explicit.mock.callCount(), 0, 'model-backed frontend calls must not reset the incremental baseline');
});

test('queued edits for multiple models publish one workspace batch and full-source inputs discard old deltas', async t => {
	const { LuaSemanticWorkspace } = await import('../../toolchain/ts/lua/semantic/model');
	const models = new EditorTextModelService();
	const project = new EditorLuaSemanticProject(0, models);
	t.after(() => { project.dispose(); models.clear(); });
	const left = models.retain(resource(0, 'left.lua'), 'lua', 'return 1');
	const right = models.retain(resource(0, 'right.lua'), 'lua', 'return 2');
	project.getSnapshot();
	const publish = t.mock.method(LuaSemanticWorkspace.prototype, 'updateFiles');
	left.pushEditOperations([{ offset: 7, deleteLength: 1, text: '123456' }]);
	right.pushEditOperations([{ offset: 7, deleteLength: 1, text: '234567' }]);
	const snapshot = project.getSnapshot();
	assert.equal(publish.mock.callCount(), 1);
	assert.equal(publish.mock.calls[0].arguments[0].length, 2);
	assert.equal(snapshot.getFileData('left.lua')!.source, 'return 123456');
	assert.equal(snapshot.getFileData('right.lua')!.source, 'return 234567');
	left.pushEditOperations([{ offset: 7, deleteLength: 6, text: '3' }]);
	project.updateDocument('left.lua', 'local unrelated = "a different source length"; return unrelated');
	left.pushEditOperations([{ offset: 7, deleteLength: 1, text: '4' }]);
	assert.equal(project.getFileData('left.lua')!.source, 'return 4', 'model deltas are not applied to an explicit replacement baseline');
});

test('diagnostics consume model deltas without replacing incremental baselines with explicit strings', async t => {
	const { editorTextModelService } = await import('../../ide/editor/model/model_service');
	const { resetSemanticProject, resetSemanticProjects } = await import('../../ide/editor/contrib/intellisense/semantic/workspace/state');
	const { computeResourceDiagnostics } = await import('../../ide/workbench/services/diagnostics/lua');
	const { RuntimeLuaTooling } = await import('../../ide/runtime/lua_tooling');
	const { SuspendedGuestSession } = await import('../../ide/runtime/suspended_guest');
	const { createTestRuntime, createTestRuntimeRomPayload } = await import('../helpers/runtime_sources');
	const path = 'diagnostics_incremental.lua';
	const source = Array.from({ length: 90 }, (_, index) => `local value_${index} = ${index}\n`).join('') + 'return value_89';
	const model = editorTextModelService.retain(resource(0, path), 'lua', source);
	const project = resetSemanticProject(editorTextModelService, 0);
	const sources = runtimeSources(sourceRegistry([['system.lua', 'return 0']]), sourceRegistry([[path, source]]));
	const bridge = new RuntimeLuaTooling(sources, new SuspendedGuestSession(createTestRuntime(createTestRuntimeRomPayload())));
	t.after(() => { resetSemanticProjects(editorTextModelService); editorTextModelService.clear(); });
	project.synchronizeRuntimeSources(sources);
	const before = project.getFileData(path)!;
	const retained = before.chunk.tokens.get(before.chunk.tokens.length - 2);
	const explicit = t.mock.method(project, 'updateDocuments');
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- diagnostics\n' }]);
	computeResourceDiagnostics(editorTextModelService, bridge, [model]);
	assert.equal(explicit.mock.callCount(), 0);
	assert.ok(Array.from(project.getFileData(path)!.chunk.tokens).includes(retained));
	computeResourceDiagnostics(editorTextModelService, bridge, [model]);
	assert.equal(explicit.mock.callCount(), 0, 'repeated diagnostics preserve the model-owned baseline');
});

test('scheduled syntax highlighting consumes current model deltas and invalidates a superseded request', async t => {
	const { editorTextModelService } = await import('../../ide/editor/model/model_service');
	const { resetSemanticProject, resetSemanticProjects } = await import('../../ide/editor/contrib/intellisense/semantic/workspace/state');
	const { CodeLayout } = await import('../../ide/editor/ui/code/layout');
	const { EditorFont } = await import('../../ide/editor/ui/view/font');
	const { VirtualHeadlessClock } = await import('../../hosts/node/headless/clock');
	const source = Array.from({ length: 90 }, (_, index) => `local value_${index} = ${index}\n`).join('') + 'return value_89';
	const model = editorTextModelService.retain(resource(0, 'highlight_incremental.lua'), 'lua', source);
	const project = resetSemanticProject(editorTextModelService, 0);
	const before = project.getFileData(model.resource.path)!;
	const retained = before.chunk.tokens.get(before.chunk.tokens.length - 2);
	const clock = new VirtualHeadlessClock();
	const layout = new CodeLayout(new EditorFont('tiny'), { maxHighlightCache: 64, semanticDebounceMs: 0,
		clock, getBuiltinIdentifiers: () => ({ epoch: 0, ids: [] }), computeWrapWidth: () => 320 });
	model.onDidChangeContent(event => layout.onDidChangeContent(model.buffer, event));
	t.after(() => { layout.invalidateAllHighlights(); resetSemanticProjects(editorTextModelService); editorTextModelService.clear(); });
	const explicit = t.mock.method(project, 'updateDocument');
	const analyze = t.mock.method(project, 'analyzeDocument');
	layout.requestSemanticUpdate(model.buffer, model.version, model.resource);
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- superseded\n' }]);
	clock.advance(0);
	assert.equal(analyze.mock.callCount(), 0, 'a queued request cannot publish new text under its old model version');
	layout.requestSemanticUpdate(model.buffer, model.version, model.resource);
	clock.advance(0);
	const current = layout.getSemanticFileData(model.buffer, model.version, model.resource);
	assert.equal(current.source, model.buffer.getText());
	assert.ok(Array.from(current.chunk.tokens).includes(retained));
	assert.equal(explicit.mock.callCount(), 0);
});

test('public listeners registered before a lazy semantic project observe current analysis for every model mutation', async t => {
	const { EditorEditStateType } = await import('../../ide/editor/model/edit_state');
	const models = new EditorTextModelService();
	const model = models.retain(resource(0, 'listener_order.lua'), 'lua', 'return 1');
	let project: EditorLuaSemanticProject;
	let observed = 0;
	let applied: import('../../ide/editor/model/text_model').EditorTextModelAppliedChanges;
	models.onDidChangeContent((changed, event) => {
		const actual = project.getFileData(changed.resource.path)!;
		assert.equal(actual.source, changed.buffer.getText());
		assert.deepEqual(luaSyntaxSnapshot(actual.chunk), luaSyntaxSnapshot(parseLuaChunkWithRecovery(changed.buffer.getText(), changed.resource.path).chunk));
		assert.equal(event.version, applied.version);
		assert.equal(event.changes, applied.changes, 'internal/public phases share one computed delta array');
		observed++;
	});
	model.onDidChangeContent(() => assert.equal(project.getFileData(model.resource.path)!.source, model.buffer.getText()));
	models.onDidApplyChanges((changed, event) => {
		assert.equal(changed.version, event.version);
		applied = event;
	});
	project = new EditorLuaSemanticProject(0, models);
	t.after(() => { project.dispose(); models.clear(); });
	project.getSnapshot();
	model.pushEditOperations([{ offset: 7, deleteLength: 1, text: '22' }]);
	model.undo(); model.redo();
	const state = new EditorEditStateType<null>().of(null);
	model.prepareUndo('typing', false, 1, state);
	model.applyUndoableReplace(7, 2, '333');
	model.commitEdit(state, null);
	model.undo(); model.redo();
	model.restoreDirtySource('return 4444');
	model.revert();
	assert.equal(observed, 8);
	assert.equal(project.getFileData(model.resource.path)!.source, 'return 1');
});

test('first public callback of a compound edit and Undo/Redo sees every applied model delta', t => {
	const models = new EditorTextModelService();
	const left = models.retain(resource(0, 'compound_left.lua'), 'lua', 'return 1');
	const right = models.retain(resource(0, 'compound_right.lua'), 'lua', 'return 2');
	let project: EditorLuaSemanticProject;
	let observed = 0;
	const versions = new Map<import('../../ide/editor/model/text_model').EditorTextModel, number>();
	models.onDidChangeContent(() => {
		const snapshot = project.getSnapshot();
		for (const model of [left, right]) {
			assert.equal(versions.get(model), model.version, 'all internal phases finish before the first public phase');
			const actual = snapshot.getFileData(model.resource.path)!;
			assert.equal(actual.source, model.buffer.getText());
			assert.deepEqual(luaSyntaxSnapshot(actual.chunk), luaSyntaxSnapshot(parseLuaChunkWithRecovery(model.buffer.getText(), model.resource.path).chunk));
		}
		observed++;
	});
	models.onDidApplyChanges((model, applied) => versions.set(model, applied.version));
	project = new EditorLuaSemanticProject(0, models);
	t.after(() => { project.dispose(); models.clear(); });
	project.getSnapshot();
	models.history.applyEdits(new Map([
		[left, { version: left.version, edits: [{ offset: 7, deleteLength: 1, text: '11' }] }],
		[right, { version: right.version, edits: [{ offset: 7, deleteLength: 1, text: '222' }] }],
	]));
	left.undo();
	right.redo();
	assert.equal(observed, 6);
	assert.equal(project.getFileData(left.resource.path)!.source, 'return 11');
	assert.equal(project.getFileData(right.resource.path)!.source, 'return 222');
});

test('editor model edits, inactive documents and undo reuse unchanged binding bodies', t => {
	const models = new EditorTextModelService();
	const project = new EditorLuaSemanticProject(0, models);
	t.after(() => { project.dispose(); models.clear(); });
	const padding = 'do end\n'.repeat(80);
	const source = `local item = { field = 1 }\n${padding}local function changed()\n${padding}return item end\nlocal function retained()\n${padding}return item.field end\n${padding}`;
	const model = models.retain(resource(0, 'reuse.lua'), 'lua', source);
	const inactive = models.retain(resource(0, 'inactive.lua'), 'lua', 'return {}');
	const first = project.getSnapshot();
	const old = first.getFileData('reuse.lua')!;
	const retained = old.functionValueFlows[1];
	const offset = source.indexOf('local function changed()') + 'local function changed()\n'.length + 20 * 'do end\n'.length;
	model.pushEditOperations([{ offset, deleteLength: 0, text: 'do end; ' }]);
	model.pushEditOperations([{ offset, deleteLength: 0, text: 'do end; ' }]);
	const edited = project.getFileData('reuse.lua')!;
	assert.equal(edited.bindingWork.reusedFunctions, 1);
	assert.equal(edited.functionValueFlows[1], retained);
	assert.equal(project.getFileData('inactive.lua'), first.getFileData('inactive.lua'));
	model.undo();
	assert.equal(project.getFileData('reuse.lua')!.functionValueFlows[1], retained);
	model.redo();
	assert.equal(project.getFileData('reuse.lua')!.functionValueFlows[1], retained);
	inactive.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- changed elsewhere\n' }]);
	assert.equal(project.getFileData('reuse.lua')!.functionValueFlows[1], retained);
	assert.equal(first.getFileData('reuse.lua'), old);
	assert.equal(old.source, source);
});
