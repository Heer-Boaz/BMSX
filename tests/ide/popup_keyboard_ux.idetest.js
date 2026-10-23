// Actual modal query history must never borrow the dirty document's Undo or reopen the Palette.
// Run: npm run ide:test -- nemesis_s tests/ide/popup_keyboard_ux.idetest.js
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const capture = async label => { await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label); };
await t.waitForCart(); await t.frames(90);
t.openLuaSource('cart.lua'); await t.frames(2);
const code = t.activeWorkbenchTab(), model = code.workingCopy, original = model.buffer.getText();
t.assert(code.kind === 'code_editor' && model.resource.path === 'cart.lua' && !model.dirty,
	'the canonical clean cartridge entry did not open');
// Bind the real actor once; subsequent Palette Open must route directly to this retained input.
t.command('actorLab'); await t.frames(2); await press('Enter');
const actor = t.activeWorkbenchTab();
t.assert(actor.kind === 'actor_lab' && actor.actorPresent && actor.outline.rows[0].element.node.name === 'nemesis_s.intro',
	'the actual Intro actor did not bind through its ordinary picker');
t.openLuaSource('cart.lua'); await t.frames(2);
const cycles = t.runtime().machine.scheduler.nowCycles;
const pendingDocument = () => {
	t.assert(model.buffer.getText() === ' ' + original && model.dirty,
		'a modal keyboard occurrence changed or undid the underlying source edit');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles, 'modal editing advanced the paused guest');
};
for (const variant of ['tiny', 'msx']) {
	t.assert(t.activeWorkbenchTab() === code, 'ordinary source navigation replaced its retained input');
	await press('ControlLeft', 'Home'); await press('Space'); pendingDocument();
	await press('ControlLeft', 'ShiftLeft', 'KeyP');
	await press('ControlLeft', 'KeyZ'); pendingDocument();
	await capture(`popup-keyboard-${variant}-empty-local-undo`);
	for (const character of 'actor lab openx') await press(character === ' ' ? 'Space' : `Key${character.toUpperCase()}`);
	// A global Palette reopening would erase this query and its local history.
	await press('ControlLeft', 'ShiftLeft', 'KeyP'); pendingDocument();
	await press('ControlLeft', 'KeyZ'); pendingDocument();
	await press('ControlLeft', 'KeyY'); pendingDocument();
	await press('Enter');
	t.assert(t.activeWorkbenchTab() === code, 'local Redo failed to restore the unmatched query before submission');
	pendingDocument();
	await press('ControlLeft', 'KeyZ'); pendingDocument();
	await capture(`popup-keyboard-${variant}-query-local-undo-redo`);
	await press('Enter');
	t.assert(t.activeWorkbenchTab() === actor && actor.actorPresent && actor.layout.font.variant === variant,
		'local query Undo/Redo or blocked Palette shortcut lost the exact Actor Lab command route or intended font');
	pendingDocument(); await capture(`popup-keyboard-${variant}-routed-actor-lab`);
	t.openLuaSource('cart.lua'); await t.frames(2);
	t.assert(t.activeWorkbenchTab() === code && code.workingCopy === model, 'Actor Lab return lost the canonical dirty working copy');
	await press('ControlLeft', 'KeyZ');
	t.assert(model.buffer.getText() === original && !model.dirty,
		'ordinary document Undo did not restore the one untouched canonical source step');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles, 'document return advanced the paused guest');
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}

// Tab commands have an explicit scope, not a workbench shortcut bypass around the query.
const retainedTabs = t.workbenchTabs().slice();
await press('ControlLeft', 'Home'); await press('Space'); pendingDocument();
await press('ControlLeft', 'ShiftLeft', 'KeyP');
for (const character of 'actor lab openx') await press(character === ' ' ? 'Space' : `Key${character.toUpperCase()}`);
for (const codes of [['ControlLeft', 'KeyW'], ['ControlLeft', 'Tab'], ['ControlLeft', 'ShiftLeft', 'Tab']]) {
	await press(...codes);
	t.assert(t.activeWorkbenchTab() === code && t.workbenchTabs().length === retainedTabs.length
		&& t.workbenchTabs().every((tab, index) => tab === retainedTabs[index]),
		'a tab shortcut escaped the modal query and closed or switched a retained editor');
	pendingDocument();
}
await press('ControlLeft', 'KeyZ'); await press('Enter');
t.assert(t.activeWorkbenchTab() === actor && actor.actorPresent,
	'blocked tab shortcuts reset the retained modal query or its local history');
pendingDocument(); await capture('popup-keyboard-tab-shortcuts-remain-isolated');
t.openLuaSource('cart.lua'); await t.frames(2); await press('ControlLeft', 'KeyZ');
t.assert(t.activeWorkbenchTab() === code && code.workingCopy === model && model.buffer.getText() === original && !model.dirty,
	'query dismissal lost the canonical source or its one document Undo step');
const codeIndex = retainedTabs.indexOf(code), next = retainedTabs[(codeIndex + 1) % retainedTabs.length];
t.assert(next === actor, 'the fixture no longer has its actual retained Actor Lab adjacent to the source');
await press('ControlLeft', 'Tab');
t.assert(t.activeWorkbenchTab() === next, 'normal CtrlTab did not use the actual next retained input');
await press('ControlLeft', 'ShiftLeft', 'Tab');
t.assert(t.activeWorkbenchTab() === code, 'normal CtrlShiftTab did not return to the original source input');
await press('ControlLeft', 'Tab'); await press('ControlLeft', 'KeyW');
t.assert(t.activeWorkbenchTab() === code && !t.workbenchTabs().includes(actor)
	&& t.workbenchTabs().length === retainedTabs.length - 1, 'normal CtrlW did not close exactly the clean bound Actor Lab input');
t.assert(model.buffer.getText() === original && !model.dirty && t.runtime().machine.scheduler.nowCycles === cycles,
	'ordinary tab navigation changed canonical source or executed the paused guest');
await capture('popup-keyboard-normal-tab-route-and-close');
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Popup keyboard workflow logged an error: ${t.logMessage(index).message}`);
