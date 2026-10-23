// Real cartlib_test boot-time PLUS acceptance/publication, observed before ordinary Reboot.
// Run: npm run ide:test -- cartlib_test tests/ide/gte_plus_window_ux.idetest.js
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true })));
	await t.frames(2);
	t.controlInput(codes.map(code => ({ type: 'key', code, down: false })));
	await t.frames(2);
};
const click = async bounds => {
	t.controlInput([{ type: 'pointer', x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 },
		{ type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
};
const capture = async label => { await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label); };
await t.waitForCart(); await t.frames(90); t.openLuaSource('entry.lua'); await t.frames(2);
const entry = t.activeWorkbenchTab(), source = entry.workingCopy.buffer.getText();
t.command('gteDebugger'); await t.frames(2);
const input = t.activeWorkbenchTab();
t.assert(input.kind === 'gte_debugger' && input.history.observing, 'the actual GTE observer did not attach before boot-time PLUS work');
const boot = t.reboot();
for (let frame = 0; frame < 300 && boot.result === null; frame++) await t.frames(1);
t.assert(boot.result !== null && boot.result.status === 'reset', 'the ordinary cartridge Reboot did not complete');
await t.waitForCart(); await t.frames(90);
// Reboot intentionally leaves Studio; opening canonical source is its ordinary entry path.
t.openLuaSource('entry.lua'); await t.frames(2); t.command('gteDebugger'); await t.frames(3);
t.assert(t.workbenchActive() && t.activeWorkbenchTab() === input && input.history.observing, 'returning to Studio replaced the retained GTE observation input');
const publications = input.projection.rows.filter(sequence => input.history.at(sequence).kind === 'plus-published');
t.assert(publications.length === 3, 'the shipped cart did not produce its three actual PLUS publication events');
const publishedSequence = publications[2], acceptedSequence = input.history.at(publishedSequence).acceptedSequence;
t.assert(acceptedSequence !== undefined && input.history.at(acceptedSequence).kind === 'plus-accepted', 'the real publication has no observed acceptance');
const selectSequence = async sequence => {
	await press('Escape'); await press('Home');
	const index = input.projection.rows.indexOf(sequence);
	t.assert(index >= 0, 'the actual retained event is absent from the list');
	for (let row = 0; row < index; row++) await press('ArrowDown');
	t.assert(input.selected.sequence === sequence, 'ordinary list navigation selected a different event');
};
await selectSequence(publishedSequence); t.command('gte.details'); await t.frames(3);
const window = input.detailsWindow;
const action = command => input.detailsActions.items.find(item => item.command === command);
const focusClient = async () => { await click({ left: window.client.left + 16, right: window.client.left + 24, top: window.client.top, bottom: window.client.top + 8 }); };
const snapshot = () => ({ kind: input.selected.kind, sequence: input.selected.sequence, acceptedSequence: input.selected.acceptedSequence,
	cycles: input.selected.cycles, acceptedCycles: input.selected.acceptedCycles, deadlineCycles: input.selected.deadlineCycles,
	pc: input.selected.pc, image: input.selected.image, domain: input.selected.domain, commandWord: input.selected.commandWord,
	before: Array.from(input.selected.beforePlus), after: Array.from(input.selected.afterPlus) });
const cycles = t.runtime().machine.scheduler.nowCycles;
const sameCapture = expected => {
	for (const field of ['kind', 'sequence', 'acceptedSequence', 'cycles', 'acceptedCycles', 'deadlineCycles', 'pc', 'image', 'domain', 'commandWord'])
		t.assert(input.selected[field] === expected[field], `PLUS presentation changed retained ${field}`);
	t.assert(expected.before.every((word, index) => input.selected.beforePlus[index] === word), 'PLUS presentation changed accepted raw words');
	if (expected.kind === 'plus-published') t.assert(expected.after.every((word, index) => input.selected.afterPlus[index] === word), 'PLUS presentation changed published raw words');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles, 'PLUS presentation advanced the paused guest');
};
const published = snapshot();
t.assert(window.open && window.title.includes(`#${publishedSequence}`) && window.title.includes('PLUS PUBLISH'), 'the window did not identify the actual publication phase');
t.assert(action('gte.source').enabled, 'publication lost its retained acceptance source');
await click(action('gte.source').bounds);
t.assert(t.activeWorkbenchTab() === entry && entry.context.view.cursorRow === 31 && entry.context.view.cursorColumn === 0,
	'publication Source did not reveal the observed acceptance instruction in canonical entry.lua');
const sourcePosition = { row: entry.context.view.cursorRow, column: entry.context.view.cursorColumn };
t.assert(window.open && input.history.observing, 'Source navigation destroyed publication evidence or window intent');
sameCapture(published); await capture('gte-plus-published-acceptance-source');
t.command('gteDebugger'); await t.frames(3);
t.controlInput([{ type: 'pointer', x: 380, y: 40 }]); await t.frames(2);
for (let font = 0; font < 2; font++) {
	const variant = input.layout.font.variant;
	for (let theme = 0; theme < 2; theme++) {
		await focusClient(); await press('Home');
		t.assert(window.bounds.bottom <= input.layout.bottom, 'PLUS default placement obscured shared transport');
		sameCapture(published); await capture(`gte-plus-publication-${variant}-theme-${theme}`);
		if (theme === 0) {
			await press('End'); await press('ArrowRight');
			await capture(`gte-plus-publication-${variant}-raw-word-disclosure`); await press('ArrowLeft');
		}
		t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
await selectSequence(acceptedSequence); t.command('gte.details'); await t.frames(2);
const accepted = snapshot();
t.assert(accepted.kind === 'plus-accepted' && window.title.includes('PLUS ACCEPT'), 'list selection did not show the paired acceptance phase');
t.assert(accepted.pc === published.pc && accepted.domain === published.domain && accepted.image === published.image,
	'publication attributed source to a later synchronizing instruction instead of its accepted command');
t.assert(accepted.before.every((word, index) => word === published.before[index]), 'publication did not retain the paired accepted operand bank');
for (let font = 0; font < 2; font++) {
	await focusClient(); await press('Home'); sameCapture(accepted);
	await capture(`gte-plus-acceptance-${input.layout.font.variant}-immutable-phase`);
	await press('End'); await press('ArrowRight');
	await capture(`gte-plus-acceptance-${input.layout.font.variant}-raw-word-disclosure`);
	await press('ArrowLeft'); await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
await focusClient(); await press('Home'); await press('ArrowDown'); await press('Enter');
t.assert(t.activeWorkbenchTab() === entry && entry.context.view.cursorRow === sourcePosition.row && entry.context.view.cursorColumn === sourcePosition.column,
	'acceptance Source did not use the same exact canonical instruction as its publication');
t.command('gteDebugger'); await t.frames(3); sameCapture(accepted);
await click(action('window.collapse').bounds); await press('Escape'); await press('ArrowDown');
t.assert(window.open && window.collapsed && input.selected.sequence === publishedSequence && window.title.includes('PLUS PUBLISH'),
	'collapsed Details failed to follow the paired actual publication independently of the retired client');
await click(action('window.collapse').bounds); sameCapture(published);
await capture('gte-plus-publication-after-collapsed-phase-change');
t.assert(entry.workingCopy.buffer.getText() === source, 'PLUS inspection or Source navigation changed canonical authored bytes');
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `PLUS window workflow logged an error: ${t.logMessage(index).message}`);
