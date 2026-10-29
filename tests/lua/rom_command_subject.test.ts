import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { InputFocusScope, InputFocusTarget, inputFocus } from '../../ide/input/focus';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { RomInspectorInput } from '../../ide/workbench/contrib/rom_inspector/editor_input';
import { RomInspectorPane } from '../../ide/workbench/contrib/rom_inspector/editor_pane';
import type { CommandQuickPickItem } from '../../ide/workbench/contrib/commands/quick_pick_provider';
import { HomeInput } from '../../ide/workbench/contrib/home/editor_input';
import { findEditorGroup } from '../../ide/workbench/services/editor/editor_group';
import { createActualSourcePanes } from '../helpers/source_panes';
import { SCENE_VIEWPORT_SOURCE } from '../fixtures/studio/scene_viewport';
import { createRomInspectorImageSnapshot } from '../fixtures/studio/rom_inspector';

const MODES = ['assets', 'structure', 'code'] as const;

function fixture(t: TestContext, image = false) {
	const f = createActualSourcePanes(t, false, [['scene.lua', SCENE_VIEWPORT_SOURCE], ['cartlib/world/scene_library.lua', 'return {}']]);
	const rom = f.sources.systemRom;
	const input = new RomInspectorInput(image ? createRomInspectorImageSnapshot(-1, f.sources.systemContextId, { bounds: { left: 0, top: 0, right: 2, bottom: 2 } }) : {
		domain: -1, sourceContextId: f.sources.systemContextId, label: 'Synthetic compiled system',
		rom: rom.bytes, header: rom.header, assets: rom.index.entries,
	});
	f.firstGroup.openEditor(input); f.update();
	const pane = f.firstGroup.panes.activePane; assert.ok(pane instanceof RomInspectorPane);
	const list = pane.commandTarget, filter = list.previous;
	assert.ok(filter instanceof InputFocusTarget);
	const toolbar = filter.previous; assert.ok(toolbar instanceof InputFocusTarget);
	return { ...f, input, pane, targets: { pane: toolbar.commandContext, list, filter, toolbar } };
}

for (const control of ['pane', 'list', 'filter', 'toolbar'] as const)
	for (const mode of MODES)
		test(`ROM ${control} owns ${mode} checked state through the same native capability as execution`, t => {
			const f = fixture(t), target = f.targets[control], command = `romInspector.${mode}` as const;
			assert.equal(target.focus(), true);
			assert.equal(f.editor.commands.isEnabled(command, target), true);
			f.editor.commands.execute(command, target); f.update();
			assert.equal(f.input.model.mode, mode);
			for (const candidate of MODES) assert.equal(f.editor.commands.isActive(`romInspector.${candidate}`, target), candidate === mode);
			assert.equal(target.getCommand(command)!.isChecked?.(), true);
		});

for (const control of ['list', 'filter', 'toolbar'] as const)
	test(`ROM Palette from ${control} retains the actual capability and its mode state`, async t => {
		const f = fixture(t), target = f.targets[control]; assert.equal(target.focus(), true);
		f.editor.commands.execute('commandPalette', target);
		const picker = f.editor.quickInput;
		const index = picker.model.list.rows.findIndex(row => (row.item as CommandQuickPickItem).command === 'romInspector.structure');
		assert.ok(index >= 0);
		const item = picker.model.list.rows[index].item as CommandQuickPickItem & { target: InputFocusTarget };
		assert.ok(item.target === target); picker.model.list.selectionIndex = index;
		await picker.accept(); f.update();
		assert.equal(picker.visible, false); assert.equal(f.input.model.mode, 'structure');
		assert.equal(f.editor.commands.isActive('romInspector.structure', item.target), true);
		assert.equal(f.editor.commands.isActive('romInspector.assets', item.target), false);
	});

for (const command of ['romInspector.hold', 'romInspector.collision'] as const)
	test(`ROM reader publishes ${command} checked state from its displayed native subject`, async t => {
		const f = fixture(t, true);
		f.input.model.select(f.input.model.rows.findIndex(row => row.asset?.type === 'image')); f.update();
		f.editor.commands.execute('romInspector.inspect', f.pane.commandTarget); f.update();
		const client = inputFocus.admittedTarget; assert.ok(client !== null);
		assert.equal(f.input.reader.hasCollision, true);
		const title = client.parent!.parent!, toolbar = title.next; assert.ok(toolbar instanceof InputFocusTarget);
		const targets = command === 'romInspector.hold' ? [client, title, toolbar] : [client, title];
		for (const target of targets) {
			assert.equal(f.editor.commands.isEnabled(command, target), true);
			assert.equal(f.editor.commands.isActive(command, target), false);
		}
		f.editor.commands.execute(command, client); f.update();
		assert.equal(command === 'romInspector.hold' ? f.input.readerHeld : f.input.reader.showCollision, true);
		for (const target of targets) {
			assert.equal(f.editor.commands.isActive(command, target), true);
			assert.equal(target.getCommand(command)!.isChecked?.(), true);
		}
		assert.equal(client.focus(), true); f.editor.commands.execute('commandPalette', client);
		const picker = f.editor.quickInput, index = picker.model.list.rows.findIndex(row => (row.item as CommandQuickPickItem).command === command);
		assert.ok(index >= 0);
		assert.ok((picker.model.list.rows[index].item as CommandQuickPickItem & { target: InputFocusTarget }).target === client);
		picker.model.list.selectionIndex = index; await picker.accept(); f.update();
		assert.equal(command === 'romInspector.hold' ? f.input.readerHeld : f.input.reader.showCollision, false);
		for (const target of targets) assert.equal(f.editor.commands.isActive(command, target), false);
	});

test('unrelated Main cannot inherit checked ROM state from a background document', async t => {
	const f = fixture(t, true);
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), document = f.ide.sceneSources.get(model);
	assert.equal(await f.editor.openSceneInMain(model,
		{ document, sourceVersion: model.version, scene: document.scenes[0] }, f.pane.commandTarget), true);
	const main = f.editor.mainWorkspace.primary!;
	f.input.model.select(f.input.model.rows.findIndex(row => row.asset?.type === 'image')); f.update();
	f.editor.commands.execute('romInspector.inspect', f.pane.commandTarget); f.update();
	const reader = inputFocus.admittedTarget!;
	f.editor.commands.execute('romInspector.hold', reader); f.editor.commands.execute('romInspector.collision', reader);
	f.editor.commands.execute('romInspector.structure', f.pane.commandTarget); f.update();
	assert.equal(f.input.model.mode, 'structure'); assert.equal(f.input.readerHeld, true); assert.equal(f.input.reader.showCollision, true);
	f.editor.editorParts.activate(f.firstPart);
	assert.equal(findEditorGroup(main.commandTarget), undefined); assert.equal(f.editor.editorParts.partForTarget(main.commandTarget), undefined);
	assert.ok(f.editor.editorParts.activeGroup === f.firstGroup && f.firstGroup.model.activeTab === f.input);
	for (const command of ['romInspector.structure', 'romInspector.hold', 'romInspector.collision'] as const) {
		assert.equal(main.commandTarget.resolveCommand(command), undefined);
		assert.equal(f.editor.commands.isEnabled(command, main.commandTarget), false);
		assert.equal(f.editor.commands.isActive(command, main.commandTarget), false);
	}
});

test('focused Main primary does not acquire a ROM capability from its own active document group', async t => {
	const f = fixture(t), resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), document = f.ide.sceneSources.get(model);
	assert.equal(await f.editor.openSceneInMain(model,
		{ document, sourceVersion: model.version, scene: document.scenes[0] }, f.pane.commandTarget), true);
	const main = f.editor.mainWorkspace.primary!, group = f.editor.editorParts.main.activeGroup;
	const input = new RomInspectorInput(f.input.snapshot); group.openEditor(input, { pinned: true }); f.update();
	const pane = group.panes.activePane; assert.ok(pane instanceof RomInspectorPane);
	f.editor.commands.execute('romInspector.structure', pane.commandTarget); f.update(); main.focus();
	const target = inputFocus.admittedTarget; assert.ok(target !== null && main.scope.contains(target.scope));
	assert.ok(f.editor.editorParts.activeGroup === group && group.model.activeTab === input);
	assert.equal(input.model.mode, 'structure'); assert.equal(target.resolveCommand('romInspector.structure'), undefined);
	assert.equal(f.editor.commands.isEnabled('romInspector.structure', target), false);
	assert.equal(f.editor.commands.isActive('romInspector.structure', target), false);
});

test('an unowned ordinary target cannot infer checked ROM capability from its containing group', t => {
	const f = fixture(t); f.editor.commands.execute('romInspector.structure', f.pane.commandTarget); f.update();
	const target = inputFocus.createTarget(null, new InputFocusScope(f.firstGroup.focusScope.surfaceScope, f.firstGroup.focusScope));
	assert.ok(findEditorGroup(target) === f.firstGroup && f.firstGroup.model.activeTab === f.input);
	assert.equal(target.resolveCommand('romInspector.structure'), undefined);
	assert.equal(f.editor.commands.isEnabled('romInspector.structure', target), false);
	assert.equal(f.editor.commands.isActive('romInspector.structure', target), false);
});

test('a disabled local ROM capability shadows an active declared owner in direct and Palette routing', t => {
	const f = fixture(t), owner = f.pane.commandTarget;
	f.editor.commands.execute('romInspector.structure', owner); f.update();
	const field = inputFocus.createTarget(owner, new InputFocusScope(owner.scope.surfaceScope, owner.scope)); field.commandContext = owner;
	field.registerCommand('romInspector.structure', { isEnabled: () => false, isChecked: () => false,
		run: () => assert.fail('the disabled local command cannot fall through to its owner') });
	assert.equal(f.editor.commands.isEnabled('romInspector.structure', field), false);
	assert.equal(f.editor.commands.isActive('romInspector.structure', field), false);
	f.editor.commands.execute('romInspector.structure', field);
	assert.equal(f.input.model.mode, 'structure');
	f.editor.commands.execute('commandPalette', field);
	assert.equal(f.editor.quickInput.model.items.some(item => (item as CommandQuickPickItem).command === 'romInspector.structure'), false);
	f.editor.quickInput.hide();
});

test('a retained ROM catalog input does not keep checked capability after its pane detaches', t => {
	const f = fixture(t), target = f.pane.commandTarget;
	f.editor.commands.execute('romInspector.structure', target); f.update();
	assert.equal(f.editor.commands.isActive('romInspector.structure', target), true);
	f.firstGroup.model.pin(f.input); f.firstGroup.openEditor(new HomeInput(null), { pinned: true }); f.update();
	assert.equal(f.firstGroup.model.contains(f.input), true); assert.equal(f.input.model.mode, 'structure');
	for (const mode of MODES) {
		const command = `romInspector.${mode}` as const, retained = target.getCommand(command)!;
		assert.equal(retained.isEnabled(), false); assert.equal(retained.isChecked?.(), false);
		assert.equal(f.editor.commands.isEnabled(command, target), false); assert.equal(f.editor.commands.isActive(command, target), false);
		retained.run();
	}
	assert.equal(f.input.model.mode, 'structure');
});

for (const withdrawal of ['hide reader', 'catalog replaced', 'group retired'] as const)
	test(`${withdrawal} withdraws reader capabilities without changing captured Hold and Collision state`, async t => {
		const f = fixture(t, true);
		f.input.model.select(f.input.model.rows.findIndex(row => row.asset?.type === 'image')); f.update();
		f.editor.commands.execute('romInspector.inspect', f.pane.commandTarget); f.update();
		const target = inputFocus.admittedTarget!;
		f.editor.commands.execute('romInspector.hold', target); f.editor.commands.execute('romInspector.collision', target); f.update();
		assert.equal(f.input.readerHeld, true); assert.equal(f.input.reader.showCollision, true);
		if (withdrawal === 'hide reader') f.editor.commands.execute('window.hide', target);
		else if (withdrawal === 'catalog replaced') {
			f.firstGroup.model.pin(f.input); f.firstGroup.openEditor(new HomeInput(null), { pinned: true });
			assert.equal(f.firstGroup.model.contains(f.input), true);
			assert.equal(f.input.readerWindow.open, true, 'retained reopen intent is not a physically admitted reader');
		} else assert.equal(await f.editor.editorParts.close(f.firstPart), true);
		f.update();
		for (const command of ['romInspector.hold', 'romInspector.collision'] as const) {
			const retained = target.getCommand(command)!;
			assert.equal(retained.isEnabled(), false); assert.equal(retained.isChecked?.(), false);
			assert.equal(f.editor.commands.isEnabled(command, target), false); assert.equal(f.editor.commands.isActive(command, target), false);
			retained.run();
		}
		assert.equal(f.input.readerHeld, true); assert.equal(f.input.reader.showCollision, true);
	});
