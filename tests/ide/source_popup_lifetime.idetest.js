// Real authored AEM drafts publish through the presented primary or More action.
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
const model = input.workingCopy, original = model.buffer.getText(), initialUndo = model.canUndo;
const cycles = t.runtime().machine.scheduler.nowCycles;
t.command('resources'); await t.frames(3);
// Files is an actual resizable sibling in both fonts. A companion game may
// legitimately be unavailable at the client's current reading minimum.
const dividerX = input.layout.left, narrowX = (input.layout.left + input.layout.right) / 2;
t.controlInput([{ type: 'pointer', x: dividerX, y: 80 }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
t.controlInput([{ type: 'pointer', x: narrowX, y: 80 }]); await t.frames(2);
t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
for (let font = 0; font < 2; font++) {
	const tree = input.tree;
	const index = tree.rows.findIndex(row => row.element.key === '["events","story","channel"]');
	t.assert(index >= 0, 'the actual story channel is absent');
	await click(tree.layout.contentLeft + tree.layout.twistieWidth + 4, tree.layout.contentTop + tree.layout.rowHeight / 2);
	await press('Home');
	for (let row = 0; row < index; row++) await press('ArrowDown');
	const property = tree.rows[tree.selectionIndex].element, range = property.node.range, version = model.version;
	t.assert(property.key === '["events","story","channel"]' && property.value === 'music', 'keyboard selection changed the source subject');
	await press('Enter');
	for (const code of ['KeyS', 'KeyF', 'KeyX']) await press(code);
	t.assert(model.buffer.getText() === original, 'a local field draft published before normal blur admission');
	await capture(`aem-${input.layout.font.variant}-constrained-property-editor-theme-0`);
	t.command('theme-toggle'); await t.frames(2); await capture(`aem-${input.layout.font.variant}-constrained-property-editor-theme-1`);
	t.command('theme-toggle'); await t.frames(2);
	const more = input.actionBar.overflow.button;
	const opensMore = more.visible;
	const action = opensMore ? more : input.actionBar.items.find(item => item.command === 'aem.source');
	t.assert(action !== undefined && action.visible && action.enabled && !action.overflowed,
		'the responsive toolbar did not present its actual Source or More action');
	await click((action.bounds.left + action.bounds.right) / 2, (action.bounds.top + action.bounds.bottom) / 2);
	await t.frames(3);
	t.assert(model.buffer.getText() === original.slice(0, range[0]) + 'sfx' + original.slice(range[1])
		&& model.version === version + 1 && model.canUndo,
		'normal action admission lost or duplicated the accepted authored draft');
	if (opensMore) {
		t.assert(t.activeWorkbenchTab() === input, 'More admission replaced the authored input');
		await capture(`aem-${input.layout.font.variant}-more-source-retired-popup`);
		await press('Home');
		t.assert(input.tree.selectionIndex === 0, 'the retired popup kept focus instead of returning to actual AEM content');
		await press('ControlLeft', 'KeyZ');
	} else {
		const code = t.activeWorkbenchTab();
		t.assert(code.kind === 'code_editor' && code.workingCopy === model && code.resource === input.resource,
			'primary Source admission replaced the authored working copy');
		await capture(`aem-${input.layout.font.variant}-primary-source-accepted-draft`);
		await press('ControlLeft', 'KeyZ');
		const tabs = t.workbenchTabs(), start = tabs.indexOf(code), target = tabs.indexOf(input);
		for (let step = 0; step < (target - start + tabs.length) % tabs.length; step++) await press('ControlLeft', 'Tab');
		t.assert(t.activeWorkbenchTab() === input, 'physical tab navigation replaced the authored audio input');
	}
	t.assert(model.buffer.getText() === original && model.canRedo && model.canUndo === initialUndo,
		'ordinary document Undo did not restore exact canonical source and its history boundary');
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
t.assert(t.activeWorkbenchTab() === input, 'popup admission replaced the authored input');
t.assert(t.runtime().machine.scheduler.nowCycles === cycles, 'source-field interaction executed the paused guest');
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Source popup workflow logged an error: ${t.logMessage(index).message}`);
