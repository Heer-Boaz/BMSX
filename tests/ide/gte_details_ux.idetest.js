// Actual Starcatch GTE commands and installed-source identity, not injected snapshots.
// Run: npm run ide:test -- starcatch tests/ide/gte_details_ux.idetest.js
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
await t.waitForCart(); await t.frames(90); t.openLuaSource('entry.lua'); await t.frames(2);
const authored = t.activeWorkbenchTab(), source = authored.context.model.buffer.getText();
t.command('gteDebugger'); await t.frames(2);
const input = t.activeWorkbenchTab();
t.assert(input.kind === 'gte_debugger', 'the actual GTE contribution did not open');
for (let step = 0; step < 4; step++) { t.command('stepFrame'); await t.frames(12); }
t.assert(input.history.count > 0 && input.selected.sequence >= 0, 'the cart did not issue observable GTE commands');
t.command('gte.details'); await t.frames(2);
const sequence = input.selected.sequence, before = Array.from(input.selected.beforeData), after = Array.from(input.selected.afterData);
const cycles = t.runtime().machine.scheduler.nowCycles;
for (let font = 0; font < 2; font++) {
	const variant = input.layout.font.variant;
	for (let theme = 0; theme < 2; theme++) {
		await press('Home'); await capture(`gte-details-${variant}-${theme}-compact`);
		await press('End');
		if (theme === 0) {
			await click(6, input.layout.bottom - 10);
			await capture(`gte-details-${variant}-${theme}-pointer-explanation`);
			await press('ArrowLeft'); await press('End');
		}
		await press('ArrowRight'); await capture(`gte-details-${variant}-${theme}-register-explanation`);
		await press('ArrowLeft'); await press('Home');
		t.assert(input.selected.sequence === sequence, 'local disclosure retargeted the captured command');
		t.assert(before.every((word, index) => input.selected.beforeData[index] === word) && after.every((word, index) => input.selected.afterData[index] === word),
			'local disclosure changed retained before/after register evidence');
		t.assert(t.runtime().machine.scheduler.nowCycles === cycles, 'property presentation executed the paused guest');
		t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
await press('Escape');
t.assert(t.activeWorkbenchTab() === input && input.selected.sequence === sequence, 'Back lost the captured GTE event');
t.assert(authored.context.model.buffer.getText() === source, 'hardware inspection changed authored source');
await capture('gte-details-back-to-observation');
