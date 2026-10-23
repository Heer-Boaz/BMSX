// Real authored AEM drafts: popup admission observes source publication during blur.
// Run: npm run ide:test -- nemesis_s tests/ide/source_popup_lifetime.idetest.js
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
t.command('aem'); await t.frames(2); await press('Enter');
const input = t.activeWorkbenchTab();
t.assert(input.kind === 'aem_editor', 'the actual authored audio event map did not open');
const model = input.workingCopy, original = model.buffer.getText();
const cycles = t.runtime().machine.scheduler.nowCycles;
for (let font = 0; font < 2; font++) {
	t.command('gameView.togglePanel'); await t.frames(3);
	const splitX = input.actionBar.bounds.right + 6;
	t.controlInput([{ type: 'pointer', x: splitX, y: 80 }, { type: 'button', button: 'primary', down: true }]);
	await t.frames(1);
	t.controlInput([{ type: 'pointer', x: 50, y: 80 }]); await t.frames(2);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
	const tree = input.tree;
	const index = tree.rows.findIndex(row => row.element.key === '["events","story","channel"]');
	t.assert(index >= 0, 'the actual story channel is absent');
	await click(tree.layout.contentLeft + tree.layout.twistieWidth + 4, tree.layout.contentTop + tree.layout.rowHeight / 2);
	await press('Home');
	for (let row = 0; row < index; row++) await press('ArrowDown');
	const property = tree.rows[tree.selectionIndex].element, range = property.node.range;
	t.assert(property.key === '["events","story","channel"]' && property.value === 'music', 'keyboard selection changed the source subject');
	await press('Enter');
	for (const code of ['KeyS', 'KeyF', 'KeyX']) await press(code);
	t.assert(model.buffer.getText() === original, 'a local field draft published before normal blur admission');
	const more = input.actionBar.overflow.button;
	t.assert(more.visible && more.bounds.right > more.bounds.left, 'the minimum-width More action is not reachable');
	await click((more.bounds.left + more.bounds.right) / 2, (more.bounds.top + more.bounds.bottom) / 2);
	await t.frames(3);
	t.assert(model.buffer.getText() === original.slice(0, range[0]) + 'sfx' + original.slice(range[1]),
		'opening a popup lost or duplicated the accepted authored draft');
	await capture(`aem-${input.layout.font.variant}-more-source-retired-popup`);
	await press('Home');
	t.assert(input.tree.selectionIndex === 0, 'the retired popup kept focus instead of returning to actual AEM content');
	await press('ControlLeft', 'KeyZ');
	t.assert(model.buffer.getText() === original, 'ordinary document Undo did not restore the canonical audio source');
	t.command('gameView.closePanel'); await t.frames(2);
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
t.assert(t.activeWorkbenchTab() === input, 'popup admission replaced the authored input');
t.assert(t.runtime().machine.scheduler.nowCycles === cycles, 'source-field interaction executed the paused guest');
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Source popup workflow logged an error: ${t.logMessage(index).message}`);
