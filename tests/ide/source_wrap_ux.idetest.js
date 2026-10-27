// Ordinary Source input, independent wrapping, tab reuse and horizontal reading.
// Run: npm run ide:test -- nemesis_s tests/ide/source_wrap_ux.idetest.js --ttl 120
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const type = async text => {
	for (const character of text) await press(character === '/' ? 'Slash' : character === '.' ? 'Period' : character === ' ' ? 'Space' : `Key${character.toUpperCase()}`);
};
let captures = 0;
const capture = async label => {
	t.assert(++captures <= 16, 'wrap inspection exceeded its capture budget');
	await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label);
};
const search = async path => {
	t.command('resourceSearch'); await t.frames(2); await type(path); await press('Enter'); await t.frames(3);
	const input = t.activeWorkbenchTab();
	t.assert(input.kind === 'code_editor' && input.workingCopy.resource.path === path, 'ordinary search admitted another source');
	return input;
};
await t.waitForCart(); await t.frames(90); t.openLuaSource('cart.lua'); await t.frames(3);
const original = await search('scenes/title.lua'), model = original.workingCopy;
const source = model.buffer.getText(), version = model.version, media = t.sourceState().currentBlua32Media;
const cycles = t.runtime().machine.scheduler.nowCycles;
t.command('resources.focus'); await t.frames(2); await press('ControlLeft', 'Enter'); await t.frames(3);
const title = t.activeWorkbenchTab(), control = t.activeEditorDocument();
t.assert(title.kind === 'code_editor' && title !== original && title.workingCopy === model, 'Files did not open an independent Source view');
t.command('resources'); await t.frames(2);
for (const font of ['tiny', 'msx']) {
	for (const theme of ['light', 'dark']) {
		t.assert(t.activeWorkbenchTab() === title && control.font.variant === font, 'the actual Source/font differs from the requested inspection case');
		t.assert(control.view.wordWrapEnabled && original.context.view.wordWrapEnabled, 'a previous case leaked its wrapping choice');
		await press('AltLeft', 'KeyZ');
		t.assert(!control.view.wordWrapEnabled && original.context.view.wordWrapEnabled, 'Alt+Z changed another view or failed to toggle the bound Source');
		await capture(`wrap-${font}-${theme}-independent`);
		const bounds = control.geometry.clientBounds;
		t.controlInput([{ type: 'pointer', x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 },
			{ type: 'key', code: 'ShiftLeft', down: true }, { type: 'wheel', deltaY: 12.375 }, { type: 'key', code: 'ShiftLeft', down: false }]);
		await t.frames(3);
		const readingLeft = title.context.view.scrollLeft;
		t.assert(readingLeft > 0, 'ordinary horizontal input did not pan the unwrapped Source');
		await capture(`wrap-${font}-${theme}-horizontal`);
		const other = await search('scenes/intro.lua');
		t.assert(t.activeEditorDocument() === control && control.view.wordWrapEnabled, 'the reused control leaked its previous input wrapping choice');
		t.assert(title.context.view.scrollLeft === readingLeft, 'rendering another tab erased the retained horizontal reading position');
		await capture(`wrap-${font}-${theme}-other-tab`);
		await press('ControlLeft', 'Tab');
		t.assert(t.activeWorkbenchTab() === title && !control.view.wordWrapEnabled && title.context.view.scrollLeft === readingLeft,
			'tab return lost the retained Source mode or reading position');
		t.assert(other.context.view.wordWrapEnabled, 'returning to Source changed the other input preference');
		t.command('commandPalette'); await t.frames(2); await type('word wrap');
		await capture(`wrap-${font}-${theme}-palette`); await press('Escape');
		t.assert(t.activeWorkbenchTab() === title && !control.view.wordWrapEnabled, 'cancelling the palette changed wrapping or its original subject');
		await press('AltLeft', 'KeyZ');
		t.assert(control.view.wordWrapEnabled && original.context.view.wordWrapEnabled, 'restoring wrapping changed the independent view');
		t.assert(model.buffer.getText() === source && model.version === version && !model.dirty,
			'presentation input edited the canonical source or its history');
		t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === media,
			'wrapping or source discovery executed/replaced the paused machine');
		t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Source wrap workflow logged an error: ${t.logMessage(index).message}`);
