// Dedicated authored booleans; input uses the actual Workbench, never model writes.
// npm run ide:test -- studio_test tests/ide/scene_boolean_ux.idetest.js --ttl 180
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const pointer = async (point, down) => {
	t.controlInput([{ type: 'pointer', ...point }, { type: 'button', button: 'primary', down }]); await t.frames(3);
};
const capture = async label => { await t.frames(3); t.log(`VISUAL ${label}`); t.capture(label); };
await t.waitForCart(); await t.frames(90); await press('ControlRight', 'ShiftRight');
t.command('sceneEditor'); await t.frames(3);
for (const character of 'boolean.lua') await press(character === '.' ? 'Period' : `Key${character.toUpperCase()}`);
await press('Enter'); await t.frames(5);
const main = t.mainWorkspace(), primary = main.primary, context = primary.consumer, model = context.workingCopy;
t.assert(model.identity.path === 'scenes/boolean.lua', 'the dedicated boolean declaration did not become the Main subject');
t.command('sceneEditor.outline'); await press('Home'); await press('ArrowDown'); t.command('sceneEditor.details'); await t.frames(3);
const details = primary.details.control, view = primary.view.viewport;
const source = model.buffer.getText(), cycles = t.runtime().machine.scheduler.nowCycles, media = t.sourceState().currentBlua32Media;
const checkbox = () => {
	const entry = details.options.controls.find(entry => entry.kind === 'boolean');
	t.assert(entry !== undefined, 'the actual authored boolean did not receive a native checkbox');
	return entry.control;
};
const unchangedRuntime = () => t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === media,
	'property authoring executed or replaced the paused guest');
const initial = () => {
	t.assert(model.buffer.getText() === source && !model.dirty && !model.canUndo && context.selection.kind === 'member',
		'one Undo did not restore the complete clean authored fixture');
	t.assert(checkbox().input.checked && view.canvas.items.length === 1, 'the restored property did not restore its actual solid visual');
	unchangedRuntime();
};
const fonts = new Set();
for (let font = 0; font < 2; font++) {
	for (let theme = 0; theme < 2; theme++) {
		const variant = primary.view.hierarchy.layout.font.variant; fonts.add(variant);
		const label = `scene-boolean-${variant}-${theme}`;
		initial(); const control = checkbox(), bounds = control.bounds, beforePress = model.version;
		const point = { x: control.labelX + 1, y: (bounds.top + bounds.bottom) / 2 };
		await pointer(point, true);
		t.assert(model.buffer.getText() === source && model.version === beforePress && !model.dirty, 'pressing without release committed a checkbox');
		await capture(`${label}-pressed`); await pointer(point, false);
		t.assert(!checkbox().input.checked && model.buffer.getText() === source.replace('visible = true', 'visible = false')
			&& view.canvas.items.length === 0 && control.focusTarget.hasFocus, 'label click did not toggle only its own token, visual and native focus');
		unchangedRuntime(); await capture(`${label}-unchecked`);
		t.command('undo'); await t.frames(4); initial();
		await press('Space'); await t.frames(3);
		t.assert(!checkbox().input.checked && model.dirty && view.canvas.items.length === 0, 'Space did not invoke the focused checkbox once');
		t.command('undo'); await t.frames(4); initial();

		// The same first click must settle a real preceding position draft and
		// follow the clicked boolean token through that source-length change.
		t.command('sceneEditor.details'); await press('Tab'); await press('ControlLeft', 'KeyA'); await press('Digit9');
		t.assert(details.controls[0].pending && model.buffer.getText() === source, 'numeric typing failed to establish a local draft');
		const after = checkbox(), area = after.bounds, click = { x: after.labelX + 1, y: (area.top + area.bottom) / 2 };
		await pointer(click, true);
		t.assert(!details.controls[0].pending && context.selectedLocalTransform.ox === 9 && checkbox().input.checked,
			'the checkbox press did not settle the actual preceding numeric field');
		await pointer(click, false);
		t.assert(!checkbox().input.checked && context.selectedLocalTransform.ox === 9 && view.canvas.items.length === 0,
			'the first checkbox click was lost or retargeted after the preceding draft committed');
		unchangedRuntime(); await capture(`${label}-draft-and-toggle`);
		t.command('undo'); await t.frames(4);
		t.assert(checkbox().input.checked && context.selectedLocalTransform.ox === 9, 'checkbox Undo also undid the preceding position edit');
		t.command('undo'); await t.frames(4); initial();
		t.command('theme-toggle'); await t.frames(3);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT'); await t.frames(4);
}
t.assert(fonts.size === 2, 'the boolean interaction workflow did not exercise both existing fonts');
initial();
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `boolean workflow logged an error: ${t.logMessage(index).message}`);
