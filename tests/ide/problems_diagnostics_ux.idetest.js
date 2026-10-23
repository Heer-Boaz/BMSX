// Actual retained errors in two shipped source files; all edits are ordinary input and undone.
// Run: npm run ide:test -- nemesis_s tests/ide/problems_diagnostics_ux.idetest.js
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const drag = async (x, y, toX, toY) => {
	t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'pointer', x: toX, y: toY }]); await t.frames(2);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
};
const capture = async label => { await t.frames(3); t.log(`VISUAL ${label}`); t.capture(label); };
const focusFirst = async () => {
	t.command('problems.coverage'); await t.frames(2); await press('Tab'); await press('Home');
};
await t.waitForCart(); await t.frames(90);
const documents = [];
for (const path of ['cart.lua', 'intro.lua']) {
	t.openLuaSource(path); await t.frames(3);
	const input = t.activeWorkbenchTab(), model = input.context.model, original = model.buffer.getText();
	documents.push({ path, input, model, original });
	await press('ControlLeft', 'Home'); await press('Digit9');
	t.assert(model.buffer.getText() === '9' + original, 'the real editing producer did not create the intended authored parse fault');
}
const cycles = t.runtime().machine.scheduler.nowCycles;
const unchanged = () => {
	for (const document of documents) t.assert(document.model.buffer.getText() === '9' + document.original,
		'Problems disclosure or navigation changed the retained authored error');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles, 'Problems presentation advanced the paused guest');
};
t.command('problems'); await t.frames(90);
for (const [font, variant] of ['tiny', 'msx'].entries()) {
	for (let theme = 0; theme < 2; theme++) {
		await focusFirst(); await capture(`${variant}-theme-${theme}-diagnostic-cart-identity`);
		unchanged(); await press('Enter');
		t.assert(t.activeWorkbenchTab() === documents[0].input && t.activeWorkbenchTab().context.model === documents[0].model,
			'first diagnostic did not retain its exact cartridge source model');
		t.assert(documents[0].input.context.view.cursorRow === 0 && documents[0].input.context.view.cursorColumn === 0,
			'first diagnostic navigation did not use its actual 1-based displayed location');
		await focusFirst(); await press('ArrowDown'); await capture(`${variant}-theme-${theme}-diagnostic-intro-identity`);
		unchanged(); await press('Enter');
		t.assert(t.activeWorkbenchTab() === documents[1].input && t.activeWorkbenchTab().context.model === documents[1].model,
			'same-message diagnostic was resolved by position or basename instead of its owned source model');
		t.assert(documents[1].input.context.view.cursorRow === 0 && documents[1].input.context.view.cursorColumn === 0,
			'second diagnostic lost its original source range');
		// The Problems part remains readable across the root while the real Game Panel
		// constrains the code editor to its supported font-dependent minimum.
		t.command('gameView.togglePanel'); await t.frames(3);
		if (font === 0 && theme === 0) await drag(222, 80, 50, 80);
		await focusFirst(); await capture(`${variant}-theme-${theme}-diagnostic-narrow-editor`);
		unchanged(); t.command('gameView.closePanel'); await t.frames(3);
		t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
t.command('problems');
for (const document of documents) {
	t.openLuaSource(document.path); await t.frames(2); await press('ControlLeft', 'KeyZ');
	t.assert(t.activeWorkbenchTab() === document.input && document.input.context.model === document.model,
		'ordinary source return replaced a canonical working copy');
	t.assert(document.model.buffer.getText() === document.original && !document.model.dirty,
		'ordinary document Undo did not restore the exact shipped source');
}
t.assert(t.runtime().machine.scheduler.nowCycles === cycles, 'final source return advanced the guest');
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `diagnostic workflow logged an error: ${t.logMessage(index).message}`);
