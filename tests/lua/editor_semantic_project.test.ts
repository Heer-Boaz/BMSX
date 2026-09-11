import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorLuaSemanticProject } from '../../ide/editor/contrib/intellisense/semantic/workspace/project';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import type { ResourceDomain, RuntimeResource } from '../../ide/common/resource';
import type { LuaSourceRecord, LuaSourceRegistry } from '../../ide/runtime/source_registry';
import type { RuntimeSourceState } from '../../ide/runtime/sources';
import { LuaSyntaxKind } from '../../toolchain/ts/lua/syntax/ast';

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
	const statement = importer.chunk.body[0];
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
