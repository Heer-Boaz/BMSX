// Home is workspace content; real actions open retained editors without booting or authoring source.
// Run: npm run ide:test -- nemesis_s tests/ide/studio_home_ux.idetest.js
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const clickAction = async item => {
	// The retained control's published hit target drives input; no pixel coordinate is an oracle.
	const { left, top, right, bottom } = item.bounds;
	t.controlInput([{ type: 'pointer', x: (left + right) / 2, y: (top + bottom) / 2 }, { type: 'button', button: 'primary', down: true }]);
	await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(3);
};
const capture = async label => { await t.frames(3); t.log(`VISUAL ${label}`); t.capture(label); };
await t.waitForCart(); await t.frames(90);
const home = t.activeWorkbenchTab();
t.assert(home.kind === 'home' && home.resource === undefined && !home.isDirty(), 'first-start Studio did not select its ordinary workspace Home input');
t.assert(t.workbenchTabs().length === 1, 'first-start Home manufactured an unused source editor');
await press('ControlRight', 'ShiftRight'); await t.frames(3);
t.assert(t.workbenchActive(), 'the native workbench shortcut did not reveal Studio');
const cycles = t.runtime().machine.scheduler.nowCycles, media = t.sourceState().currentBlua32Media;
let source;
const unchanged = () => {
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === media, 'Home executed or installed a program');
	if (source !== undefined) t.assert(source.input.workingCopy.buffer.getText() === source.text && source.input.workingCopy.version === source.version
		&& !source.input.workingCopy.dirty, 'Home replaced or authored the retained source working copy');
};
for (const font of ['tiny', 'msx']) {
	for (const theme of ['light', 'dark']) {
		t.command('home'); await t.frames(3);
		t.assert(t.activeWorkbenchTab() === home && t.workbenchTabs().filter(input => input.kind === 'home').length === 1, 'Home navigation opened a duplicate or lost its workspace input');
		await capture(`home-${font}-${theme}-workspace`);
		// Vertical action navigation uses ordinary key ownership, not a page-specific command route.
		await press('Home'); await press('ArrowDown'); await press('Enter');
		for (const code of ['KeyC', 'KeyA', 'KeyR', 'KeyT', 'Period', 'KeyL', 'KeyU', 'KeyA']) await press(code);
		await press('Enter'); await t.frames(4);
		const opened = t.activeWorkbenchTab();
		t.assert(opened.kind === 'code_editor' && opened.workingCopy.resource.path === 'cart.lua', 'Home Go to File did not open the selected canonical source');
		if (source === undefined) source = { input: opened, text: opened.workingCopy.buffer.getText(), version: opened.workingCopy.version };
		t.assert(opened === source.input && t.activeEditorDocument().focusTarget.hasFocus, 'Home action did not reuse and focus the retained Source editor');
		t.command('home'); await t.frames(3);
		await clickAction(home.sections[0].actions.items.find(item => item.command === 'resources.focus'));
		t.assert(t.activeWorkbenchTab() === home, 'focusing Files replaced the central workspace editor');
		t.command('home'); await t.frames(3); await capture(`home-${font}-${theme}-beside-files`);
		await press('Escape'); await press('PageDown'); await capture(`home-${font}-${theme}-scroll`);
		unchanged();
		t.command('resources'); // This scenario deliberately opened Files above; preserve the separate toggle command.
		t.command('home'); await t.frames(3);
		await press('ControlLeft', 'AltLeft', 'KeyT');
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
t.command('tabs.close'); await t.frames(3);
t.assert(!t.workbenchTabs().includes(home) && t.activeWorkbenchTab() === source.input, 'closing Home did not return to the retained adjacent editor');
unchanged();
t.command('home'); await t.frames(3);
t.assert(t.activeWorkbenchTab().kind === 'home' && t.activeWorkbenchTab() !== home && t.activeWorkbenchTab().workspaceRoot === home.workspaceRoot,
	'the permanent Home command did not recreate a closed workspace page against the same attached workspace');
unchanged();
