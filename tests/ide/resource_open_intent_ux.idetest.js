// Direct Files and Go-to-File side intents through ordinary Workbench input.
// Run: npm run ide:test -- nemesis_s tests/ide/resource_open_intent_ux.idetest.js --ttl 120
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const type = async text => {
	for (const character of text) await press(character === '/' ? 'Slash' : character === '.' ? 'Period'
		: character === ' ' ? 'Space' : `Key${character.toUpperCase()}`);
};
const search = async hint => {
	t.command('resourceSearch'); await t.frames(2);
	if (hint !== undefined) await capture(hint);
	await type('scenes/title.lua');
};
let captures = 0;
const capture = async label => {
	t.assert(++captures <= 24, 'resource-opening inspection exceeded its capture budget');
	await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label);
};
await t.waitForCart(); await t.frames(90); t.openLuaSource('cart.lua'); await t.frames(3);
await search(); await press('Enter'); await t.frames(3);
const original = t.activeWorkbenchTab(), model = original.workingCopy;
t.assert(original.kind === 'code_editor' && model.resource.path === 'scenes/title.lua', 'ordinary file opening lost its authored resource');
const source = model.buffer.getText(), version = model.version;
const cycles = t.runtime().machine.scheduler.nowCycles, media = t.sourceState().currentBlua32Media;
let sideSource, scene;
for (const font of ['tiny', 'msx']) {
	for (const theme of ['light', 'dark']) {
		await search(`intent-${font}-${theme}-go-to-file-hint`); await capture(`intent-${font}-${theme}-go-to-file`);
		await press('AltLeft', 'Enter'); await t.frames(3);
		const input = t.activeWorkbenchTab();
		t.assert(input.kind === 'code_editor' && input !== original && input.workingCopy === model,
			'Alt+Enter did not open an independent view in the invoking host neighbor');
		if (sideSource === undefined) sideSource = input;
		t.assert(input === sideSource && t.activeEditorDocument().focusTarget.hasFocus,
			'repeated search side placement replaced its neighbor or left the menu active');
		t.command('resources.focus'); await t.frames(2); t.command('resources'); await capture(`intent-${font}-${theme}-source-pair`);
		t.command('group.focusPrevious'); await t.frames(2);
		t.assert(t.activeWorkbenchTab() === original, 'Go to File changed or moved the invoking editor');
		t.command('resources.focus'); await t.frames(2); await press('ControlLeft', font === 'msx' ? 'NumpadEnter' : 'Enter'); await t.frames(3);
		t.assert(t.activeWorkbenchTab() === sideSource && t.activeEditorDocument().model === model,
			'Files keyboard side intent did not reuse the exact neighbor input');
		t.command('group.focusPrevious'); await t.frames(2); t.command('resources.focus'); await t.frames(2);
		await press('ContextMenu'); await capture(`intent-${font}-${theme}-files-shortcut`); await press('Escape');
		t.command('commandPalette'); await t.frames(2); await type('files open to side'); await press('Enter'); await t.frames(3);
		t.assert(t.activeWorkbenchTab() === sideSource, 'the palette lost the actual Files command subject or invoking group');
		t.command('group.focusPrevious'); await t.frames(2); t.command('resources.focus'); await t.frames(2);
		await press('ArrowRight'); await press('ArrowRight'); await press('ControlLeft', 'Enter'); await t.frames(3);
		const visual = t.activeWorkbenchTab();
		t.assert(visual.kind === 'scene_editor' && visual.workingCopy === model,
			'Files side intent on a declaration opened its file instead of its real contribution');
		if (scene === undefined) scene = visual;
		t.assert(visual === scene && t.workbenchTabs().includes(sideSource), 'declaration side opening multiplied or replaced retained views');
		t.command('resources'); await capture(`intent-${font}-${theme}-source-and-scene`);
		t.command('group.focusNext'); await t.frames(2);
		t.assert(t.activeWorkbenchTab() === original, 'side opening created an extra group rather than reusing its neighbor');
		t.assert(model.buffer.getText() === source && model.version === version && !model.dirty,
			'opening shortcuts or held release edited the canonical source');
		t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === media,
			'workspace opening gestures executed or replaced the paused program');
		t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Resource-opening workflow logged an error: ${t.logMessage(index).message}`);
