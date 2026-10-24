// Real recorded events, source-preserving UI interaction only.
// Run: npm run ide:test -- nemesis_s tests/ide/events_responsive_ux.idetest.js --ttl 120
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const click = async (bounds, button = 'primary') => {
	t.controlInput([{ type: 'pointer', x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 },
		{ type: 'button', button, down: true }]); await t.frames(1);
	t.controlInput([{ type: 'button', button, down: false }]); await t.frames(2);
};
let captures = 0;
const capture = async label => {
	t.assert(++captures <= 28, 'the Events workflow exceeded its bounded capture budget');
	t.controlInput([{ type: 'pointer', x: 382, y: 285 }]); await t.frames(2);
	t.log(`VISUAL ${label}`); t.capture(label);
};
await t.waitForCart(); await t.frames(90); t.openLuaSource('cart.lua'); await t.frames(2);
const code = t.activeWorkbenchTab(), model = code.workingCopy, source = model.buffer.getText();
t.command('events'); await t.frames(3);
const input = t.activeWorkbenchTab();
t.assert(input.kind === 'event_viewer' && input.history.count > 0, 'the real cart event history did not open');
const first = input.history.at(input.history.firstSequence), firstBytes = JSON.stringify(first);
t.assert(first.event.kind === 'string' && first.event.value === 'intro' && !first.event.omitted
	&& first.emitter.kind === 'string' && first.emitter.value === 'nemesis_s.director' && !first.emitter.omitted && first.payload.kind === 'nil',
	'the shipped first event is no longer the authored intro emission');
const expectedClipboard = `Event: "intro"\nEmitter: "nemesis_s.director"\nPayload: nil\nEmission: #${first.sequence} | timeline ${first.timeline} | slot ${first.domain} | tick ${first.completedTick} | cycle ${first.cycles}`;
const history = { count: input.history.count, generation: input.history.generation, revision: input.history.revision,
	first: input.history.firstSequence, end: input.history.endSequence };
const cycles = t.runtime().machine.scheduler.nowCycles, media = t.sourceState().currentBlua32Media;
t.log(`FIRST_EVENT ${firstBytes}`);
const unchanged = () => {
	t.assert(input.history.count === history.count && input.history.generation === history.generation && input.history.revision === history.revision
		&& input.history.firstSequence === history.first && input.history.endSequence === history.end && JSON.stringify(first) === firstBytes,
		'Events navigation mutated the captured event or retained history');
	t.assert(model.buffer.getText() === source && !model.dirty, 'Events navigation changed canonical cart.lua');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === media,
		'Events navigation executed or replaced the installed program');
};
const row = () => ({ left: input.viewport.bounds.left, right: input.viewport.bounds.right,
	top: input.viewport.bounds.top, bottom: input.viewport.bounds.top + input.layout.rowHeight });
const focusFirst = async () => { await click(row()); await press('Home'); t.assert(input.projection.rows[input.selected] === first, 'ordinary list navigation selected another captured event'); };
const resize = async () => {
	t.controlInput([{ type: 'pointer', x: input.layout.right + 2, y: 80 }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'pointer', x: 50, y: 80 }]); await t.frames(2);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
};
const availableActions = () => {
	const overflow = input.actions.overflow;
	t.assert(overflow !== undefined && overflow.button.visible, 'Events lost its actual secondary-action menu');
	const primary = input.actions.items.filter(item => item.visible && !item.overflowed);
	const secondary = overflow.items.filter(item => item.type === 'command').map(item => item.command);
	const commands = primary.map(item => item.command).concat(secondary);
	t.assert(new Set(commands).size === commands.length && !commands.some(command => command.endsWith('.more')),
		'Events duplicated a primary command or nested a second More engine');
	t.assert(secondary.includes('events.goToFrame') && secondary.includes('events.clear'), 'the original frame/history actions disappeared from More');
};
const action = async command => {
	const item = input.actions.items.find(item => item.command === command);
	t.assert(item.visible && !item.overflowed && item.enabled, `${command} is not a directly painted enabled action`);
	await click(item.bounds);
};
const acceptFilter = async query => {
	await press('ControlLeft', 'KeyA'); await press('Backspace');
	for (const letter of query) await press(`Key${letter.toUpperCase()}`);
	await press('Enter'); t.assert(input.filter === query, 'the real Filter query did not accept its exact text');
	t.assert(input.actions.items.find(item => item.command === 'events.filter').checked === (query !== ''), 'the actual Filter action did not reflect its active query');
	unchanged();
};
const clearFilter = async () => { await action('events.filter'); await acceptFilter(''); await focusFirst(); };
await focusFirst();
for (const font of ['tiny', 'msx']) {
	for (const theme of ['light', 'dark']) {
		t.command('gameView.closePanel'); await t.frames(3);
		await capture(`events-${font}-${theme}-wide-subject`);
		const fullRight = input.layout.right;
		t.command('gameView.togglePanel'); await t.frames(3);
		const companion = input.layout.right < fullRight;
		if (companion) await resize();
		const phase = companion ? 'companion' : 'full-preview-unavailable';
		await focusFirst(); await capture(`events-${font}-${theme}-${phase}-subject`);
		availableActions();
		if (companion) t.assert(input.layout.compact, 'Events did not switch to its subject-first presentation beside the companion');
		await action('events.filter'); await acceptFilter('zzzz');
		t.assert(input.projection.rows.length === 0 && input.selected === -1, 'the actual no-match query left stale rows or selection');
		await capture(`events-${font}-${theme}-filter-no-match`); await clearFilter();
		await click(input.actions.overflow.button.bounds); await capture(`events-${font}-${theme}-more-pointer`);
		await press('Escape'); t.assert(!input.actions.hasFocus, 'pointer More did not restore its real list origin');
		await press('ShiftLeft', 'Tab'); t.assert(input.actions.hasFocus, 'the Events toolbar is not keyboard reachable');
		await press('End'); await press('Enter'); await capture(`events-${font}-${theme}-more-keyboard`);
		await press('Escape'); t.assert(input.actions.hasFocus, 'keyboard More did not restore the actual toolbar');
		// A toolbar action alias is not permission to borrow the list's context-menu keybinding.
		await press('ContextMenu'); await press('Escape');
		t.assert(!input.actions.hasFocus, 'the toolbar borrowed the list ContextMenu binding instead of returning to content');
		await focusFirst(); await press('ContextMenu'); await capture(`events-${font}-${theme}-list-context-keyboard`);
		await press('End'); await press('ArrowUp'); await press('Enter'); await acceptFilter('intro');
		t.assert(input.projection.rows.length === 1 && input.projection.rows[0] === first, 'ContextMenu did not invoke the actual list Filter command');
		await clearFilter(); await press('ShiftLeft', 'F10');
		await press('End'); await press('ArrowUp'); await press('Enter'); await acceptFilter('director');
		t.assert(input.projection.rows.length === 1 && input.projection.rows[0] === first, 'ShiftF10 did not route through the actual list context capability');
		await clearFilter(); await click(row(), 'secondary');
		await press('End'); await press('ArrowUp'); await press('Enter'); await acceptFilter('intro');
		t.assert(input.projection.rows.length === 1 && input.projection.rows[0] === first, 'the physical context menu did not keep its selected event identity');
		await clearFilter(); await press('Enter'); await capture(`events-${font}-${theme}-event-details`);
		t.assert(input.actions.items.every(item => !item.enabled), 'Enter did not admit the selected event inspector');
		await press('Escape'); await press('Home');
		t.assert(input.projection.rows[input.selected] === first && input.actions.items.find(item => item.command === 'events.details').enabled,
			'Escape did not restore the captured-event list');
		await press('ControlLeft', 'KeyC'); t.openLuaSource('cart.lua'); await t.frames(2);
		t.assert(t.activeWorkbenchTab() === code && code.workingCopy === model, 'clipboard verification replaced the canonical source input');
		await press('ControlLeft', 'End'); await press('ControlLeft', 'KeyV');
		t.assert(model.buffer.getText() === source + expectedClipboard, 'list CtrlC did not copy the full exact captured event and metadata');
		await press('ControlLeft', 'KeyZ'); t.assert(model.buffer.getText() === source && !model.dirty, 'ordinary Undo did not restore cart.lua after clipboard verification');
		t.command('events'); await t.frames(3); t.assert(t.activeWorkbenchTab() === input, 'clipboard verification replaced the retained Events input');
		await focusFirst();
		unchanged();
		t.command('gameView.closePanel'); await t.frames(3); t.command('theme-toggle'); await t.frames(2);
		t.assert(!input.layout.compact && input.projection.rows[input.selected] === first,
			'closing the companion did not restore the wide captured-event presentation and selection');
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
unchanged();
t.assert(captures === 28, 'the Events workflow did not capture every declared font/theme state');
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Events workflow logged an error: ${t.logMessage(index).message}`);
