// Actual Starcatch captures, canonical source navigation and shared floating chrome.
// Run: npm run ide:test -- starcatch tests/ide/gte_window_ux.idetest.js
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true })));
	await t.frames(2);
	t.controlInput(codes.map(code => ({ type: 'key', code, down: false })));
	await t.frames(2);
};
const point = async (x, y) => { t.controlInput([{ type: 'pointer', x, y }]); await t.frames(2); };
const click = async (x, y) => {
	t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
};
const drag = async (x, y, targetX, targetY) => {
	t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
	await point(targetX, targetY);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
};
const capture = async label => { await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label); };
const sameBounds = (left, right) => left.left === right.left && left.top === right.top && left.right === right.right && left.bottom === right.bottom;
const chooseView = async (label, page, view) => {
	t.command('gte.view'); await t.frames(2); await press('ControlLeft', 'KeyA');
	for (const character of label.toUpperCase()) await press(character === ' ' ? 'Space' : `Key${character}`);
	await press('ControlLeft', 'Home'); await press('Enter'); await t.frames(2);
	t.assert(input.inspectorPage === page, `the actual ${label} picker did not open its inspector page`);
	if (view !== undefined) t.assert(input.view === view, `the actual ${label} picker lost its interpretation`);
};

await t.waitForCart(); await t.frames(90); t.openLuaSource('entry.lua'); await t.frames(2);
const entry = t.activeWorkbenchTab(), entrySource = entry.context.model.buffer.getText();
t.command('gteDebugger'); await t.frames(2);
const input = t.activeWorkbenchTab();
t.assert(input.kind === 'gte_debugger', 'the actual GTE contribution did not open');
for (let font = 0; font < 2; font++) {
	for (let theme = 0; theme < 2; theme++) {
		t.assert(input.selected.sequence < 0 && input.projection.rows.length === 0, 'the waiting history fabricated an observed GTE command');
		await capture(`gte-history-waiting-${input.layout.font.variant}-theme-${theme}`);
		t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
for (let step = 0; step < 4; step++) { t.command('stepFrame'); await t.frames(12); }
t.assert(input.projection.rows.length > 1 && input.selected.kind === 'normal' && input.selected.commandWord === 0x06,
	'the shipped Starcatch renderer did not issue its actual NCLIP captures');
let stoppedCycles = t.runtime().machine.scheduler.nowCycles;
const selected = () => ({ sequence: input.selected.sequence, timeline: input.selected.timeline, kind: input.selected.kind,
	commandWord: input.selected.commandWord, cycles: input.selected.cycles, domain: input.selected.domain, pc: input.selected.pc, image: input.selected.image,
	beforeData: Array.from(input.selected.beforeData), afterData: Array.from(input.selected.afterData),
	beforeControl: Array.from(input.selected.beforeControl), afterControl: Array.from(input.selected.afterControl) });
const sameCapture = expected => {
	for (const field of ['sequence', 'timeline', 'kind', 'commandWord', 'cycles', 'domain', 'pc', 'image'])
		t.assert(input.selected[field] === expected[field], `window interaction changed retained capture ${field}`);
	for (const bank of ['beforeData', 'afterData', 'beforeControl', 'afterControl'])
		t.assert(expected[bank].every((word, index) => input.selected[bank][index] === word), `window interaction changed retained ${bank}`);
	t.assert(t.runtime().machine.scheduler.nowCycles === stoppedCycles, 'presentation/source navigation advanced the paused guest');
};
const original = selected(), historyBounds = {};
for (let font = 0; font < 2; font++) {
	historyBounds[input.layout.font.variant] = { ...input.list.bounds };
	t.assert(input.list.bounds.right - input.list.bounds.left >= input.layout.right - input.layout.left - 16,
		'the command history retained a permanently reserved diagram column');
	await capture(`gte-full-width-history-before-inspector-${input.layout.font.variant}`);
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
t.command('gte.details'); await t.frames(3);
const window = input.detailsWindow, initial = { ...window.requestedBounds };
const action = command => input.detailsActions.items.find(item => item.command === command);
const clickAction = async command => {
	const bounds = action(command).bounds;
	await click((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2);
};
const focusClient = async () => { await click(input.inspectorBounds.left + 20, input.inspectorBounds.top + 4); };
const sourceRow = async () => { await chooseView('Properties', 'properties'); await focusClient(); await press('Home'); await press('ArrowDown'); };
t.assert(window.open && !window.collapsed, 'Details did not open an expanded modeless window');
t.assert(action('window.hide').icon === 'close' && action('window.collapse').checkedIcon === 'expand', 'the window did not use shared native icon controls');
t.assert(action('gte.source').icon === 'source' && action('gte.source').enabled, 'captured Source is not reachable through the actual window icon');
for (let font = 0; font < 2; font++) {
	const variant = input.layout.font.variant;
	for (let theme = 0; theme < 2; theme++) {
		t.assert(sameBounds(input.list.bounds, historyBounds[variant]), 'opening the inspector changed the full-width command history');
		t.assert(window.bounds.bottom <= input.layout.bottom, 'the default window obscured shared transport controls');
		t.assert(window.header.bottom - window.header.top === input.layout.font.lineHeight + 8, 'window chrome ignored the active font');
		t.assert(sameBounds(window.requestedBounds, initial), 'font/theme changes overwrote requested placement');
		t.assert(window.title.includes(`#${original.sequence}`) && window.title.includes('NCLIP'), 'the compact caption lost actual capture identity');
		sameCapture(original); await capture(`gte-window-default-${variant}-theme-${theme}`);
		t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}

// Interpretation pages stay inside this one inspector and preserve the register document.
for (let font = 0; font < 2; font++) {
	const variant = input.layout.font.variant;
	await chooseView('Properties', 'properties'); await focusClient(); await press('End');
	await chooseView('Automatic', 'diagram', 'auto');
	const properties = { ...input.detailsView };
	t.assert(properties.selectionIndex > 0, 'changing pages discarded the selected before/after register');
	t.assert(input.diagram.bounds.left >= input.inspectorBounds.left && input.diagram.bounds.right <= input.inspectorBounds.right
		&& input.diagram.bounds.top >= input.inspectorBounds.top && input.diagram.bounds.bottom <= input.inspectorBounds.bottom,
		'the command diagram is not contained by the actual inspector client');
	await focusClient(); await press('End');
	t.assert(input.diagram.scrollTop === input.diagram.scrollbar.getMaximumScroll(), 'End did not reveal the final wrapped GTE annotation');
	sameCapture(original); await capture(`gte-inspector-${variant}-diagram-final-annotation`);
	await press('Home'); t.assert(input.diagram.scrollTop === 0, 'Home did not return to the actual GTE plot');
	await chooseView('Input XY', 'diagram', 'input'); sameCapture(original);
	await chooseView('Projected SXY', 'diagram', 'projected'); sameCapture(original);
	await chooseView('Output RGB', 'diagram', 'color'); await focusClient(); await press('Home');
	sameCapture(original); await capture(`gte-inspector-${variant}-nclip-has-no-rgb-result`);
	await chooseView('Properties', 'properties');
	t.assert(Object.keys(properties).every(key => input.detailsView[key] === properties[key]), 'diagram interpretation changes lost the raw-register bookmark');
	await focusClient(); await press('Home'); await press('ControlLeft', 'ShiftLeft', 'KeyT');
}

// Direct inspection stops Follow rather than losing the selected point or reading position next frame.
await chooseView('Automatic', 'diagram', 'auto'); await focusClient();
t.command('gte.follow'); await t.frames(2); t.assert(input.following, 'Follow did not enable its real observation mode');
await press('ArrowRight');
t.assert(!input.following && input.selectedPoint === 1, 'diagram point navigation did not retain an explicit observed point');
await press('Home'); t.command('gte.follow'); await t.frames(2);
t.controlInput([{ type: 'pointer', x: input.diagram.bounds.left + 12, y: input.diagram.bounds.top + 4 }, { type: 'wheel', deltaY: 120 }]);
await t.frames(3);
t.assert(!input.following && input.diagram.scrollTop > 0, 'diagram scrolling did not stop Follow for the observed reading position');
sameCapture(original); await capture('gte-inspector-scroll-retains-observation');

// Both physical context-menu bindings act on the focused history and reach its real view chooser.
for (const gesture of [['ContextMenu'], ['ShiftLeft', 'F10']]) {
	await chooseView('Automatic', 'diagram', 'auto'); await clickAction('window.hide');
	await press(...gesture); await press('Home'); await press('Enter');
	for (const character of 'PROPERTIES') await press(`Key${character}`);
	await press('ControlLeft', 'Home'); await press('Enter'); await t.frames(2);
	t.assert(window.open && input.inspectorPage === 'properties', `${gesture.join('+')} did not expose the command history's inspector chooser`);
	sameCapture(original); await capture(`gte-history-keyboard-context-${gesture.join('+')}`);
}

// Source belongs to this capture's issuing instruction, not the current CPU PC.
await clickAction('gte.source');
const authored = t.activeWorkbenchTab();
t.assert(authored.kind === 'code_editor' && authored.workingCopy.resource.path === 'scene_renderer.lua', 'captured Source opened a different canonical resource');
t.assert(authored.context.view.cursorRow === 70 && authored.context.view.cursorColumn === 8, 'captured NCLIP Source did not reveal its actual issuing instruction');
const model = authored.workingCopy, source = model.buffer.getText();
t.assert(window.open && input.history.observing, 'Source navigation destroyed the retained GTE window or observation lease');
sameCapture(original); await capture('gte-window-source-canonical-issue-range');

// An ordinary unsaved edit makes the captured source range unavailable; Undo restores it.
await press('ArrowLeft'); // Collapse the source action's actual instruction selection before inserting.
const offset = model.buffer.offsetAt(authored.context.view.cursorRow, authored.context.view.cursorColumn);
await press('Space');
t.assert(model.buffer.getText() === source.slice(0, offset) + ' ' + source.slice(offset), 'actual source-editor input did not edit the retained canonical working copy');
t.command('gteDebugger'); await t.frames(3);
t.assert(t.activeWorkbenchTab() === input && window.open, 'returning from an unsaved source edit lost window intent');
for (let font = 0; font < 2; font++) {
	await sourceRow(); await capture(`gte-window-${input.layout.font.variant}-source-changed`);
	t.assert(!action('gte.source').enabled, 'the window Source icon admitted an unsaved changed source range');
	await press('Home'); await capture(`gte-window-${input.layout.font.variant}-source-warning-light`);
	t.command('theme-toggle'); await t.frames(2); await capture(`gte-window-${input.layout.font.variant}-source-warning-dark`);
	t.command('theme-toggle'); await t.frames(2); await press('ArrowDown');
	t.command('gte.source'); await t.frames(2);
	await press('Enter');
	t.assert(t.activeWorkbenchTab() === input, 'Source navigated with a stale captured range after an unsaved canonical edit');
	sameCapture(original); await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
t.openLuaSource('scene_renderer.lua'); await t.frames(2);
t.assert(t.activeWorkbenchTab() === authored, 'the changed source was replaced by a second editor model');
await press('ControlLeft', 'KeyZ');
t.assert(model.buffer.getText() === source, 'normal editor Undo did not restore the exact canonical source bytes');
t.command('gteDebugger'); await t.frames(3);
t.assert(action('gte.source').enabled, 'Undo left Source disabled for the original captured bytes');
await sourceRow(); await press('Enter');
t.assert(t.activeWorkbenchTab() === authored && authored.context.view.cursorRow === 70 && authored.context.view.cursorColumn === 8,
	'Undo did not restore navigation to the same captured issuing instruction');
t.command('gteDebugger'); await t.frames(3); sameCapture(original);

// List and client share one selected observation; an old Enter attempt cannot follow it.
await press('Escape'); await press('Home');
const firstSequence = input.projection.rows[0];
t.assert(window.open && input.selected.sequence === firstSequence && window.title.includes(`#${firstSequence}`), 'Escape did not return to the real list while leaving Details open');
await click(input.list.bounds.left + 10, input.list.offsetTop + input.layout.rowHeight * 1.5);
const clickedSequence = input.projection.rows[1];
t.assert(input.selected.sequence === clickedSequence && window.title.includes(`#${clickedSequence}`), 'an uncovered operation-list press did not retarget the same window');
await sourceRow();
t.controlInput([{ type: 'key', code: 'Enter', down: true }]); await t.frames(1);
t.command('gte.follow'); await t.frames(2);
t.assert(input.selected.sequence !== clickedSequence, 'the real Follow action did not select a newer capture during the local attempt');
t.controlInput([{ type: 'key', code: 'Enter', down: false }]); await t.frames(2);
t.assert(t.activeWorkbenchTab() === input, 'a retired Source key attempt opened another capture after selection changed');
await press('Escape'); await press('Home');
const sourceButton = action('gte.source').bounds;
t.controlInput([{ type: 'pointer', x: (sourceButton.left + sourceButton.right) / 2, y: (sourceButton.top + sourceButton.bottom) / 2 },
	{ type: 'button', button: 'primary', down: true }]); await t.frames(1);
t.command('gte.follow'); await t.frames(2);
t.assert(input.selected.sequence !== firstSequence, 'Follow did not change the capture during the Source icon hold');
t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
t.assert(t.activeWorkbenchTab() === input, 'a retired Source icon press navigated using a newer capture');
await press('Escape'); await press('End');
const popupSequence = input.selected.sequence;
t.assert(popupSequence === original.sequence && input.selected.commandWord === 0x06,
	'the popup Source phase did not select the original NCLIP issuing instruction');
const more = input.actions.overflow.button.bounds;
await click((more.left + more.right) / 2, (more.top + more.bottom) / 2);
const sourceIndex = input.actions.overflow.items.filter(item => item.type === 'command').findIndex(item => item.command === 'gte.source');
t.assert(sourceIndex >= 0, 'the actual More menu does not expose captured Source');
await press('Home');
for (let index = 0; index < sourceIndex; index++) await press('ArrowDown');
await capture('gte-window-popup-captured-source');
t.controlInput([{ type: 'key', code: 'Enter', down: true }]); await t.frames(1);
// The popup owns this gesture; cancellation must retire its pending acceptance.
// Source-generation retirement during accept is covered at the captured popup owner.
await press('Escape');
t.controlInput([{ type: 'key', code: 'Enter', down: false }]); await t.frames(2);
t.assert(t.activeWorkbenchTab() === input && input.selected.sequence === popupSequence,
	'a cancelled popup Source attempt navigated or changed its retained capture');
await capture('gte-window-popup-source-cancelled');
await click((more.left + more.right) / 2, (more.top + more.bottom) / 2);
await press('Home');
for (let index = 0; index < sourceIndex; index++) await press('ArrowDown');
await press('Enter');
t.assert(t.activeWorkbenchTab() === authored && authored.workingCopy === model
	&& authored.context.view.cursorRow === 70 && authored.context.view.cursorColumn === 8
	&& input.selected.sequence === popupSequence,
	'a fresh popup Source acceptance lost its canonical issuing instruction or retained capture');
await capture('gte-window-popup-source-accepted');
t.command('gteDebugger'); await t.frames(3);
t.assert(t.activeWorkbenchTab() === input && input.selected.sequence === popupSequence,
	'popup Source return replaced the retained GTE input or its captured subject');
await press('Escape'); await press('Home'); t.command('gte.details'); await t.frames(2);
const pinned = selected();
await capture('gte-window-list-selection-retired-source-attempt');

// Captured move/resize and document disclosure use the same shared chrome and raw snapshot.
const beforeMove = { ...window.bounds };
await drag(window.header.left + 12, (window.header.top + window.header.bottom) / 2,
	window.header.left - 18, (window.header.top + window.header.bottom) / 2 - 35);
t.assert(window.bounds.left === beforeMove.left - 30 && window.bounds.top === beforeMove.top - 35, 'titlebar capture stopped outside its old bounds');
sameCapture(pinned); await capture('gte-window-moved-capture');
const width = beforeMove.right - beforeMove.left, height = beforeMove.bottom - beforeMove.top;
await drag(window.bounds.right - 1, window.bounds.bottom - 1,
	window.bounds.left + window.minimumWidth - 9, window.bounds.top + window.minimumHeight - 9);
for (let font = 0; font < 2; font++) {
	t.assert(window.bounds.right - window.bounds.left >= window.minimumWidth && window.bounds.bottom - window.bounds.top >= window.minimumHeight,
		'the actual resize minimum ignored current font metrics');
	await focusClient(); await press('End'); await press('ArrowRight');
	sameCapture(pinned); await capture(`gte-window-minimum-${input.layout.font.variant}-raw-before-after`);
	await press('ArrowLeft'); await press('Home'); await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
await drag(window.bounds.right - 1, window.bounds.bottom - 1, window.bounds.left + width - 1, window.bounds.top + height - 1);
await drag(window.header.left + 12, (window.header.top + window.header.bottom) / 2,
	window.header.left + 12 + initial.left - window.bounds.left, (window.header.top + window.header.bottom) / 2 + initial.top - window.bounds.top);
t.assert(sameBounds(window.requestedBounds, initial), 'ordinary move/resize could not restore the retained placement');
await focusClient(); await press('End'); await press('ArrowRight');
await capture('gte-window-explicit-register-explanation'); await press('ArrowLeft');
await clickAction('window.collapse');
const retainedRow = input.detailsView.selectionIndex;
t.assert(window.open && window.collapsed && window.bounds.bottom === window.header.bottom && retainedRow > 0 && input.detailsView.anchorIndex > 0,
	'Collapse retained a client hit area or lost its actual row/scroll bookmark');
await press('ControlLeft', 'ShiftLeft', 'KeyT');
t.assert(window.collapsed && window.header.bottom - window.header.top === input.layout.font.lineHeight + 8, 'collapsed font change retained stale header metrics');
await clickAction('window.collapse');
await capture('gte-window-expanded-msx-retained-register');
await clickAction('window.collapse');
t.assert(input.detailsView.selectionIndex === retainedRow, 'collapsed font reflow changed the selected raw register');
await press('ControlLeft', 'ShiftLeft', 'KeyT');
await clickAction('window.collapse');
await capture('gte-window-expanded-tiny-retained-register');
await clickAction('window.hide');
const retainedView = { ...input.detailsView };
t.assert(!window.open && input.detailsView.selectionIndex === retainedRow, 'Close discarded the selected register');
t.command('gte.details'); await t.frames(3);
t.assert(window.open && Object.keys(retainedView).every(key => input.detailsView[key] === retainedView[key]), 'reopening lost the selected register or document-relative reading anchor');
sameCapture(pinned); await capture('gte-window-reopened-retained-register');

// Explicit transport remains owned by the pane even when its window client has focus.
await focusClient();
const beforeStep = stoppedCycles;
t.command('stepFrame'); await t.frames(12);
stoppedCycles = t.runtime().machine.scheduler.nowCycles;
t.assert(stoppedCycles > beforeStep && input.running === false, 'the window client lost explicit paused frame transport');
sameCapture(pinned); await capture('gte-window-transport-keeps-owned-capture');
const placement = { ...window.requestedBounds };
t.openLuaSource('entry.lua'); await t.frames(3);
t.assert(t.activeWorkbenchTab() === entry && window.open && input.history.observing, 'switching panes destroyed retained window/observation state');
await capture('gte-window-detached-over-canonical-source');
t.command('gteDebugger'); await t.frames(3);
t.assert(t.activeWorkbenchTab() === input && window.open && sameBounds(window.requestedBounds, placement), 'reattaching GTE lost its retained window placement');
sameCapture(pinned); await capture('gte-window-reattached');

// Optional companion composition preserves history and the root-owned inspector's placement.
for (let font = 0; font < 2; font++) {
	const variant = input.layout.font.variant;
	await clickAction('window.hide'); t.command('gameView.closePanel'); await t.frames(3);
	const fullRight = input.layout.right, inspectorPlacement = { ...window.requestedBounds };
	t.command('gameView.togglePanel'); await t.frames(3);
	const companion = input.layout.right < fullRight;
	if (companion) await drag(input.layout.right + 2, 80, 50, 80);
	t.command('gteDebugger'); await t.frames(2);
	const phase = companion ? 'companion' : 'full-preview-unavailable';
	for (let theme = 0; theme < 2; theme++) {
		const historyBounds = { ...input.list.bounds };
		await capture(`gte-history-${phase}-${variant}-theme-${theme}`);
		t.command('gte.details'); await t.frames(2); await chooseView('Properties', 'properties');
		t.assert(window.open && sameBounds(window.requestedBounds, inspectorPlacement) && sameBounds(input.list.bounds, historyBounds),
			'opening the root-owned GTE inspector changed its requested placement or the retained history allocation');
		await capture(`gte-inspector-${phase}-${variant}-theme-${theme}-properties`);
		await chooseView('Automatic', 'diagram', 'auto'); await focusClient(); await press('Home');
		sameCapture(pinned); await capture(`gte-inspector-${phase}-${variant}-theme-${theme}-diagram`);
		await press('End');
		t.assert(input.diagram.scrollTop === input.diagram.scrollbar.getMaximumScroll(), 'the retained command diagram cannot reveal its final annotation');
		await chooseView('Properties', 'properties'); await clickAction('window.hide');
		t.command('theme-toggle'); await t.frames(2);
	}
	t.command('gameView.closePanel'); await t.frames(3); t.command('gteDebugger'); t.command('gte.details'); await t.frames(2);
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}

// Clear is an explicit empty subject; inactive backing register arrays are not new evidence.
await press('Escape'); t.command('gte.clear'); await t.frames(3);
t.assert(window.open && input.selected.sequence === -1 && input.selected.image === null && input.history.count === 0, 'Clear retained a stale capture identity or closed Details');
t.assert(!window.title.includes(`#${pinned.sequence}`), 'the empty window retained the old event caption');
await capture('gte-window-cleared-empty-subject'); await clickAction('window.hide');
t.assert(!window.open, 'Close became unreachable for an empty capture');
t.assert(model.buffer.getText() === source && entry.context.model.buffer.getText() === entrySource, 'GTE window/source interaction changed canonical source bytes');
t.assert(t.runtime().machine.scheduler.nowCycles === stoppedCycles, 'presentation advanced execution after the explicit frame step');
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `GTE window workflow logged an error: ${t.logMessage(index).message}`);
