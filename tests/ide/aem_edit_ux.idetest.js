// The original AEM working copy owns both an accepted field and the next structural action.
// Run: npm run ide:test -- nemesis_s tests/ide/aem_edit_ux.idetest.js
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const click = async bounds => {
	t.controlInput([{ type: 'pointer', x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 },
		{ type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
};
const capture = async label => { await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label); };
await t.waitForCart(); await t.frames(90); t.openLuaSource('cart.lua'); await t.frames(2);
t.command('aem'); await t.frames(2); await press('Enter'); await t.frames(3);
const input = t.activeWorkbenchTab();
t.assert(input.kind === 'aem_editor', 'the shipped authored audio map did not open');
const model = input.workingCopy, source = model.buffer.getText(), cycles = t.runtime().machine.scheduler.nowCycles;
for (const variant of ['tiny', 'msx']) {
	const tree = input.tree, index = tree.rows.findIndex(row => row.element.key === '["events","story","channel"]');
	await click({ left: tree.layout.contentLeft + 12, right: tree.layout.contentLeft + 20,
		top: tree.layout.contentTop, bottom: tree.layout.contentTop + tree.layout.rowHeight });
	await press('Home'); for (let row = 0; row < index; row++) await press('ArrowDown');
	const property = tree.rows[tree.selectionIndex].element, range = property.node.range;
	t.assert(property.key === '["events","story","channel"]' && property.value === 'music', 'the authored channel field is not selected');
	const lineStart = source.lastIndexOf('\n', range[0]) + 1, lineEnd = source.indexOf('\n', range[1]) + 1;
	const removed = source.slice(0, lineStart) + source.slice(lineEnd);
	const edited = source.slice(0, range[0]) + 'audiofx' + source.slice(range[1]);
	await press('Enter');
	for (const code of ['KeyA', 'KeyU', 'KeyD', 'KeyI', 'KeyO', 'KeyF', 'KeyX']) await press(code);
	t.assert(model.buffer.getText() === source, 'the field draft published before acceptance');
	await capture(`aem-${variant}-pending-longer-channel`);
	const remove = input.actionBar.items.find(item => item.command === 'aem.remove');
	t.assert(remove.visible && !remove.overflowed && remove.enabled, 'the actual primary Remove action is unavailable');
	await click(remove.bounds);
	t.assert(model.buffer.getText() === removed, 'Remove used stale pre-draft source ranges instead of the accepted current field');
	t.assert(input.document !== undefined, 'field removal corrupted the source document');
	await capture(`aem-${variant}-removed-current-field`);
	t.command('undo'); await t.frames(3); t.assert(model.buffer.getText() === edited, 'Undo did not separate removal from the accepted field edit');
	t.command('undo'); await t.frames(3); t.assert(model.buffer.getText() === source, 'two ordinary Undo commands did not restore exact canonical source');
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
t.assert(t.runtime().machine.scheduler.nowCycles === cycles, 'authored source interaction advanced the paused guest');
