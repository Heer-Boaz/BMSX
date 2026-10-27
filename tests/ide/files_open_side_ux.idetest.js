// Ordinary Files input opens canonical Source and its visual contribution side by side.
// Run: npm run ide:test -- nemesis_s tests/ide/files_open_side_ux.idetest.js --ttl 120
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const type = async text => {
	for (const character of text) await press(character === '/' ? 'Slash' : character === '.' ? 'Period' : `Key${character.toUpperCase()}`);
};
let captures = 0;
const capture = async label => {
	t.assert(++captures <= 20, 'side-opening inspection exceeded its capture budget');
	await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label);
};
const openSource = async () => {
	t.command('resourceSearch'); await t.frames(2); await type('scenes/title.lua'); await press('Enter'); await t.frames(3);
	const input = t.activeWorkbenchTab();
	t.assert(input.kind === 'code_editor' && input.workingCopy.resource.path === 'scenes/title.lua',
		'ordinary navigation did not admit the exact authored source');
	return input;
};
await t.waitForCart(); await t.frames(90); t.openLuaSource('cart.lua'); await t.frames(3);
const original = await openSource(), model = original.workingCopy;
const text = model.buffer.getText(), version = model.version;
const cycles = t.runtime().machine.scheduler.nowCycles, media = t.sourceState().currentBlua32Media;
let retainedScene, retainedSideSource;
const unchanged = () => {
	t.assert(model.buffer.getText() === text && model.version === version && !model.dirty,
		'side placement wrote or replaced the canonical authored source');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === media,
		'side placement executed or replaced the paused program');
};
for (const font of ['tiny', 'msx']) {
	for (const theme of ['light', 'dark']) {
		t.assert(await openSource() === original, 'ordinary Source navigation left the invoking retained view');
		t.command('resources.focus'); await t.frames(2);
		await press('ArrowRight'); await press('ArrowRight');
		await press('ContextMenu'); await press('ArrowDown');
		await capture(`side-${font}-${theme}-declaration-menu`); await press('Escape');
		t.assert(t.activeWorkbenchTab() === original && !t.activeEditorDocument().focusTarget.hasFocus,
			'cancelling side placement changed the active subject or left Files focus');
		await press('ShiftLeft', 'F10'); await press('ArrowDown'); await press('Enter'); await t.frames(3);
		const scene = t.activeWorkbenchTab();
		t.assert(scene.kind === 'scene_editor' && scene.workingCopy === model,
			'Open to Side did not admit the real visual editor over the canonical source');
		if (retainedScene === undefined) retainedScene = scene;
		t.assert(scene === retainedScene, 'repeated side placement duplicated the retained visual subject');
		t.command('resources'); await capture(`side-${font}-${theme}-source-and-scene`);
		t.command('group.focusPrevious'); await t.frames(2);
		t.assert(t.activeWorkbenchTab() === original && t.activeEditorDocument().model === model,
			'side opening replaced or moved the invoking Source input');
		t.command('group.maximize'); await t.frames(2);
		t.command('resources.focus'); await t.frames(2); await press('ContextMenu');
		await press('ArrowDown'); await press('ArrowDown'); await press('ArrowDown');
		await capture(`side-${font}-${theme}-source-menu`); await press('Enter'); await t.frames(3);
		const sideSource = t.activeWorkbenchTab();
		t.assert(sideSource.kind === 'code_editor' && sideSource !== original && sideSource.workingCopy === model,
			'Source to Side did not admit an independent view of the canonical owner');
		if (retainedSideSource === undefined) retainedSideSource = sideSource;
		t.assert(sideSource === retainedSideSource && t.workbenchTabs().includes(scene),
			'Source to Side lost the neighbor or created another hidden group');
		t.command('resources'); await capture(`side-${font}-${theme}-source-views`);
		t.command('group.focusNext'); await t.frames(2);
		t.assert(t.activeWorkbenchTab() === original,
			'maximized side placement created an extra group instead of reusing the actual neighbor');
		unchanged(); t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Side-opening workflow logged an error: ${t.logMessage(index).message}`);
