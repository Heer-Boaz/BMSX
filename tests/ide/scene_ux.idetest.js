// Real shipped scene members and cancelled typed drafts; no model-injected authoring.
// Run: npm run ide:test -- nemesis_s tests/ide/scene_ux.idetest.js
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true })));
	await t.frames(2);
	t.controlInput(codes.map(code => ({ type: 'key', code, down: false })));
	await t.frames(2);
};
const click = async (x, y) => {
	t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
};
const capture = async label => { await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label); };
await t.waitForCart(); await t.frames(90); t.openLuaSource('cart.lua'); await t.frames(2);
t.command('sceneEditor'); await t.frames(2); await press('Enter'); await t.frames(3);
const input = t.activeWorkbenchTab();
t.assert(input.kind === 'scene_editor' && input.workingCopy.resource.path === 'scenes/end_demo.lua', 'the actual shipped Scene definition did not open');
const source = input.workingCopy.buffer.getText(), cycles = t.runtime().machine.scheduler.nowCycles;
const focusTree = async () => {
	const list = input.outline.layout;
	await click(list.contentLeft + list.twistieWidth + 6, list.contentTop + list.rowHeight * 3.5);
};
const unchanged = () => {
	t.assert(input.workingCopy.buffer.getText() === source, 'selection, focus or a cancelled draft changed canonical Scene source');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles, 'Scene presentation advanced the paused guest');
};
const selected = () => input.outline.rows[input.outline.selectionIndex].element;
for (let font = 0; font < 2; font++) {
	const variant = input.layout.font.variant;
	for (let theme = 0; theme < 2; theme++) {
		await focusTree(); await press('End');
		t.assert(selected().kind === 'member' && selected().label === "'curtain'", 'the real tree selected another authored member');
		t.assert(input.detailsText[0].text === selected().label, 'Details identifies only the parent scene instead of the selected member');
		t.assert(selected().identity.includes('scenes/end_demo.lua') && selected().identity.includes('Scene end_demo_scene.id')
			&& selected().identity.includes("Member 'curtain'") && selected().identity.includes('Definition curtain.definition_id'),
			'the retained member identity lost its canonical source, containing scene or actual definition');
		await capture(`scene-${variant}-theme-${theme}-selected-curtain`);
		// Tree -> details viewport -> X/Y/Z -> sx/sy/mode/visible.
		for (let step = 0; step < 8; step++) await press('Tab');
		await capture(`scene-${variant}-theme-${theme}-only-visible-field-focused`);
		await press('Escape'); await press('Home');
		const field = input.properties[0].bounds;
		t.assert(field.bottom > field.top && field.top >= input.details.bounds.top && field.bottom <= input.details.bounds.bottom,
			'the numeric draft did not start in an actually visible position field');
		await click((field.left + field.right) / 2, (field.top + field.bottom) / 2); await press('Digit9');
		unchanged(); await capture(`scene-${variant}-theme-${theme}-numeric-draft`);
		await press('Escape'); unchanged();
		t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}

// Compact navigation, hidden controls and Source lifetimes live in scene_responsive_ux.
unchanged();
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Scene workflow logged an error: ${t.logMessage(index).message}`);
