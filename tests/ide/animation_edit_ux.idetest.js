// Actual EndDemo property draft, followed by physical +Key on the same input.
// Run: npm run ide:test -- nemesis_s tests/ide/animation_edit_ux.idetest.js
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true })));
	await t.frames(2);
	t.controlInput(codes.map(code => ({ type: 'key', code, down: false })));
	await t.frames(2);
};
const click = async (x, y) => {
	t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'primary', down: true }]);
	await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]);
	await t.frames(2);
};
const capture = async label => { await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label); };
await t.waitForCart(); await t.frames(90); t.openLuaSource('cart.lua'); await t.frames(2);
t.command('animation'); await t.frames(2);
for (const code of ['KeyE', 'KeyN', 'KeyD']) await press(code);
await press('Enter'); await t.frames(3);
const input = t.activeWorkbenchTab();
t.assert(input.kind === 'animation' && input.workingCopy.resource.path === 'end_demo.lua', 'the real EndDemo source did not open');
const source = input.workingCopy.buffer.getText(), cycles = t.runtime().machine.scheduler.nowCycles;
await press('ArrowDown');
for (const variant of ['tiny', 'msx']) {
	const viewport = input.keys.range.bounds;
	await click(input.keys.xAt(0), (viewport.top + viewport.bottom) / 2);
	t.assert(input.trackIndex === 0 && input.keyIndex === 0, 'the actual first authored key was not selected');
	const tree = input.details, index = tree.rows.findIndex(row => row.element.label === 'value');
	t.assert(index >= 0 && tree.rows[index].element.value === '1', 'the actual initial key value is missing');
	await click(tree.layout.contentRight - 3, tree.layout.contentTop + (index - (tree.scroll | 0) + 0.5) * tree.layout.rowHeight);
	await press('Enter'); await press('Digit2');
	t.assert(input.workingCopy.buffer.getText() === source, 'a pending property draft wrote canonical source before acceptance');
	await capture(`animation-${variant}-pending-property`);
	const add = input.actionBar.items.find(item => item.command === 'animation.addKey');
	t.assert(add.visible && !add.overflowed && add.enabled, 'the real +Key action is not a primary command');
	await click((add.bounds.left + add.bounds.right) / 2, (add.bounds.top + add.bounds.bottom) / 2);
	t.assert(input.document.tracks[0].keys[0].value.value === 2, 'physical +Key did not first publish the original property draft');
	await capture(`animation-${variant}-key-value-prompt-after-property`);
	// An actual usable prompt accepts a fresh value; a prompt retired by a late
	// semantic refresh leaves these ordinary keys in the Details list instead.
	await press('ControlLeft', 'KeyA'); await press('Digit9'); await press('Enter'); await t.frames(3);
	t.assert(input.document.tracks[0].keys.length === 3, 'the new key prompt was retired after committing the preceding property draft');
	t.assert(input.document.tracks[0].keys[2].value.value === 9, 'the actual prompt did not author its supplied key value');
	await capture(`animation-${variant}-new-key-after-property`);
	t.command('undo'); await t.frames(3);
	t.assert(input.document.tracks[0].keys.length === 2 && input.document.tracks[0].keys[0].value.value === 2, 'Undo did not separate the new key from the preceding property edit');
	t.command('undo'); await t.frames(3);
	t.assert(input.workingCopy.buffer.getText() === source, 'ordinary Undo did not recover exact canonical source');
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
// The same real property stays editable at the supported outer Game Panel minimum.
// Its readable draft surface belongs to the root workarea, not the tiny Details cell.
const firstKeys = input.keys.range.bounds;
await click(input.keys.xAt(0), (firstKeys.top + firstKeys.bottom) / 2);
t.assert(input.trackIndex === 0 && input.keyIndex === 0, 'the first actual authored key did not regain selection after Undo');
t.command('gameView.togglePanel'); await t.frames(3);
for (const variant of ['tiny', 'msx']) {
	const sash = input.actionBar.bounds.right + 6;
	t.controlInput([{ type: 'pointer', x: sash, y: 80 }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'pointer', x: 50, y: 80 }]); await t.frames(2);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
	t.assert(input.actionBar.bounds.right + 4 === (variant === 'tiny' ? 78 : 118), 'the actual Game Panel minimum was not exercised');
	const tree = input.details, index = tree.rows.findIndex(row => row.element.label === 'value');
	t.assert(index >= 0 && tree.rows[index].element.value === '1', 'the selected authored key value was lost at minimum width');
	await click(tree.layout.contentRight - 3, tree.layout.contentTop + (index - (tree.scroll | 0) + 0.5) * tree.layout.rowHeight);
	for (let theme = 0; theme < 2; theme++) {
		await press('Enter');
		for (const code of ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7']) await press(code);
		t.assert(input.workingCopy.buffer.getText() === source, 'a minimum-width value draft wrote canonical source');
		await capture(`animation-${variant}-minimum-value-editor-theme-${theme}`);
		await press('Escape');
		t.assert(input.workingCopy.buffer.getText() === source, 'Escape accepted a minimum-width value draft');
		await capture(`animation-${variant}-cancelled-value-editor-theme-${theme}`);
		t.command('theme-toggle'); await t.frames(2);
	}
	// Accept a fresh draft through the actual field to distinguish readable editing
	// from keys merely landing in the underlying list while source stays unchanged.
	await press('Enter'); await press('Digit2'); await press('Enter');
	t.assert(input.document.tracks[0].keys[0].value.value === 2, 'the minimum-width field did not accept ordinary typed input');
	t.command('undo'); await t.frames(3);
	t.assert(input.workingCopy.buffer.getText() === source, 'Undo did not recover exact source after a minimum-width edit');
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
t.command('gameView.closePanel'); await t.frames(2);
t.assert(t.runtime().machine.scheduler.nowCycles === cycles, 'authoring UI advanced the paused guest');
