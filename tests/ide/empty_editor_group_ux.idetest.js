// Empty groups keep complete discovery hints beside the actual Files panel.
// Run: npm run ide:test -- nemesis_s tests/ide/empty_editor_group_ux.idetest.js
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const capture = async label => { await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label); };
await t.waitForCart(); await t.frames(90); t.openLuaSource('cart.lua'); await t.frames(3);
const authored = t.activeWorkbenchTab(), model = authored.context.model, source = model.buffer.getText();
while (t.workbenchTabs().length > 0) { t.command('tabs.close'); await t.frames(2); }
const cycles = t.runtime().machine.scheduler.nowCycles;
const unchanged = () => {
	t.assert(t.activeWorkbenchTab() === null && t.workbenchTabs().length === 0, 'watermark fabricated an editor input');
	t.assert(model.buffer.getText() === source, 'empty-group discovery changed canonical source');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles, 'empty-group presentation advanced the paused guest');
};
for (let font = 0; font < 2; font++) {
	for (let theme = 0; theme < 2; theme++) {
		unchanged(); await capture(`empty-wide-font-${font}-theme-${theme}`);
		t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
t.command('resources'); await t.frames(3);
t.controlInput([{ type: 'pointer', x: 115, y: 80 }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
t.controlInput([{ type: 'pointer', x: 300, y: 80 }]); await t.frames(2);
t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
for (let font = 0; font < 2; font++) {
	for (let theme = 0; theme < 2; theme++) {
		unchanged(); await capture(`empty-files-wide-font-${font}-theme-${theme}`);
		t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
await press('ControlLeft', 'ShiftLeft', 'KeyP');
for (const character of 'GPU Operations') await press(character === ' ' ? 'Space' : `Key${character.toUpperCase()}`);
await press('Enter'); await t.frames(3);
t.assert(t.activeWorkbenchTab().kind === 'gpu_debugger', 'the documented palette shortcut did not open the actual contribution from an empty group');
t.assert(model.buffer.getText() === source && t.runtime().machine.scheduler.nowCycles === cycles, 'palette discovery changed source or advanced gameplay');
t.command('tabs.close'); await t.frames(2); unchanged();
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Empty-group UX logged an error: ${t.logMessage(index).message}`);
