// Real emitted GPU operations, shared floating chrome, and retained observation lifetime.
// Run: npm run ide:test -- nemesis_s tests/ide/gpu_window_ux.idetest.js
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true })));
	await t.frames(2);
	t.controlInput(codes.map(code => ({ type: 'key', code, down: false })));
	await t.frames(2);
};
const point = async (x, y) => { t.controlInput([{ type: 'pointer', x, y }]); await t.frames(2); };
const click = async (x, y) => {
	t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'primary', down: true }]);
	await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
};
const drag = async (x, y, targetX, targetY) => {
	t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
	await point(targetX, targetY);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
};
const capture = async label => { await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label); };
const sameBounds = (left, right) => left.left === right.left && left.top === right.top && left.right === right.right && left.bottom === right.bottom;

await t.waitForCart(); await t.frames(90); t.openLuaSource('cart.lua'); await t.frames(2);
const authored = t.activeWorkbenchTab(), source = authored.context.model.buffer.getText();
t.command('gpuDebugger'); await t.frames(2);
const input = t.activeWorkbenchTab();
t.assert(input.kind === 'gpu_debugger', 'the real GPU contribution did not open');
for (let step = 0; step < 4; step++) { t.command('stepFrame'); await t.frames(8); }
t.assert(input.projection.rows.length > 1 && input.selected.sequence >= 0, 'the actual cart did not emit selectable GPU operations');
const cycles = t.runtime().machine.scheduler.nowCycles;
const selected = () => ({ sequence: input.selected.sequence, timeline: input.selected.timeline, wordCount: input.selected.wordCount,
	words: Array.from(input.selected.words.subarray(0, input.selected.wordCount)) });
const sameOperation = expected => {
	t.assert(input.selected.sequence === expected.sequence && input.selected.timeline === expected.timeline
		&& input.selected.wordCount === expected.wordCount && expected.words.every((word, index) => input.selected.words[index] === word),
		'window presentation changed a retained raw operation or adopted another subject');
	t.assert(t.runtime().machine.scheduler.nowCycles === cycles, 'window presentation advanced the paused guest');
};
const baseline = {};
for (let font = 0; font < 2; font++) {
	const variant = input.layout.font.variant;
	baseline[variant] = { ...input.visualBounds };
	await capture(`gpu-diagram-before-window-${variant}`);
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
const original = selected();
t.command('gpu.details'); await t.frames(3);
const window = input.detailsWindow;
t.assert(window.open && !window.collapsed, 'Details did not open a modeless expanded window');
const initial = { ...window.requestedBounds };
const action = command => input.detailsActions.items.find(item => item.command === command);
const clickAction = async command => {
	const bounds = action(command).bounds;
	await click((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2);
};
const focusClient = async () => { await click(window.client.left + 16, window.client.top + 4); };
t.assert(action('window.hide').icon === 'close' && action('window.collapse').checkedIcon === 'expand', 'window chrome replaced native icon controls with text');
for (let font = 0; font < 2; font++) {
	const variant = input.layout.font.variant;
	for (let theme = 0; theme < 2; theme++) {
		t.assert(sameBounds(input.visualBounds, baseline[variant]), 'opening Details reserved a second diagram layout/split');
		t.assert(window.bounds.bottom <= input.layout.bottom, 'the default window obscured the shared runtime transport');
		t.assert(window.header.bottom - window.header.top === input.layout.font.lineHeight + 8, 'window header ignored the active font');
		t.assert(sameBounds(window.requestedBounds, initial), 'font/theme layout overwrote requested window placement');
		t.assert(window.title.includes(`#${input.selected.sequence}`), 'the compact caption lost the actual selected operation identity');
		sameOperation(original);
		await capture(`gpu-window-default-${variant}-theme-${theme}`);
		t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}

// Escape returns to the actual operation list, not a hidden full-screen inspector.
await press('Escape');
t.assert(window.open && !window.collapsed, 'Escape closed a modeless GPU window');
const previousIndex = input.projection.rows.indexOf(input.selected.sequence) - 1;
const previousSequence = input.projection.rows[previousIndex];
await press('ArrowUp');
t.assert(input.selected.sequence === previousSequence && window.title.includes(`#${previousSequence}`), 'Escape did not return to the actual list or Details stopped following its operation');
const firstSequence = input.projection.rows[0];
await click(input.list.bounds.left + 10, input.list.offsetTop + input.layout.rowHeight / 2);
t.assert(input.selected.sequence === firstSequence && window.title.includes(`#${firstSequence}`), 'an uncovered list row did not update the same window subject');
await capture('gpu-window-pointer-list-follows-operation');
const first = selected(), originalPoint = input.selectedPoint;

// A header gesture continues above its original rectangle without escaping to the diagram.
const beforeMove = { ...window.bounds };
await drag(window.header.left + 12, (window.header.top + window.header.bottom) / 2,
	window.header.left + 42, (window.header.top + window.header.bottom) / 2 - 35);
t.assert(window.bounds.left === beforeMove.left + 30 && window.bounds.top === beforeMove.top - 35,
	'captured titlebar motion stopped when the pointer left the original window');
sameOperation(first); await capture('gpu-window-moved-capture');
const width = beforeMove.right - beforeMove.left, height = beforeMove.bottom - beforeMove.top;
await drag(window.bounds.right - 1, window.bounds.bottom - 1,
	window.bounds.left + window.minimumWidth - 9, window.bounds.top + window.minimumHeight - 9);
t.assert(window.bounds.right - window.bounds.left === window.minimumWidth && window.bounds.bottom - window.bounds.top === window.minimumHeight,
	'resizing did not use the actual font-aware minimum');
await capture('gpu-window-minimum-tiny');
await focusClient(); await press('End'); await press('ArrowRight');
sameOperation(first); await capture('gpu-window-minimum-tiny-raw-disclosure');
await press('ArrowLeft'); await press('Home');
await press('ControlLeft', 'ShiftLeft', 'KeyT');
t.assert(window.bounds.right - window.bounds.left >= window.minimumWidth && window.bounds.bottom - window.bounds.top >= window.minimumHeight,
	'the larger font escaped the window minimum');
await capture('gpu-window-minimum-msx');
await focusClient(); await press('End'); await press('ArrowRight');
sameOperation(first); await capture('gpu-window-minimum-msx-raw-disclosure');
await press('ArrowLeft'); await press('Home');
await press('ControlLeft', 'ShiftLeft', 'KeyT');
await drag(window.bounds.right - 1, window.bounds.bottom - 1, window.bounds.left + width - 1, window.bounds.top + height - 1);
await drag(window.header.left + 12, (window.header.top + window.header.bottom) / 2,
	window.header.left + 12 + initial.left - window.bounds.left, (window.header.top + window.header.bottom) / 2 + initial.top - window.bounds.top);
t.assert(sameBounds(window.requestedBounds, initial), 'ordinary resize/move gestures could not restore the requested placement');
sameOperation(first);

// Local row/scroll state survives client retirement and Close without inventing another snapshot.
await focusClient(); await press('End'); await press('ArrowRight');
await capture('gpu-window-explicit-raw-explanation');
await press('ArrowLeft');
await clickAction('window.collapse');
t.assert(window.open && window.collapsed && window.bounds.bottom === window.header.bottom, 'Collapse retained a hidden client-sized input area');
const retainedView = { ...input.detailsView };
t.assert(retainedView.selectionIndex > 0 && retainedView.anchorIndex > 0, 'client retirement discarded the selected raw row/scroll position');
await clickAction('window.collapse');
await capture('gpu-window-expanded-retained-row');
await clickAction('window.hide');
t.assert(!window.open && Object.keys(retainedView).every(key => input.detailsView[key] === retainedView[key]), 'Close disposed retained Details state');
t.command('gpu.details'); await t.frames(3);
t.assert(window.open && Object.keys(retainedView).every(key => input.detailsView[key] === retainedView[key]), 'reopening Details lost its selected row/scroll');
sameOperation(first); await capture('gpu-window-reopened-retained-row');

// Retiring a client capture drains the physical hold; it cannot become a diagram press.
await press('Home');
t.controlInput([{ type: 'pointer', x: window.client.right - 1, y: window.client.top + 3 }, { type: 'button', button: 'primary', down: true }]);
await t.frames(1);
t.command('window.collapse'); await t.frames(2);
t.assert(window.collapsed, 'the focused client did not expose its owning window command');
const collapsedPlacement = { ...window.requestedBounds };
await point(350, 80);
t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
t.assert(sameBounds(window.requestedBounds, collapsedPlacement) && input.selectedPoint === originalPoint,
	'a cancelled client hold moved the window or clicked through to the diagram');
sameOperation(first); await capture('gpu-window-collapsed-capture-retired');
await press('Escape'); await press('ArrowDown');
const secondSequence = input.projection.rows[1];
t.assert(window.open && window.collapsed && input.selected.sequence === secondSequence && window.title.includes(`#${secondSequence}`),
	'the collapsed caption did not follow real list selection independently of its retired client');
await clickAction('window.collapse');
const second = selected(); await capture('gpu-window-expanded-new-operation');

// Switching panes detaches presentation, not open intent or the input's observation lease.
const placement = { ...window.requestedBounds };
t.openLuaSource('cart.lua'); await t.frames(3);
t.assert(t.activeWorkbenchTab() === authored && window.open && input.history.observing, 'Source navigation destroyed the retained GPU input/window intent');
await capture('gpu-window-detached-over-canonical-source');
t.command('gpuDebugger'); await t.frames(3);
t.assert(t.activeWorkbenchTab() === input && window.open && sameBounds(window.requestedBounds, placement), 'returning to GPU lost retained window placement');
sameOperation(second); await capture('gpu-window-reattached');

// Clearing is an explicit empty subject; the old operation is never replaced by slot contents.
await press('Escape'); t.command('gpu.clear'); await t.frames(3);
t.assert(window.open && input.selected.sequence === -1 && input.selected.wordCount === 0 && input.history.count === 0,
	'Clear left stale raw data or closed the modeless window instead of showing its empty subject');
t.assert(!window.title.includes(`#${second.sequence}`), 'the empty window retained the previous operation caption');
await capture('gpu-window-cleared-empty-subject');
await clickAction('window.hide'); t.assert(!window.open, 'Close stopped working when no operation was selected');
t.assert(authored.context.model.buffer.getText() === source, 'GPU window interaction changed canonical authored source');
t.assert(t.runtime().machine.scheduler.nowCycles === cycles, 'GPU window interaction advanced the paused guest');
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `GPU window workflow logged an error: ${t.logMessage(index).message}`);
