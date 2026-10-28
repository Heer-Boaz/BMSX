import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { resourceIdentityKey } from '../../ide/common/resource';
import { getOrCreateSemanticProject } from '../../ide/editor/contrib/intellisense/semantic/workspace/state';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { INTEGER_INPUT_FORMAT } from '../../ide/editor/ui/inline/integer_input';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { ValueInput } from '../../ide/editor/ui/inline/value_input';
import { inputFocus } from '../../ide/input/focus';
import { navigationState, resetNavigationHistoryState } from '../../ide/navigation/navigation_history';
import { registerLuaSourceRecord } from '../../ide/runtime/source_registry';
import { CartMapInput } from '../../ide/workbench/contrib/cart_maps/editor_input';
import { CodeEditorInput, WORKBENCH_TEXT_EDITOR_ID } from '../../ide/workbench/contrib/code_editor/editor_input';
import { captureCodeEditorView } from '../../ide/workbench/contrib/code_editor/view_snapshot';
import { HostErrorInput } from '../../ide/workbench/contrib/host_error/editor_input';
import type { EditorSourceLocation } from '../../ide/editor/navigation/source_location';
import { luaSourceLocation } from '../../ide/language/lua/source_location';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { closeWorkspaceRecords, openWorkspaceRecords } from '../../ide/workspace/records';
import { createActualSourcePanes } from '../helpers/source_panes';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';

function fixture(t: TestContext) {
	const f = createActualSourcePanes(t, false, [['selected.lua', 'local selected = 3\nreturn selected\n']]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'selected.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource);
	f.first.focus();
	const location = (): EditorSourceLocation => ({ model, modelVersion: model.version,
		selection: { row: 1, startColumn: 7, endColumn: 7 } });
	return { ...f, resource, model, location };
}

test('Source navigation produces its location before opening and preserves canonical text and departure history', async t => {
	const f = fixture(t), generation = f.firstGroup.panes.openGeneration;
	resetNavigationHistoryState(); t.after(resetNavigationHistoryState);
	f.model.pushEditOperations([{ offset: f.model.buffer.length, deleteLength: 0, text: '-- retained draft\n' }]);
	const text = f.model.buffer.getText(), version = f.model.version, pane = f.firstGroup.panes.activePane;
	let read = false;
	const result = await f.editor.navigation.openSource(f.firstGroup, () => {
		read = true; assert.ok(f.firstGroup.panes.activePane === pane && pane.input === f.firstInput);
		assert.equal(f.firstGroup.panes.openGeneration, generation, 'producing source does not start an input opening');
		return f.location();
	});
	assert.equal(read, true); assert.ok(result !== undefined);
	const code = f.firstGroup.model.activeTab;
	assert.ok(code instanceof CodeEditorInput && code.workingCopy === f.model && f.firstGroup.model.previewTab !== code);
	assert.equal(captureCodeEditorView(code).cursor, f.model.buffer.offsetAt(1, 7));
	assert.equal(f.model.buffer.getText(), text); assert.equal(f.model.version, version); assert.equal(f.model.dirty, true);
	assert.ok(navigationState.back.some(entry => entry.owner === f.firstGroup && entry.target.kind === 'resource'
		&& entry.target.resource.path === f.firstInput.workingCopy.resource.path));
});

test('ordinary Source follows an existing foreign text view while explicit side ignores its affinity', async t => {
	const f = fixture(t), foreign = new CodeEditorInput(f.model); f.secondGroup.openEditor(foreign); f.first.focus();
	await f.editor.navigation.openSource(f.firstGroup, f.location);
	assert.ok(f.editor.editorParts.activeGroup === f.secondGroup && f.secondGroup.model.activeTab === foreign);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput);
	f.first.focus(); await f.editor.navigation.openSource(f.firstGroup, f.location, 'side');
	const side = f.firstPart.groups.find(group => group !== f.firstGroup)!;
	assert.ok(side.model.activeTab instanceof CodeEditorInput && side.model.activeTab !== foreign && side.model.activeTab.workingCopy === f.model);
	assert.ok(f.editor.editorParts.activeGroup === side && f.secondGroup.model.activeTab === foreign);
});

for (const placement of ['default', 'side'] as const) test(`${placement} Source overrides YAML's visual editor without replacing its canonical working copy`, async t => {
	await openWorkspaceRecords(new MemoryWorkspaceFiles());
	t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); });
	const f = fixture(t), path = 'res/data/castle_map.yaml';
	f.sources.catalog.registerTextSources(f.sources.systemContextId, [{ type: 'data', resid: 'map', source_path: path,
		sourcemeta: { text: '1: { map: [".."], objects: [] }\n' } }]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path })!;
	await f.editor.navigation.openResource(f.firstGroup, resource);
	const visual = f.firstGroup.model.activeTab; assert.ok(visual instanceof CartMapInput);
	const model = visual.workingCopy; model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '# canonical draft\n' }]);
	const text = model.buffer.getText(), version = model.version, foreign = new CodeEditorInput(model);
	f.secondGroup.openEditor(foreign); f.firstGroup.focus();
	await f.editor.navigation.openSource(f.firstGroup, () => ({ model, modelVersion: model.version,
		selection: { row: 1, startColumn: 0, endColumn: 0 } }), placement);
	const destination = f.editor.editorParts.activeGroup, code = destination.model.activeTab;
	assert.ok(code instanceof CodeEditorInput && code.workingCopy === model && destination.model.previewTab !== code);
	assert.ok(placement === 'default' ? destination === f.secondGroup && code === foreign
		: destination !== f.firstGroup && f.firstPart.groups.includes(destination));
	assert.ok(f.firstGroup.model.activeTab === visual && f.firstGroup.panes.activePane?.input === visual);
	assert.equal(model.buffer.getText(), text); assert.equal(model.version, version); assert.equal(model.dirty, true);
	assert.equal(model.canUndo, true);
});

test('side Source restores the maximized arrangement and reuses the actual same-part neighbor', async t => {
	const f = fixture(t), side = f.firstPart.splitGroup(f.firstGroup, 'right');
	f.firstPart.arrangement.toggleMaximize(f.firstGroup); f.firstPart.layout(f.firstPart.clientBounds);
	await f.editor.navigation.openSource(f.firstGroup, f.location, 'side');
	assert.equal(f.firstPart.groups.length, 2); assert.equal(f.firstPart.arrangement.maximized, undefined);
	assert.ok(f.editor.editorParts.activeGroup === side && side.model.activeTab instanceof CodeEditorInput);
	assert.ok(side.model.activeTab.workingCopy === f.model && f.firstGroup.model.activeTab === f.firstInput);
});

test('an invalid sender draft prevents location production and side topology', async t => {
	const f = fixture(t), control = new ValueInput(f.first.commandTarget, INTEGER_INPUT_FORMAT, () => {});
	t.after(() => { control.cancel(); control.dispose(); });
	control.setValue(1); control.layout(f.firstGroup.panes.contentBounds); control.field.focusTarget.focus(); setFieldText(control.field, 'invalid', true);
	let reads = 0;
	assert.equal(await f.editor.navigation.openSource(f.firstGroup, () => { reads++; return f.location(); }, 'side'), undefined);
	assert.equal(reads, 0); assert.equal(f.firstPart.groups.length, 1); assert.equal(control.pending, true);
	assert.ok(inputFocus.admittedTarget === control.field.focusTarget && f.firstGroup.model.activeTab === f.firstInput);
});

test('a committed sender may release to its own Source parent before the location is read', async t => {
	const f = fixture(t), control = new ValueInput(f.first.commandTarget, INTEGER_INPUT_FORMAT, value => {
		control.field.focusTarget.release();
		f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: `-- accepted ${value}\n` }]);
	}); t.after(() => control.dispose());
	control.setValue(1); control.layout(f.firstGroup.panes.contentBounds); control.field.focusTarget.focus(); setFieldText(control.field, '2', true);
	let version = -1;
	await f.editor.navigation.openSource(f.firstGroup, () => { version = f.model.version; return f.location(); }, 'side');
	assert.equal(control.pending, false); assert.equal(version, f.model.version); assert.equal(f.firstPart.groups.length, 2);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput);
});

test('sender draft reentrancy replaces the pane before the lazy producer can run', async t => {
	const f = fixture(t), newer = new HostErrorInput('newer sender'), control = new ValueInput(f.first.commandTarget, INTEGER_INPUT_FORMAT,
		() => { f.firstGroup.openEditor(newer); }); t.after(() => control.dispose());
	control.setValue(1); control.layout(f.firstGroup.panes.contentBounds); control.field.focusTarget.focus(); setFieldText(control.field, '2', true);
	let reads = 0;
	assert.equal(await f.editor.navigation.openSource(f.firstGroup, () => { reads++; return f.location(); }, 'side'), undefined);
	assert.equal(reads, 0); assert.equal(f.firstPart.groups.length, 1);
	assert.ok(f.firstGroup.model.activeTab === newer && f.firstGroup.panes.activePane?.input === newer);
});

for (const change of ['undefined', 'foreignFocus', 'rebind', 'clearModels', 'staleVersion', 'catalogReplacement'] as const)
	test(`source producer ${change} cannot mutate side topology or attach its earlier source`, async t => {
		const f = fixture(t), location = f.location(), newer = new HostErrorInput('newer sender');
		const result = await f.editor.navigation.openSource(f.firstGroup, () => {
			if (change === 'undefined') return undefined;
			if (change === 'foreignFocus') f.second.focus();
			else if (change === 'rebind') f.firstGroup.openEditor(newer);
			else if (change === 'clearModels') editorTextModelService.clear();
			else if (change === 'staleVersion') f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- newer source\n' }]);
			else if (change === 'catalogReplacement') {
				const registry = f.sources.catalog.getContext(f.resource.contextId).luaSources, record = registry.path2lua[f.resource.path];
				registry.records.splice(registry.records.indexOf(record), 1); delete registry.path2lua[f.resource.path]; delete registry.module2lua[record.module_path];
				f.sources.catalog.rebuildResources(); registerLuaSourceRecord(registry, { ...record, update_timestamp: record.update_timestamp + 1 });
			}
			return location;
		}, 'side');
		assert.equal(result, undefined); assert.equal(f.firstPart.groups.length, 1);
		assert.ok(f.firstGroup.model.activeTab === (change === 'rebind' ? newer : f.firstInput));
		if (change === 'foreignFocus') assert.ok(inputFocus.admittedTarget === f.second.commandTarget && f.editor.editorParts.activeGroup === f.secondGroup);
	});

test('source edits during accepted side publication invalidate the caret but keep the admitted empty group', async t => {
	const f = fixture(t), location = f.location();
	const unbind = f.firstPart.onDidChangeGroups(() => {
		unbind(); f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- publication changed source\n' }]);
	}); t.after(unbind);
	assert.equal(await f.editor.navigation.openSource(f.firstGroup, () => location, 'side'), undefined);
	assert.equal(f.firstPart.groups.length, 2);
	assert.ok(f.firstPart.groups.find(group => group !== f.firstGroup)!.model.activeTab === null);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput);
});

test('source edits while the text opener yields cannot admit the earlier caret generation', async t => {
	const f = fixture(t), location = f.location();
	const pending = f.editor.navigation.openSource(f.firstGroup, () => location, 'side');
	f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- newer than the requested caret\n' }]);
	assert.equal(await pending, undefined);
	assert.equal(f.firstPart.groups.length, 2);
	assert.ok(f.firstPart.groups.find(group => group !== f.firstGroup)!.model.activeTab === null);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput);
});

test('the receiver draft cannot apply an obsolete Source caret after accepting its canonical edit', async t => {
	const f = fixture(t), foreign = new CodeEditorInput(f.model); f.secondGroup.openEditor(foreign);
	const control = new ValueInput(f.second.commandTarget, INTEGER_INPUT_FORMAT, value => {
		f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: `-- receiver accepted ${value}\n` }]);
	}); t.after(() => control.dispose());
	control.setValue(1); control.layout(f.secondGroup.panes.contentBounds); control.field.focusTarget.focus(); setFieldText(control.field, '2', true);
	const location = f.location();
	assert.equal(await f.editor.navigation.openSource(f.firstGroup, () => location), undefined);
	assert.equal(control.pending, false); assert.ok(f.model.version > location.modelVersion);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.secondGroup.model.activeTab === foreign);
	assert.equal(f.firstPart.groups.length, 1);
});

test('retiring the exact sender while Source resolution yields disposes the late candidate', async t => {
	const f = fixture(t), resolve = f.editor.resourceEditors.resolveEditorInput.bind(f.editor.resourceEditors);
	let disposed = 0;
	t.mock.method(f.editor.resourceEditors, 'resolveEditorInput', (resource, editorId) => {
		const input = resolve(resource, editorId); assert.ok(input instanceof CodeEditorInput);
		input.onWillDispose(() => { disposed++; }); return input;
	});
	const pending = f.editor.navigation.openSource(f.firstGroup, f.location, 'side'); f.firstGroup.clear();
	assert.equal(await pending, undefined); assert.equal(disposed, 1);
	assert.ok(f.firstPart.groups.find(group => group !== f.firstGroup)!.model.activeTab === null);
});

test('an admitted pending Source may attach in the background without taking a newer pane focus', async t => {
	const f = fixture(t), pending = f.editor.navigation.openSource(f.firstGroup, f.location, 'side'); f.second.focus();
	assert.ok(await pending !== undefined);
	const side = f.firstPart.groups.find(group => group !== f.firstGroup)!;
	assert.ok(side.model.activeTab instanceof CodeEditorInput && side.model.activeTab.workingCopy === f.model);
	assert.ok(inputFocus.admittedTarget === f.second.commandTarget && f.editor.editorParts.activeGroup === f.secondGroup);
});

test('opening lifetime denial runs before input production and never disposes a retained input', async t => {
	const f = fixture(t), generation = f.firstGroup.panes.openGeneration; let reads = 0, disposed = false;
	f.firstInput.onWillDispose(() => { disposed = true; });
	assert.equal(await f.firstGroup.openResolvedEditor(() => { reads++; return new CodeEditorInput(f.model); }, { isCurrent: () => false }), undefined);
	assert.equal(reads, 0); assert.equal(f.firstGroup.panes.openGeneration, generation);
	assert.ok(f.firstGroup.openEditor(f.firstInput, { isCurrent: () => false }) === undefined);
	assert.equal(disposed, false); assert.ok(f.firstGroup.model.activeTab === f.firstInput);
});

test('direct opening lifetime is rechecked after the actual destination draft before candidate admission', t => {
	const f = fixture(t), candidate = new CodeEditorInput(f.model); let current = true, disposed = 0;
	candidate.onWillDispose(() => { disposed++; });
	const control = new ValueInput(f.first.commandTarget, INTEGER_INPUT_FORMAT, () => { current = false; });
	t.after(() => control.dispose());
	control.setValue(1); control.layout(f.firstGroup.panes.contentBounds); control.field.focusTarget.focus(); setFieldText(control.field, '2', true);
	assert.ok(f.firstGroup.openEditor(candidate, { isCurrent: () => current }) === undefined);
	assert.equal(control.pending, false); assert.equal(disposed, 1);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.firstGroup.panes.activePane?.input === f.firstInput);
});

for (const publication of ['clear', 'membership'] as const) test(`${publication} publication cannot consume a caret from an older canonical source generation`, async t => {
	const f = fixture(t), resolve = f.editor.resourceEditors.resolveEditorInput.bind(f.editor.resourceEditors);
	let candidate: CodeEditorInput | undefined, cursorAfterEdit: number | undefined, edited = false;
	t.mock.method(f.editor.resourceEditors, 'resolveEditorInput', (resource, editorId) => {
		assert.equal(editorId, WORKBENCH_TEXT_EDITOR_ID);
		const input = resolve(resource, editorId); assert.ok(input instanceof CodeEditorInput); candidate = input; return input;
	});
	const edit = () => {
		if (edited) return;
		edited = true; f.model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- publication advanced canonical source\n' }]);
		assert.ok(candidate !== undefined); cursorAfterEdit = captureCodeEditorView(candidate).cursor;
	};
	const unbind = publication === 'clear' ? f.firstGroup.panes.onDidClearEditor(edit)
		: f.firstGroup.model.onDidChange(() => { if (f.firstGroup.model.contains(candidate!)) edit(); });
	t.after(unbind);
	await f.editor.navigation.openSource(f.firstGroup, f.location);
	assert.equal(edited, true); assert.ok(candidate !== undefined && cursorAfterEdit !== undefined);
	assert.ok(f.firstGroup.model.activeTab === candidate);
	assert.equal(captureCodeEditorView(candidate).cursor, cursorAfterEdit, 'a stale Source caret cannot overwrite the input cursor after an admitted publication');
});

test('retired or empty reference groups never invoke source production', async t => {
	const f = fixture(t); f.firstGroup.clear(); let reads = 0;
	assert.equal(await f.editor.navigation.openSource(f.firstGroup, () => { reads++; return f.location(); }, 'side'), undefined);
	await f.editor.editorParts.close(f.firstPart);
	assert.equal(await f.editor.navigation.openSource(f.firstGroup, () => { reads++; return f.location(); }, 'side'), undefined);
	assert.equal(reads, 0); assert.equal(f.secondPart.groups.length, 1);
});

test('Lua location certification rejects an AST made stale by canonical model admission callbacks', t => {
	const f = createActualSourcePanes(t, false, [['selected.lua', 'return 3\n']]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'selected.lua' })!;
	const project = getOrCreateSemanticProject(editorTextModelService, resource.contextId); project.synchronizeSources(f.sources.catalog);
	const file = project.getSnapshot().getFileData(resourceIdentityKey(resource))!;
	t.after(editorTextModelService.onDidAddModel(model => {
		if (model.resource === resource) model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- admitted newer source\n' }]);
	}));
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource);
	assert.equal(luaSourceLocation(project, model, file), undefined);
	const current = project.getFileData(model.identity)!;
	const location = luaSourceLocation(project, model, current)!;
	assert.ok(location.model === model); assert.equal(location.modelVersion, model.version);
});
