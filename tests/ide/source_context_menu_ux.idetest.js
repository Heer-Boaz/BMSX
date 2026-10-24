// Actual source-menu history and clipboard actions retain the invoking document.
// Run: npm run ide:test -- nemesis_s tests/ide/source_context_menu_ux.idetest.js
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const capture = async label => { await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label); };
await t.waitForCart(); await t.frames(90); t.openLuaSource('cart.lua'); await t.frames(2);
const input = t.activeWorkbenchTab(), model = input.workingCopy, original = model.buffer.getText();
const cycles = t.runtime().machine.scheduler.nowCycles;
for (const font of ['tiny', 'msx']) {
	await press('ControlLeft', 'Home'); await press('Space'); await press('ArrowLeft');
	await press('ShiftLeft', 'F10'); await press('Home'); await capture(`source-menu-${font}-undo`); await press('Enter');
	t.assert(model.buffer.getText() === original && !model.dirty, 'the source menu did not Undo its invoking document');
	// The end-of-file blank line has the ordinary history/clipboard menu, not identifier actions.
	await press('ControlLeft', 'End');
	await press('ShiftLeft', 'F10'); await press('Home'); await capture(`source-menu-${font}-redo`); await press('Enter');
	t.assert(model.buffer.getText() === ' ' + original, 'the source menu did not Redo the same canonical edit');
	await press('ControlLeft', 'Home'); await press('ArrowRight'); await press('ShiftLeft', 'ArrowLeft');
	await press('ShiftLeft', 'F10'); await press('Home'); await press('ArrowDown'); await press('ArrowDown');
	await capture(`source-menu-${font}-copy`); await press('Enter');
	await press('ControlLeft', 'Home');
	await press('ShiftLeft', 'F10'); await press('End'); await capture(`source-menu-${font}-paste`); await press('Enter');
	t.assert(model.buffer.getText() === '  ' + original, 'menu Copy/Paste lost the exact selected source bytes or used popup focus');
	await press('ControlLeft', 'KeyZ'); await press('ControlLeft', 'KeyZ');
	t.assert(t.activeWorkbenchTab() === input && input.workingCopy === model && t.activeEditorDocument().focusTarget.hasFocus,
		'menu execution replaced the invoking source model or lost source focus');
	t.assert(model.buffer.getText() === original && !model.dirty, 'menu history did not restore the original canonical source');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles, 'source menu interaction advanced the paused guest');
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Source menu workflow logged an error: ${t.logMessage(index).message}`);
