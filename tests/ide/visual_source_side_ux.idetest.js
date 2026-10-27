// Real visual-editor Source actions use the same groups as Files and Go to File.
// Run: npm run ide:test -- nemesis_s tests/ide/visual_source_side_ux.idetest.js --ttl 120
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const click = async bounds => {
	t.controlInput([{ type: 'pointer', x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 },
		{ type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
};
let captures = 0;
const capture = async label => {
	t.assert(++captures <= 16, 'visual Source inspection exceeded its capture budget');
	await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label);
};
await t.waitForCart(); await t.frames(90); t.openLuaSource('cart.lua'); await t.frames(3);
t.command('resourceSearch'); await t.frames(2);
for (const character of 'scenes/title.lua') await press(character === '/' ? 'Slash' : character === '.' ? 'Period' : `Key${character.toUpperCase()}`);
await press('Enter'); await t.frames(3);
const original = t.activeWorkbenchTab(), model = original.workingCopy;
t.assert(original.kind === 'code_editor' && model.resource.path === 'scenes/title.lua', 'the canonical authored source did not open');
const source = model.buffer.getText(), version = model.version, cycles = t.runtime().machine.scheduler.nowCycles;
const media = t.sourceState().currentBlua32Media;
t.command('resources.focus'); await t.frames(2); await press('ArrowRight'); await press('ArrowRight');
await press('Enter'); await t.frames(3);
const scene = t.activeWorkbenchTab();
t.assert(scene.kind === 'scene_editor' && scene.workingCopy === model, 'the real Scene contribution did not open over its canonical source');
t.command('resources'); await t.frames(2);
t.command('editor.sourceToSide'); await t.frames(3);
const sideSource = t.activeWorkbenchTab();
t.assert(sideSource.kind === 'code_editor' && sideSource !== original && sideSource.workingCopy === model,
	'direct Source to Side did not create an independent view in its actual right neighbor');
t.command('group.focusPrevious'); await t.frames(2);
t.assert(t.activeWorkbenchTab() === scene && t.workbenchTabs().includes(original), 'side opening replaced its invoking visual or original text view');
for (const font of ['tiny', 'msx']) {
	for (const theme of ['light', 'dark']) {
		t.assert(t.activeWorkbenchTab() === scene, 'the invoking Scene view was replaced');
		t.command('group.maximize'); await t.frames(2);
		const overflow = scene.actionBar.overflow;
		t.assert(overflow.button.visible, 'the Scene secondary source actions are unreachable');
		await click(overflow.button.bounds);
		await capture(`visual-source-${font}-${theme}-menu`);
		await press('Escape');
		t.assert(t.activeWorkbenchTab() === scene, 'cancelling Source placement replaced the visual editor');
		await click(overflow.button.bounds);
		const entries = overflow.items.filter(item => item.type === 'command');
		t.assert(entries[entries.length - 1].command === 'editor.sourceToSide', 'the visual editor has no explicit secondary Source to Side action');
		await press('End');
		await press('Enter'); await t.frames(3);
		t.assert(t.activeWorkbenchTab() === sideSource && t.activeEditorDocument().model === model,
			'direct Source to Side did not reuse the existing canonical text view');
		await capture(`visual-source-${font}-${theme}-pair`);
		t.command('group.focusPrevious'); await t.frames(2);
		t.assert(t.activeWorkbenchTab() === scene, 'Source to Side moved, replaced or hid its invoking Scene view');
		t.command('editor.source'); await t.frames(3);
		t.assert(t.activeWorkbenchTab() === original, 'ordinary Source did not follow the retained text-view affinity');
		t.command('navigateBack'); await t.frames(3);
		t.assert(t.activeWorkbenchTab() === scene, 'Source history did not return to the real visual-editor selection');
		t.assert(model.buffer.getText() === source && model.version === version && !model.dirty,
			'Source navigation altered the canonical authored text');
		t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === media,
			'authoring Source navigation executed or replaced the paused machine');
		await capture(`visual-source-${font}-${theme}-return`);
		t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Visual Source workflow logged an error: ${t.logMessage(index).message}`);
