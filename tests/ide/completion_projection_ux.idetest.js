// Shipped Lua source, real completion and pointer input; never inject a provider or projected model.
// Run: npm run ide:test -- nemesis_s tests/ide/completion_projection_ux.idetest.js --ttl 120
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const type = async text => {
	for (const character of text) {
		if (character === '_') await press('ShiftLeft', 'Minus');
		else if (character === '(') await press('ShiftLeft', 'Digit9');
		else if (character === ')') await press('ShiftLeft', 'Digit0');
		else await press(`Key${character.toUpperCase()}`);
	}
};
const click = async (x, y) => {
	t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
};
let captures = 0;
const capture = label => {
	t.assert(++captures <= 16, 'the projection workflow exceeded its bounded capture budget');
	t.log(`VISUAL ${label}`); t.capture(label);
};
await t.waitForCart(); await t.frames(90);
t.openLuaSource('cart.lua'); await t.frames(3);
const code = t.activeWorkbenchTab(), model = code.workingCopy, original = model.buffer.getText();
const cycles = t.runtime().machine.scheduler.nowCycles, executable = t.sourceState().currentBlua32Media;
t.assert(code.kind === 'code_editor' && model.resource.path === 'cart.lua' && !model.dirty, 'the canonical shipped Lua entry did not open cleanly');
const unchanged = expected => {
	t.assert(t.activeWorkbenchTab() === code && model.buffer.getText() === expected, 'the projected view changed or replaced its canonical source input');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === executable,
		'completion authoring executed or replaced the captured cartridge program');
};
const restore = async () => {
	for (let step = 0; model.buffer.getText() !== original && step < 30; step++) await press('ControlLeft', 'KeyZ');
	unchanged(original); t.assert(!model.dirty, 'ordinary Undo did not restore the pristine shipped working copy');
	await press('Escape');
};
const middle = async tail => {
	await press('ControlLeft', 'End'); await press('Enter'); await type(`retu${tail}()`);
	for (let index = 0; index < tail.length + 2; index++) await press('ArrowLeft');
	await type('r'); await t.frames(12);
	const pending = model.buffer.getText();
	t.assert(pending.endsWith(`retur${tail}()`) && code.context.view.cursorColumn === 5,
		'ordinary editing did not retain the exact prefix, source tail and issuing cursor');
	unchanged(pending); return pending;
};
// The same surviving '(' follows a replaced identifier, not the injected glyph's source column.
for (const variant of ['tiny', 'msx']) {
	const pending = await middle('_tail'); capture(`projection-${variant}-middle-pending-return-call`);
	await press('Tab'); unchanged(pending.slice(0, -12) + 'return()');
	capture(`projection-${variant}-middle-accepted-return-call`);
	await press('ControlLeft', 'KeyZ'); unchanged(pending); await restore();
	for (const target of ['before', 'ghost-right', 'surviving-paren']) {
		const source = await middle('_tail'), caret = { ...t.activeEditorDocument().nativeCaret };
		const x = caret.x + (target === 'before' ? -caret.width + 1 : target === 'ghost-right' ? caret.width - 1 : caret.width + 1);
		await click(x, caret.y + 2);
		const expectedColumn = target === 'before' ? 4 : target === 'ghost-right' ? 5 : 10;
		t.assert(code.context.view.cursorColumn === expectedColumn,
			`${variant}: clicking ${target} did not map the admitted displayed glyph to its exact original source boundary`);
		unchanged(source); await restore();
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
// One physical sash gesture reaches tiny's actual minimum; changing font applies the same retained sash intent.
t.command('gameView.togglePanel'); await t.frames(3);
t.controlInput([{ type: 'pointer', x: 222, y: 80 }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
t.controlInput([{ type: 'pointer', x: 50, y: 80 }]); await t.frames(2);
t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
for (const variant of ['tiny', 'msx']) {
	const caret = t.activeEditorDocument().nativeCaret; await click(caret.x + 1, caret.y + 2);
	t.assert(t.activeEditorDocument().focusTarget.hasFocus, 'the actual minimum-width source did not receive pointer focus');
	for (const theme of ['light', 'dark']) {
		await press('ControlLeft', 'End'); await press('Enter'); await type('title_scr'); await t.frames(12);
		const pending = model.buffer.getText(); unchanged(pending);
		capture(`projection-${variant}-${theme}-minimum-module-pending`);
		await press('Tab'); unchanged(pending.slice(0, -9) + 'title_screen_module');
		capture(`projection-${variant}-${theme}-minimum-module-accepted`);
		await press('ControlLeft', 'KeyZ'); unchanged(pending); await restore();
		if (theme === 'light') {
			const tail = '_abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz', source = await middle(tail);
			capture(`projection-${variant}-minimum-long-tail-pending`);
			await press('Tab'); unchanged(source.slice(0, -(5 + tail.length + 2)) + 'return()');
			capture(`projection-${variant}-minimum-long-tail-accepted`);
			await press('ControlLeft', 'KeyZ'); unchanged(source); await restore();
		}
		t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
t.command('gameView.closePanel'); await t.frames(2); unchanged(original);
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Completion projection workflow logged an error: ${t.logMessage(index).message}`);
