// Real title menus restore snapped windows without re-entering the Source client.
// Run: npm run ide:test -- nemesis_s tests/ide/window_restore_context.idetest.js
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const titleMenu = async group => {
	let owner = group.surface;
	while (owner.role !== 'window') owner = owner.presentationParent;
	const bounds = owner.getBounds(), tabs = group.tabStrip.layoutState.bounds;
	t.controlInput([{ type: 'pointer', x: bounds.left + 6, y: (bounds.top + tabs.top) / 2 },
		{ type: 'button', button: 'secondary', down: true }]); await t.frames(2);
	t.controlInput([{ type: 'button', button: 'secondary', down: false }]); await t.frames(2);
	t.assert(t.contextMenu().visible && t.contextMenu().model.rows.some(row => row.command === 'window.restore'),
		'the real title menu must expose the shared Restore capability');
};
const acceptRestore = async () => {
	const menu = t.contextMenu();
	t.assert(menu.model.rows.some(row => row.command === 'window.restore' && row.enabled), 'the snapped owner must admit Restore');
	await press('Home');
	for (let step = 0; step < menu.model.rows.length && menu.model.rows[menu.model.selectedIndex]?.command !== 'window.restore'; step++) await press('ArrowDown');
	t.assert(menu.model.rows[menu.model.selectedIndex]?.command === 'window.restore', 'keyboard menu navigation must reach Restore');
	await press('Enter'); await t.frames(3);
};
await t.waitForCart(); await t.frames(90); t.openLuaSource('cart.lua'); await t.frames(3);
const original = t.activeWorkbenchTab(), model = original.workingCopy;
const source = model.buffer.getText(), version = model.version, history = model.history;
const cycles = t.runtime().machine.scheduler.nowCycles;
t.command('window.copyEditor'); await t.frames(3);
const copy = t.activeWorkbenchTab(), group = t.activeEditorGroup();
t.assert(copy !== original && copy.workingCopy === model, 'the document window must own an independent view over the same source');
for (const font of ['tiny', 'msx']) {
	for (const side of ['Left', 'Right']) {
		t.command(`window.snap${side}`); await t.frames(3);
		await titleMenu(group);
		t.log(`VISUAL window-${font}-${side.toLowerCase()}-restore-menu`); t.capture(`window-${font}-${side.toLowerCase()}-restore-menu`);
		await acceptRestore();
		t.assert(t.activeEditorGroup() === group && t.activeWorkbenchTab() === copy && !t.activeEditorDocument().focusTarget.hasFocus,
			'Restore must retain the exact document and chrome focus rather than entering Source');
		await titleMenu(group);
		t.assert(t.contextMenu().model.rows.some(row => row.command === 'window.restore' && !row.enabled),
			'the restored normal owner must no longer admit Restore');
		await press('Escape');
		t.assert(model.buffer.getText() === source && model.version === version && model.history === history && !model.dirty,
			'window placement changed canonical source, its generation or history');
		t.assert(t.runtime().machine.scheduler.nowCycles === cycles, 'title-menu placement executed the paused guest');
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Window restore workflow logged an error: ${t.logMessage(index).message}`);
