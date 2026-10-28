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
// Drag and resize the real window to a large reading area for disclosure checks.
const window = input.detailsWindow;
const drag = async (x, y, endX, endY) => {
	t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'pointer', x: endX, y: endY }]); await t.frames(2);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
};
await drag(window.header.left + 20, window.header.top + 4, 24, input.layout.top + 4);
await drag(window.bounds.right - 1, window.bounds.bottom - 1, input.layout.right - 4, input.layout.bottom - 4);
await click(window.client.left + 20, window.client.top + 4);
const sequence = input.selected.sequence, before = Array.from(input.selected.beforeData), after = Array.from(input.selected.afterData);
const cycles = t.runtime().machine.scheduler.nowCycles;
for (let font = 0; font < 2; font++) {
	const variant = input.layout.font.variant;
	for (let theme = 0; theme < 2; theme++) {
		t.command('gte.follow'); await t.frames(2); t.command('gte.view'); await t.frames(2);
		t.assert(!input.following && input.selected.sequence === sequence, 'View did not hold the inspected command before presenting choices');
		await capture(`gte-view-${variant}-${theme}-choices`); await press('Escape');
		t.assert(!input.following && window.open && input.selected.sequence === sequence, 'View cancellation resumed Follow or replaced the observation');
		t.command('gte.view'); await t.frames(2); await press('ControlLeft', 'Home'); await press('Enter');
		t.assert(input.inspectorPage === 'properties' && input.selected.sequence === sequence, 'View acceptance changed the captured command');
		await press('Home'); await capture(`gte-details-${variant}-${theme}-compact`);
		await press('End');
		if (theme === 0) {
			await click(window.client.left + 5, window.client.bottom - 8);
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
t.assert(t.activeWorkbenchTab() === input && input.selected.sequence === sequence && window.open, 'Escape lost the captured GTE event or closed its modeless window');
t.command('gte.details'); await t.frames(2); t.command('window.hide'); await t.frames(2);
t.assert(!window.open, 'explicit Close left GTE Details open');
t.assert(authored.context.model.buffer.getText() === source, 'hardware inspection changed authored source');
await capture('gte-details-back-to-observation');
