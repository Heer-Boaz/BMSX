import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { readFile } from 'node:fs/promises';
import { EditorTextModelService, editorTextModelService as models } from '../../ide/editor/model/model_service';
import { getOrCreateSemanticProject, resetSemanticProjects } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { ResourceDiagnosticsService } from '../../ide/workbench/services/diagnostics/resource_diagnostics';
import { RuntimeLuaTooling } from '../../ide/runtime/lua_tooling';
import { SuspendedGuestSession } from '../../ide/runtime/suspended_guest';
import { registerLuaSourceRecord, type LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { setWorkspaceLuaSourceOverride, deleteWorkspaceLuaSourceOverride } from '../../ide/workspace/cache';
import type { ResourceDomain } from '../../ide/common/resource';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { clearBackgroundTasks, runBackgroundTasks } from '../../ide/common/background_tasks';
import { LuaParser } from '../../toolchain/ts/lua/syntax/parser';
import { createTestRuntime, createTestRuntimeRomPayload, createTestRuntimeSourceState } from '../helpers/runtime_sources';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';

function fixture(t: TestContext) {
	models.clear(); resetSemanticProjects(models); clearBackgroundTasks();
	const registries: LuaSourceRegistry[] = [-1, 0, 1].map(() => ({ records: [], path2lua: {}, module2lua: {},
		entrySourcePath: 'entry.lua', projectRootPath: '', can_boot_from_source: true, revision: 0 }));
	const sources = createTestRuntimeSourceState(registries[0], [registries[1], registries[2]], 0);
	const tooling = new RuntimeLuaTooling(sources, new SuspendedGuestSession(createTestRuntime(createTestRuntimeRomPayload())));
	const clock = new VirtualHeadlessClock();
	const service = new ResourceDiagnosticsService(models, tooling, clock);
	t.after(() => { service.dispose(); resetSemanticProjects(models); models.clear(); clearBackgroundTasks(); });
	const retain = (domain: ResourceDomain, path: string, source: string) => models.retain({ domain, path,
		source: { type: 'lua', resid: path } }, 'lua', source);
	return { service, clock, retain, registries };
}

test('diagnostics cover retained resources without code inputs; unknown and unsupported coverage is not a clean result', t => {
	const { service, retain } = fixture(t);
	const model = retain(0, 'visual.lua', 'return missing_from_visual_source');
	const yaml = models.retain({ domain: 0, path: 'level.yaml', source: { type: 'data', resid: 'level' } }, 'yaml', 'level: one');
	assert.equal(service.get(model.identity)!.status, 'pending');
	assert.equal(service.get(yaml.identity)!.status, 'unsupported');
	assert.equal(service.get({ domain: 0, path: 'unopened.lua' }), undefined);
	service.computePending();
	assert.deepEqual(service.coverage, { ready: 1, pending: 0, unsupported: 1, failed: 0 });
	const diagnostic = service.diagnostics.find(item => item.message.includes('missing_from_visual_source'))!;
	assert.equal(diagnostic.model, model);
	assert.equal(diagnostic.version, model.version);
});

test('resource diagnostics never import matching working copies from another model owner', t => {
	const f = fixture(t);
	f.retain(0, 'provider.lua', 'foreign_workspace_global = 1');
	const ownedModels = new EditorTextModelService();
	const sources = createScenarioTestSourceState([createScenarioTestSourceRecord('provider.lua', 1, 'owned_global = 1'),
		createScenarioTestSourceRecord('reader.lua', 1, 'return owned_global')]);
	const tooling = new RuntimeLuaTooling(sources, new SuspendedGuestSession(createTestRuntime(createTestRuntimeRomPayload())));
	const service = new ResourceDiagnosticsService(ownedModels, tooling, new VirtualHeadlessClock());
	t.after(() => { service.dispose(); ownedModels.clear(); });
	const reader = ownedModels.retain(sources.luaResources.find(resource => resource.path === 'reader.lua')!, 'lua', 'return owned_global');
	service.computePending();
	assert.equal(service.get(reader.identity)!.status, 'ready');
	assert.deepEqual(service.diagnostics, [], 'unopened dependencies belong to this workspace, not the global editor model service');
});

test('dependency edits invalidate same-project diagnostics even when the consumer version did not change', t => {
	const { service, retain } = fixture(t);
	const reader = retain(0, 'reader.lua', 'return shared.value');
	const provider = retain(0, 'provider.lua', 'shared = { value = 1 }');
	service.computePending();
	assert.equal(service.diagnostics.some(item => item.message.includes("'shared' is not defined")), false);
	const first = service.get(reader.identity);
	provider.pushEditOperations([{ offset: 0, deleteLength: 6, text: 'other' }]);
	assert.equal(reader.version, 1);
	assert.notEqual(service.get(reader.identity), first);
	assert.equal(service.get(reader.identity)!.status, 'pending');
	assert.deepEqual(service.diagnostics, [], 'old markers disappear at invalidation, not after the next query');
	service.computePending();
	assert.ok(service.diagnostics.some(item => item.model === reader && item.message.includes("'shared' is not defined")));
	provider.undo(); service.computePending();
	assert.equal(service.diagnostics.some(item => item.message.includes("'shared' is not defined")), false);
});

test('unopened source discovery and registry overrides retire dependent results without a code-tab or model event', t => {
	const { service, retain, registries } = fixture(t);
	const reader = retain(0, 'reader.lua', 'return discovered');
	const registry = registries[1];
	service.computePending();
	assert.ok(service.diagnostics.some(item => item.message.includes("'discovered' is not defined")));
	registerLuaSourceRecord(registry, { resid: 'provider', type: 'lua', source_path: 'provider.lua',
		normalized_source_path: 'provider.lua', module_path: 'provider', src: 'discovered = 1', base_src: 'discovered = 1',
		base_update_timestamp: 0, update_timestamp: 0, generated: false, program_module: true });
	assert.equal(service.get(reader.identity)!.status, 'pending');
	service.computePending();
	assert.deepEqual(service.diagnostics, []);
	setWorkspaceLuaSourceOverride(registry, 'provider.lua', 'renamed = 1');
	assert.equal(service.get(reader.identity)!.status, 'pending');
	service.computePending();
	assert.ok(service.diagnostics.some(item => item.message.includes("'discovered' is not defined")));
	deleteWorkspaceLuaSourceOverride(registry, 'provider.lua');
	service.computePending();
	assert.deepEqual(service.diagnostics, []);
	const provider = retain(0, 'provider.lua', 'discovered = 2');
	service.computePending();
	const result = service.get(reader.identity);
	setWorkspaceLuaSourceOverride(registry, 'provider.lua', 'older_saved_source = 1');
	assert.equal(service.get(reader.identity), result, 'working copies shadow saved or installed source');
	assert.equal(service.get(provider.identity)!.status, 'ready');
	deleteWorkspaceLuaSourceOverride(registry, 'provider.lua');
});

test('socket identity is retained and system source edits invalidate both dependent domains', t => {
	const { service, retain } = fixture(t);
	const system = retain(-1, 'globals.lua', 'shared = 1');
	const first = retain(0, 'same.lua', 'return shared');
	const second = retain(1, 'same.lua', 'return shared');
	service.computePending();
	const oldSecond = service.get(second.identity);
	first.pushEditOperations([{ offset: first.buffer.length, deleteLength: 0, text: '\nend end' }]);
	assert.equal(service.get(second.identity), oldSecond, 'unrelated socket results retain identity');
	service.computePending();
	assert.equal(service.diagnostics[0].model, first);
	first.undo();
	system.pushEditOperations([{ offset: 0, deleteLength: 6, text: 'other' }]);
	assert.equal(service.get(first.identity)!.status, 'pending');
	assert.equal(service.get(second.identity)!.status, 'pending');
	service.computePending();
	assert.deepEqual(service.diagnostics.filter(item => item.message.includes("'shared' is not defined")).map(item => item.model), [first, second]);
});

test('unchanged reads and visibility transitions retain results without parsing or recomputing', t => {
	const { service, clock, retain } = fixture(t);
	const model = retain(0, 'stable.lua', 'return 1');
	const parse = t.mock.method(LuaParser.prototype, 'parseChunkWithRecovery');
	service.computePending();
	const result = service.get(model.identity), diagnostics = service.diagnostics, calls = parse.mock.callCount();
	let changes = 0; service.onDidChange(() => changes++);
	for (let index = 0; index < 100; index++) {
		service.setEnabled(true); clock.advance(1000); runBackgroundTasks(clock); service.setEnabled(false);
		service.computePending();
		assert.equal(service.get(model.identity), result);
		assert.equal(service.diagnostics, diagnostics);
	}
	assert.equal(changes, 0);
	assert.equal(parse.mock.callCount(), calls);
});

test('hiding cancels queued work but keeps pending source; workspace disposal prevents late results or revived coverage', t => {
	const { service, clock, retain } = fixture(t);
	const model = retain(0, 'retired.lua', 'return 1');
	service.setEnabled(true); clock.advance(200); service.setEnabled(false);
	runBackgroundTasks(clock);
	assert.equal(service.get(model.identity)!.status, 'pending');
	service.setEnabled(true); clock.advance(200); runBackgroundTasks(clock);
	assert.equal(service.get(model.identity)!.status, 'ready');
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: 'end end\n' }]);
	clock.advance(1000);
	service.dispose(); models.clear();
	const reopened = retain(0, 'retired.lua', 'return 1');
	runBackgroundTasks(clock); clock.advance(1000);
	assert.equal(service.get(reopened.identity), undefined);
	assert.deepEqual(service.diagnostics, []);
	assert.throws(() => service.computePending(), /disposal/);
});

test('provider failure is explicit coverage and a later source change can be analyzed normally', t => {
	const { service, retain } = fixture(t);
	const model = retain(0, 'failed.lua', 'return 1');
	const error = new Error('semantic query failed');
	const method = t.mock.method(getOrCreateSemanticProject(models, 0), 'getSnapshot', () => { throw error; });
	service.computePending();
	assert.deepEqual(service.get(model.identity), { status: 'failed', model, version: 1, error });
	assert.equal(service.coverage.failed, 1);
	method.mock.restore();
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: '\n-- retry' }]);
	service.computePending();
	assert.equal(service.get(model.identity)!.status, 'ready');
});

test('resource diagnostics have no code-tab, Problems panel, active-view or command dependency', async () => {
	for (const path of ['lua', 'resource_diagnostics']) {
		const source = await readFile(`ide/workbench/services/diagnostics/${path}.ts`, 'utf8');
		assert.doesNotMatch(source, /(?:code_tab|cart_editor|problems\/|activeCodeEditor|commands\/)/);
	}
});
