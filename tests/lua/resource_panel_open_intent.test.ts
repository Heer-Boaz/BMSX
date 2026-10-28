import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { INTEGER_INPUT_FORMAT } from '../../ide/editor/ui/inline/integer_input';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { ValueInput } from '../../ide/editor/ui/inline/value_input';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { inputFocus } from '../../ide/input/focus';
import { registerLuaSourceRecord } from '../../ide/runtime/source_registry';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { GameViewInput } from '../../ide/workbench/contrib/game_view/editor_input';
import type { FileElement } from '../../ide/workbench/contrib/resources/panel/files_model';
import type { WorkbenchTreeNode } from '../../ide/workbench/ui/tree_view';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { createActualSourcePanes } from '../helpers/source_panes';

function fixture(t: TestContext, font: 'tiny' | 'msx' = 'tiny', sources: readonly (readonly [string, string])[] = []) {
	const f = createActualSourcePanes(t, false, [['folder/third.lua', 'return 3'], ['folder/other.lua', 'return 4'], ...sources]);
	f.editor.setFontVariant(font); f.update(); assert.equal(editorViewState.font.variant, font);
	f.first.focus(); f.editor.resourcePanel.show(); f.update();
	return { ...f, panel: f.editor.resourcePanel };
}
type Fixture = ReturnType<typeof fixture>;

function reveal(f: Fixture, path = 'folder/third.lua') {
	f.panel.queuePendingSelection({ contextId: f.sources.systemContextId, path }); f.panel.applyPendingSelection(); f.update();
	const node = f.panel.files.selectedNode;
	assert.ok(node !== null && node.element.kind === 'file'); return { node, resource: node.element.resource };
}

/** Coordinates deliver input into the actual tree; they are not workflow assertions. */
function click(f: Fixture, node: WorkbenchTreeNode<FileElement>, modifiers: KeyModifier, gutter = false): void {
	const index = f.panel.files.tree.rows.indexOf(node), metrics = f.panel.getItemMetrics(index), layout = f.panel.prepareLayout();
	const x = layout.contentLeft - f.panel.hscroll + (gutter ? (metrics.markerStartWidth + metrics.markerEndWidth) / 2
		: metrics.indentWidth + editorViewState.font.advance(' '));
	const y = layout.contentTop + (index - f.panel.scroll + 0.5) * f.panel.lineHeight;
	for (const down of [true, false]) {
		f.host.clock.advance(10);
		f.editor.dispatchPointer({ x, y, buttons: down ? PointerButton.Primary : 0,
			pressedButtons: down ? PointerButton.Primary : 0, releasedButtons: down ? 0 : PointerButton.Primary,
			cancelledButtons: 0, modifiers, spaceDown: false, timestamp: f.host.clock.now() });
	}
}

for (const font of ['tiny', 'msx'] as const) for (const code of ['Enter', 'NumpadEnter']) for (const modifier of [KeyModifier.ctrl, KeyModifier.meta])
	test(`${font} ${modifier === KeyModifier.ctrl ? 'Ctrl' : 'Cmd'}+${code} opens the exact Files selection beside its host without changing canonical source or machine time`, async t => {
		const f = fixture(t, font), { resource } = reveal(f), original = f.firstInput.workingCopy.buffer.getText();
		const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), source = model.buffer.getText(), version = model.version;
		const cycles = f.host.runtime.machine.scheduler.nowCycles, media = f.sources.currentBlua32Media;
		const open = t.mock.method(f.editor.navigation, 'openResource'); f.panel.setFocused(true); f.key(code, modifier);
		assert.equal(open.mock.callCount(), 1); await open.mock.calls[0].result;
		const target = open.mock.calls[0].arguments[0], input = target.model.activeTab;
		assert.ok(target !== f.firstGroup && f.editor.editorParts.partForGroup(target) === f.firstPart && f.firstPart.groups.length === 2);
		assert.ok(input instanceof CodeEditorInput && input.resource === resource && input.workingCopy === model && target.panes.activePane?.input === input);
		assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.secondGroup.model.activeTab === f.secondInput);
		assert.equal(model.buffer.getText(), source); assert.equal(model.version, version); assert.equal(model.dirty, false);
		assert.equal(f.firstInput.workingCopy.buffer.getText(), original); assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
		assert.ok(f.sources.currentBlua32Media === media);
	});

for (const font of ['tiny', 'msx'] as const) test(`${font} Alt-primary opens beside the invoked host while ordinary primary follows existing editor affinity`, async t => {
	const f = fixture(t, font), { node, resource } = reveal(f);
	await f.editor.navigation.openResource(f.secondGroup, resource); const foreign = f.secondGroup.model.activeTab;
	f.first.focus(); f.panel.setFocused(true); const open = t.mock.method(f.editor.navigation, 'openResource');
	click(f, node, KeyModifier.none); assert.equal(open.mock.callCount(), 1); await open.mock.calls[0].result;
	assert.ok(open.mock.calls[0].arguments[0] === f.secondGroup && f.secondGroup.model.activeTab === foreign); assert.equal(f.firstPart.groups.length, 1);
	f.first.focus(); f.panel.setFocused(true); click(f, reveal(f).node, KeyModifier.alt);
	assert.equal(open.mock.callCount(), 2); await open.mock.calls[1].result;
	const side = open.mock.calls[1].arguments[0];
	assert.ok(side !== f.firstGroup && f.editor.editorParts.partForGroup(side) === f.firstPart && side.model.activeTab instanceof CodeEditorInput);
	assert.ok(side.model.activeTab.resource === resource && f.secondGroup.model.activeTab === foreign); assert.equal(f.firstPart.groups.length, 2);
});

for (const font of ['tiny', 'msx'] as const) test(`${font} side keyboard is disabled on folders and Alt disclosure never creates an editor group`, t => {
	const f = fixture(t, font), { node } = reveal(f), directory = node.parent!;
	f.panel.setSelectionIndex(f.panel.files.tree.rows.indexOf(directory)); f.panel.setFocused(true);
	const open = t.mock.method(f.editor.navigation, 'openResource'), collapsed = directory.collapsed;
	assert.equal(f.panel.focusTarget.getCommand('resources.openToSide')!.isEnabled(), false);
	f.key('Enter', KeyModifier.ctrl); f.key('NumpadEnter', KeyModifier.meta);
	assert.equal(directory.collapsed, collapsed); assert.equal(open.mock.callCount(), 0); assert.equal(f.firstPart.groups.length, 1);
	click(f, directory, KeyModifier.alt, true); assert.equal(directory.collapsed, !collapsed);
	assert.equal(open.mock.callCount(), 0); assert.equal(f.firstPart.groups.length, 1); assert.ok(inputFocus.target === f.panel.focusTarget);
});

for (const font of ['tiny', 'msx'] as const) test(`${font} an expandable file's Alt disclosure is distinct from its Alt body opening`, async t => {
	const f = fixture(t, font, [['cartlib/world/scene_library.lua', 'return {}'], ['definitions.lua',
		"local scenes=require('cartlib/world/scene_library')\nscenes.register('one', {objects={}})\n"]]);
	const { node } = reveal(f, 'definitions.lua'), open = t.mock.method(f.editor.navigation, 'openResource');
	assert.equal(node.expandable, true); const collapsed = node.collapsed;
	click(f, node, KeyModifier.alt, true); assert.equal(node.collapsed, !collapsed); assert.equal(open.mock.callCount(), 0);
	assert.equal(f.firstPart.groups.length, 1); click(f, node, KeyModifier.alt);
	assert.equal(open.mock.callCount(), 1); await open.mock.calls[0].result; assert.equal(f.firstPart.groups.length, 2);
});

for (const font of ['tiny', 'msx'] as const) test(`${font} side declaration activation opens its real Scene contribution, never inferred Source`, t => {
	const f = fixture(t, font, [['cartlib/world/scene_library.lua', 'return {}'], ['definitions.lua',
		"local scenes=require('cartlib/world/scene_library')\nscenes.register('one', {objects={}})\n"]]);
	const { node: file } = reveal(f, 'definitions.lua'); f.panel.toggleFileDisclosure(file); f.update();
	const node = file.children[0]; assert.ok(node !== undefined && node.element.kind === 'definition');
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, node.element.content.ownerResource), source = model.buffer.getText(), version = model.version;
	click(f, node, KeyModifier.alt);
	const target = f.firstPart.groups.find(group => group !== f.firstGroup)!;
	assert.ok(target !== undefined && target.model.activeTab?.kind === 'scene_editor' && target.model.activeTab.workingCopy === model);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput && target.panes.activePane?.input === target.model.activeTab);
	assert.equal(model.buffer.getText(), source); assert.equal(model.version, version); assert.equal(model.dirty, false);
});

test('the scoped side shortcut is not reserved while a real game viewport owns input', t => {
	const f = fixture(t); f.panel.hide(); const game = new GameViewInput(); f.firstGroup.openEditor(game); f.firstGroup.focus(); f.update(); f.key('Tab');
	const guest = inputFocus.target; assert.ok(guest?.guestInput !== undefined && f.editor.guestInputRecipient === f.host.input);
	const open = t.mock.method(f.editor.navigation, 'openResource');
	for (const code of ['Enter', 'NumpadEnter']) {
		const key = new KeyInputEvent(code, KeyModifier.ctrl); f.editor.dispatchKey(key);
		f.editor.dispatchKey(new KeyInputEvent(code, KeyModifier.ctrl, false, false));
		assert.equal(key.consumed, false);
	}
	assert.equal(open.mock.callCount(), 0); assert.equal(f.firstPart.groups.length, 1);
	assert.ok(inputFocus.target === guest && f.editor.guestInputRecipient === f.host.input);
});

test('side publication keeps its captured file even if a callback selects another Files row', async t => {
	const f = fixture(t), { resource } = reveal(f), open = t.mock.method(f.editor.navigation, 'openResource'); f.panel.setFocused(true);
	const unbind = f.firstPart.onDidChangeGroups(() => { unbind(); reveal(f, 'folder/other.lua'); }); t.after(unbind);
	f.key('Enter', KeyModifier.ctrl); assert.equal(open.mock.callCount(), 1); await open.mock.calls[0].result;
	const input = open.mock.calls[0].arguments[0].model.activeTab; assert.ok(input instanceof CodeEditorInput && input.resource === resource);
});

test('side publication cannot use a catalog resource replaced under the same path', t => {
	const f = fixture(t), { resource } = reveal(f), open = t.mock.method(f.editor.navigation, 'openResource'); f.panel.setFocused(true);
	const unbind = f.firstPart.onDidChangeGroups(() => {
		unbind(); const registry = f.sources.catalog.getContext(resource.contextId).luaSources, record = registry.path2lua[resource.path];
		registry.records.splice(registry.records.indexOf(record), 1); delete registry.path2lua[resource.path]; delete registry.module2lua[record.module_path];
		f.sources.catalog.rebuildResources();
	}); t.after(unbind);
	f.key('Enter', KeyModifier.ctrl); assert.equal(open.mock.callCount(), 0); assert.equal(f.firstPart.groups.length, 2);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput);
});

test('side publication does not borrow a newer foreground interaction', t => {
	const f = fixture(t); reveal(f); const open = t.mock.method(f.editor.navigation, 'openResource'); f.panel.setFocused(true);
	const unbind = f.firstPart.onDidChangeGroups(() => { unbind(); f.second.focus(); }); t.after(unbind);
	f.key('Enter', KeyModifier.ctrl); assert.equal(open.mock.callCount(), 0);
	assert.ok(inputFocus.target === f.second.commandTarget && f.editor.editorParts.activeGroup === f.secondGroup);
});

test('direct side opening rejects an actual invalid focused draft before creating topology', t => {
	const f = fixture(t); reveal(f);
	const field = new ValueInput(f.first.commandTarget, INTEGER_INPUT_FORMAT, () => {}); t.after(() => field.dispose());
	field.setValue(1); field.layout(f.firstGroup.panes.contentBounds); field.field.focusTarget.focus(); setFieldText(field.field, '-', true);
	f.panel.openSelected('side'); assert.equal(f.firstPart.groups.length, 1); assert.equal(field.pending, true);
	assert.ok(inputFocus.target === field.field.focusTarget && f.firstGroup.panes.activePane?.input === f.firstInput);
});

test('direct opening cannot keep its old subject when draft acceptance retires the resource catalog entry', t => {
	const f = fixture(t), { resource } = reveal(f), open = t.mock.method(f.editor.navigation, 'openResource'); let committed = false;
	const field = new ValueInput(f.first.commandTarget, INTEGER_INPUT_FORMAT, () => {
		committed = true; const registry = f.sources.catalog.getContext(resource.contextId).luaSources, record = registry.path2lua[resource.path];
		registry.records.splice(registry.records.indexOf(record), 1); delete registry.path2lua[resource.path]; delete registry.module2lua[record.module_path];
		f.sources.catalog.rebuildResources();
	}); t.after(() => field.dispose());
	field.setValue(1); field.layout(f.firstGroup.panes.contentBounds); field.field.focusTarget.focus(); setFieldText(field.field, '2', true);
	f.panel.openSelected(); assert.equal(committed, true); assert.equal(open.mock.callCount(), 0);
	assert.ok(inputFocus.target === field.field.focusTarget && f.firstGroup.panes.activePane?.input === f.firstInput);
});

test('a physical Files hit cannot become another row when outgoing draft acceptance removes the clicked resource', t => {
	const f = fixture(t), { node, resource } = reveal(f), open = t.mock.method(f.editor.navigation, 'openResource'); let committed = false;
	const field = new ValueInput(f.first.commandTarget, INTEGER_INPUT_FORMAT, () => {
		committed = true; const registry = f.sources.catalog.getContext(resource.contextId).luaSources, record = registry.path2lua[resource.path];
		registry.records.splice(registry.records.indexOf(record), 1); delete registry.path2lua[resource.path]; delete registry.module2lua[record.module_path];
		f.sources.catalog.rebuildResources(); f.update();
	}); t.after(() => field.dispose());
	field.setValue(1); field.layout(f.firstGroup.panes.contentBounds); field.field.focusTarget.focus(); setFieldText(field.field, '2', true);
	click(f, node, KeyModifier.alt);
	assert.equal(committed, true); assert.equal(open.mock.callCount(), 0); assert.equal(f.firstPart.groups.length, 1);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.secondGroup.model.activeTab === f.secondInput);
});

test('same-path catalog replacement publishes a retained Files row\'s changed semantic subject before opening continues', t => {
	const f = fixture(t), { node, resource } = reveal(f), open = t.mock.method(f.editor.navigation, 'openResource'); f.panel.setFocused(true);
	const revision = f.panel.files.revision; let replaced = false;
	const unbind = f.firstPart.onDidChangeGroups(() => {
		unbind(); const registry = f.sources.catalog.getContext(resource.contextId).luaSources, record = registry.path2lua[resource.path];
		registry.records.splice(registry.records.indexOf(record), 1); delete registry.path2lua[resource.path]; delete registry.module2lua[record.module_path];
		f.sources.catalog.rebuildResources();
		registerLuaSourceRecord(registry, { ...record, update_timestamp: record.update_timestamp + 1 });
		f.sources.catalog.rebuildResources(); f.panel.refresh();
		replaced = node.element.kind === 'file' && node.element.resource !== resource;
	}); t.after(unbind);
	f.key('Enter', KeyModifier.ctrl);
	assert.equal(replaced, true); assert.ok(f.panel.files.revision > revision, 'resource replacement publishes even when its row text and location are unchanged');
	assert.equal(open.mock.callCount(), 0); assert.equal(f.firstPart.groups.length, 2);
	assert.ok(f.firstGroup.model.activeTab === f.firstInput);
});

test('side declaration opening accepts a transient returning to its own Source parent after draft publication', t => {
	const f = fixture(t, 'tiny', [['cartlib/world/scene_library.lua', 'return {}'], ['definitions.lua',
		"local scenes=require('cartlib/world/scene_library')\nscenes.register('one', {objects={}})\n"]]);
	const { node: file } = reveal(f, 'definitions.lua'); f.panel.toggleFileDisclosure(file); f.update();
	const node = file.children[0]; assert.ok(node !== undefined && node.element.kind === 'definition');
	const entry = node.element.content, model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, entry.ownerResource);
	f.panel.setSelectionIndex(f.panel.files.tree.rows.indexOf(node));
	const field = new ValueInput(f.first.commandTarget, INTEGER_INPUT_FORMAT, () => {
		field.field.focusTarget.release(); model.pushEditOperations([{ offset: 0, deleteLength: 0, text: '-- accepted transient\n' }]);
	}); t.after(() => field.dispose());
	field.setValue(1); field.layout(f.firstGroup.panes.contentBounds); field.field.focusTarget.focus(); setFieldText(field.field, '2', true);
	f.panel.openSelected('side'); const side = f.firstPart.groups.find(group => group !== f.firstGroup)!;
	assert.equal(field.pending, false);
	assert.ok(side !== undefined && side.model.activeTab?.kind === 'scene_editor' && side.model.activeTab.workingCopy === model);
	assert.ok(side.panes.activePane?.input === side.model.activeTab && f.firstGroup.model.activeTab === f.firstInput);
});

for (const modifiers of [KeyModifier.none, KeyModifier.alt]) test(`${modifiers === KeyModifier.alt ? 'side' : 'ordinary'} Files hit is revoked when outgoing blur replaces its same-path resource on the retained row`, t => {
	const f = fixture(t), { node, resource } = reveal(f), open = t.mock.method(f.editor.navigation, 'openResource');
	const revision = f.panel.files.revision; let committed = false;
	const field = new ValueInput(f.first.commandTarget, INTEGER_INPUT_FORMAT, () => {
		committed = true; const registry = f.sources.catalog.getContext(resource.contextId).luaSources, record = registry.path2lua[resource.path];
		registry.records.splice(registry.records.indexOf(record), 1); delete registry.path2lua[resource.path]; delete registry.module2lua[record.module_path];
		f.sources.catalog.rebuildResources(); registerLuaSourceRecord(registry, { ...record, update_timestamp: record.update_timestamp + 1 });
		f.sources.catalog.rebuildResources(); f.panel.refresh();
	}); t.after(() => field.dispose());
	field.setValue(1); field.layout(f.firstGroup.panes.contentBounds); field.field.focusTarget.focus(); setFieldText(field.field, '2', true);
	click(f, node, modifiers);
	assert.equal(committed, true); assert.ok(node.element.kind === 'file' && node.element.resource !== resource);
	assert.equal(open.mock.callCount(), 0); assert.equal(f.firstPart.groups.length, 1);
	assert.ok(f.panel.files.revision > revision, 'a changed semantic resource must publish even when its retained row has unchanged text and location');
	assert.ok(f.firstGroup.model.activeTab === f.firstInput && f.secondGroup.model.activeTab === f.secondInput);
});
