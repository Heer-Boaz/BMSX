import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import type { EditorCommandRunner } from '../../ide/common/commands';
import { editorTextModelService } from '../../ide/editor/model/model_service';
import { configureFontVariant } from '../../ide/editor/ui/view/configuration';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { TextField } from '../../ide/editor/ui/inline/text_field_model';
import { inputFocus, type InputFocusTarget } from '../../ide/input/focus';
import { pointerCapture } from '../../ide/input/pointer/capture';
import { ContextMenuController } from '../../ide/workbench/services/context_menu/controller';
import { QuickInputController } from '../../ide/workbench/services/quick_input/controller';
import { buildCommandQuickPickItems, showCommandPalette } from '../../ide/workbench/contrib/commands/quick_access';
import { TextQuickPickProvider } from '../../ide/workbench/services/quick_input/text_provider';
import { resolveLuaCodeEditorInput } from '../../ide/workbench/ui/code_tab/io';
import type { EditorInput } from '../../ide/workbench/common/editor_inputs';
import { createTestEditorGroup } from '../helpers/editor_panes';
import { createScenarioTestSourceRecord, createScenarioTestSourceState } from '../helpers/scenario_sources';
import { TEST_CARTRIDGE_CONTEXT_IDS } from '../helpers/runtime_sources';

function fixture(t: TestContext) {
	configureFontVariant('tiny');
	editorViewState.viewportWidth = 384; editorViewState.viewportHeight = 288;
	const sources = createScenarioTestSourceState([
		createScenarioTestSourceRecord('original.lua', 1, 'return 1'),
		createScenarioTestSourceRecord('replacement.lua', 1, 'return 2'),
	]);
	const resource = sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'original.lua' })!;
	const nextResource = sources.catalog.resolveResource({ contextId: TEST_CARTRIDGE_CONTEXT_IDS[0], path: 'replacement.lua' })!;
	const originGroup = createTestEditorGroup(), siblingGroup = createTestEditorGroup();
	const original = resolveLuaCodeEditorInput(sources.catalog, resource);
	originGroup.openEditor(original);
	siblingGroup.openEditor(resolveLuaCodeEditorInput(sources.catalog, resource));
	originGroup.panes.activePane!.focus();
	const origin = inputFocus.target!;
	const executed: EditorInput[] = [];
	origin.registerCommand('aem.source', {
		isEnabled: () => true,
		run: () => { executed.push(originGroup.panes.activePane!.input); },
	});
	const commands: EditorCommandRunner = {
		isEnabled: (command, target) => target?.getCommand(command)?.isEnabled() === true,
		execute: (command, target) => { target!.getCommand(command)!.run(); },
	};
	const menu = new ContextMenuController(inputFocus, pointerCapture), picker = new QuickInputController(menu, undefined, undefined, { scope: inputFocus.workbenchScope, bounds: { left: 0, top: 0, right: editorViewState.viewportWidth, bottom: editorViewState.viewportHeight }, kind: 'workspace' });
	t.after(() => {
		picker.dispose(); menu.dispose(); originGroup.dispose(); siblingGroup.dispose();
		editorTextModelService.clear(); inputFocus.setTarget(null);
	});
	return { sources, nextResource, originGroup, siblingGroup, original, origin, executed, commands, menu, picker };
}

for (const transient of ['context menu', 'quick pick'] as const) {
	for (const changedGroup of ['origin', 'sibling'] as const) test(`${transient} acceptance ${changedGroup === 'origin' ? 'rejects a rebound origin' : 'survives a sibling rebind'} during return focus`, t => {
		const f = fixture(t);
		const group = changedGroup === 'origin' ? f.originGroup : f.siblingGroup;
		const oldPane = group.panes.activePane;
		const oldInput = group.model.activeTab!;
		const replacement = resolveLuaCodeEditorInput(f.sources.catalog, f.nextResource);
		const unbind = f.origin.onDidFocus(() => {
			unbind();
			group.openEditor(replacement);
		});
		t.after(unbind);
		if (transient === 'context menu') {
			f.menu.show(0, 0, [{ type: 'command', command: 'aem.source' }], f.commands,
				{ invocationOrigin: f.origin, commandTarget: f.origin, returnFocus: f.origin, selectFirst: true });
			f.menu.accept();
		} else {
			f.picker.pick('Source action', '', () => new TextQuickPickProvider([{ label: 'Source', description: '', detail: '' }]),
				() => f.commands.execute('aem.source', f.origin));
			f.picker.accept();
		}
		assert.equal(group.model.activeTab, replacement);
		assert.equal(group.panes.activePane, oldPane, 'the cached pane now represents a different input attachment');
		assert.ok(group.model.tabs.includes(oldInput), 'the old input remains retained but its attachment has ended');
		assert.deepEqual(f.executed, changedGroup === 'origin' ? [] : [f.original]);
		assert.equal(f.menu.visible, false); assert.equal(f.picker.visible, false);
	});
}

test('local keyboard commands do not inherit semantic context or focus-return capabilities', t => {
	const pane = inputFocus.createTarget(), field = inputFocus.createTarget(pane), returnParent = inputFocus.createTarget();
	let localUndo = 0, paneUndo = 0, source = 0, parent = 0;
	pane.registerCommand('undo', { isEnabled: () => true, run: () => { paneUndo++; } });
	pane.registerCommand('aem.source', { isEnabled: () => true, run: () => { source++; } });
	field.registerCommand('undo', { isEnabled: () => false, run: () => { localUndo++; } });
	returnParent.registerCommand('redo', { isEnabled: () => true, run: () => { parent++; } });
	const unbound = inputFocus.createTarget(returnParent);
	t.after(() => inputFocus.setTarget(null));
	assert.equal(field.getCommand('aem.source'), undefined, 'focus-return ancestry is not command authority');
	assert.equal(unbound.getCommand('redo'), undefined);
	field.commandContext = pane;
	assert.equal(field.getCommand('undo')!.isEnabled(), false, 'a disabled local action does not fall through to a different owner');
	assert.equal(field.getCommand('aem.source'), undefined, 'semantic context does not install pane keyboard capabilities');
	inputFocus.executeCommand('undo', field);
	inputFocus.executeCommand('aem.source', field);
	inputFocus.executeCommand('redo', unbound);
	assert.equal(localUndo, 0); assert.equal(paneUndo, 0);
	assert.equal(source, 0); assert.equal(parent, 0);
	field.unregisterCommand('undo');
	assert.equal(field.getCommand('undo'), undefined);
	inputFocus.executeCommand('undo', field);
	assert.equal(paneUndo, 0, 'an absent local keyboard action does not inherit semantic-context commands');
});

test('Palette captures the explicit Source subject while a disabled field Undo cannot borrow pane Undo', t => {
	const f = fixture(t), field = new TextField(f.origin), laterFocus = inputFocus.createTarget();
	let paneUndo = 0;
	f.origin.registerCommand('undo', { isEnabled: () => true, run: () => { paneUndo++; } });
	field.focusTarget.commandContext = f.origin;
	field.focusTarget.focus();
	assert.equal(field.focusTarget.getCommand('undo')!.isEnabled(), false);
	const executedTargets: Array<InputFocusTarget | null | undefined> = [];
	const commands = {
		isEnabled: f.commands.isEnabled,
		isActive: () => false,
		execute: (...args: Parameters<EditorCommandRunner['execute']>) => {
			executedTargets.push(args[1]);
			assert.equal(inputFocus.target, laterFocus, 'acceptance does not choose its subject from later focus');
			f.commands.execute(...args);
		},
	};
	showCommandPalette(f.picker, commands);
	const items = f.picker.model.items as ReturnType<typeof buildCommandQuickPickItems>;
	assert.equal(items.some(item => item.command === 'undo'), false, 'disabled local Undo excludes another owner\'s enabled Undo');
	const source = items.find(item => item.command === 'aem.source');
	assert.ok(source);
	assert.equal(source.target, f.origin);
	assert.equal(f.picker.invocationOrigin, field.focusTarget);
	f.picker.model.list.selectionIndex = f.picker.model.list.rows.findIndex(row => items[row.itemIndex].command === 'aem.source');
	t.after(f.picker.field.focusTarget.onDidBlur(() => laterFocus.focus()));
	f.picker.accept();
	assert.deepEqual(executedTargets, [f.origin]);
	assert.deepEqual(f.executed, [f.original]);
	assert.equal(paneUndo, 0);
});
