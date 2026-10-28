import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import test, { type TestContext } from 'node:test';
import { KeyModifier } from '../../hosts/common/input/text';
import { executeEditorSearchCommand } from '../../ide/commands/search';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { advanceLuaSourceRevision, registerLuaSourceRecord } from '../../ide/runtime/source_registry';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { HostErrorInput } from '../../ide/workbench/contrib/host_error/editor_input';
import { CartMapInput } from '../../ide/workbench/contrib/cart_maps/editor_input';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { WorkbenchPropertyEdit } from '../../ide/workbench/ui/property_edit';
import { createWorkbenchPropertyTree, layoutWorkbenchPropertyTree, type WorkbenchPropertyElement } from '../../ide/workbench/ui/property_tree';
import { appendWorkbenchTreeNode, rebuildWorkbenchTreeRows } from '../../ide/workbench/ui/tree_view';
import { clearWorkspaceSourceCaches } from '../../ide/workspace/cache';
import { closeWorkspaceRecords, openWorkspaceRecords } from '../../ide/workspace/records';
import { createActualSourcePanes } from '../helpers/source_panes';
import { MemoryWorkspaceFiles } from '../helpers/workspace_files';

function fixture(t: TestContext) {
	const f = createActualSourcePanes(t, false, [['third.lua', 'return 3\n']]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'third.lua' })!;
	const registry = f.sources.catalog.getContext(resource.contextId).luaSources;
	const open = () => {
		f.first.focus();
		executeEditorSearchCommand(f.editor, f.sources, 'resourceSearch', f.firstGroup, f.first.commandTarget, f.host.clock);
		f.editor.quickInput.model.filter('third.lua');
		assert.equal(f.editor.quickInput.visible, true);
		assert.equal(f.editor.quickInput.model.list.rows.length, 1);
	};
	const remove = () => {
		const record = registry.path2lua[resource.path];
		registry.records.splice(registry.records.indexOf(record), 1);
		delete registry.path2lua[resource.path]; delete registry.module2lua[record.module_path];
		f.sources.catalog.rebuildResources();
		return record;
	};
	return { ...f, resource, registry, open, remove };
}

test('Go to File foreground acceptance focuses the canonical pinned Source in the captured invoking group', async t => {
	const f = fixture(t); f.open();
	f.editor.quickInput.accept(); await setImmediate();
	const input = f.firstGroup.model.activeTab;
	assert.ok(input instanceof CodeEditorInput && input.workingCopy === editorTextModelService.get(f.resource));
	assert.ok(f.firstGroup.model.previewTab !== input);
	assert.ok(inputFocus.admittedTarget === f.first.commandTarget);
	assert.ok(f.editor.editorParts.activeGroup === f.firstGroup);
	assert.ok(f.secondGroup.model.activeTab === f.secondInput);
});

test('Go to File Alt acceptance opens a same-part side instead of borrowing default affinity', async t => {
	const f = fixture(t); f.open();
	f.editor.quickInput.accept(KeyModifier.alt); await setImmediate();
	const groups = f.firstPart.groups;
	assert.equal(groups.length, 2);
	const side = groups.find(group => group !== f.firstGroup)!;
	const input = side.model.activeTab;
	assert.ok(input instanceof CodeEditorInput && input.workingCopy.resource === f.resource);
	assert.ok(f.editor.editorParts.activePart === f.firstPart && f.editor.editorParts.activeGroup === side);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput);
});

test('Go to File cannot lend a later model-listener foreground interaction to its old request', async t => {
	const f = fixture(t); f.open();
	t.after(editorTextModelService.onDidAddModel(model => { if (model.resource === f.resource) f.second.focus(); }));
	f.editor.quickInput.accept(); await setImmediate();
	assert.ok(inputFocus.admittedTarget === f.second.commandTarget);
	assert.ok(f.editor.editorParts.activePart === f.secondPart && f.editor.editorParts.activeGroup === f.secondGroup);
});

test('resource input production runs inside the group opening receipt so a synchronous newer opening wins', async t => {
	const f = fixture(t), newer = new HostErrorInput('newer receiver'); f.open();
	t.after(editorTextModelService.onDidAddModel(model => {
		if (model.resource === f.resource) f.firstGroup.openEditor(newer);
	}));
	f.editor.quickInput.accept(); await setImmediate();
	assert.ok(f.firstGroup.model.activeTab === newer && f.firstGroup.panes.activePane?.input === newer);
	assert.equal(f.firstGroup.model.tabs.some(input => input instanceof CodeEditorInput && input.workingCopy.resource === f.resource), false);
});

for (const font of ['tiny', 'msx'] as const) for (const side of [false, true])
	test(`${font} ${side ? 'Alt+Enter' : 'Enter'} keeps explicit side separate from ordinary resource affinity`, async t => {
		const f = fixture(t); f.editor.setFontVariant(font); f.update();
		assert.equal(editorViewState.font.variant, font);
		const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, f.resource);
		model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- retained canonical draft\n' }]);
		const existing = new CodeEditorInput(model); f.secondGroup.openEditor(existing);
		const bytes = model.buffer.getText(), version = model.version, cycles = f.host.runtime.machine.scheduler.nowCycles;
		f.open(); f.key('Enter', side ? KeyModifier.alt : KeyModifier.none); await setImmediate();
		const destination = f.editor.editorParts.activeGroup, input = destination.model.activeTab;
		assert.ok(input instanceof CodeEditorInput && input.workingCopy === model && destination.model.previewTab !== input);
		assert.ok(side ? destination !== f.secondGroup && destination !== f.firstGroup && f.firstPart.groups.includes(destination)
			: destination === f.secondGroup && input === existing);
		assert.ok(f.firstGroup.model.activeTab === f.firstInput);
		assert.equal(model.buffer.getText(), bytes); assert.equal(model.version, version); assert.equal(model.dirty, true);
		assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
	});

test('Alt acceptance reuses a maximized same-part side without fabricating another group', async t => {
	const f = fixture(t), side = f.firstPart.splitGroup(f.firstGroup, 'right');
	f.firstPart.arrangement.toggleMaximize(f.firstGroup); f.firstPart.layout(f.firstPart.clientBounds);
	f.open(); f.editor.quickInput.accept(KeyModifier.alt); await setImmediate();
	assert.equal(f.firstPart.groups.length, 2); assert.equal(f.firstPart.arrangement.maximized, undefined);
	assert.ok(f.editor.editorParts.activeGroup === side && side.model.activeTab instanceof CodeEditorInput);
	assert.ok(side.model.activeTab.workingCopy.resource === f.resource);
});

test('a null prepared origin can open its captured group without a fabricated control', async t => {
	const f = fixture(t); inputFocus.setTarget(null);
	executeEditorSearchCommand(f.editor, f.sources, 'resourceSearch', f.firstGroup, null, f.host.clock);
	f.editor.quickInput.model.filter('third.lua'); f.editor.quickInput.accept(); await setImmediate();
	assert.ok(f.firstGroup.model.activeTab instanceof CodeEditorInput && f.firstGroup.model.activeTab.workingCopy.resource === f.resource);
	assert.ok(f.editor.editorParts.activeGroup === f.firstGroup);
});

test('the prepared origin follows ordinary Source draft blur before retaining its command lifetime', async t => {
	const f = fixture(t); f.first.focus();
	const edit = new WorkbenchPropertyEdit<string>(f.first.commandTarget, value => value, f.editor.surfaces, f.firstGroup.paneSurface, f.firstGroup.workArea);
	t.after(() => edit.dispose());
	const tree = createWorkbenchPropertyTree<WorkbenchPropertyElement>();
	const row = appendWorkbenchTreeNode<WorkbenchPropertyElement>(tree, null, { kind: 'property', label: 'alpha', value: '1', description: '', warning: false,
		displayLabel: '', displayValue: '', displayValueLeft: 0 });
	rebuildWorkbenchTreeRows(tree, row);
	layoutWorkbenchPropertyTree(tree, editorViewState.font.renderFont(), (text, start, end) => editorViewState.font.measure(text.slice(start, end)),
		f.firstGroup.bounds.left, f.firstGroup.bounds.top, f.firstGroup.bounds.right, f.firstGroup.bounds.bottom);
	edit.open({ model: f.firstInput.workingCopy, tree, row, parse: text => ({ value: text }),
		apply: text => f.firstInput.workingCopy.pushEditOperations([{ offset: 14, deleteLength: 1, text }]) }, '1');
	setFieldText(edit.control.field, '2', true);
	executeEditorSearchCommand(f.editor, f.sources, 'resourceSearch', f.firstGroup, edit.control.field.focusTarget, f.host.clock);
	assert.equal(edit.active, false);
	assert.equal(f.firstInput.workingCopy.buffer.getText(), f.source.replace('1', '2'));
	assert.ok(f.editor.quickInput.invocationOrigin === f.first.commandTarget);
	f.editor.quickInput.model.filter('third.lua'); f.editor.quickInput.accept(); await setImmediate();
	assert.ok(f.firstGroup.model.activeTab instanceof CodeEditorInput && f.firstGroup.model.activeTab.workingCopy.resource === f.resource);
	assert.ok(inputFocus.admittedTarget === f.first.commandTarget);
});

for (const side of [false, true]) test(`Go to File ${side ? 'Alt' : 'plain'} acceptance preserves the resource visual default and pinned canonical source`, async t => {
	await openWorkspaceRecords(new MemoryWorkspaceFiles());
	const f = fixture(t), path = 'res/data/castle_map.yaml', source = '1: { map: [".."], objects: [] }\n';
	t.after(async () => { await closeWorkspaceRecords(); clearWorkspaceSourceCaches(); });
	f.sources.catalog.registerTextSources(f.sources.systemContextId, [{ type: 'data', resid: 'map', source_path: path, sourcemeta: { text: source } }]);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path })!;
	f.first.focus(); executeEditorSearchCommand(f.editor, f.sources, 'resourceSearch', f.firstGroup, f.first.commandTarget, f.host.clock);
	f.editor.quickInput.model.filter(path); f.editor.quickInput.accept(side ? KeyModifier.alt : KeyModifier.none); await setImmediate();
	const destination = f.editor.editorParts.activeGroup, input = destination.model.activeTab;
	assert.ok(input instanceof CartMapInput && input.resource === resource && input.workingCopy === editorTextModelService.get(resource));
	assert.ok(destination.model.previewTab !== input);
	assert.ok(side ? destination !== f.firstGroup && f.firstPart.groups.includes(destination) : destination === f.firstGroup);
	assert.equal(input.workingCopy.buffer.getText(), source); assert.equal(input.workingCopy.dirty, false);
});

test('catalog source revisions and additions retain the fixed admitted inventory and current selection', async t => {
	const f = fixture(t); f.open();
	const items = f.editor.quickInput.model.items, selection = f.editor.quickInput.model.list.rows[0].item;
	advanceLuaSourceRevision(f.registry, f.resource.path);
	registerLuaSourceRecord(f.registry, { ...f.registry.path2lua[f.resource.path],
		resid: 'new.lua', source_path: 'new.lua', normalized_source_path: 'new.lua', module_path: 'new' });
	assert.equal(f.editor.quickInput.visible, true);
	assert.ok(f.editor.quickInput.model.items === items && f.editor.quickInput.model.list.rows[0].item === selection);
	assert.equal(items.some(item => 'resource' in item && item.resource === f.sources.catalog.resolveResource({ contextId: f.resource.contextId, path: 'new.lua' })), false);
	f.editor.quickInput.accept(); await setImmediate();
	assert.ok(f.firstGroup.model.activeTab instanceof CodeEditorInput && f.firstGroup.model.activeTab.workingCopy.resource === f.resource);
});

test('catalog publication retires a fixed inventory containing a removed resource without reopening its same-path replacement', async t => {
	const f = fixture(t); f.open();
	const record = f.remove();
	advanceLuaSourceRevision(f.registry);
	assert.equal(f.editor.quickInput.visible, false);
	registerLuaSourceRecord(f.registry, record);
	const replacement = f.sources.catalog.resolveResource(f.resource);
	assert.ok(replacement !== undefined && replacement !== f.resource);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput && editorTextModelService.get(f.resource) === undefined);
});

test('acceptance rejects a selected resource retired without publication rather than resolving its stale identity', async t => {
	const f = fixture(t); f.open(); f.remove();
	f.editor.quickInput.accept(); await setImmediate();
	assert.ok(f.firstGroup.model.activeTab === f.firstInput && editorTextModelService.get(f.resource) === undefined);
});

test('source model clearing retires the resource picker before detached source can be accepted', t => {
	const f = fixture(t); f.open(); editorTextModelService.clear();
	assert.equal(f.editor.quickInput.visible, false);
	assert.ok(editorTextModelService.get(f.resource) === undefined);
});

test('captured group disposal retires the picker instead of adopting a surviving active group', t => {
	const f = fixture(t); f.open(); f.firstPart.dispose();
	assert.equal(f.editor.quickInput.visible, false);
	assert.ok(f.secondGroup.model.activeTab === f.secondInput && editorTextModelService.get(f.resource) === undefined);
});

for (const change of ['foreignFocus', 'originRetirement', 'groupDisposal', 'resourceReplacement'] as const)
	test(`resource acceptance respects ${change} during actual focus return`, async t => {
		const f = fixture(t); f.open();
		const unbind = f.first.commandTarget.onDidFocus(() => {
			unbind();
			if (change === 'foreignFocus') f.second.focus();
			else if (change === 'originRetirement') f.first.commandTarget.scope.retireContext();
			else if (change === 'groupDisposal') f.firstPart.dispose();
			else registerLuaSourceRecord(f.registry, f.remove());
		}); t.after(unbind);
		f.editor.quickInput.accept(); await setImmediate();
		if (change !== 'groupDisposal') assert.ok(f.firstGroup.model.activeTab === f.firstInput);
		assert.ok(f.secondGroup.model.activeTab === f.secondInput && editorTextModelService.get(f.resource) === undefined);
		if (change === 'foreignFocus') assert.ok(inputFocus.admittedTarget === f.second.commandTarget && f.editor.editorParts.activePart === f.secondPart);
	});

test('newer foreign interaction during accepted side publication cancels only the opening, not the explicit split', async t => {
	const f = fixture(t); f.open();
	t.after(f.firstPart.onDidChangeGroups(() => { f.second.focus(); }));
	f.editor.quickInput.accept(KeyModifier.alt); await setImmediate();
	assert.equal(f.firstPart.groups.length, 2);
	assert.equal(f.firstPart.groups.find(group => group !== f.firstGroup)!.model.tabs.length, 0);
	assert.ok(inputFocus.admittedTarget === f.second.commandTarget && f.editor.editorParts.activePart === f.secondPart);
	assert.ok(editorTextModelService.get(f.resource) === undefined);
});
