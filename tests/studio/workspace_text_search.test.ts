import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { clearBackgroundTasks, runBackgroundTasks } from '../../ide/common/background_tasks';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { createLuaSourceRegistry, registerLuaSourceRecord, type LuaSourceRegistry } from '../../ide/runtime/source_registry';
import { WorkspaceTextSearch, captureWorkspaceSearchResources } from '../../ide/workbench/contrib/workspace_search/search';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { openWorkspaceRecords, closeWorkspaceRecords, type WorkspaceRecord } from '../../ide/workspace/records';
import { createScenarioTestSourceRecord } from '../helpers/scenario_sources';
import { createTestRuntimeSourceState, TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';

function registry(root: string, entries: readonly (readonly [string, string])[]): LuaSourceRegistry {
	const value = createLuaSourceRegistry(root, '');
	for (const [path, source] of entries) registerLuaSourceRecord(value, createScenarioTestSourceRecord(path, 1, source, `${root}/${path}`));
	return value;
}

async function fixture(t: TestContext, entries: readonly (readonly [string, string])[] = []) {
	const project = registry('fixture/project', entries), dependency = registry('fixture/shared', [['dependency.lua', 'return "needle dependency"']]);
	const unrelated = registry('fixture/unrelated', [['unrelated.lua', 'return "needle unrelated"']]);
	const sources = createTestRuntimeSourceState(dependency, [project, unrelated], 0), catalog = sources.catalog;
	const models = new EditorTextModelService(), files = new MemoryWorkspaceFiles(), clock = new VirtualHeadlessClock();
	await openWorkspaceRecords(files);
	const contextId = TEST_CARTRIDGE_CONTEXT_IDS[0], search = new WorkspaceTextSearch(models, catalog, contextId);
	t.after(async () => { search.dispose(); models.clear(); catalog.dispose(); clearWorkspaceSourceCaches(); clearBackgroundTasks(); await closeWorkspaceRecords(); });
	const drain = async () => { while (search.status === 'running') { await Promise.resolve(); runBackgroundTasks(clock); } };
	return { sources, catalog, project, models, files, clock, contextId, search, drain };
}

test('scope snapshots include authored format capabilities and explicit shared dependencies, never generated or unrelated contexts', async t => {
	const f = await fixture(t, [['project.lua', 'return "needle"']]);
	f.catalog.registerTextSources(f.contextId, [
		{ type: 'data', resid: 'yaml', source_path: 'source.yaml', sourcemeta: { text: 'value: needle\n' } },
		{ type: 'aem', resid: 'aem', source_path: 'source.aem', sourcemeta: { text: 'events: needle\n' } },
	]);
	registerLuaSourceRecord(f.project, createScenarioTestSourceRecord('library.lua', 1, 'return "needle shared"', 'fixture/library/library.lua'));
	registerLuaSourceRecord(f.project, { ...createScenarioTestSourceRecord('generated.lua', 1, 'return "needle generated"', 'fixture/project/generated.lua'), generated: true });
	const local = captureWorkspaceSearchResources(f.catalog, f.contextId, false);
	assert.deepEqual(local.map(resource => resource.path).sort(), ['project.lua', 'source.aem', 'source.yaml']);
	const shared = captureWorkspaceSearchResources(f.catalog, f.contextId, true);
	assert.deepEqual(shared.map(resource => resource.path).sort(), ['dependency.lua', 'library.lua', 'project.lua', 'source.aem', 'source.yaml']);
	registerLuaSourceRecord(f.project, createScenarioTestSourceRecord('later.lua', 1, 'return "needle later"', 'fixture/project/later.lua'));
	assert.equal(local.some(resource => resource.path === 'later.lua'), false);
});

test('workspace search observes canonical dirty Lua/YAML/AEM without acquiring models for unopened files', async t => {
	const f = await fixture(t, [['dirty.lua', 'return "saved"'], ['unopened.lua', 'return "needle unopened"']]);
	f.catalog.registerTextSources(f.contextId, [
		{ type: 'data', resid: 'yaml', source_path: 'source.yaml', sourcemeta: { text: 'value: saved\n' } },
		{ type: 'aem', resid: 'aem', source_path: 'source.aem', sourcemeta: { text: 'events: needle\n' } },
	]);
	const luaResource = f.catalog.resolveResource({ contextId: f.contextId, path: 'dirty.lua' })!;
	const yamlResource = f.catalog.resolveResource({ contextId: f.contextId, path: 'source.yaml' })!;
	const lua = resolveLuaTextFileModel(f.models, f.catalog, luaResource), yaml = f.models.retain(yamlResource, 'yaml', 'value: saved\n');
	lua.pushEditOperations([{ offset: 0, deleteLength: lua.buffer.length, text: 'return "needle dirty"' }]);
	yaml.pushEditOperations([{ offset: 0, deleteLength: yaml.buffer.length, text: '# needle draft\nvalue: changed\n' }]);
	f.search.run('needle', { matchCase: true, includeShared: false }); await f.drain();
	assert.equal(f.search.status, 'complete'); assert.equal(f.search.matchCount, 4);
	assert.deepEqual(f.search.files.map(file => file.resource.path).sort(), ['dirty.lua', 'source.aem', 'source.yaml', 'unopened.lua']);
	assert.equal(f.search.files.find(file => file.resource.path === 'dirty.lua')!.snapshot.source, lua.buffer.getText());
	assert.equal(f.search.files.find(file => file.resource.path === 'source.yaml')!.snapshot.source, yaml.buffer.getText());
	assert.equal([...f.models.models].length, 2); assert.equal(lua.dirty, true); assert.equal(yaml.dirty, true);
});

test('results retain exact original UTF-16 coordinates and all matches beyond inline widget capacity', async t => {
	const source = '-- İx 😀\r\n' + 'needle '.repeat(80), f = await fixture(t, [['matches.lua', source]]);
	f.search.run('needle', { matchCase: true, includeShared: false }); await f.drain();
	assert.equal(f.search.matchCount, 80);
	const file = f.search.files[0]; assert.equal(file.matches.length, 80);
	for (const match of file.matches) {
		assert.equal(match.row, 1); assert.equal(source.slice(match.offset, match.offset + match.end - match.start), 'needle');
		assert.equal(match.offset, source.indexOf('\n') + 1 + match.start);
	}
	f.search.run('x', { matchCase: false, includeShared: false }); await f.drain();
	const match = f.search.files[0].matches[0];
	assert.equal(match.offset, source.indexOf('x')); assert.equal(match.row, 0); assert.equal(match.start, 4); assert.equal(match.end, 5);
});

test('large single-line scanning remains cancellable and obsolete work cannot mutate a replacement run', async t => {
	const f = await fixture(t, [['large.lua', '-- ' + 'a'.repeat(200000) + ' needle']]);
	f.search.run('a', { matchCase: true, includeShared: false });
	await Promise.resolve(); runBackgroundTasks(f.clock);
	assert.equal(f.search.status, 'running');
	const oldFiles = f.search.files, oldMatches = oldFiles[0].matches, partialCount = oldMatches.length;
	assert.ok(partialCount > 0 && partialCount < 200000);
	f.search.cancel(); assert.equal(f.search.status, 'cancelled');
	f.search.run('needle', { matchCase: true, includeShared: false });
	assert.ok(f.search.files !== oldFiles); await f.drain();
	assert.equal(oldFiles.length, 1); assert.equal(oldMatches.length, partialCount); assert.equal(f.search.matchCount, 1);
	const completed = f.search.files, selected = completed[0].matches[0];
	f.search.run('needle', { matchCase: true, includeShared: false });
	assert.ok(f.search.files !== completed); await f.drain();
	assert.equal(completed.length, 1); assert.ok(completed[0].matches[0] === selected); assert.equal(f.search.matchCount, 1);
});

test('dense-file progress publishes one stable observation with bounded match batches rather than a final materialization spike', async t => {
	const f = await fixture(t, [['dense.lua', '-- ' + 'a'.repeat(5000)]]);
	const batches: number[] = [];
	let previous = 0;
	const files = new Set<unknown>();
	const release = f.search.onDidChange(() => {
		if (f.search.matchCount > previous) batches.push(f.search.matchCount - previous);
		previous = f.search.matchCount;
		if (f.search.files.length !== 0) files.add(f.search.files[0]);
	}); t.after(release);
	f.search.run('a', { matchCase: true, includeShared: false }); await f.drain();
	assert.equal(f.search.matchCount, 5000); assert.equal(files.size, 1);
	assert.ok(batches.length > 1 && batches.every(count => count > 0 && count <= 256));
});

test('a newer query published by a progress observer owns all subsequent results', async t => {
	const f = await fixture(t, [['dense.lua', '-- ' + 'a'.repeat(20000) + ' needle']]);
	let superseded = false;
	const retired: { matches: readonly unknown[]; count: number }[] = [];
	const release = f.search.onDidChange(() => {
		if (superseded || f.search.matchCount === 0) return;
		superseded = true;
		const matches = f.search.files[0].matches;
		retired.push({ matches, count: matches.length });
		f.search.run('needle', { matchCase: true, includeShared: false });
	}); t.after(release);
	f.search.run('a', { matchCase: true, includeShared: false }); await f.drain();
	assert.equal(superseded, true); assert.equal(f.search.query, 'needle'); assert.equal(f.search.matchCount, 1);
	assert.equal(retired[0].matches.length, retired[0].count); assert.ok(retired[0].count <= 256);
});

for (const retirement of ['cancel', 'models', 'catalog', 'dispose'] as const) test(`late authored-file IO cannot publish after query ${retirement}`, async t => {
	const f = await fixture(t);
	f.catalog.registerTextSources(f.contextId, [{ type: 'data', resid: 'pending', source_path: 'pending.yaml', sourcemeta: { text: 'packaged needle' } }]);
	const read = Promise.withResolvers<WorkspaceRecord | null>();
	t.mock.method(f.files, 'read', () => read.promise);
	f.search.run('needle', { matchCase: true, includeShared: false });
	if (retirement === 'cancel') f.search.cancel();
	else if (retirement === 'models') f.models.clear();
	else if (retirement === 'dispose') f.search.dispose();
	else registerLuaSourceRecord(f.project, createScenarioTestSourceRecord('new.lua', 1, 'return "needle"', 'fixture/project/new.lua'));
	read.resolve({ contents: 'needle file', updatedAt: 1 });
	await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); runBackgroundTasks(f.clock);
	assert.equal(f.search.status, 'cancelled'); assert.equal(f.search.files.length, 0); assert.equal(f.search.matchCount, 0);
	assert.equal([...f.models.models].length, 0);
});

test('authored-source IO errors remain explicit search failures rather than packaged-content results', async t => {
	const f = await fixture(t);
	f.catalog.registerTextSources(f.contextId, [{ type: 'data', resid: 'failed', source_path: 'failure.yaml', sourcemeta: { text: 'needle packaged' } }]);
	t.mock.method(f.files, 'read', async () => { throw new Error('source read failed'); });
	f.search.run('needle', { matchCase: true, includeShared: false }); await f.drain();
	assert.equal(f.search.status, 'error'); assert.match(f.search.error!, /source read failed/);
	assert.equal(f.search.files.length, 0); assert.equal([...f.models.models].length, 0);
});
