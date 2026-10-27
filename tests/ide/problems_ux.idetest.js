// Real Problems coverage disclosure and focus return, using the shipped source owners.
// Run: npm run ide:test -- nemesis_s tests/ide/problems_ux.idetest.js
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
const capture = async label => {
	await t.frames(2);
	t.log(`VISUAL ${label}`);
	t.capture(label);
};

await t.waitForCart();
await t.frames(90);
t.openLuaSource('cart.lua');
await t.frames(80);
const code = t.activeWorkbenchTab();
t.assert(code.kind === 'code_editor', 'the actual cartridge source did not open');
const original = code.context.model.buffer.getText();
const cycles = t.runtime().machine.scheduler.nowCycles;
for (const [variant, lineHeight] of [['tiny', 6], ['msx', 8]]) {
	for (let theme = 0; theme < 2; theme++) {
		t.command('problems');
		await t.frames(40);
		await capture(`${variant}-theme-${theme}-problems`);
		t.command('problems.coverage');
		await capture(`${variant}-theme-${theme}-coverage-keyboard`);
		await press('Escape');
		if (theme === 0) {
			// Shipped viewport 384x288; the empty panel owns three rows above its status bar.
			const headerHeight = Math.max(lineHeight + 4, 12);
			const headerTop = 288 - (lineHeight + 6) - (headerHeight + lineHeight * 3 + 8);
			await click(371, headerTop + headerHeight / 2);
			await capture(`${variant}-coverage-pointer`);
			await press('Escape');
		}
		await press('Tab');
		t.command('problems');
		// Closing from the header must return to the real source editor, not a retired header target.
		const model = code.context.model, view = code.context.view;
		const offset = model.buffer.offsetAt(view.cursorRow, view.cursorColumn);
		await press('Space');
		t.assert(model.buffer.getText() === original.slice(0, offset) + ' ' + original.slice(offset),
			'closing Problems from Info did not restore actual source-edit focus');
		await press('ControlLeft', 'KeyZ');
		t.assert(model.buffer.getText() === original, 'ordinary Undo did not retain the canonical source');
		t.assert(t.activeWorkbenchTab() === code, 'coverage replaced the retained source input');
		t.command('theme-toggle');
		await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}

// Open a real unsupported diagnostic language; never invent a clean or failed result.
t.command('aem');
await t.frames(2);
await press('Enter');
const audio = t.activeWorkbenchTab();
t.assert(audio.kind === 'aem_editor', 'the actual audio event map did not open');
t.command('editor.source');
await t.frames(40);
const yaml = t.activeWorkbenchTab();
t.assert(yaml.kind === 'code_editor' && yaml.workingCopy === audio.workingCopy && yaml.context.model.mode === 'aem',
	'the authored audio YAML source did not open in its actual document mode');
const yamlSource = yaml.context.model.buffer.getText();
t.command('problems');
for (const variant of ['tiny', 'msx']) {
	t.command('problems.coverage');
	await capture(`${variant}-unsupported-source-coverage`);
	await press('Escape');
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
t.command('problems');
t.assert(yaml.context.model.buffer.getText() === yamlSource, 'coverage edited the authored unsupported source');
t.assert(t.runtime().machine.scheduler.nowCycles === cycles, 'diagnostic UI advanced the paused guest');
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Problems workflow logged an error: ${t.logMessage(index).message}`);
