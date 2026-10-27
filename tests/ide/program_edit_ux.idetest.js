// Real authored Starcatch program values use the same readable, source-owned editor.
// Run: npm run ide:test -- starcatch tests/ide/program_edit_ux.idetest.js
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const click = async (x, y) => {
	t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
};
const capture = async label => { await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label); };
await t.waitForCart(); await t.frames(90); t.openLuaSource('entry.lua'); await t.frames(2);
t.command('progression'); await t.frames(2); await press('Enter'); await t.frames(3);
const input = t.activeWorkbenchTab();
t.assert(input.kind === 'lua_program' && input.programKind === 'progression' && !input.liveVisible, 'the actual authored progression definition did not open');
const index = input.tree.rows.findIndex(row => row.element.kind === 'property' && row.element.field !== undefined
	&& row.element.inlineEditable && !input.sourceModels.get(row.element.file.file).readOnly);
t.assert(index >= 0, 'the shipped program has no actual editable scalar');
const property = input.tree.rows[index].element, owner = input.sourceModels.get(property.file.file), original = owner.buffer.getText();
const rootSource = input.workingCopy.buffer.getText(), cycles = t.runtime().machine.scheduler.nowCycles;
for (const variant of ['tiny', 'msx']) {
	t.command('gameView.closePanel'); await t.frames(3);
	const fullRight = input.layout.right;
	t.command('gameView.togglePanel'); await t.frames(3);
	const companion = input.layout.right < fullRight;
	if (companion) {
		t.controlInput([{ type: 'pointer', x: input.layout.right + 2, y: 80 }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
		t.controlInput([{ type: 'pointer', x: 50, y: 80 }]); await t.frames(2);
		t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
	}
	const phase = companion ? 'companion' : 'full-preview-unavailable';
	t.assert(t.activeWorkbenchTab() === input && input.layout.font.variant === variant, 'requesting the companion replaced the program input or its current font');
	const layout = input.tree.layout;
	await click(layout.contentLeft + layout.twistieWidth + 6, layout.contentTop + layout.rowHeight / 2);
	await press('Home'); for (let row = 0; row < index; row++) await press('ArrowDown');
	t.assert(input.tree.rows[input.tree.selectionIndex].element === property, 'ordinary keyboard navigation lost the actual source field');
	await press('Enter');
	for (const code of ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7']) await press(code);
	for (let theme = 0; theme < 2; theme++) {
		t.assert(owner.buffer.getText() === original, 'a temporary value draft changed the canonical source');
		await capture(`program-${variant}-${phase}-value-editor-theme-${theme}`);
		t.command('theme-toggle'); await t.frames(2);
	}
	await press('Escape');
	t.assert(owner.buffer.getText() === original && input.workingCopy.buffer.getText() === rootSource, 'Escape changed source or a different imported owner');
	await capture(`program-${variant}-cancelled-value-editor`);
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
t.command('gameView.closePanel'); await t.frames(2);
const range = property.file.chunk.locations.range(property.field.value.span);
t.command('editor.source'); await t.frames(3);
t.assert(t.activeWorkbenchTab().kind === 'code_editor' && t.activeWorkbenchTab().workingCopy === owner, 'Source lost the exact edited resource-owned model');
t.assert(t.activeWorkbenchTab().context.view.cursorRow === range.start.line - 1 && t.activeWorkbenchTab().context.view.cursorColumn === range.start.column - 1,
	'Source did not retain its original written field position');
t.assert(owner.buffer.getText() === original && t.runtime().machine.scheduler.nowCycles === cycles, 'cancelled source editing changed authored bytes or guest execution');
