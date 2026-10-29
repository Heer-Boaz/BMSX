import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { inputFocus } from '../../ide/input/focus';
import { createLuaSourceRegistry, registerLuaSourceRecord } from '../../ide/runtime/source_registry';
import type { QuickPickItem } from '../../ide/workbench/services/quick_input/provider';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { closeWorkspaceRecords, openWorkspaceRecords, workspaceRecords } from '../../ide/workspace/records';
import { createActualSourcePanes } from '../helpers/source_panes';
import { createScenarioTestSourceRecord } from '../helpers/scenario_sources';
import { createTestSourceOnlyLuaRecord, createTestToolingPackage } from '../helpers/runtime_sources';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';

async function fixture(t: TestContext) {
	const files = new MemoryWorkspaceFiles('workspace');
	await files.createDirectory('physical-empty');
	await files.write('notes.txt', { contents: 'raw authored workspace file', updatedAt: 1 }, false);
	await files.write('first.lua', { contents: 'local alpha = 1\nreturn alpha\n', updatedAt: 1 }, false);
	await openWorkspaceRecords(files);
	const f = createActualSourcePanes(t, false, [], undefined, workspaceRecords!);
	t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); });
	const directories = f.ide.directories!;
	const root = directories.rootForContext(f.sources.systemContextId)!;
	return { ...f, files, directories, root };
}

async function showFiles(f: Awaited<ReturnType<typeof fixture>>) {
	const panel = f.editor.resourcePanel; panel.show();
	if (panel.getFilterMode() !== 'all') panel.toggleFilterMode();
	f.update();
	const root = panel.files.tree.roots.find(node => node.element.kind === 'root'
		&& node.element.locationKind === 'project' && node.element.contextId === f.root.contextId)!;
	assert.ok(root !== undefined);
	if (root.collapsed) panel.toggleFileDisclosure(root);
	await f.directories.resolve(f.root, ''); f.update();
	return panel;
}

test('actual Files composes raw physical entries and empty folders with semantic overlays without frame-driven filesystem IO', async t => {
	const f = await fixture(t);
	registerLuaSourceRecord(f.sources.catalog.getContext(f.root.contextId).luaSources,
		{ ...createScenarioTestSourceRecord('generated.lua', 1, 'return {}', 'generated.lua'), generated: true });
	const resources = [...f.sources.catalog.resources], models = [...editorTextModelService.models];
	const reads = t.mock.method(f.files, 'readDirectory'), contents = t.mock.method(f.files, 'read');
	const panel = await showFiles(f);
	assert.ok(panel.files.tree.rows.some(node => node.element.kind === 'physicalFile' && node.element.path === 'notes.txt'));
	assert.ok(panel.files.tree.rows.some(node => node.element.kind === 'directory' && node.element.path === 'physical-empty'));
	assert.equal(panel.files.tree.rows.filter(node => (node.element.kind === 'file' || node.element.kind === 'physicalFile') && node.element.path === 'first.lua').length, 1);
	assert.ok(panel.files.tree.rows.some(node => node.element.kind === 'file' && node.element.path === 'second.lua'));
	const generated = panel.files.tree.roots.find(node => node.element.kind === 'root' && node.element.locationKind === 'generated')!;
	assert.ok(generated !== undefined); if (generated.collapsed) panel.toggleFileDisclosure(generated);
	assert.ok(panel.files.tree.rows.some(node => node.element.kind === 'file' && node.element.path === 'generated.lua'));
	const acknowledgedReads = reads.mock.callCount();
	for (let frame = 0; frame < 25; frame++) { f.update(); f.paint(); }
	await setImmediate();
	assert.equal(reads.mock.callCount(), acknowledgedReads); assert.equal(contents.mock.callCount(), 0);
	assert.deepEqual([...f.sources.catalog.resources], resources); assert.deepEqual([...editorTextModelService.models], models);
	assert.equal(f.sources.catalog.resolveResource({ contextId: f.root.contextId, path: 'notes.txt' }), undefined);
	assert.equal(f.directories.get(f.root, 'physical-empty'), undefined, 'unexpanded children remain lazy');
});

test('actual Files keeps its selected raw subject through refresh loading and errors, then removes only an acknowledged deletion', async t => {
	const gate = Promise.withResolvers<void>(); t.after(() => gate.resolve());
	const f = await fixture(t), panel = await showFiles(f);
	const index = panel.files.tree.rows.findIndex(node => node.element.kind === 'physicalFile' && node.element.path === 'notes.txt');
	assert.ok(index >= 0); panel.setSelectionIndex(index);
	const selected = panel.files.selectedNode, empty = panel.files.tree.rows.find(node => node.element.kind === 'directory' && node.element.path === 'physical-empty');
	const read = t.mock.method(f.files, 'readDirectory', async () => { await gate.promise; throw new Error('Fixture directory refresh refused'); });
	const refresh = f.directories.refresh(f.root, ''); await setImmediate(); f.update();
	assert.ok(panel.files.selectedNode === selected && panel.files.tree.rows.includes(selected!));
	gate.resolve(); await refresh; f.update();
	assert.equal(f.directories.get(f.root, '')!.status, 'error'); assert.ok(panel.files.selectedNode === selected);
	read.mock.restore(); await f.files.delete('notes.txt'); await f.directories.refresh(f.root, ''); f.update();
	assert.equal(panel.files.tree.rows.some(node => node.element.kind === 'physicalFile' && node.element.path === 'notes.txt'), false);
	assert.ok(panel.files.selectedNode !== selected && panel.files.tree.rows.includes(empty!));
});

test('actual Files New Folder creates a real nested directory and New Source uses that captured folder rather than the active document', async t => {
	const f = await fixture(t), panel = await showFiles(f);
	const index = panel.files.tree.rows.findIndex(node => node.element.kind === 'directory' && node.element.path === 'physical-empty');
	assert.ok(index >= 0); panel.setSelectionIndex(index);
	const fileCount = f.files.records.size, media = f.sources.currentBlua32Media, execution = f.host.execution.revision;
	f.editor.commands.execute('resources.newFolder', panel.focusTarget);
	const folderInput = f.editor.quickInput; assert.equal(folderInput.visible, true);
	assert.equal(folderInput.field.replaceText(0, folderInput.field.text.length, 'created/nested'), true);
	await folderInput.accept(); f.update();
	assert.equal(folderInput.visible, false);
	assert.ok(panel.files.selectedNode?.element.kind === 'directory'); assert.equal(panel.files.selectedNode.element.path, 'physical-empty/created/nested');
	assert.deepEqual(await f.files.readDirectory('physical-empty/created/nested'), []); assert.equal(f.files.records.size, fileCount);
	f.second.focus(); panel.setFocused(true);
	f.editor.commands.execute('createResource', panel.focusTarget);
	const sourceInput = f.secondPart.quickInput; assert.equal(sourceInput.visible, true);
	assert.equal(sourceInput.field.replaceText(sourceInput.field.text.length, 0, 'created.lua'), true);
	await sourceInput.accept(); f.update();
	const path = 'physical-empty/created/nested/created.lua', resource = f.sources.catalog.resolveResource({ contextId: f.root.contextId, path });
	assert.ok(resource !== undefined); assert.equal(f.files.records.has(path), true); assert.equal(f.files.records.has('created.lua'), false);
	const input = f.secondGroup.model.activeTab; assert.ok(input?.kind === 'code_editor' && input.workingCopy.resource === resource);
	assert.equal(input.workingCopy.buffer.getText(), f.files.records.get(path)!.contents); assert.equal(input.workingCopy.dirty, false);
	assert.equal(f.firstInput.workingCopy.buffer.getText(), f.source); assert.equal(f.secondInput.workingCopy.buffer.getText(), f.otherSource);
	assert.ok(f.sources.currentBlua32Media === media); assert.equal(f.host.execution.revision, execution);
});

for (const [directory, proposedPath] of [['', 'res/data/events.aem.yaml'], ['res', 'data/events.aem.yaml'], ['res/data', 'events.aem.yaml']] as const) {
	test(`actual Files AEM creation from ${directory || 'project root'} proposes an admissible captured-folder path`, async t => {
		const f = await fixture(t);
		await f.directories.createDirectory(f.directories.directory(f.root, ''), 'res/data');
		const panel = await showFiles(f);
		if (directory === 'res/data') {
			const res = panel.files.tree.rows.find(node => node.element.kind === 'directory' && node.element.path === 'res')!;
			assert.ok(res !== undefined); if (res.collapsed) panel.toggleFileDisclosure(res);
			await f.directories.resolve(f.root, 'res'); f.update();
		}
		const index = panel.files.tree.rows.findIndex(node => node.element.contextId === f.root.contextId
			&& (directory === '' ? node.element.kind === 'root' && node.element.locationKind === 'project'
				: node.element.kind === 'directory' && node.element.path === directory));
		assert.ok(index >= 0); panel.setSelectionIndex(index);
		f.second.focus(); panel.setFocused(true);
		assert.equal(f.editor.commands.isEnabled('aem.create', panel.focusTarget), true);
		f.editor.commands.execute('aem.create', panel.focusTarget);
		const picker = f.secondPart.quickInput;
		assert.equal(picker.visible, true); assert.equal(picker.inputBox, true);
		assert.equal(picker.field.text, proposedPath, 'the proposed filename is canonical creation data relative to the captured physical parent');
		await picker.accept(); f.update();
		assert.equal(picker.visible, false);
		const path = 'res/data/events.aem.yaml', resource = f.sources.catalog.resolveResource({ contextId: f.root.contextId, path });
		assert.ok(resource !== undefined); assert.equal(resource.source.type, 'aem');
		assert.equal(resource.sourceFilePath, path); assert.equal(f.files.records.has(path), true);
		assert.ok(f.firstGroup.model.activeTab === f.firstInput);
	});
}

test('actual Files creation enablement follows source membership while excluded folders retain physical New Folder', async t => {
	const f = await fixture(t);
	const paths = ['scripts', 'node_modules', 'test', '.git', '_ignore'] as const;
	for (const path of paths) await f.directories.createDirectory(f.directories.directory(f.root, ''), path);
	const panel = await showFiles(f), files = f.files.records.size, resources = [...f.sources.catalog.resources];
	const luaCommands = ['createResource', 'animation.create', 'animation.createSprite',
		'progression.createProgram', 'input.createBindings', 'behaviorLens.createEffect'] as const;
	for (const path of paths) {
		const index = panel.files.tree.rows.findIndex(node => node.element.kind === 'directory' && node.element.path === path);
		assert.ok(index >= 0); panel.setSelectionIndex(index); f.second.focus(); panel.setFocused(true);
		assert.equal(f.editor.commands.isEnabled('aem.create', panel.focusTarget), false);
		f.editor.commands.execute('aem.create', panel.focusTarget);
		for (const command of luaCommands) {
			assert.equal(f.editor.commands.isEnabled(command, panel.focusTarget), path === 'scripts');
			if (path !== 'scripts') f.editor.commands.execute(command, panel.focusTarget);
		}
		assert.equal(f.secondPart.quickInput.visible, false);
		assert.equal(f.editor.commands.isEnabled('resources.refresh', panel.focusTarget), true);
		assert.equal(f.editor.commands.isEnabled('resources.newFolder', panel.focusTarget), true);
		f.editor.commands.execute('resources.newFolder', panel.focusTarget);
		const picker = f.editor.quickInput; assert.equal(picker.visible, true);
		assert.equal(picker.field.replaceText(0, picker.field.text.length, 'physical-child'), true);
		await picker.accept(); f.update();
		assert.equal(picker.visible, false); assert.deepEqual(await f.files.readDirectory(`${path}/physical-child`), []);
	}
	assert.equal(f.files.records.size, files); assert.deepEqual([...f.sources.catalog.resources], resources);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.secondGroup.model.activeTab === f.secondInput);
});

for (const location of ['workspace', 'generated'] as const) {
	test(`actual Files New Source from a ${location} node chooses a project without borrowing the active document directory`, async t => {
		const f = await fixture(t), contextId = 'fixture-authoring-project', projectRootPath = 'fixture/project';
		const registry = createLuaSourceRegistry(projectRootPath, '');
		const path = location === 'workspace' ? 'cartlib/shared.lua' : 'generated.lua';
		registerLuaSourceRecord(registry, createTestSourceOnlyLuaRecord(path, 'return {}',
			location === 'workspace' ? path : `${projectRootPath}/${path}`, location === 'generated'));
		f.sources.catalog.admitContext({ admission: { id: contextId, projectRoot: projectRootPath }, programDomain: 'cart',
			systemContextId: f.root.contextId, luaSources: registry,
			sourceRoots: [{ path: projectRootPath, resourcePathPrefix: '', modulePathPrefix: '', structured: true, sourceKind: 'project' },
				{ path: 'cartlib', resourcePathPrefix: 'cartlib', modulePathPrefix: 'cartlib', structured: false, sourceKind: 'library' }],
			dependencyContextIds: [f.root.contextId], previewPackage: createTestToolingPackage(projectRootPath), previewRom: null, assetSources: [] });
		const panel = await showFiles(f);
		const root = panel.files.tree.roots.find(node => node.element.kind === 'root'
			&& node.element.contextId === contextId && node.element.locationKind === location)!;
		assert.ok(root !== undefined); if (root.collapsed) panel.toggleFileDisclosure(root);
		if (location === 'workspace') {
			const directory = root.children.find(node => node.element.kind === 'directory' && node.element.path === 'cartlib')!;
			assert.ok(directory !== undefined); if (directory.collapsed) panel.toggleFileDisclosure(directory);
		}
		const index = panel.files.tree.rows.findIndex(node => node.element.kind === 'file'
			&& node.element.contextId === contextId && node.element.path === path);
		assert.ok(index >= 0); panel.setSelectionIndex(index);
		assert.equal(panel.files.directoryFor(panel.files.selectedNode), undefined);
		f.second.focus(); panel.setFocused(true);
		assert.equal(f.editor.commands.isEnabled('createResource', panel.focusTarget), true);
		assert.equal(f.editor.commands.isEnabled('resources.newFolder', panel.focusTarget), false);
		assert.equal(f.editor.commands.isEnabled('resources.refresh', panel.focusTarget), false);
		f.editor.commands.execute('createResource', panel.focusTarget);
		const picker = f.secondPart.quickInput;
		assert.equal(picker.visible, true); assert.equal(picker.inputBox, false);
		const projects = picker.model.items as readonly (QuickPickItem & { contextId: string })[];
		assert.deepEqual(new Set(projects.map(project => project.contextId)), new Set([f.root.contextId, contextId]));
		assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.secondGroup.model.activeTab === f.secondInput);
	});
}

test('cancelling the actual folder input retires presentation but not its already accepted mkdir', async t => {
	const gate = Promise.withResolvers<void>(); t.after(() => gate.resolve());
	const f = await fixture(t), panel = await showFiles(f);
	const index = panel.files.tree.rows.findIndex(node => node.element.kind === 'directory' && node.element.path === 'physical-empty');
	assert.ok(index >= 0); panel.setSelectionIndex(index);
	const files = f.files.records.size, inputs = [...f.firstGroup.model.tabs, ...f.secondGroup.model.tabs];
	t.mock.method(f.files, 'createDirectory', async path => { await gate.promise; await MemoryWorkspaceFiles.prototype.createDirectory.call(f.files, path); });
	f.editor.commands.execute('resources.newFolder', panel.focusTarget);
	const picker = f.editor.quickInput; assert.equal(picker.visible, true);
	assert.equal(picker.field.replaceText(0, picker.field.text.length, 'accepted'), true);
	const accepting = picker.accept(); await setImmediate();
	assert.equal(await f.files.readDirectory('physical-empty/accepted'), null);
	picker.hide(); panel.hide(); f.second.focus(); const foreground = inputFocus.target;
	gate.resolve(); await accepting; f.update();
	assert.deepEqual(await f.files.readDirectory('physical-empty/accepted'), []); assert.equal(picker.visible, false);
	assert.ok(inputFocus.target === foreground && f.editor.editorParts.activePart === f.secondPart);
	assert.deepEqual([...f.firstGroup.model.tabs, ...f.secondGroup.model.tabs], inputs); assert.equal(f.files.records.size, files);
});

test('actual workbench shutdown publishes its join before directory retirement callbacks and drains accepted mkdir', async t => {
	const gate = Promise.withResolvers<void>(); t.after(() => gate.resolve());
	const f = await fixture(t); await f.directories.resolve(f.root, '');
	const reading = f.directories.children(f.root, '');
	const fileCount = f.files.records.size;
	t.mock.method(f.files, 'createDirectory', async path => {
		await gate.promise; await MemoryWorkspaceFiles.prototype.createDirectory.call(f.files, path);
	});
	const creating = f.directories.createDirectory(f.directories.directory(f.root, ''), 'accepted');
	await setImmediate();
	let reentrant: Promise<void> | undefined, repeated: Promise<void> | undefined, retired = false;
	f.directories.onDidChange(() => {
		if (f.directories.acceptingRequests || retired) return;
		retired = true; reentrant = f.ide.shutdown(); repeated = f.ide.shutdown();
	});
	const closing = f.ide.shutdown();
	assert.equal(retired, true); assert.ok(closing === reentrant && closing === repeated);
	let drained = false; void closing.then(() => { drained = true; });
	await setImmediate(); assert.equal(drained, false);
	assert.ok(f.directories.children(f.root, '') === reading, 'final reading mementos consume the retained inert observation');
	gate.resolve(); await creating; await closing;
	assert.equal(drained, true); assert.deepEqual(await f.files.readDirectory('accepted'), []);
	assert.ok(f.directories.children(f.root, '') === reading);
	assert.equal(f.files.records.size, fileCount, 'folder creation does not publish a dummy source file');
});
