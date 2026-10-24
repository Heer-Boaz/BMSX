// Files retains typed folder navigation; only a successful file open transfers source focus.
// Run: npm run ide:test -- nemesis_s tests/ide/files_focus_ux.idetest.js
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const click = async (x, y) => {
	t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(3);
};
const capture = async label => {
	t.controlInput([{ type: 'pointer', x: 382, y: 285 }]); await t.frames(2);
	t.log(`VISUAL ${label}`); t.capture(label);
};
await t.waitForCart(); await t.frames(90); t.openLuaSource('cart.lua'); await t.frames(2);
const cart = t.activeWorkbenchTab(), model = cart.context.model, source = model.buffer.getText(), version = model.version;
const cycles = t.runtime().machine.scheduler.nowCycles, media = t.sourceState().currentBlua32Media;
let system;
const unchanged = () => {
	t.assert(model.buffer.getText() === source && model.version === version && !model.dirty, 'Files changed the canonical cartridge document');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === media, 'Files executed or replaced the paused program');
	if (system !== undefined) t.assert(system.input.context.model.buffer.getText() === system.source
		&& system.input.context.model.version === system.version && !system.input.context.model.dirty, 'Files changed the canonical system document');
};
const folderOwnsFocus = () => {
	t.assert(t.activeWorkbenchTab() === cart && !t.activeEditorDocument().focusTarget.hasFocus,
		'folder navigation opened a file or transferred keyboard focus to source');
	t.assert(cart.context.view.cursorRow === 0 && cart.context.view.cursorColumn === 0 && cart.context.view.selectionAnchor === null,
		'folder navigation changed the source cursor or selection');
	unchanged();
};
const systemEditor = async () => {
	const opened = t.activeWorkbenchTab();
	t.assert(opened.kind === 'code_editor' && opened.context.model.resource.domain === -1
		&& opened.context.model.resource.path === 'bmsx/blua32.lua', 'tree navigation did not open the exact selected BIOS resource');
	if (system === undefined) system = { input: opened, model: opened.context.model, source: opened.context.model.buffer.getText(), version: opened.context.model.version };
	t.assert(opened === system.input && opened.context.model === system.model, 'Files replaced the retained system input/model');
	t.assert(t.activeEditorDocument().focusTarget.hasFocus, 'successful file navigation did not focus its actual source target');
	await press('ControlLeft', 'Home'); await press('ArrowDown');
	t.assert(opened.context.view.cursorRow === 1 && opened.context.view.cursorColumn === 0 && opened.context.view.selectionAnchor === null,
		'the opened source did not receive ordinary keyboard navigation');
	unchanged();
};
const showBmsxExpanded = async () => {
	t.openLuaSource('cart.lua'); await t.frames(2); await press('ControlLeft', 'Home');
	await press('ControlLeft', 'KeyB'); await press('Home'); await press('ArrowRight');
	folderOwnsFocus();
};
// First entry is a distinct product contract: System starts closed. Slot roots remain expanded.
await press('ControlLeft', 'Home'); await press('ControlLeft', 'KeyB'); await press('Home');
folderOwnsFocus(); await capture('files-bios-initially-closed');
await press('ArrowRight'); await press('ArrowDown'); await press('ArrowRight'); await press('ArrowDown');
folderOwnsFocus(); await press('Enter'); await systemEditor(); await capture('files-bios-default-keyboard-open');
for (const [font, lineHeight, rowHeight] of [['tiny', 6, 9], ['msx', 8, 10]]) {
	// Coordinates drive the existing canvas only; resource identity/focus, never pixels, are the oracles.
	const contentTop = (lineHeight + 4) + (lineHeight + 3) + 2 + 2;
	for (const theme of ['light', 'dark']) {
		// System and bmsx are expanded after the preceding actual BIOS navigation.
		await showBmsxExpanded(); await press('ArrowLeft'); folderOwnsFocus();
		await press('ArrowRight'); folderOwnsFocus(); await capture(`files-keyboard-folder-${font}-${theme}`);
		await press('ArrowRight'); await press('Enter'); await systemEditor();

		await showBmsxExpanded(); await press('ArrowLeft'); folderOwnsFocus();
		await press('Escape'); t.assert(t.activeEditorDocument().focusTarget.hasFocus, 'hiding Files did not return source focus');
		await press('ControlLeft', 'KeyB'); folderOwnsFocus();
		// A real catalog refresh must retain the selected folder, not its previous row ordinal.
		await press('ControlLeft', 'ShiftLeft', 'KeyL'); await press('ControlLeft', 'ShiftLeft', 'KeyL');
		folderOwnsFocus(); await capture(`files-retained-collapsed-${font}-${theme}`);
		await press('ArrowRight'); await press('ArrowDown'); await press('Enter'); await systemEditor();

		await showBmsxExpanded(); await press('Enter'); folderOwnsFocus();
		await capture(`files-enter-collapsed-${font}-${theme}`);
		await press('Enter'); await press('ArrowRight'); await press('Enter'); await systemEditor();

		await showBmsxExpanded();
		await click(20, contentTop + rowHeight + rowHeight / 2); folderOwnsFocus();
		await capture(`files-pointer-collapsed-${font}-${theme}`);
		// If the click merely selects instead of collapsing, Right descends and Down opens a different file.
		await press('ArrowRight'); await press('ArrowDown'); await press('Enter'); await systemEditor();
		await capture(`files-pointer-open-${font}-${theme}`);
		await press('ControlLeft', 'AltLeft', 'KeyT');
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
unchanged();
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Files workflow logged an error: ${t.logMessage(index).message}`);
