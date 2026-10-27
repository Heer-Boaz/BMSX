// Real Workbench groups, floating hosts and keyboard tab subjects over shipped source.
// Run: npm run ide:test -- nemesis_s tests/ide/workspace_group_ux.idetest.js --ttl 120
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const type = async text => {
	for (const character of text)
		await press(character === ' ' ? 'Space' : character === '2' ? 'Digit2' : `Key${character.toUpperCase()}`);
};
let captures = 0;
const capture = async label => {
	t.assert(++captures <= 32, 'workspace group inspection exceeded its capture budget');
	await t.frames(3); t.log(`VISUAL ${label}`); t.capture(label);
};
await t.waitForCart(); await t.frames(90);
const documents = [];
for (const path of ['cart.lua', 'intro.lua', 'director.lua']) {
	t.openLuaSource(path); await t.frames(3);
	const input = t.activeWorkbenchTab(), model = input.workingCopy;
	t.assert(input.kind === 'code_editor' && model.resource.path === path && !model.dirty,
		'ordinary source navigation did not admit its exact clean working copy');
	documents.push({ input, model, source: model.buffer.getText(), version: model.version });
}
const originalTabs = [...t.workbenchTabs()], director = documents[2];
const cycles = t.runtime().machine.scheduler.nowCycles, media = t.sourceState().currentBlua32Media;
const unchanged = () => {
	for (const document of documents)
		t.assert(document.model.buffer.getText() === document.source && document.model.version === document.version && !document.model.dirty,
			'workspace presentation changed authored source or its canonical generation');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === media,
		'workspace presentation executed or replaced the paused guest');
};
await capture('workspace-main-source');
t.command('group.splitRight'); await t.frames(3);
t.assert(t.activeWorkbenchTab() === null && t.workbenchTabs().length === 0, 'split fabricated an editor in the new group');
await capture('workspace-empty-neighbour');
t.command('group.focusPrevious'); await t.frames(2);
t.assert(t.activeWorkbenchTab() === director.input, 'group navigation lost its retained Source');
t.command('window.copyEditor'); await t.frames(3);
const view = t.activeWorkbenchTab();
t.assert(view !== director.input && view.kind === 'code_editor' && view.workingCopy === director.model,
	'additional window did not create an independent view over the canonical document');
await capture('workspace-floating-source');
t.command('window.snapRight'); await capture('workspace-floating-snapped');
t.command('window.maximize'); await capture('workspace-floating-maximized');
t.command('window.restore'); await t.frames(2);
t.command('group.focusTabs'); await t.frames(2);
await press('ContextMenu'); await capture('workspace-floating-tab-menu'); await press('Escape');
t.assert(t.activeWorkbenchTab() === view && !t.activeEditorDocument().focusTarget.hasFocus,
	'tab-menu cancellation acquired content focus or replaced its view');

// Select the explicit empty receiving group through the ordinary move chooser.
// The text is user input, not a wording assertion or a private picker/model write.
t.command('group.move'); await t.frames(2); await type('merge group 2');
await capture('workspace-group-move-chooser');
await press('Enter'); await t.frames(3);
t.assert(t.activeWorkbenchTab() === view && t.workbenchTabs().length === 1 && view.workingCopy === director.model,
	'whole-group docking lost the receiving view or canonical document');
unchanged();
t.command('group.focusPrevious'); await t.frames(2);
t.assert(t.activeWorkbenchTab() === director.input && originalTabs.every(input => t.workbenchTabs().includes(input)),
	'docking another group retired or replaced the original group inputs');

for (const font of ['tiny', 'msx']) {
	for (const theme of ['light', 'dark']) {
		t.command('group.focusTabs'); await press('Home'); await press('ArrowRight');
		t.assert(t.activeWorkbenchTab() === director.input && !t.activeEditorDocument().focusTarget.hasFocus,
			'roving tab focus activated or rebound an unrelated Source pane');
		await capture(`workspace-${font}-${theme}-inactive-tab-focus`);
		await press('ShiftLeft', 'F10'); await capture(`workspace-${font}-${theme}-inactive-tab-menu`); await press('Escape');
		t.assert(t.activeWorkbenchTab() === director.input, 'tab-menu dismissal changed editor selection');
		await press('Enter'); await t.frames(2);
		t.assert(t.activeWorkbenchTab() === documents[0].input && !t.activeEditorDocument().focusTarget.hasFocus,
			'matching tab activation did not retain the exact input and keyboard tab focus');
		await press('Escape');
		t.assert(t.activeEditorDocument().focusTarget.hasFocus, 'Escape did not enter the selected Source');
		t.command('group.focusNext'); await t.frames(2);
		t.assert(t.activeWorkbenchTab() === view, 'the receiving group no longer retains its independent Source view');
		t.command('group.maximize'); await capture(`workspace-${font}-${theme}-maximized-group`);
		t.command('group.maximize'); await t.frames(2);
		t.command('group.focusPrevious'); await t.frames(2);
		t.command('group.focusTabs'); await press('End'); await press('Enter'); await press('Escape');
		t.assert(t.activeWorkbenchTab() === director.input, 'returning to the original group lost its retained source selection');
		t.command('openEditors'); await t.frames(2); await type('director');
		await capture(`workspace-${font}-${theme}-editor-search`); await press('Enter');
		t.assert(t.activeWorkbenchTab() === director.input,
			'workspace editor search did not reveal the exact retained view in its invoking group');
		t.command('group.openEditors'); await t.frames(2); await type('intro');
		await capture(`workspace-${font}-${theme}-group-search`); await press('Enter');
		t.assert(t.activeWorkbenchTab() === documents[1].input,
			'group editor search did not activate its retained inactive source');
		t.command('group.focusTabs'); await press('End'); await press('Enter'); await press('Escape');
		t.assert(t.activeWorkbenchTab() === director.input, 'editor-search navigation lost the original source input');
		unchanged(); t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
// Accept Close on the inactive tab: a File-menu invocation would instead close
// the selected Director editor, so this proves the actual contextual subject.
t.command('group.focusTabs'); await press('Home'); await press('ArrowRight');
await press('ShiftLeft', 'F10'); await press('End'); await press('Enter'); await t.frames(2);
t.assert(t.activeWorkbenchTab() === director.input && !t.workbenchTabs().includes(documents[0].input),
	'keyboard context-menu Close did not address the inactive tab exclusively');
await capture('workspace-inactive-tab-closed');
t.command('window.showAll'); await capture('workspace-window-picker-after-docking'); await press('Escape');
unchanged();
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Workspace group inspection logged an error: ${t.logMessage(index).message}`);
