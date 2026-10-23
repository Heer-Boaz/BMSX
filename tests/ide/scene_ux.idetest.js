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
		await press('Escape');
		await press('Tab'); await press('Tab'); await press('Digit9');
		unchanged(); await capture(`scene-${variant}-theme-${theme}-numeric-draft`);
		await press('Escape'); unchanged();
		t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}

// The supported Game Panel sash minimum exposes clipped authored members, not fake short names.
t.command('gameView.togglePanel'); await t.frames(3);
const sash = input.actionBar.bounds.right + 6;
t.controlInput([{ type: 'pointer', x: sash, y: 80 }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
t.controlInput([{ type: 'pointer', x: 50, y: 80 }]); await t.frames(2);
t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
for (let font = 0; font < 2; font++) {
	const variant = input.layout.font.variant;
	t.assert(input.layout.right - input.layout.left === (variant === 'tiny' ? 78 : 118), 'the actual sash did not reach its supported font-dependent minimum');
	await focusTree(); await press('Home'); await press('End');
	t.assert(selected().label === "'curtain'" && selected().labelClipped, 'the narrow keyboard case does not contain a genuinely clipped member label');
	await capture(`scene-${variant}-minimum-keyboard-curtain-identity`);
	const list = input.outline.layout;
	t.controlInput([{ type: 'pointer', x: list.contentLeft + list.twistieWidth + 7, y: list.contentTop + list.rowHeight * 3.5 }]);
	await capture(`scene-${variant}-minimum-hover-curtain-identity`);
	await press('Tab'); await press('ShiftLeft', 'Tab'); await press('End');
	t.assert(selected().label === "'curtain'", 'revisiting keyboard identity changed the selected member');
	await capture(`scene-${variant}-minimum-keyboard-retained-curtain-identity`);
	await press('Home'); await press('ArrowDown'); await press('ArrowDown');
	t.assert(selected().label === "'caption'" && selected().identity.includes('Definition caption.definition_id'), 'keyboard feedback adopted a same-prefix namesake');
	await capture(`scene-${variant}-minimum-keyboard-caption-identity`);
	await press('End');
	for (let step = 0; step < 8; step++) await press('Tab');
	await capture(`scene-${variant}-minimum-field-focus-without-row-hint`);
	await press('Escape'); unchanged();
	const expected = selected().source;
	t.command('sceneEditor.source'); await t.frames(3);
	const code = t.activeWorkbenchTab();
	t.assert(code.kind === 'code_editor' && code.workingCopy === input.workingCopy, 'Source opened another model instead of the retained canonical working copy');
	t.assert(code.context.view.cursorRow === expected.start.line - 1 && code.context.view.cursorColumn === expected.start.column - 1,
		'Source did not reveal the exact selected member range');
	await capture(`scene-${variant}-selected-member-canonical-source`); unchanged();
	t.command('sceneEditor'); await t.frames(3);
	t.assert(t.activeWorkbenchTab() === input && selected().label === "'curtain'", 'returning from Source lost the retained authored member');
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
t.command('gameView.closePanel'); await t.frames(3); unchanged();
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Scene workflow logged an error: ${t.logMessage(index).message}`);
