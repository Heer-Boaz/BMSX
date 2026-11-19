import assert from 'node:assert/strict';
import test from 'node:test';
import { inputFocus } from '../../ide/input/focus';
import { navigationState, resetNavigationHistoryState } from '../../ide/navigation/navigation_history';
import { AemEditorInput } from '../../ide/workbench/contrib/aem/editor_input';
import { CartMapInput } from '../../ide/workbench/contrib/cart_maps/editor_input';
import { CodeEditorInput, WORKBENCH_TEXT_EDITOR_ID } from '../../ide/workbench/contrib/code_editor/editor_input';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { closeWorkspaceRecords, openWorkspaceRecords } from '../../ide/workspace/records';
import { createActualSourcePanes } from '../helpers/source_panes';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';

test('default YAML navigation keeps Map while Source navigation shares its dirty canonical model and applies the requested text range', async t => {
	await openWorkspaceRecords(new MemoryWorkspaceFiles());
	const f = createActualSourcePanes(t), group = f.firstGroup;
	t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); });
	const source = '1: { map: [".."], objects: [] }\n', path = 'res/data/castle_map.yaml';
	f.sources.catalog.registerTextSources(f.sources.systemContextId,
		[{ type: 'data', resid: 'map', source_path: path, sourcemeta: { text: source } }]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path })!;
	assert.ok(await f.editor.navigation.openResource(group, resource) !== undefined);
	const map = group.model.activeTab; assert.ok(map instanceof CartMapInput);
	map.workingCopy.pushEditOperations([{ offset: 0, deleteLength: 0, text: '# canonical draft\n' }]);
	const text = map.workingCopy.buffer.getText(), version = map.workingCopy.version;
	assert.ok(await f.editor.navigation.focusChunkSource(group, resource, { row: 1, startColumn: 0, endColumn: 1 }) !== undefined);
	const code = group.model.activeTab;
	assert.ok(code instanceof CodeEditorInput && code.workingCopy === map.workingCopy && code.resource === resource);
	assert.equal(code.context.view.cursorRow, 1); assert.equal(code.context.view.cursorColumn, 0);
	assert.equal(code.context.view.selectionAnchor.row, 1); assert.equal(code.context.view.selectionAnchor.column, 1);
	assert.equal(code.workingCopy.buffer.getText(), text); assert.equal(code.workingCopy.version, version);
	assert.equal(code.isDirty(), true); assert.equal(code.workingCopy.canUndo, true);
	assert.ok(await f.editor.navigation.openResource(group, resource) !== undefined);
	assert.ok(group.model.activeTab === map && group.model.contains(code));
	assert.equal(map.workingCopy.buffer.getText(), text); assert.equal(map.workingCopy.version, version);
});

test('context Source navigation explicitly opens text for AEM without replacing its default contribution or canonical working copy', async t => {
	await openWorkspaceRecords(new MemoryWorkspaceFiles());
	const f = createActualSourcePanes(t), group = f.firstGroup;
	t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); });
	const path = 'res/data/events.aem.yaml', source = 'events: {}\n';
	f.sources.catalog.registerTextSources(f.sources.systemContextId,
		[{ type: 'aem', resid: 'events', source_path: path, sourcemeta: { text: source } }]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path })!;
	await f.editor.navigation.openResource(group, resource);
	const aem = group.model.activeTab; assert.ok(aem instanceof AemEditorInput);
	const shown = Promise.withResolvers<void>();
	const unbind = group.panes.onWillShowEditor(() => {
		const input = group.panes.activePane?.input;
		if (input instanceof CodeEditorInput && input.resource === resource) shown.resolve();
	}); t.after(unbind);
	f.editor.navigation.focusChunkSourceForContext(group, resource.contextId, resource.path, { row: 0, startColumn: 0, endColumn: 2 });
	await shown.promise; unbind();
	const code = group.model.activeTab;
	assert.ok(code instanceof CodeEditorInput && code.workingCopy === aem.workingCopy && group.model.contains(aem));
	assert.equal(code.workingCopy.buffer.getText(), source); assert.equal(code.context.view.cursorColumn, 0);
	assert.equal(code.context.view.selectionAnchor.column, 2);
	await f.editor.navigation.openResource(group, resource);
	assert.ok(group.model.activeTab === aem && group.panes.activePane?.input === aem);
});

test('explicit Source options bind the captured group without stealing another control focus or adding departure history', async t => {
	await openWorkspaceRecords(new MemoryWorkspaceFiles());
	const f = createActualSourcePanes(t), group = f.firstGroup;
	t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); });
	resetNavigationHistoryState(); t.after(resetNavigationHistoryState);
	const path = 'res/data/castle_map.yml';
	f.sources.catalog.registerTextSources(f.sources.systemContextId,
		[{ type: 'data', resid: 'map', source_path: path, sourcemeta: { text: '1: { map: [".."], objects: [] }\n' } }]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path })!;
	f.second.focus();
	const focused = inputFocus.target, back = navigationState.back.length, forward = navigationState.forward.length;
	assert.ok(await f.editor.navigation.openResource(group, resource,
		{ editorId: WORKBENCH_TEXT_EDITOR_ID, selection: { row: 0, startColumn: 0, endColumn: 1 }, preserveFocus: true }) !== undefined);
	const code = group.model.activeTab; assert.ok(code instanceof CodeEditorInput && code.resource === resource);
	assert.ok(inputFocus.target === focused && f.editor.editorParts.activeGroup === f.secondGroup);
	assert.ok(group.panes.activePane?.input === code); assert.equal(code.context.view.cursorColumn, 0);
	assert.equal(code.context.view.selectionAnchor.column, 1);
	assert.equal(navigationState.back.length, back); assert.equal(navigationState.forward.length, forward);
});
