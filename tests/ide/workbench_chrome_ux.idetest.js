// Real menu admission, command ownership and focus over the shipped cartridge.
// Run: npm run ide:test -- nemesis_s tests/ide/workbench_chrome_ux.idetest.js
// Coordinates drive actual affordances; source/history/focus outcomes are the oracles.
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const click = async (x, y) => {
	t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
};
const capture = async label => { await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label); };
const hideTimelineContext = async input => {
	const x = (input.layout.left + input.layout.right) / 2;
	const y = input.layout.bottom + input.layout.font.lineHeight / 2 + 2;
	t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'secondary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'button', button: 'secondary', down: false }]); await t.frames(2);
	await press('Home'); await press('Enter'); await t.frames(3);
};

await t.waitForCart(); await t.frames(90); t.openLuaSource('cart.lua'); await t.frames(3);
let input = t.activeWorkbenchTab();
const model = input.workingCopy, source = model.buffer.getText();
const cycles = t.runtime().machine.scheduler.nowCycles, executable = t.sourceState().currentBlua32Media;
const unchanged = () => {
	t.assert(model.buffer.getText() === source && !model.dirty, 'chrome interaction changed the canonical source bytes');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === executable,
		'chrome interaction executed or replaced the paused program');
};

for (const font of ['tiny', 'msx']) {
	for (const theme of ['light', 'dark']) {
		await press('ControlLeft', 'Home');
		const version = model.version, view = input.context.view;
		const row = view.cursorRow, column = view.cursorColumn;
		await capture(`chrome-${font}-${theme}-collapsed`);
		// The persistent leading Menu affordance stays at the root even while the
		// category part is collapsed. Opening it must not activate an underlying tab.
		await click(6, 4);
		t.assert(t.activeWorkbenchTab() === input && !t.activeEditorDocument().focusTarget.hasFocus,
			'the persistent Menu affordance did not enter its actual menu');
		await capture(`chrome-${font}-${theme}-pointer-menu`);
		await press('Escape');
		t.assert(t.activeEditorDocument().focusTarget.hasFocus, 'pointer menu cancellation lost its source focus');
		t.controlInput([{ type: 'key', code: 'AltLeft', down: true }]); await t.frames(2);
		t.assert(t.activeEditorDocument().focusTarget.hasFocus, 'Alt down opened the menu before a clean release');
		t.controlInput([{ type: 'key', code: 'AltLeft', down: false }]); await t.frames(2);
		t.assert(!t.activeEditorDocument().focusTarget.hasFocus, 'a clean UI Alt release did not enter the menu');
		t.assert(t.activeWorkbenchTab() === input && model.version === version && view.cursorRow === row
			&& view.cursorColumn === column && view.selectionAnchor === null, 'opening the menu changed its source owner or caret');
		await capture(`chrome-${font}-${theme}-alt-menu`);
		await press('Escape');
		t.assert(t.activeEditorDocument().focusTarget.hasFocus, 'menu Escape did not return the exact source focus');
		unchanged();

		await press('F10');
		t.assert(!t.activeEditorDocument().focusTarget.hasFocus, 'F10 did not enter the collapsed menu');
		await press('Escape');
		t.assert(t.activeEditorDocument().focusTarget.hasFocus, 'F10 menu cancellation lost source focus');
		// A chord is not a bare Alt gesture, including after its non-Alt key is released.
		await press('AltLeft', 'ArrowRight');
		t.assert(t.activeEditorDocument().focusTarget.hasFocus, 'an Alt navigation chord also opened the menu');

		// A pointer action also cancels the pending Alt gesture, even when it keeps
		// the same source focus. The renderer owns this actual caret hit rectangle.
		await press('ControlLeft', 'Home');
		const caret = t.activeEditorDocument().nativeCaret;
		t.controlInput([{ type: 'key', code: 'AltLeft', down: true }]); await t.frames(1);
		t.controlInput([{ type: 'pointer', x: caret.x + caret.width / 2, y: caret.y + caret.height / 2 },
			{ type: 'button', button: 'primary', down: true }]); await t.frames(1);
		t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(1);
		t.controlInput([{ type: 'key', code: 'AltLeft', down: false }]); await t.frames(2);
		t.assert(t.activeEditorDocument().focusTarget.hasFocus && model.version === version,
			'an Alt-plus-pointer action opened the menu or edited the source');
		unchanged();

		// Exercise menu commands against their real invoking working copy. Disabled
		// Undo is skipped after undoing, so Home then selects the available Redo.
		await press('ControlLeft', 'Home'); await press('Space'); await press('ArrowLeft');
		t.assert(model.buffer.getText() === ' ' + source, 'ordinary typing did not establish source Undo history');
		await press('AltLeft'); await press('ArrowRight'); await press('Home');
		await capture(`chrome-${font}-${theme}-edit-undo`);
		await press('Enter');
		t.assert(t.activeWorkbenchTab() === input && input.workingCopy === model && t.activeEditorDocument().focusTarget.hasFocus,
			'menu Undo replaced its source owner or did not return source focus');
		unchanged();
		await press('F10'); await press('ArrowRight'); await press('Home'); await press('Enter');
		t.assert(model.buffer.getText() === ' ' + source && t.activeEditorDocument().focusTarget.hasFocus,
			'menu Redo did not use the same canonical document history');
		await press('ControlLeft', 'KeyZ'); unchanged();
		t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}

// Root chrome remains keyboard-accessible without manufacturing an editor input.
while (t.workbenchTabs().length > 0) { t.command('tabs.close'); await t.frames(2); }
for (const font of ['tiny', 'msx']) {
	await capture(`chrome-empty-${font}-collapsed`);
	await click(6, 4); await capture(`chrome-empty-${font}-pointer-menu`); await press('Escape');
	await press('AltLeft'); await capture(`chrome-empty-${font}-menu`); await press('Escape');
	await press('F10'); await press('Escape');
	t.assert(t.activeWorkbenchTab() === null && t.workbenchTabs().length === 0, 'empty-group menu access fabricated an editor input');
	unchanged();
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
// The root keyboard owner still admits the existing Go to File picker afterward.
await press('ControlLeft', 'Comma');
for (const character of 'cart.lua') await press(character === '.' ? 'Period' : `Key${character.toUpperCase()}`);
await press('Enter'); await t.frames(3);
input = t.activeWorkbenchTab();
t.assert(input.kind === 'code_editor' && input.workingCopy === model && t.activeEditorDocument().focusTarget.hasFocus,
	'empty-group menu cancellation lost root keyboard admission or the resource-owned source model');
unchanged();

// A live inspector supplies its real physical transport. Ordinary paused inspection
// needs no full timeline; explicit access and retained-history review are separate.
const chromeVersion = model.version;
t.command('actorLab'); await t.frames(2); await press('Enter');
const actor = t.activeWorkbenchTab();
t.assert(actor.kind === 'actor_lab' && actor.actorPresent, 'the real paused actor did not open for timeline inspection');
const actorHashId = actor.actorHashId, transport = actor.controller.viewport.transport;
for (const font of ['tiny', 'msx']) {
	const pausedCycles = transport.runtime.machine.scheduler.nowCycles;
	await capture(`chrome-timeline-${font}-ordinary-paused`);
	t.command('runtime.focusTimeline'); await t.frames(3);
	await capture(`chrome-timeline-${font}-explicit`);
	// Timeline visibility belongs to its actual strip context menu, not an X.
	await hideTimelineContext(actor);
	const selectedMember = actor.outline.rows[actor.outline.selectionIndex].element.node;
	const followingMember = actor.outline.rows[actor.outline.selectionIndex + 1].element.node;
	await press('ArrowDown');
	t.assert(actor.outline.rows[actor.outline.selectionIndex].element.node === followingMember,
		'the actual Timeline context Hide did not return keyboard focus to the Actor tree');
	await press('ArrowUp');
	t.assert(actor.outline.rows[actor.outline.selectionIndex].element.node === selectedMember,
		'Timeline context Hide changed the selected Actor member');
	t.assert(transport.runtime.machine.scheduler.nowCycles === pausedCycles && actor.actorHashId === actorHashId && !actor.running,
		'revealing or hiding the timeline changed the physical target, position or capture latch');
	await capture(`chrome-timeline-${font}-explicitly-closed`);

	const presentCycles = transport.runtime.history.latestCycles, earliestCycles = transport.runtime.history.earliestCycles;
	t.command('runtime.focusTimeline'); await t.frames(3);
	await press('Tab'); await press('Home');
	for (let frame = 0; frame < 400 && (transport.navigation.active !== undefined || transport.rewind.seeking); frame++) await t.frames(1);
	await t.frames(2);
	t.assert(transport.navigation.active === undefined && transport.rewind.active && !transport.rewind.seeking
		&& transport.runtime.machine.scheduler.nowCycles === earliestCycles && actor.actorHashId === actorHashId,
		'the actual timeline slider did not review the selected target at its retained history boundary');
	const shownBottom = actor.layout.bottom;
	await hideTimelineContext(actor);
	t.assert(actor.layout.bottom > shownBottom && transport.rewind.active
		&& transport.runtime.machine.scheduler.nowCycles === earliestCycles,
		'the actual context Hide failed or committed, cancelled or resumed historical review');
	await capture(`chrome-timeline-${font}-review-hidden`);
	t.command('runtime.focusTimeline'); await t.frames(3);
	t.assert(actor.layout.bottom === shownBottom && transport.rewind.active
		&& transport.runtime.machine.scheduler.nowCycles === earliestCycles,
		'revealing Timeline lost the retained historical position');
	await capture(`chrome-timeline-${font}-review-reshown`);
	t.command('runtime.present');
	for (let frame = 0; frame < 400 && (transport.navigation.active !== undefined || transport.rewind.active || transport.rewind.seeking); frame++) await t.frames(1);
	await t.frames(3);
	t.assert(transport.navigation.active === undefined && !transport.rewind.active && !transport.rewind.seeking
		&& transport.runtime.machine.scheduler.nowCycles === presentCycles && actor.actorHashId === actorHashId && actor.actorPresent && !actor.running,
		'Return to Present did not restore the same physical actor at the recorded tip without starting gameplay');
	t.assert(t.activeWorkbenchTab() === actor && model.buffer.getText() === source && model.version === chromeVersion
		&& !model.dirty && t.sourceState().currentBlua32Media === executable,
		'timeline presentation or review replaced the Actor input or canonical installed source');
	await capture(`chrome-timeline-${font}-returned-explicit`);
	await hideTimelineContext(actor);
	await press('Home');
	const nextMember = actor.outline.rows[1].element.node;
	await press('ArrowDown');
	t.assert(actor.outline.rows[actor.outline.selectionIndex].element.node === nextMember,
		'hiding the timeline did not return keyboard navigation to the actual Actor tree');
	await press('Home');
	await capture(`chrome-timeline-${font}-returned-and-closed`);
	t.assert(transport.runtime.machine.scheduler.nowCycles === presentCycles, 'finishing timeline review advanced the paused guest');
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}

for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Workbench chrome UX logged an error: ${t.logMessage(index).message}`);
