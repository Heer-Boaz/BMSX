// Subject-first compact Details on the actual recorded intro event.
// Run: npm run ide:test -- nemesis_s tests/ide/events_details_ux.idetest.js --ttl 120
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
	t.assert(++captures <= 24, 'compact Event Details exceeded its capture budget');
	t.controlInput([{ type: 'pointer', x: 382, y: 285 }]); await t.frames(2);
	t.log(`VISUAL ${label}`); t.capture(label);
};
await t.waitForCart(); await t.frames(90); t.openLuaSource('cart.lua'); await t.frames(2);
const code = t.activeWorkbenchTab(), model = code.workingCopy, source = model.buffer.getText();
t.command('events'); await t.frames(3); const input = t.activeWorkbenchTab();
t.assert(input.kind === 'event_viewer' && input.history.count === 1, 'the actual first intro event did not open');
const first = input.history.at(input.history.firstSequence), facts = JSON.stringify(first), cycles = t.runtime().machine.scheduler.nowCycles, media = t.sourceState().currentBlua32Media;
t.assert(first.event.kind === 'string' && first.event.value === 'intro' && first.payload.kind === 'nil', 'the real event fixture changed');
const unchanged = () => {
	t.assert(JSON.stringify(first) === facts && input.history.count === 1, 'Details changed the captured event snapshot');
	t.assert(model.buffer.getText() === source && !model.dirty, 'Details modified canonical source');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === media, 'Details advanced or replaced the paused program');
};
const inspect = async () => {
	await click({ left: input.viewport.bounds.left, right: input.viewport.bounds.right, top: input.viewport.bounds.top, bottom: input.viewport.bounds.top + input.layout.rowHeight });
	await press('Home'); await press('Enter'); await press('Home');
};
const copiedValue = async expected => {
	await press('ControlLeft', 'KeyC'); await press('Escape'); await press('ControlLeft', 'KeyF');
	await press('ControlLeft', 'KeyA'); await press('Backspace'); await press('ControlLeft', 'KeyV'); await press('Enter');
	t.log(`COPIED_DETAIL ${JSON.stringify({ expected, actual: input.filter })}`);
	t.assert(input.filter === expected, 'the actual compact Details row copied another field or truncated its captured value');
	await press('ControlLeft', 'KeyF'); await press('ControlLeft', 'KeyA'); await press('Backspace'); await press('Enter');
	t.assert(input.filter === '' && input.projection.rows[0] === first, 'clipboard verification did not restore the retained event list'); unchanged();
};
const emission = `#${first.sequence} | timeline ${first.timeline} | slot ${first.domain} | tick ${first.completedTick} | cycle ${first.cycles}`;
const fullCopy = `Event: "intro"\nEmitter: "nemesis_s.director"\nPayload: nil\nEmission: ${emission}`;
const firstCompactRow = font => {
	const top = input.layout.top + input.layout.font.lineHeight + 8;
	return { left: input.layout.left + 4, right: input.layout.right - 4, top, bottom: top + (font === 'tiny' ? 11 : 12) };
};
for (const font of ['tiny', 'msx']) {
	t.assert(input.layout.font.variant === font, 'the actual Events font does not match its test phase');
	for (const theme of ['light', 'dark']) {
		t.command('gameView.closePanel'); await t.frames(3);
		await inspect(); await capture(`events-details-${font}-${theme}-wide-compact`);
		// This literal first compact row must address Event, not the old Emission help card.
		await click(firstCompactRow(font)); await copiedValue('"intro"');
		await inspect(); await press('End'); await press('ArrowRight');
		await capture(`events-details-${font}-${theme}-wide-help-expanded`);
		await press('ArrowLeft'); await copiedValue(emission);
		const fullRight = input.layout.right;
		t.command('gameView.togglePanel'); await t.frames(3);
		const companion = input.layout.right < fullRight;
		if (companion) {
			t.controlInput([{ type: 'pointer', x: input.layout.right + 2, y: 80 }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
			t.controlInput([{ type: 'pointer', x: 50, y: 80 }]); await t.frames(2);
			t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
		}
		const phase = companion ? 'companion' : 'full-preview-unavailable';
		await inspect(); await capture(`events-details-${font}-${theme}-${phase}-compact`);
		await click(firstCompactRow(font)); await copiedValue('"intro"');
		await inspect(); await press('End'); await press('ArrowRight');
		await capture(`events-details-${font}-${theme}-${phase}-help-expanded`);
		await press('ArrowLeft'); await capture(`events-details-${font}-${theme}-${phase}-help-collapsed`);
		await copiedValue(emission);
		await inspect(); await press('ArrowDown'); await press('ArrowDown');
		await capture(`events-details-${font}-${theme}-${phase}-payload`); await copiedValue('nil');
		await press('Home'); await press('ControlLeft', 'KeyC'); t.openLuaSource('cart.lua'); await t.frames(2);
		t.assert(t.activeWorkbenchTab() === code && code.workingCopy === model, 'full clipboard verification replaced the canonical source input');
		await press('ControlLeft', 'End'); await press('ControlLeft', 'KeyV');
		t.assert(model.buffer.getText() === source + fullCopy, 'full event copy changed its intentional subject-first order or lost captured metadata');
		await press('ControlLeft', 'KeyZ'); t.assert(model.buffer.getText() === source && !model.dirty, 'ordinary Undo did not restore exact canonical source after clipboard verification');
		t.command('events'); await t.frames(3); t.assert(t.activeWorkbenchTab() === input, 'clipboard verification replaced the retained Events tab');
		unchanged(); t.command('gameView.closePanel'); await t.frames(3); t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
unchanged(); t.assert(captures === 24, 'the compact Details matrix did not capture every declared state');
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Event Details workflow logged an error: ${t.logMessage(index).message}`);
