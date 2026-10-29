import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyInputEvent, KeyModifier } from '../../hosts/common/input/text';
import { inputFocus } from '../../ide/input/focus';
import { CodeEditorPane } from '../../ide/workbench/contrib/code_editor/editor_pane';
import { GameViewInput } from '../../ide/workbench/contrib/game_view/editor_input';
import { createActualSourcePanes } from '../helpers/source_panes';

for (const font of ['tiny', 'msx'] as const) {
	test(`${font} Alt+Z toggles only the physically focused Source view, never its shared working copy`, t => {
		const f = createActualSourcePanes(t, true);
		f.editor.setFontVariant(font); f.update(); f.first.focus();
		assert.equal(f.first.code.font.variant, font);
		assert.ok(f.firstInput.workingCopy === f.secondInput.workingCopy);
		const model = f.firstInput.workingCopy, source = model.buffer.getText(), version = model.version;
		const cycles = f.host.runtime.machine.scheduler.nowCycles;
		assert.equal(f.editor.commands.isActive('wrap', f.first.commandTarget), false);
		assert.equal(f.editor.commands.isActive('wrap', f.second.commandTarget), false);
		f.editor.dispatchKey(new KeyInputEvent('AltLeft', KeyModifier.alt));
		const press = new KeyInputEvent('KeyZ', KeyModifier.alt);
		assert.equal(f.editor.dispatchKey(press), true);
		assert.equal(press.consumed, true);
		assert.equal(f.editor.commands.isActive('wrap', f.first.commandTarget), true);
		assert.equal(f.editor.commands.isActive('wrap', f.second.commandTarget), false);
		assert.ok(inputFocus.target === f.first.commandTarget);
		f.editor.dispatchKey(new KeyInputEvent('KeyZ', KeyModifier.alt, true));
		f.editor.dispatchKey(new KeyInputEvent('KeyZ', KeyModifier.alt, false, false));
		f.editor.dispatchKey(new KeyInputEvent('AltLeft', KeyModifier.none, false, false));
		assert.equal(f.editor.commands.isActive('wrap', f.first.commandTarget), true, 'repeat and release cannot toggle twice');
		assert.equal(f.editor.contextMenu.visible, false, 'a completed Alt+Z is not a later Alt-only menu gesture');
		f.second.focus(); f.key('KeyZ', KeyModifier.alt);
		assert.equal(f.editor.commands.isActive('wrap', f.first.commandTarget), true);
		assert.equal(f.editor.commands.isActive('wrap', f.second.commandTarget), true);
		f.first.focus(); f.key('KeyZ', KeyModifier.alt);
		assert.equal(f.editor.commands.isActive('wrap', f.first.commandTarget), false);
		assert.equal(f.editor.commands.isActive('wrap', f.second.commandTarget), true);
		assert.equal(model.buffer.getText(), source); assert.equal(model.version, version);
		assert.equal(model.canUndo, false); assert.equal(model.dirty, false);
		assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
	});
}

test('the actual inline Find capability toggles its Source while retaining the query and field focus', t => {
	const f = createActualSourcePanes(t); f.first.focus();
	const model = f.firstInput.workingCopy, version = model.version;
	f.key('KeyF', KeyModifier.ctrl);
	const field = f.first.find.state.field, target = field.focusTarget;
	assert.ok(inputFocus.target === target && target.getCommand('wrap') !== undefined);
	assert.equal(f.editor.textTarget!.replaceText(0, 0, 'alpha'), true);
	const query = field.text;
	f.key('KeyZ', KeyModifier.alt);
	assert.equal(f.editor.commands.isActive('wrap', target), true);
	assert.equal(f.editor.commands.isActive('wrap', f.first.commandTarget), true);
	assert.equal(f.editor.commands.isActive('wrap', f.second.commandTarget), false);
	assert.ok(inputFocus.target === target); assert.equal(field.text, query);
	assert.equal(f.first.find.state.query, query); assert.equal(model.version, version);
});

test('read-only Source retains the same wrap capability without acquiring mutation or Undo', t => {
	const f = createActualSourcePanes(t), model = f.firstInput.workingCopy;
	model.refreshResource({ ...model.resource, source: { ...model.resource.source, generated: true } });
	f.first.focus();
	const source = model.buffer.getText(), version = model.version;
	assert.equal(model.readOnly, true); assert.equal(f.editor.commands.isEnabled('wrap', f.first.commandTarget), true);
	f.key('KeyZ', KeyModifier.alt);
	assert.equal(f.editor.commands.isActive('wrap', f.first.commandTarget), true);
	assert.equal(f.editor.commands.isActive('wrap', f.second.commandTarget), false);
	assert.equal(model.buffer.getText(), source); assert.equal(model.version, version);
	assert.equal(model.canUndo, false); assert.equal(model.dirty, false);
});

test('a same-part Source side view keeps an independent toggle while sharing the canonical model', t => {
	const f = createActualSourcePanes(t); f.first.focus();
	const group = f.editor.editorParts.splitGroup(f.firstGroup, 'right')!, input = f.firstInput.createView();
	group.openEditor(input); f.update();
	const side = group.panes.activePane;
	assert.ok(side instanceof CodeEditorPane && input.workingCopy === f.firstInput.workingCopy);
	side.focus(); f.key('KeyZ', KeyModifier.alt);
	assert.equal(f.editor.commands.isActive('wrap', side.commandTarget), true);
	assert.equal(f.editor.commands.isActive('wrap', f.first.commandTarget), false);
	f.first.focus(); f.key('KeyZ', KeyModifier.alt);
	assert.equal(f.editor.commands.isActive('wrap', f.first.commandTarget), true);
	assert.equal(f.editor.commands.isActive('wrap', side.commandTarget), true);
	side.focus(); f.key('KeyZ', KeyModifier.alt);
	assert.equal(f.editor.commands.isActive('wrap', side.commandTarget), false);
	assert.equal(f.editor.commands.isActive('wrap', f.first.commandTarget), true);
});

test('QuickInput and the real Source context popup cannot borrow their origin wrap keyboard capability', t => {
	const f = createActualSourcePanes(t); f.first.focus();
	f.key('KeyP', KeyModifier.ctrl | KeyModifier.shift);
	const picker = f.editor.quickInput;
	assert.equal(picker.visible, true); assert.ok(inputFocus.target === picker.field.focusTarget);
	assert.equal(picker.field.focusTarget.getCommand('wrap'), undefined);
	const pickPress = new KeyInputEvent('KeyZ', KeyModifier.alt);
	f.editor.dispatchKey(pickPress); f.update();
	assert.equal(pickPress.consumed, false); assert.equal(picker.visible, true);
	assert.ok(inputFocus.target === picker.field.focusTarget);
	assert.equal(f.editor.commands.isActive('wrap', f.first.commandTarget), false);
	f.key('Escape'); f.key('ContextMenu');
	const popup = f.editor.contextMenu;
	assert.equal(popup.visible, true); assert.ok(inputFocus.target === popup.focusTarget);
	assert.ok(popup.invocationOrigin === f.first.commandTarget);
	assert.equal(popup.focusTarget.getCommand('wrap'), undefined);
	const menuPress = new KeyInputEvent('KeyZ', KeyModifier.alt);
	f.editor.dispatchKey(menuPress); f.update();
	assert.equal(menuPress.consumed, false); assert.equal(popup.visible, true);
	assert.ok(inputFocus.target === popup.focusTarget);
	assert.equal(f.editor.commands.isActive('wrap', f.first.commandTarget), false);
	f.key('Escape'); assert.ok(inputFocus.target === f.first.commandTarget);
	f.key('KeyZ', KeyModifier.alt);
	assert.equal(f.editor.commands.isActive('wrap', f.first.commandTarget), true);
});

test('Files and tab-strip focus do not borrow the visible Source wrap binding', t => {
	const f = createActualSourcePanes(t); f.first.focus();
	f.key('KeyE', KeyModifier.ctrl | KeyModifier.shift);
	assert.equal(f.editor.resourcePanel.isFocused(), true);
	const files = inputFocus.target!;
	assert.equal(files.getCommand('wrap'), undefined);
	const filePress = new KeyInputEvent('KeyZ', KeyModifier.alt);
	f.editor.dispatchKey(filePress); f.update();
	assert.equal(filePress.consumed, false); assert.ok(inputFocus.target === files);
	assert.equal(f.editor.commands.isActive('wrap', f.first.commandTarget), false);
	f.first.focus(); f.editor.commands.execute('group.focusTabs', f.first.commandTarget);
	assert.ok(inputFocus.target === f.firstGroup.tabStrip.focusTarget);
	assert.equal(f.firstGroup.tabStrip.focusTarget.getCommand('wrap'), undefined);
	const tabPress = new KeyInputEvent('KeyZ', KeyModifier.alt);
	f.editor.dispatchKey(tabPress); f.update();
	assert.equal(tabPress.consumed, false); assert.ok(inputFocus.target === f.firstGroup.tabStrip.focusTarget);
	assert.equal(f.editor.commands.isActive('wrap', f.first.commandTarget), false);
});

test('the existing View menu checked state and explicit Palette acceptance address the captured Source', t => {
	const f = createActualSourcePanes(t); f.first.focus();
	f.key('KeyZ', KeyModifier.alt);
	f.key('F10'); f.key('ArrowRight'); f.key('ArrowRight');
	const popup = f.editor.contextMenu;
	assert.equal(f.editor.menubar.activeMenu, 'view');
	const index = popup.model.rows.findIndex(row => row.command === 'wrap');
	assert.ok(index >= 0 && popup.model.rows[index].enabled);
	assert.equal(popup.model.rows[index].active, true);
	while (popup.model.selectedIndex !== index) f.key('ArrowDown');
	f.key('Enter');
	assert.equal(popup.visible, false); assert.ok(inputFocus.target === f.first.commandTarget);
	assert.equal(f.editor.commands.isActive('wrap', f.first.commandTarget), false);
	assert.equal(f.editor.commands.isActive('wrap', f.second.commandTarget), false);
	f.key('KeyP', KeyModifier.ctrl | KeyModifier.shift);
	assert.equal(f.editor.textTarget!.replaceText(0, 0, 'wrap'), true); f.update();
	const picker = f.editor.quickInput;
	assert.equal(picker.model.list.rows.length, 1);
	f.key('Enter');
	assert.equal(picker.visible, false); assert.ok(inputFocus.target === f.first.commandTarget);
	assert.equal(f.editor.commands.isActive('wrap', f.first.commandTarget), true);
	assert.equal(f.editor.commands.isActive('wrap', f.second.commandTarget), false);
});

test('Alt+Z remains ordinary guest input in the actual Game viewport', t => {
	const f = createActualSourcePanes(t);
	f.ide.boots.didReplaceMachine(); f.editor.interaction.setActive(true);
	f.editor.editorParts.main.activeGroup.openEditor(new GameViewInput()); f.update(); f.key('Tab');
	const guest = inputFocus.target!, binding = guest.guestInput;
	assert.ok(binding !== undefined && binding.recipient === f.host.input);
	const cycles = f.host.runtime.machine.scheduler.nowCycles;
	for (const event of [new KeyInputEvent('AltLeft', KeyModifier.alt), new KeyInputEvent('KeyZ', KeyModifier.alt),
		new KeyInputEvent('KeyZ', KeyModifier.alt, false, false), new KeyInputEvent('AltLeft', KeyModifier.none, false, false)]) {
		assert.equal(f.editor.dispatchKey(event), false); assert.equal(event.consumed, false);
		assert.ok(inputFocus.target === guest && guest.guestInput === binding);
	}
	assert.equal(f.editor.contextMenu.visible, false);
	assert.equal(f.editor.commands.isActive('wrap', f.first.commandTarget), false);
	assert.equal(f.editor.commands.isActive('wrap', f.second.commandTarget), false);
	assert.equal(f.host.runtime.machine.scheduler.nowCycles, cycles);
});
