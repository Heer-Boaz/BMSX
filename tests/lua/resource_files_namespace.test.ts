import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorTextModelService } from '../../ide/editor/model/model_service';
import { createLuaSourceRegistry } from '../../ide/runtime/source_registry';
import { BehaviorRegistrationIndex } from '../../ide/workbench/contrib/behavior_lens/registration_index';
import { ProjectContentIndex } from '../../ide/workbench/contrib/resources/panel/content_index';
import { ResourceFilesModel } from '../../ide/workbench/contrib/resources/panel/files_model';
import { SceneSourceDocuments } from '../../ide/workbench/contrib/scene_editor/source_documents';
import { WorkspaceDirectoryModel } from '../../ide/workspace/directory_model';
import { WorkspaceRecords } from '../../ide/workspace/records';
import { createTestRuntimeSourceState, TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';

test('a physical-only project root replacement consumes preloaded alias inventory without retaining the old parent, selection or recovery address', async t => {
	const provider = new MemoryWorkspaceFiles('workspace');
	await provider.write('fixture/old/raw.txt', { contents: 'old physical file', updatedAt: 1 }, false);
	await provider.write('fixture/current/raw.txt', { contents: 'different physical file', updatedAt: 2 }, false);
	const sources = createTestRuntimeSourceState(createLuaSourceRegistry('fixture/system', ''),
		[createLuaSourceRegistry('fixture/old', ''), null], 0);
	const contextId = TEST_CARTRIDGE_CONTEXT_IDS[0], context = sources.catalog.getContext(contextId);
	const currentAdmission = { ...context, luaSources: createLuaSourceRegistry('fixture/current', ''),
		sourceRoots: [{ path: 'fixture/current', resourcePathPrefix: '', modulePathPrefix: '', structured: true, sourceKind: 'project' as const }] };
	sources.catalog.admitContext({ ...currentAdmission, admission: { id: 'preloaded-directory-alias', projectRoot: 'fixture/current' } });
	const records = new WorkspaceRecords(provider), directories = new WorkspaceDirectoryModel(records, sources.catalog);
	const models = new EditorTextModelService(), content = new ProjectContentIndex(models, sources.catalog,
		new BehaviorRegistrationIndex(models, sources.catalog), new SceneSourceDocuments(models, sources.catalog));
	const files = new ResourceFilesModel(directories);
	t.after(async () => { content.dispose(); models.clear(); directories.dispose(); sources.catalog.dispose(); await records.close(); });
	const previous = directories.rootForContext(contextId)!, alias = directories.rootForContext('preloaded-directory-alias')!;
	await directories.resolve(previous, ''); await directories.resolve(alias, '');
	content.sync(); files.sync(sources.catalog, 'all', content.entriesByResource, content.revision);
	const oldRoot = files.tree.roots.find(node => node.element.kind === 'root' && node.element.contextId === contextId)!;
	const oldFile = files.tree.rows.find(node => node.element.kind === 'physicalFile' && node.element.contextId === contextId)!;
	assert.ok(oldRoot !== undefined && oldFile !== undefined && oldFile.parent === oldRoot);
	files.tree.selectionIndex = files.tree.rows.indexOf(oldFile);
	const reading = files.captureView(content);
	const reads = t.mock.method(provider, 'readDirectory');
	sources.catalog.contexts.delete(contextId);
	sources.catalog.admitContext({ ...currentAdmission, admission: { id: contextId, projectRoot: 'fixture/current' } });
	const current = directories.rootForContext(contextId)!;
	assert.equal(directories.isCurrent(previous), false); assert.equal(directories.get(current, '')!.status, 'ready');
	content.sync(); files.sync(sources.catalog, 'all', content.entriesByResource, content.revision);
	const root = files.tree.roots.find(node => node.element.kind === 'root' && node.element.contextId === contextId)!;
	const file = files.tree.rows.find(node => node.element.kind === 'physicalFile' && node.element.contextId === contextId)!;
	assert.ok(root !== oldRoot && file !== oldFile && file.parent === root);
	assert.equal(root.element.path, 'fixture/current');
	assert.ok(file.element.kind === 'physicalFile'); assert.equal(file.element.entry.workspacePath, 'fixture/current/raw.txt');
	assert.equal(files.tree.rows.includes(oldFile), false); assert.ok(files.selectedNode !== file);
	files.restoreView(reading, content); assert.ok(files.selectedNode === null, 'a retired root cannot recover a namesake from the replacement root');
	assert.equal(reads.mock.callCount(), 0, 'the replacement projects the surviving physical cache without a new read or old row aliases');
});
