// Files owns folder selection; successful navigation owns editor focus.
// Run: npm run ide:test -- nemesis_s tests/ide/files_focus_ux.idetest.js
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const click = async (x, y) => {
	t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(3);
};
const capture = async label => { t.controlInput([{ type: 'pointer', x: 382, y: 285 }]); await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label); };
await t.waitForCart(); await t.frames(90); t.openLuaSource('cart.lua'); await t.frames(2);
const cart = t.activeWorkbenchTab(), model = cart.context.model, source = model.buffer.getText(), version = model.version;
const cycles = t.runtime().machine.scheduler.nowCycles, media = t.sourceState().currentBlua32Media;
let system;
const unchanged = () => {
	t.assert(model.buffer.getText() === source && model.version === version && !model.dirty, 'Files interaction changed the authored cartridge source');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === media, 'Files navigation executed or replaced the guest');
};
const systemEditor = async () => {
	const opened = t.activeWorkbenchTab();
	t.assert(opened.kind === 'code_editor' && opened !== cart && opened.context.model.resource.domain === -1
		&& opened.context.model.resource.path === 'bmsx/blua32.lua', 'Files did not open the real selected system source');
	if (system === undefined) system = { input: opened, source: opened.context.model.buffer.getText(), version: opened.context.model.version };
	t.assert(opened === system.input && opened.context.model.buffer.getText() === system.source
		&& opened.context.model.version === system.version && !opened.context.model.dirty, 'Files recreated or edited the canonical system document');
	await press('ControlLeft', 'Home');
	t.assert(opened.context.view.cursorRow === 0 && opened.context.view.cursorColumn === 0, 'completed navigation did not focus its actual editor');
	await press('ArrowDown');
	t.assert(opened.context.view.cursorRow === 1, 'the opened editor did not receive subsequent keyboard navigation');
	unchanged();
};
for (const [font, lineHeight] of [['tiny', 6], ['msx', 8]]) {
	// The authored two short tabs fit on one row. Pointer coordinates follow
	// their visible chrome and the actual font's resource-row height.
	const contentTop = (lineHeight + 4) + (lineHeight + 3) + 2 + 2;
	for (const theme of ['light', 'dark']) {
		t.openLuaSource('cart.lua'); await t.frames(2); await press('ControlLeft', 'Home');
		await press('ControlLeft', 'KeyB'); await press('Home');
		await click(18, contentTop + lineHeight / 2); await press('ArrowDown');
		t.assert(t.activeWorkbenchTab() === cart && cart.context.view.cursorRow === 0 && cart.context.view.cursorColumn === 0,
			'clicking a resource root/folder leaked keyboard focus to the underlying source');
		await capture(`files-folder-focus-${font}-${theme}`); unchanged();
		await press('Home'); for (let row = 0; row < 3; row++) await press('ArrowDown'); await press('Enter');
		await systemEditor(); await capture(`files-keyboard-open-${font}-${theme}`);
		t.openLuaSource('cart.lua'); await t.frames(2); await press('ControlLeft', 'Home');
		await press('ControlLeft', 'KeyB'); await press('Home');
		await click(18, contentTop + 3 * lineHeight + lineHeight / 2);
		await systemEditor(); await capture(`files-pointer-open-${font}-${theme}`);
		await press('ControlLeft', 'Home'); await press('ControlLeft', 'KeyB');
		await capture(`files-current-resource-${font}-${theme}`);
		await press('Enter'); await press('ArrowDown');
		t.assert(t.activeWorkbenchTab() === system.input && system.input.context.view.cursorRow === 1,
			'reopening Files lost the resource selected by the completed navigation');
		t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
unchanged();
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Files focus workflow logged an error: ${t.logMessage(index).message}`);
