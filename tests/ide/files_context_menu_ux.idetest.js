// Real Files menus over shipped source; no injected tree, model edits or private popup API.
// Run: npm run ide:test -- nemesis_s tests/ide/files_context_menu_ux.idetest.js --ttl 120
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const type = async text => {
	for (const character of text) await press(character === '/' ? 'Slash' : character === '.' ? 'Period' : `Key${character.toUpperCase()}`);
};
let captures = 0;
const capture = async label => {
	t.assert(++captures <= 24, 'Files menu inspection exceeded its capture budget');
	await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label);
};
const openFile = async path => {
	t.command('resourceSearch'); await t.frames(2); await type(path); await press('Enter'); await t.frames(3);
	const input = t.activeWorkbenchTab();
	t.assert(input.kind === 'code_editor' && input.workingCopy.resource.path === path,
		'ordinary file navigation did not select the exact authored source');
	return input;
};
await t.waitForCart(); await t.frames(90); t.openLuaSource('cart.lua'); await t.frames(3);
const cycles = t.runtime().machine.scheduler.nowCycles, media = t.sourceState().currentBlua32Media;
const documents = new Map();
const unchanged = () => {
	for (const [model, snapshot] of documents) t.assert(model.buffer.getText() === snapshot.source
		&& model.version === snapshot.version && !model.dirty, 'Files menus wrote or replaced canonical source');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === media,
		'Files menu navigation executed or replaced the paused program');
};
for (const font of ['tiny', 'msx']) {
	for (const theme of ['light', 'dark']) {
		const source = await openFile('scenes/title.lua'), model = source.workingCopy;
		if (!documents.has(model)) documents.set(model, { source: model.buffer.getText(), version: model.version });
		t.command('resources.focus'); await t.frames(3);
		const code = t.activeEditorDocument();
		// These coordinates only deliver a secondary press into the first Files
		// row/gutter. Source identity and unchanged state, never pixels, are oracles.
		const y = code.geometry.clientBounds.top - (code.font.lineHeight + 3) + 2 + (Math.max(code.font.lineHeight, 7) + 2) / 2;
		t.controlInput([{ type: 'pointer', x: 10, y }, { type: 'button', button: 'secondary', down: true }]); await t.frames(2);
		t.controlInput([{ type: 'button', button: 'secondary', down: false }]); await t.frames(2);
		await capture(`files-${font}-${theme}-secondary-folder-menu`); await press('Escape');
		t.assert(t.activeWorkbenchTab() === source && !code.focusTarget.hasFocus,
			'secondary menu cancellation opened a resource or failed to return to Files');
		await openFile('scenes/title.lua'); t.command('resources.focus'); await t.frames(2);
		await press('ShiftLeft', 'F10'); await capture(`files-${font}-${theme}-file-menu`); await press('Escape');
		t.assert(t.activeWorkbenchTab() === source && !code.focusTarget.hasFocus, 'keyboard menu cancellation changed its resource or entered Source');
		await press('ContextMenu'); await press('Enter'); await t.frames(3);
		t.assert(t.activeWorkbenchTab() === source && t.activeEditorDocument().focusTarget.hasFocus,
			'Open did not reuse and focus the exact retained source input');
		t.command('resources.focus'); await t.frames(2); await press('ArrowLeft'); await press('ArrowLeft');
		await press('ContextMenu'); await capture(`files-${font}-${theme}-folder-disclosure`); await press('Enter');
		t.assert(t.activeWorkbenchTab() === source && !code.focusTarget.hasFocus, 'folder disclosure opened a source editor');
		await openFile('scenes/title.lua'); t.command('resources.focus'); await t.frames(2);
		await press('ArrowRight'); await press('ArrowRight');
		await press('ContextMenu'); await capture(`files-${font}-${theme}-declaration-menu`); await press('Enter'); await t.frames(3);
		const scene = t.activeWorkbenchTab();
		t.assert(scene.kind === 'scene_editor' && scene.workingCopy === model,
			'the declaration menu did not open its real Scene contribution over the canonical source');
		t.command('resources.focus'); await t.frames(2); await press('ShiftLeft', 'F10'); await press('ArrowDown'); await press('ArrowDown');
		await capture(`files-${font}-${theme}-declaration-source`); await press('Enter'); await t.frames(3);
		t.assert(t.activeWorkbenchTab() === source && t.activeEditorDocument().model === model && t.activeEditorDocument().focusTarget.hasFocus,
			'declaration Source did not return to the exact retained source input/model');
		unchanged(); t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Files menu workflow logged an error: ${t.logMessage(index).message}`);
