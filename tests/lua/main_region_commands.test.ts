import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { KeyModifier } from '../../hosts/common/input/text';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { inputFocus, type InputFocusTarget } from '../../ide/input/focus';
import { CodeEditorInput } from '../../ide/workbench/contrib/code_editor/editor_input';
import { ScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/primary_client';
import { UnavailableScenePrimaryClient } from '../../ide/workbench/contrib/scene_editor/unavailable_primary';
import { selectSceneOutlineRow } from '../../ide/workbench/contrib/scene_editor/outline';
import { buildCommandQuickPickItems } from '../../ide/workbench/contrib/commands/quick_access';
import { resolveLuaTextFileModel } from '../../ide/workbench/services/working_copy/text_file_model';
import { WORKBENCH_MENUS } from '../../ide/workbench/ui/menu/registry';
import { createActualSourcePanes } from '../helpers/source_panes';

const SOURCE = "local scenes=require('cartlib/world/scene_library'); scenes.register('room',{objects={{member_id='unit',definition_id='actor',options={pos={x=1,y=2,z=3}}}}})";

async function fixture(t: TestContext, unavailable = false) {
	const f = createActualSourcePanes(t, false, [['scene.lua', SOURCE], ['cartlib/world/scene_library.lua', 'return {}']]);
	f.editor.setFontVariant('tiny'); f.first.focus();
	const main = f.editor.mainWorkspace;
	const resource = f.sources.catalog.resolveResource({ contextId: f.sources.systemContextId, path: 'scene.lua' })!;
	const model = resolveLuaTextFileModel(editorTextModelService, f.sources.catalog, resource), document = f.ide.sceneSources.get(model);
	assert.equal(await f.editor.openSceneInMain(() => ({ model, subject: { document, sourceVersion: model.version, scene: document.scenes[0] } }), inputFocus.target!), true);
	f.update();
	if (unavailable) {
		const saved = main.serialize(), request = main.beginRestore();
		model.pushEditOperations([{ offset: 0, deleteLength: SOURCE.length, text: 'return {}' }]);
		try { assert.equal(await request.restore(saved, (...args) => f.editor.restorePrimaryClient(...args)), true); }
		finally { request.dispose(); }
		f.update();
	}
	const primary = main.primary!;
	assert.ok(unavailable ? primary instanceof UnavailableScenePrimaryClient : primary instanceof ScenePrimaryClient);
	if (primary instanceof ScenePrimaryClient) { assert.equal(selectSceneOutlineRow(primary.view.hierarchy, 1), true); f.update(); }
	return { ...f, main, primary, model };
}

test('Window contributes both explicit region placements while unbound Main cannot acquire an authored subject', t => {
	const f = createActualSourcePanes(t), main = f.editor.mainWorkspace;
	for (const command of ['workspace.hierarchy.float', 'workspace.hierarchy.dock', 'workspace.details.float', 'workspace.details.dock'] as const) {
		assert.ok(WORKBENCH_MENUS['menubar.window'].some(item => item.type === 'command' && item.command === command));
		assert.equal(f.editor.commands.isEnabled(command, f.first.commandTarget), false);
		f.editor.commands.execute(command, f.first.commandTarget);
	}
	assert.equal(main.primary, undefined);
	assert.equal(main.regions.hierarchy.placement, 'dockedMain'); assert.equal(main.regions.details.placement, 'dockedMain');
	assert.equal(main.regions.hierarchy.window.isOpen, false); assert.equal(main.regions.details.window.isOpen, false);
});

for (const region of ['hierarchy', 'details'] as const) for (const unavailable of [false, true])
	test(`${region} ${unavailable ? 'unavailable' : 'authored'} region commands and native window menu share the same retained subject`, async t => {
		const f = await fixture(t, unavailable), view = f.primary[region], part = f.main.regions[region], commands = f.editor.commands;
		const floating = region === 'hierarchy' ? 'workspace.hierarchy.float' : 'workspace.details.float';
		const docking = region === 'hierarchy' ? 'workspace.hierarchy.dock' : 'workspace.details.dock';
		const source = f.model.buffer.getText(), documents = [...f.editor.editorParts.documents];
		f.main.focusPrimary(region); const target = inputFocus.admittedTarget!;
		assert.equal(commands.isEnabled(floating, target), true); assert.equal(commands.isEnabled(docking, target), false);
		view.contextActions.refresh();
		assert.ok(view.contextActions.visibleItems.some(item => item.type === 'command' && item.command === floating));
		assert.ok(view.contextActions.visibleItems.some(item => item.type === 'command' && item.command === 'editor.source'));
		commands.execute(floating, target); f.update();
		assert.equal(part.placement, 'floatingWindow'); assert.equal(part.displayed, true);
		assert.ok(inputFocus.admittedTarget === target && f.main.primary === f.primary);
		assert.equal(commands.isEnabled(floating, target), false); assert.equal(commands.isEnabled(docking, target), true);
		commands.execute('window.systemMenu', target); f.update();
		const menu = f.editor.contextMenu;
		assert.equal(menu.visible, true);
		assert.ok(menu.model.rows.some(row => row.command === 'editor.source' && row.enabled));
		assert.ok(menu.model.rows.some(row => row.command === 'window.hide' && row.enabled));
		menu.model.selectedIndex = menu.model.rows.findIndex(row => row.command === docking && row.enabled);
		assert.ok(menu.model.selectedIndex >= 0); f.key('Enter');
		assert.equal(menu.visible, false); assert.equal(part.placement, 'dockedMain'); assert.equal(part.window.isOpen, false);
		assert.ok(f.main.primary === f.primary && f.primary[region] === view);
		assert.ok(f.editor.editorParts.documents.length === documents.length
			&& documents.every((part, index) => f.editor.editorParts.documents[index] === part));
		assert.equal(f.model.buffer.getText(), source);
	});

for (const region of ['hierarchy', 'details'] as const)
	test(`the ${region} toggle's checked state tracks actual display and restores its minimized shell instead of hiding it`, async t => {
		const f = await fixture(t), commands = f.editor.commands, part = f.main.regions[region];
		const floating = region === 'hierarchy' ? 'workspace.hierarchy.float' : 'workspace.details.float';
		const toggle = region === 'hierarchy' ? 'workspace.hierarchy.toggle' : 'workspace.details.toggle';
		f.main.focusPrimary(region); commands.execute(floating, inputFocus.admittedTarget); f.update();
		assert.equal(commands.isActive(toggle, inputFocus.admittedTarget), true);
		commands.execute('window.minimize', inputFocus.admittedTarget); f.update();
		assert.equal(part.window.model.minimized, true); assert.equal(f.main.regionLayout[`${region}Visible`], true);
		assert.equal(commands.isActive(toggle, inputFocus.admittedTarget), false);
		commands.execute(toggle, inputFocus.admittedTarget); f.update();
		assert.equal(part.window.model.minimized, false); assert.equal(part.displayed, true);
		assert.equal(commands.isActive(toggle, inputFocus.admittedTarget), true);
		assert.ok(f.main.primary === f.primary); assert.equal(f.model.buffer.getText(), SOURCE);
	});

for (const draft of ['31', '('])
	test(`application float and dock retain the concrete ${draft === '31' ? 'valid' : 'invalid'} Details draft without committing source`, async t => {
		const f = await fixture(t); assert.ok(f.primary instanceof ScenePrimaryClient);
		const field = f.primary.details.control.controls[0];
		assert.equal(field.field.focusTarget.focus(), true); setFieldText(field.field, draft, true);
		for (const command of ['workspace.details.float', 'workspace.details.dock'] as const) {
			f.editor.commands.execute(command, field.field.focusTarget); f.update();
			assert.ok(inputFocus.admittedTarget === field.field.focusTarget);
			assert.equal(field.pending, true); assert.equal(field.field.text, draft);
			assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
		}
		field.cancel();
	});

test('Palette physical Window actions retain the restored region body rather than its shared Main semantic context', async t => {
	const f = await fixture(t), commands = f.editor.commands, panel = f.primary.details, part = f.main.regions.details;
	const actions = ['window.minimize', 'window.maximize', 'window.snapLeft', 'window.snapRight', 'window.restore', 'window.hide'] as const;
	const seen = new Set<string>(), documents = [...f.editor.editorParts.documents];
	f.main.setRegionPlacement('details', 'floatingWindow'); f.main.focusPrimary('details'); f.update();
	const body = inputFocus.admittedTarget!;
	assert.ok(body !== body.commandContext && body.commandContext === f.primary.commandTarget);
	for (const maximized of [false, true]) {
		if (maximized) { commands.execute('window.maximize', body); f.update(); }
		assert.equal(commands.isActive('window.maximize', body), maximized);
		const picks = buildCommandQuickPickItems(commands, body, f.primary.commandTarget);
		for (const command of actions) {
			const item = picks.find(item => item.command === command);
			assert.equal(item !== undefined, commands.isEnabled(command, body));
			if (item !== undefined) { assert.ok(item.target === body); seen.add(command); }
		}
	}
	assert.equal(seen.size, actions.length);
	commands.execute('window.minimize', body); f.update();
	commands.execute('window.restoreMinimized', inputFocus.admittedTarget);
	const picker = f.editor.quickInput;
	picker.model.list.selectionIndex = picker.model.list.rows.findIndex(row => 'window' in row.item && row.item.window === part.window);
	assert.ok(picker.model.list.selectionIndex >= 0); f.key('Enter');
	assert.ok(inputFocus.admittedTarget === body); assert.equal(part.displayed, true);
	f.key('KeyP', KeyModifier.ctrl | KeyModifier.shift);
	assert.equal(picker.visible, true);
	const close = (picker.model.items as ReturnType<typeof buildCommandQuickPickItems>).find(item => item.command === 'window.hide');
	assert.ok(close !== undefined && close.target === body);
	const field = f.editor.textTarget!;
	assert.equal(field.replaceText(0, field.readText().text.length, 'window.hide'), true); f.update(); f.key('Enter');
	assert.equal(picker.visible, false); assert.equal(part.window.isOpen, false); assert.equal(panel.attached, false);
	assert.ok(f.main.primary === f.primary && f.primary.hierarchy.attached);
	assert.ok(f.editor.editorParts.documents.length === documents.length
		&& documents.every((part, index) => f.editor.editorParts.documents[index] === part));
	assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.canUndo, false);
});

for (const hide of [false, true])
	test(`Palette from native titlebar actions retains primary Source and ${hide ? 'revokes' : 'admits'} its asynchronous request after return`, async t => {
		const f = await fixture(t); assert.ok(f.primary instanceof ScenePrimaryClient);
		const part = f.main.regions.details, primary = f.primary, ready = Promise.withResolvers<void>();
		f.main.setRegionPlacement('details', 'floatingWindow'); f.main.focusPrimary('details'); f.update();
		const origin = part.window.actionFocusTarget;
		assert.equal(origin.focus(), true); assert.ok(origin.commandContext !== primary.commandTarget);
		const capture = primary.consumer.captureSourceLocation.bind(primary.consumer);
		let focusedAtRead: InputFocusTarget | null = null;
		t.mock.method(primary.consumer, 'captureSourceLocation', () => {
			const lease = capture();
			return { ...lease, readLocation: async () => { focusedAtRead = inputFocus.admittedTarget; await ready.promise; return lease.readLocation(); } };
		});
		const request = t.mock.method(f.editor.navigation, 'openSource'), opening = t.mock.method(f.editor.navigation, 'openResource');
		const selected = primary.consumer.selection, groups = [...f.editor.editorParts.groups];
		const tabs = groups.map(group => [...group.model.tabs]);
		f.key('KeyP', KeyModifier.ctrl | KeyModifier.shift);
		const picker = f.editor.quickInput;
		assert.equal(picker.visible, true); assert.ok(picker.invocationOrigin === origin);
		const picks = picker.model.items as ReturnType<typeof buildCommandQuickPickItems>;
		const source = picks.find(item => item.command === 'editor.source'), close = picks.find(item => item.command === 'window.hide');
		assert.ok(source !== undefined && source.target === primary.commandTarget);
		assert.ok(close !== undefined && close.target === origin);
		const field = f.editor.textTarget!;
		assert.equal(field.replaceText(0, field.readText().text.length, 'editor.source'), true); f.update(); f.key('Enter');
		assert.equal(picker.visible, false); assert.equal(request.mock.callCount(), 1); assert.equal(opening.mock.callCount(), 0);
		assert.ok(inputFocus.admittedTarget === origin && focusedAtRead === origin);
		if (hide) { assert.equal(f.main.setRegionVisible('details', false), true); f.update(); }
		const focused = inputFocus.admittedTarget;
		ready.resolve();
		const result = await request.mock.calls[0].result;
		if (hide) {
			assert.equal(result, undefined); assert.equal(opening.mock.callCount(), 0);
			assert.ok(inputFocus.admittedTarget === focused);
			assert.ok(f.editor.editorParts.groups.length === groups.length
				&& groups.every((group, index) => f.editor.editorParts.groups[index] === group));
			for (let index = 0; index < groups.length; index++) {
				assert.ok(groups[index].model.tabs.length === tabs[index].length
					&& tabs[index].every((input, tab) => groups[index].model.tabs[tab] === input));
			}
		} else {
			assert.ok(result !== undefined); assert.equal(opening.mock.callCount(), 1);
			const input = f.editor.editorParts.activeGroup.model.activeTab;
			assert.ok(input instanceof CodeEditorInput && input.workingCopy === f.model);
		}
		assert.ok(f.main.primary === primary && primary.consumer.selection === selected);
		assert.equal(f.model.buffer.getText(), SOURCE); assert.equal(f.model.dirty, false); assert.equal(f.model.canUndo, false);
	});
