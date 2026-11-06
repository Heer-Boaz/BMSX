import assert from 'node:assert/strict';
import test from 'node:test';
import { PointerButton } from '../../hosts/common/input/pointer_event';
import { KeyModifier } from '../../hosts/common/input/text';
import { SettingsModel, SETTINGS, parseFontSize } from '../../ide/workbench/contrib/settings/model';
import { SettingsInput, openSettings } from '../../ide/workbench/contrib/settings/editor_input';
import { SettingsPane } from '../../ide/workbench/contrib/settings/editor_pane';
import { SettingControl } from '../../ide/workbench/contrib/settings/setting_control';
import { WORKBENCH_MENUS } from '../../ide/workbench/ui/menu/registry';
import { WorkbenchCheckboxControl } from '../../ide/workbench/ui/checkbox_control';
import { editorViewState } from '../../ide/editor/ui/view/state';
import { setFieldText } from '../../ide/editor/ui/inline/text_field';
import { inputFocus } from '../../ide/input/focus';
import { createActualSourcePanes } from '../helpers/source_panes';

test('settings search and category filter share declared preference metadata', () => {
	const model = new SettingsModel();
	model.filter('font pixels', 'typography');
	assert.ok(model.visible.some(setting => setting.id === 'fontSize'));
	assert.ok(!model.visible.some(setting => setting.id === 'theme'));
	const revision = model.revision; model.filter('font pixels', 'typography'); assert.equal(model.revision, revision);
	model.filter('nothing matches this', 'all'); assert.equal(model.visible.length, 0);
	model.filter('', 'all'); assert.equal(model.visible.length, SETTINGS.length);
});

test('font-size text boundary accepts pixels, rejecting percentages and invalid drafts', () => {
	assert.deepEqual(parseFontSize('14'), { value: 14 }); assert.deepEqual(parseFontSize(' 13.5 '), { value: 13.5 });
	for (const text of ['', '75%', '-1', '5', '10000', '14foo', 'NaN', 'Infinity']) assert.ok('error' in parseFontSize(text));
});

test('Settings command opens and reuses an ordinary separate editor window without replacing source views', async t => {
	const f = createActualSourcePanes(t), { editor } = f;
	const before = editor.editorParts.documents.length, source = f.firstGroup.model.activeTab;
	f.first.focus(); f.key('Comma', KeyModifier.ctrl);
	const part = editor.editorParts.activePart, input = part.activeGroup.model.activeTab;
	assert.equal(editor.editorParts.documents.length, before + 1);
	assert.ok(input instanceof SettingsInput);
	assert.equal(input.serializable, false); assert.equal(input.isDirty(), false);
	assert.ok(f.firstGroup.model.activeTab === source);
	f.first.focus(); openSettings(editor.editorParts, editor.preferences);
	assert.equal(editor.editorParts.documents.length, before + 1); assert.ok(editor.editorParts.activePart === part);
	assert.ok(part.activeGroup.panes.activePane instanceof SettingsPane);
	const pane = part.activeGroup.panes.activePane as SettingsPane;
	setFieldText(pane.search.field, 'font size', true); f.update();
	assert.deepEqual(input.model.visible.map(setting => setting.id), ['fontSize']);
	const font = editorViewState.font;
	editor.preferences.fontSize = 16; f.update();
	assert.ok(editorViewState.font !== font);
	assert.ok(inputFocus.admittedTarget === pane.search.field.focusTarget, 'live preference changes preserve the actual field focus');
	f.paint();
	assert.equal(await editor.editorParts.close(part), true);
	assert.equal(editor.editorParts.documents.length, before);
	openSettings(editor.editorParts, editor.preferences);
	assert.equal(editor.preferences.fontSize, 16, 'preference lifetime is not window lifetime');
});

test('numeric settings use the common draft, cancel and reset contracts; checkbox reflects the preference owner', t => {
	const f = createActualSourcePanes(t), preferences = f.editor.preferences;
	const number = new SettingControl(SETTINGS.find(setting => setting.id === 'fontSize')!, preferences, f.first.commandTarget,
		f.editor.commands, f.editor.editorParts.partForGroup(f.firstGroup).quickInput);
	const boolean = new SettingControl(SETTINGS.find(setting => setting.id === 'fontSampling')!, preferences, f.first.commandTarget,
		f.editor.commands, f.editor.editorParts.partForGroup(f.firstGroup).quickInput);
	t.after(() => { number.dispose(); boolean.dispose(); });
	number.attach(); boolean.attach();
	setFieldText(number.value!.field, '75%', true); assert.equal(number.value!.commit(), false); assert.equal(preferences.fontSize, 14);
	number.value!.cancel(); assert.equal(number.value!.pending, false);
	setFieldText(number.value!.field, '13', true); assert.equal(number.value!.commit(), true); assert.equal(preferences.fontSize, 13);
	number.context.getCommand('settings.reset')!.run(); assert.equal(preferences.fontSize, 14);
	preferences.fontSampling = 'nearest'; boolean.refresh(); assert.equal(boolean.checkbox!.input!.checked, false);
	boolean.context.getCommand('settings.reset')!.run(); boolean.refresh(); assert.equal(boolean.checkbox!.input!.checked, true);
});

test('Settings pointer focus preserves the click target while keyboard traversal reveals offscreen fields and skips disabled reset', t => {
	const f = createActualSourcePanes(t);
	let checkbox!: WorkbenchCheckboxControl;
	const layout = WorkbenchCheckboxControl.prototype.layout;
	t.mock.method(WorkbenchCheckboxControl.prototype, 'layout', function (this: WorkbenchCheckboxControl, ...args: Parameters<typeof layout>) {
		checkbox = this; layout.apply(this, args);
	});
	openSettings(f.editor.editorParts, f.editor.preferences); f.update();
	const part = f.editor.editorParts.activePart, input = part.activeGroup.model.activeTab as SettingsInput;
	const pane = part.activeGroup.panes.activePane as SettingsPane, viewport = input.viewport;
	// A real partly visible checkbox must accept the first click without focus moving it away before release.
	viewport.scrollbar.setScroll(viewport.scrollTop + checkbox.bounds.top - viewport.bounds.bottom + (checkbox.bounds.bottom - checkbox.bounds.top) / 2);
	f.update();
	const scroll = viewport.scrollTop;
	const x = (checkbox.clip.left + checkbox.clip.right) / 2, y = (checkbox.clip.top + checkbox.clip.bottom) / 2;
	for (const down of [true, false]) {
		f.editor.dispatchPointer({ pointerId: 0, pointerType: 'mouse', x, y, buttons: down ? PointerButton.Primary : 0,
			pressedButtons: down ? PointerButton.Primary : 0, releasedButtons: down ? 0 : PointerButton.Primary,
			cancelledButtons: 0, modifiers: KeyModifier.none, spaceDown: false, timestamp: down ? 0 : 1 });
		f.update();
	}
	assert.equal(f.editor.preferences.fontSampling, 'nearest');
	assert.equal(viewport.scrollTop, scroll, 'pointer focus must not change the clicked control placement');
	viewport.scrollbar.setScroll(0); pane.focus(); f.update();
	for (let step = 0; step < SETTINGS.length * 3 && inputFocus.admittedTarget !== checkbox.focusTarget; step++) f.key('Tab');
	assert.ok(inputFocus.admittedTarget === checkbox.focusTarget, 'disabled reset controls cannot trap Tab navigation');
	assert.ok(checkbox.bounds.top >= viewport.bounds.top && checkbox.bounds.bottom <= viewport.bounds.bottom,
		'keyboard traversal reveals the focused field, not an unrelated part of its settings row');
});

test('appearance preferences belong to Settings rather than the View menu', () => {
	assert.ok(WORKBENCH_MENUS['menubar.file'].some(item => item.type === 'command' && item.command === 'settings.open'));
	assert.ok(!WORKBENCH_MENUS['menubar.view'].some(item => item.type === 'command' && item.command === 'theme-toggle'));
});
