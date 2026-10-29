import { TEST_SYSTEM_CONTEXT_ID } from '../helpers/runtime_sources';
import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { EditorTextModelService, editorTextModelService as models } from '../../ide/editor/model/model_service';
import { getOrCreateSemanticProject, resetSemanticProjects } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { ResourceDiagnosticsService } from '../../ide/workbench/services/diagnostics/resource_diagnostics';
import { createProblemsPanelFixture } from '../helpers/problems_panel';
import { registerLuaSourceRecord, type LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { setWorkspaceLuaSourceOverride, deleteWorkspaceLuaSourceOverride } from '../../ide/workspace/cache';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { clearBackgroundTasks, runBackgroundTasks } from '../../ide/common/background_tasks';
import { LuaParser } from '../../toolchain/ts/lua/syntax/parser';
import { createTestRuntimeSourceState } from '../helpers/runtime_sources';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';
import { LUA_BOOT_PRIMITIVES } from '../../machine/ts/spec/blua32/builtin';

function fixture(t: TestContext) {
	models.clear(); resetSemanticProjects(models); clearBackgroundTasks();
	const registries: LuaSourceRegistry[] = [-1, 0, 1].map(() => ({ records: [], path2lua: {}, module2lua: {},
		entrySourcePath: 'entry.lua', projectRootPath: '', can_boot_from_source: true, revision: 0 }));
	const sources = createTestRuntimeSourceState(registries[0], [registries[1], registries[2]], 0);

	const clock = new VirtualHeadlessClock();
	const service = new ResourceDiagnosticsService(models, sources.catalog, clock);
	t.after(() => { service.dispose(); resetSemanticProjects(models); models.clear(); clearBackgroundTasks(); });
	const retain = (contextId: string, path: string, source: string) => models.retain({ contextLabel: 'Fixture project', sourceFilePath: path, location: { kind: 'workspace' as const, path }, contextId, path,
		source: { type: 'lua', resid: path } }, 'lua', source);
	return { service, clock, retain, registries };
}

test('boot primitive globals are known only in BIOS diagnostics, not either cartridge domain', t => {
	const { service, retain } = fixture(t);
	const source = LUA_BOOT_PRIMITIVES.map(primitive => `local capture_${primitive.id} = ${primitive.name}`).join('\n');
	const bios = retain(TEST_SYSTEM_CONTEXT_ID, 'capture.lua', source);
	const carts = [retain(TEST_CARTRIDGE_CONTEXT_IDS[0], 'capture.lua', source), retain(TEST_CARTRIDGE_CONTEXT_IDS[1], 'capture.lua', source)];
	service.computePending();
	assert.equal(service.get(bios)!.status, 'ready');
	assert.deepEqual(service.diagnostics.filter(diagnostic => diagnostic.model === bios), []);
	for (const cart of carts) {
		const diagnostics = service.diagnostics.filter(diagnostic => diagnostic.model === cart);
		assert.equal(diagnostics.length, LUA_BOOT_PRIMITIVES.length);
		assert.deepEqual(diagnostics.map(diagnostic => diagnostic.row), LUA_BOOT_PRIMITIVES.map((_, row) => row));
	}

	// An ordinary authored declaration remains legal; only ambient boot names
	// are domain-specific. It must not change the other cartridge's diagnostics.
	carts[0].pushEditOperations([{ offset: 0, deleteLength: 0, text: '__bmsx_next = 42\n' }]);
	service.computePending();
	assert.equal(service.diagnostics.filter(diagnostic => diagnostic.model === carts[0]).length, LUA_BOOT_PRIMITIVES.length - 1);
	assert.equal(service.diagnostics.filter(diagnostic => diagnostic.model === carts[1]).length, LUA_BOOT_PRIMITIVES.length);
	carts[0].undo();
	service.computePending();
	assert.equal(service.diagnostics.filter(diagnostic => diagnostic.model === carts[0]).length, LUA_BOOT_PRIMITIVES.length);
});

test('diagnostics cover retained resources without code inputs; unknown and unsupported coverage is not a clean result', t => {
	const { service, retain } = fixture(t);
	const model = retain(TEST_CARTRIDGE_CONTEXT_IDS[0], 'visual.lua', 'return missing_from_visual_source');
	const yaml = models.retain({ contextLabel: 'Fixture project', sourceFilePath: 'level.yaml', location: { kind: 'workspace' as const, path: 'level.yaml' }, contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'level.yaml', source: { type: 'data', resid: 'level' } }, 'yaml', 'level: one');
	assert.equal(service.get(model)!.status, 'pending');
	assert.equal(service.get(yaml)!.status, 'unsupported');
	assert.equal('byRow' in service.get(yaml)!, false);
	assert.equal(models.get({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'unopened.lua' }), undefined);
	service.computePending();
	assert.deepEqual(service.coverage, { ready: 1, pending: 0, unsupported: 1, failed: 0 });
	const diagnostic = service.diagnostics.find(item => item.message.includes('missing_from_visual_source'))!;
	assert.equal(diagnostic.model, model);
	assert.equal(diagnostic.version, model.version);
});

test('resource diagnostics never import matching working copies from another model owner', t => {
	const f = fixture(t);
	f.retain(TEST_CARTRIDGE_CONTEXT_IDS[0], 'provider.lua', 'foreign_workspace_global = 1');
	const ownedModels = new EditorTextModelService();
	const sources = createScenarioTestSourceState([createScenarioTestSourceRecord('provider.lua', 1, 'owned_global = 1'),
		createScenarioTestSourceRecord('reader.lua', 1, 'return owned_global')]);

	const service = new ResourceDiagnosticsService(ownedModels, sources.catalog, new VirtualHeadlessClock());
	t.after(() => { service.dispose(); ownedModels.clear(); });
	const reader = ownedModels.retain(sources.catalog.luaResources.find(resource => resource.path === 'reader.lua')!, 'lua', 'return owned_global');
	service.computePending();
	assert.equal(service.get(reader)!.status, 'ready');
	assert.deepEqual(service.diagnostics, [], 'unopened dependencies belong to this workspace, not the global editor model service');
});

test('dependency edits invalidate same-project diagnostics even when the consumer version did not change', t => {
	const { service, retain } = fixture(t);
	const reader = retain(TEST_CARTRIDGE_CONTEXT_IDS[0], 'reader.lua', 'return shared.value');
	const provider = retain(TEST_CARTRIDGE_CONTEXT_IDS[0], 'provider.lua', 'shared = { value = 1 }');
	service.computePending();
	assert.equal(service.diagnostics.some(item => item.message.includes("'shared' is not defined")), false);
	const first = service.get(reader);
	provider.pushEditOperations([{ offset: 0, deleteLength: 6, text: 'other' }]);
	assert.equal(reader.version, 1);
	assert.notEqual(service.get(reader), first);
	assert.equal(service.get(reader)!.status, 'pending');
	assert.deepEqual(service.diagnostics, [], 'old markers disappear at invalidation, not after the next query');
	service.computePending();
	assert.ok(service.diagnostics.some(item => item.model === reader && item.message.includes("'shared' is not defined")));
	provider.undo(); service.computePending();
	assert.equal(service.diagnostics.some(item => item.message.includes("'shared' is not defined")), false);
});

test('unopened source discovery and registry overrides retire dependent results without a code-tab or model event', t => {
	const { service, retain, registries } = fixture(t);
	const reader = retain(TEST_CARTRIDGE_CONTEXT_IDS[0], 'reader.lua', 'return discovered');
	const registry = registries[1];
	service.computePending();
	assert.ok(service.diagnostics.some(item => item.message.includes("'discovered' is not defined")));
	registerLuaSourceRecord(registry, { resid: 'provider', type: 'lua', source_path: 'provider.lua',
		normalized_source_path: 'provider.lua', module_path: 'provider', src: 'discovered = 1', base_src: 'discovered = 1',
		base_update_timestamp: 0, update_timestamp: 0, generated: false, sourceKind: 'project', program_module: true });
	assert.equal(service.get(reader)!.status, 'pending');
	service.computePending();
	assert.deepEqual(service.diagnostics, []);
	setWorkspaceLuaSourceOverride(registry, 'provider.lua', 'renamed = 1');
	assert.equal(service.get(reader)!.status, 'pending');
	service.computePending();
	assert.ok(service.diagnostics.some(item => item.message.includes("'discovered' is not defined")));
	deleteWorkspaceLuaSourceOverride(registry, 'provider.lua');
	service.computePending();
	assert.deepEqual(service.diagnostics, []);
	const provider = retain(TEST_CARTRIDGE_CONTEXT_IDS[0], 'provider.lua', 'discovered = 2');
	service.computePending();
	const result = service.get(reader);
	setWorkspaceLuaSourceOverride(registry, 'provider.lua', 'older_saved_source = 1');
	assert.equal(service.get(reader), result, 'working copies shadow saved or installed source');
	assert.equal(service.get(provider)!.status, 'ready');
	deleteWorkspaceLuaSourceOverride(registry, 'provider.lua');
});

test('socket identity is retained and system source edits invalidate both dependent domains', t => {
	const { service, retain } = fixture(t);
	const system = retain(TEST_SYSTEM_CONTEXT_ID, 'globals.lua', 'shared = 1');
	const first = retain(TEST_CARTRIDGE_CONTEXT_IDS[0], 'same.lua', 'return shared');
	const second = retain(TEST_CARTRIDGE_CONTEXT_IDS[1], 'same.lua', 'return shared');
	service.computePending();
	const oldSecond = service.get(second);
	first.pushEditOperations([{ offset: first.buffer.length, deleteLength: 0, text: '\nend end' }]);
	assert.equal(service.get(second), oldSecond, 'unrelated socket results retain identity');
	service.computePending();
	assert.equal(service.diagnostics[0].model, first);
	first.undo();
	system.pushEditOperations([{ offset: 0, deleteLength: 6, text: 'other' }]);
	assert.equal(service.get(first)!.status, 'pending');
	assert.equal(service.get(second)!.status, 'pending');
	service.computePending();
	assert.deepEqual(service.diagnostics.filter(item => item.message.includes("'shared' is not defined")).map(item => item.model), [first, second]);
});

test('unchanged reads and visibility transitions retain results without parsing or recomputing', t => {
	const { service, clock, retain } = fixture(t);
	const model = retain(TEST_CARTRIDGE_CONTEXT_IDS[0], 'stable.lua', 'return 1');
	const parse = t.mock.method(LuaParser.prototype, 'parseChunkWithRecovery');
	service.computePending();
	const result = service.get(model), diagnostics = service.diagnostics, calls = parse.mock.callCount();
	let changes = 0; service.onDidChange(() => changes++);
	for (let index = 0; index < 100; index++) {
		service.setEnabled(true); clock.advance(1000); runBackgroundTasks(clock); service.setEnabled(false);
		service.computePending();
		assert.equal(service.get(model), result);
		assert.equal(service.diagnostics, diagnostics);
	}
	assert.equal(changes, 0);
	assert.equal(parse.mock.callCount(), calls);
});

test('hiding cancels queued work but keeps pending source; workspace disposal prevents late results or revived coverage', t => {
	const { service, clock, retain } = fixture(t);
	const model = retain(TEST_CARTRIDGE_CONTEXT_IDS[0], 'retired.lua', 'return 1');
	service.setEnabled(true); clock.advance(200); service.setEnabled(false);
	runBackgroundTasks(clock);
	assert.equal(service.get(model)!.status, 'pending');
	service.setEnabled(true); clock.advance(200); runBackgroundTasks(clock);
	assert.equal(service.get(model)!.status, 'ready');
	model.pushEditOperations([{ offset: 0, deleteLength: 0, text: 'end end\n' }]);
	clock.advance(1000);
	service.dispose(); models.clear();
	const reopened = retain(TEST_CARTRIDGE_CONTEXT_IDS[0], 'retired.lua', 'return 1');
	runBackgroundTasks(clock); clock.advance(1000);
	assert.equal(service.get(reopened), undefined);
	assert.deepEqual(service.diagnostics, []);
	assert.throws(() => service.computePending(), /disposal/);
});

test('provider failure is explicit coverage and a later source change can be analyzed normally', t => {
	const { service, retain } = fixture(t);
	const model = retain(TEST_CARTRIDGE_CONTEXT_IDS[0], 'failed.lua', 'return missing_before_failure');
	service.computePending();
	const ready = service.get(model)!;
	assert.ok(ready.status === 'ready' && ready.byRow.size > 0);
	const error = new Error('semantic query failed');
	const method = t.mock.method(getOrCreateSemanticProject(models, TEST_CARTRIDGE_CONTEXT_IDS[0]), 'getSnapshot', () => { throw error; });
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: '\n-- changed' }]);
	service.computePending();
	assert.deepEqual(service.get(model), { status: 'failed', model, version: model.version, error });
	assert.equal(service.coverage.failed, 1);
	assert.equal('byRow' in service.get(model)!, false);
	method.mock.restore();
	model.pushEditOperations([{ offset: model.buffer.length, deleteLength: 0, text: '\n-- retry' }]);
	service.computePending();
	assert.equal(service.get(model)!.status, 'ready');
});


test('new retained source pending publication cannot replace the Problems semantic selection with the first resource', t => {
	const { service, retain } = fixture(t), panel = createProblemsPanelFixture(t).controller;
	const unsubscribe = service.onDidChange(() => panel.setDiagnostics(service.diagnostics, service.coverage));
	t.after(unsubscribe);
	retain(TEST_CARTRIDGE_CONTEXT_IDS[0], 'cart.lua', '9return 1'); const intro = retain(TEST_CARTRIDGE_CONTEXT_IDS[0], 'intro.lua', '9return 1');
	service.computePending(); panel.setSelectionIndex(1);
	assert.ok(panel.selectedDiagnostic!.model === intro);
	const previous = panel.selectedDiagnostic;
	retain(TEST_CARTRIDGE_CONTEXT_IDS[0], 'new.lua', 'return 1');
	assert.ok(service.coverage.pending > 0); assert.equal(service.diagnostics.length, 0);
	assert.equal(panel.selectedDiagnostic, undefined); assert.equal(panel.focusTarget.clipboard!.copy(), null);
	service.computePending(); const result = service.get(intro)!;
	assert.ok(result.status === 'ready' && panel.selectedDiagnostic === result.diagnostics[0],
		'actual pending-to-ready source publication reconnects the selected marker to its fresh producer row');
	assert.ok(panel.selectedDiagnostic !== previous); assert.equal(panel.selectedDiagnostic!.version, intro.version);
});


test('canonical row indexes isolate models and are shared by independent views until source invalidation', t => {
	const { service, retain } = fixture(t);
	const first = retain(TEST_CARTRIDGE_CONTEXT_IDS[0], 'same.lua', 'return missing_first');
	const second = retain(TEST_CARTRIDGE_CONTEXT_IDS[1], 'same.lua', 'return missing_second');
	service.computePending();
	const firstResult = service.get(first)!, secondResult = service.get(second)!;
	assert.ok(firstResult.status === 'ready' && secondResult.status === 'ready');
	assert.notEqual(firstResult.byRow, secondResult.byRow);
	assert.deepEqual(firstResult.byRow.get(0), firstResult.diagnostics);
	assert.deepEqual(secondResult.byRow.get(0), secondResult.diagnostics);
	for (const diagnostic of firstResult.byRow.get(0)!) assert.equal(diagnostic.model, first);
	for (const diagnostic of secondResult.byRow.get(0)!) assert.equal(diagnostic.model, second);

	const firstView = new CodeEditorInput(first), siblingView = new CodeEditorInput(first);
	t.after(() => siblingView.dispose());
	assert.notEqual(firstView.context.view, siblingView.context.view);
	assert.equal(service.get(firstView.workingCopy), service.get(siblingView.workingCopy));
	firstView.dispose();
	assert.equal(service.get(siblingView.workingCopy), firstResult, 'closing a view does not retire canonical markers');
	for (let read = 0; read < 100; read++) assert.equal(service.get(first), firstResult);

	first.pushEditOperations([{ offset: 0, deleteLength: first.buffer.length, text: 'return 1' }]);
	const pending = service.get(first)!;
	assert.equal(pending.status, 'pending');
	assert.equal('byRow' in pending, false, 'invalidation withdraws the previous row index immediately');
	assert.equal(service.get(second), secondResult);
	service.computePending();
	const fresh = service.get(first)!;
	assert.ok(fresh.status === 'ready');
	assert.notEqual(fresh, firstResult);
	assert.equal(fresh.byRow.size, 0);
	assert.deepEqual(fresh.diagnostics, []);
	assert.equal(service.get(second), secondResult);

	models.clear();
	assert.equal(service.get(first), undefined);
	assert.equal(service.get(second), undefined);
	assert.deepEqual(service.coverage, { ready: 0, pending: 0, unsupported: 0, failed: 0 });
});
