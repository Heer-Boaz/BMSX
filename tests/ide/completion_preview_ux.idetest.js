// Actual Lua auto-completion over the canonical shipped source; no synthetic provider or model writes.
// Run: npm run ide:test -- nemesis_s tests/ide/completion_preview_ux.idetest.js --ttl 120
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
let captures = 0;
const capture = label => {
	t.assert(++captures <= 22, 'the completion workflow exceeded its bounded capture budget');
	t.log(`VISUAL ${label}`); t.capture(label);
};
await t.waitForCart(); await t.frames(90);
t.openLuaSource('cart.lua'); await t.frames(3);
const code = t.activeWorkbenchTab(), model = code.workingCopy, original = model.buffer.getText();
const cycles = t.runtime().machine.scheduler.nowCycles;
t.assert(code.kind === 'code_editor' && model.resource.path === 'cart.lua' && !model.dirty,
	'the actual clean cartridge entry did not open');
const paused = () => t.assert(t.runtime().machine.scheduler.nowCycles === cycles, 'completion authoring executed the paused guest');
const restore = async () => {
	for (let step = 0; model.buffer.getText() !== original && step < 20; step++) await press('ControlLeft', 'KeyZ');
	t.assert(model.buffer.getText() === original && !model.dirty, 'ordinary document Undo did not restore exact shipped source bytes');
	paused();
};
const typePrefix = async prefix => {
	await press('ControlLeft', 'End'); await press('Enter');
	for (const character of prefix) await press(`Key${character.toUpperCase()}`);
	const pending = model.buffer.getText();
	t.assert(pending.endsWith(prefix) && model.dirty, 'ordinary Lua typing did not produce the exact pending prefix');
	// The native typing event resets the caret. This exceeds the 160 ms auto-trigger delay,
	// but remains inside its initial visible phase at the real headless frame interval.
	await t.frames(12);
	t.assert(model.buffer.getText() === pending, 'opening the automatic preview modified the canonical source');
	paused(); return pending;
};
for (const variant of ['tiny', 'msx']) {
	for (const theme of ['light', 'dark']) {
		for (const [prefix, completion] of [['retur', 'return'], ['fun', 'function']]) {
			const pending = await typePrefix(prefix);
			capture(`completion-${variant}-${theme}-${prefix}-caret-on`);
			await t.frames(27);
			capture(`completion-${variant}-${theme}-${prefix}-caret-off`);
			t.assert(model.buffer.getText() === pending, 'the unaccepted ghost or caret blink changed source bytes');
			await press('Tab');
			const expected = pending.slice(0, -prefix.length) + completion;
			t.assert(model.buffer.getText() === expected, 'Tab did not accept the actual automatic suggestion exactly once');
			await t.frames(3);
			t.assert(model.buffer.getText() === expected, 'a late Tab occurrence repeated the completion');
			await press('ControlLeft', 'KeyZ');
			t.assert(model.buffer.getText() === pending, 'completion acceptance did not retain its own document Undo step');
			await restore();
		}
		const pending = await typePrefix('retur');
		await press('Escape');
		t.assert(model.buffer.getText() === pending, 'dismissing an automatic preview changed the pending source');
		await press('ControlLeft', 'Space');
		t.assert(model.buffer.getText() === pending, 'explicit completion triggering edited the source');
		capture(`completion-${variant}-${theme}-manual-popup`);
		await press('Escape');
		t.assert(model.buffer.getText() === pending, 'dismissing the manual popup changed source bytes');
		await restore();
		t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
// A completion belongs to its source input, not merely to the shared Lua editor focus target.
t.openLuaSource('director.lua'); await t.frames(2); await press('ControlLeft', 'Home');
const other = t.activeWorkbenchTab(), otherModel = other.workingCopy, otherOriginal = otherModel.buffer.getText();
t.assert(other.kind === 'code_editor' && otherModel.resource.path === 'director.lua' && !otherModel.dirty,
	'the second canonical Lua source did not open cleanly');
t.openLuaSource('cart.lua'); await t.frames(2);
t.assert(t.activeWorkbenchTab() === code, 'source navigation replaced the canonical cartridge input');
const pending = await typePrefix('retur');
await press('ControlLeft', 'Tab');
t.assert(t.activeWorkbenchTab() === other && other.context.view.cursorRow === 0 && other.context.view.cursorColumn === 0,
	'physical CtrlTab did not restore the retained second source and its actual cursor');
t.assert(otherModel.buffer.getText() === otherOriginal, 'switching sources edited the newly active document');
capture('completion-source-switch-before-ordinary-tab');
await press('Tab');
t.assert(otherModel.buffer.getText() === otherModel.language.indentationUnit + otherOriginal,
	'a completion from the old input replaced source in the newly active Lua document');
t.assert(model.buffer.getText() === pending, 'source switching committed the old input completion');
capture('completion-source-switch-ordinary-tab-only');
await press('ControlLeft', 'KeyZ');
t.assert(otherModel.buffer.getText() === otherOriginal && !otherModel.dirty,
	'ordinary Tab Undo did not restore the second canonical source');
await press('ControlLeft', 'ShiftLeft', 'Tab');
t.assert(t.activeWorkbenchTab() === code, 'physical previous-tab navigation lost the retained cartridge input');
await restore();
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Completion preview workflow logged an error: ${t.logMessage(index).message}`);
