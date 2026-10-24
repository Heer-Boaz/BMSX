// Render the real Studio UI over the shipped cart, without a browser or model injection.
// Run: npm run ide:test -- nemesis_s tests/ide/actor_lab_window_ux.idetest.js
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true })));
	await t.frames(2);
	t.controlInput(codes.map(code => ({ type: 'key', code, down: false })));
	await t.frames(2);
};
const click = async (x, y) => {
	t.controlInput([{ type: 'pointer', x, y }]);
	await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: true }]);
	await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]);
	await t.frames(2);
};
const drag = async (x, y, toX, toY) => {
	t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'primary', down: true }]);
	await t.frames(1);
	t.controlInput([{ type: 'pointer', x: toX, y: toY }]);
	await t.frames(2);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]);
	await t.frames(2);
};
const capture = async label => {
	await t.frames(2);
	t.log(`VISUAL ${label}`);
	t.capture(label);
};

await t.waitForCart();
await t.frames(90);
t.openLuaSource('cart.lua');
await t.frames(2);
const sourceModel = t.activeEditorDocument().model;
const sourceBytes = sourceModel.buffer.getText(), sourceVersion = sourceModel.version;
t.command('actorLab');
await t.frames(2);
await capture('running-actor-picker');
const input = t.activeWorkbenchTab();
t.assert(input.kind === 'actor_lab', 'Actor Lab did not open');
await press('Enter');
t.log(JSON.stringify({ kind: input.kind, actorPresent: input.actorPresent, status: input.status,
	cycles: t.runtime().machine.scheduler.nowCycles, videoTick: t.runtime().frameScheduler.lastTickSequence }));
await capture('selected-actor');
t.assert(input.kind === 'actor_lab' && input.actorPresent, 'the real Intro actor was not selected');
t.assert(input.outline.rows[0].element.node.name === 'nemesis_s.intro', 'the actual running actor identity changed');
// Files changes the real client origin. Retained tree/graph bounds drive ordinary
// pointer input; identities and keyboard outcomes, not pixel positions, are the oracle.
const insetCycles = t.runtime().machine.scheduler.nowCycles;
for (let fontIndex = 0; fontIndex < 2; fontIndex++) {
	const variant = input.layout.font.variant;
	for (let theme = 0; theme < 2; theme++) {
		await press('Home'); await press('ArrowDown'); await press('ArrowRight');
		const timelineIndex = input.outline.selectionIndex;
		const timeline = input.outline.rows[timelineIndex].element.node;
		const nextTimeline = input.outline.rows[timelineIndex + 1].element.node;
		t.assert(timeline.kind === 'timeline' && nextTimeline.kind === 'timeline', 'the shipped actor did not expose its actual adjacent timelines');
		await press('ControlLeft', 'KeyB');
		t.assert(t.activeWorkbenchTab() === input && input.outline.rows[input.outline.selectionIndex].element.node === timeline,
			'opening Files replaced the Actor client or selected subject');
		const tree = input.outline.layout;
		await click(tree.contentRight - 4, tree.contentTop + (timelineIndex + 1 - (input.outline.scroll | 0) + 0.5) * tree.rowHeight);
		t.assert(input.outline.rows[input.outline.selectionIndex].element.node === nextTimeline, 'the translated Actor tree did not receive the actual timeline pointer');
		await press('ArrowUp');
		t.assert(input.outline.rows[input.outline.selectionIndex].element.node === timeline
			&& input.timeline.visible && input.timeline.entryHashId === timeline.hashId, 'pointer focus did not return keyboard navigation to the same live timeline');
		await capture(`${variant}-theme-${theme}-timeline-with-files`);
		const machineIndex = input.outline.rows.findIndex(row => row.element.node.kind === 'machine');
		t.assert(machineIndex >= 0, 'the real actor has no FSM machine to inspect');
		await press('Home');
		for (let index = 0; index < machineIndex; index++) await press('ArrowDown');
		const machine = input.outline.rows[input.outline.selectionIndex].element.node;
		t.command('actorLab.stateGraph'); await t.frames(2);
		const graph = input.stateGraph, selected = graph.viewport.selection;
		t.assert(input.presentation === 'graph' && selected.kind === 'node'
			&& graph.selectedTarget.path.at(-1).hashId === machine.hashId, 'the translated client did not open the exact physical FSM graph');
		await press('Home');
		await click(graph.viewport.graphToViewportX(selected.bounds.left) + 4,
			graph.viewport.graphToViewportY(selected.bounds.top) + selected.headerHeight / 2);
		t.assert(graph.viewport.selection === selected, 'the translated graph pointer selected a different physical node');
		await capture(`${variant}-theme-${theme}-graph-with-files`);
		await press('Escape');
		t.assert(input.presentation === 'outline' && input.outline.rows[input.outline.selectionIndex].element.node === machine,
			'graph Escape did not return the actual selected machine to its outline');
		await press('ControlLeft', 'KeyB'); await press('Home');
		t.assert(t.activeWorkbenchTab() === input && sourceModel.buffer.getText() === sourceBytes
			&& sourceModel.version === sourceVersion && !sourceModel.dirty, 'Files or Actor layout navigation changed the canonical source/input');
		t.assert(t.runtime().machine.scheduler.nowCycles === insetCycles, 'Actor layout/pointer navigation executed the paused guest');
		t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
await press('Enter');
t.assert(input.detailsWindow.open && input.details.available, 'Details did not inspect the selected real instance');
t.command('actorLab.lockDetails');
await t.frames(2);
const pin = input.detailsActions.items.find(item => item.command === 'actorLab.lockDetails').bounds;
await click((pin.left + pin.right) / 2, (pin.top + pin.bottom) / 2);
t.assert(!input.details.locked, 'the visible pin icon did not unlock the real Details subject');
await click((pin.left + pin.right) / 2, (pin.top + pin.bottom) / 2);
t.assert(input.details.locked, 'the visible pin icon did not relock the real Details subject');
t.command('actorLab.details');
const subject = input.details.subject;
const stoppedCycles = t.runtime().machine.scheduler.nowCycles;
await press('Escape');
await press('ArrowDown');
t.assert(input.details.subject === subject && input.details.locked, 'tree navigation changed the locked Details identity');

// Switch using the shipped font shortcut, not by replacing font or layout state.
for (let fontIndex = 0; fontIndex < 2; fontIndex++) {
	const font = input.detailsWindow.font;
	const variant = font.lineHeight === 6 ? 'tiny' : 'msx';
	t.assert(font.lineHeight === 6 || font.lineHeight === 8, 'unexpected shipped font metrics');
	t.assert(font.char_to_img('…') !== font.char_to_img('?'), 'the ellipsis is a fallback character');
	for (let theme = 0; theme < 2; theme++) {
		t.command('actorLab.details');
		await t.frames(2);
		const model = input.detailsWindow;
		t.assert(model.title === input.details.caption, 'window chrome did not use the compact subject caption');
		t.assert(model.displayTitle.length > 0, 'the subject caption has no title budget');
		for (const action of input.detailsActions.items) {
			t.assert(action.icon !== undefined, 'window control still consumes text-label width');
			t.assert(action.bounds.left >= model.header.left && action.bounds.right <= model.header.right,
				'window control escaped the header at this font size');
		}
		if (theme === 0) {
			const right = model.bounds.right - 1, bottom = model.bounds.bottom - 1;
			await drag(right, bottom, model.bounds.left + model.minimumWidth - 1, model.bounds.top + model.minimumHeight - 1);
			t.assert(model.bounds.right - model.bounds.left === model.minimumWidth
				&& model.bounds.bottom - model.bounds.top === model.minimumHeight, 'pointer resize did not reach the font-aware minimum');
			await capture(`${variant}-minimum-window`);
			await drag(model.bounds.right - 1, model.bounds.bottom - 1, right, bottom);
		}
		await capture(`${variant}-theme-${theme}-expanded`);
		t.command('window.collapse');
		await t.frames(2);
		t.assert(model.collapsed && model.client.top === model.client.bottom, 'collapse retained client real estate');
		await capture(`${variant}-theme-${theme}-collapsed`);
		t.command('window.collapse');
		await t.frames(2);
		t.assert(input.details.subject === subject && input.details.locked, 'font, theme or collapse changed the locked subject');
		t.command('theme-toggle');
		await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
t.assert(t.runtime().machine.scheduler.nowCycles === stoppedCycles, 'layout inspection advanced the paused guest');

// A window remains usable when its subject does not exist at the selected history position.
t.command('actorLab.details');
t.command('window.collapse');
await press('Escape');
t.command('runtime.focusTimeline');
await press('Tab');
await press('Home');
for (let frame = 0; frame < 120 && (t.runtime().machine.scheduler.nowCycles !== 0 || input.controller.rewind.seeking); frame++) await t.frames(1);
await t.frames(2);
t.assert(t.runtime().machine.scheduler.nowCycles === 0 && !input.actorPresent, 'the real timeline did not reach the pre-actor frame');
t.assert(input.details.locked && input.details.subject === subject && !input.details.available,
	'collapsed Details did not preserve and mark its unavailable historical identity');
await capture('historical-unavailable-collapsed');
t.command('actorLab.details');
await t.frames(2);
const close = input.detailsActions.items.find(item => item.command === 'window.hide').bounds;
await click((close.left + close.right) / 2, (close.top + close.bottom) / 2);
await t.frames(2);
t.assert(!input.detailsWindow.open, 'close did not remove the floating window');
t.command('actorLab.details');
await t.frames(2);
t.assert(input.detailsWindow.open && input.detailsWindow.collapsed && input.details.locked,
	'keyboard inspection did not reopen the retained unavailable window');
await capture('historical-unavailable-reopened');
await press('Escape');
t.command('runtime.present');
for (let frame = 0; frame < 400 && (input.controller.rewind.active || input.controller.rewind.seeking); frame++) await t.frames(1);
await t.frames(2);
t.log(JSON.stringify({ phase: 'returned', actorPresent: input.actorPresent, available: input.details.available,
	retired: input.details.retired, historical: input.historical, actorHashId: input.actorHashId,
	sameSubject: input.details.subject === subject, reviewing: input.controller.rewind.active,
	seeking: input.controller.rewind.seeking, cycles: t.runtime().machine.scheduler.nowCycles,
	latestCycles: t.runtime().history.latestCycles, worldHashId: input.worldHashId }));
await capture('historical-return-observation');
t.assert(input.actorPresent && input.details.available && input.details.subject === subject,
	'returning to the retained frame did not resolve the same locked subject');
await capture('historical-return-collapsed');
t.command('actorLab.details');
t.command('window.collapse');
t.command('actorLab.lockDetails');
await press('Escape');
await press('Home');
await press('ArrowDown');
await press('Enter');
await t.frames(2);
t.assert(input.details.subject.path.at(-1).kind === 'component', 'the real timeline component is not being inspected');
t.assert(input.details.caption === 'Timelines' && input.detailsWindow.displayTitle === 'Timelines',
	'the component chrome does not display its actual semantic type');
t.assert(input.details.items.every(item => !item.value.includes('\n')), 'component Details still contains eager multiline object dumps');
await capture('component-structured-values');
const storage = input.details.items.findIndex(item => item.label === 'Stored fields');
t.assert(storage >= 0, 'raw stored fields are not explicitly reachable');
const compactCount = input.details.items.length;
await press('Home');
for (let index = 0; index < storage; index++) await press('ArrowDown');
await press('ArrowRight');
t.assert(input.details.items.length > compactCount && input.details.items[storage].expansion.expanded,
	'the keyboard disclosure did not enumerate actual stored fields');
await capture('component-stored-fields-expanded');
const space = input.details.items.findIndex(item => item.label === '_active_space');
t.assert(space >= 0, 'the actual mounted Space reference was lost');
await press('Home');
for (let index = 0; index < space; index++) await press('ArrowDown');
await press('ArrowRight');
await capture('component-space-reference-expanded');
await press('ControlLeft', 'ShiftLeft', 'KeyT');
await capture('msx-component-space-reference-expanded');
const fullKey = '_active_objects_by_definition';
const rawReference = input.details.items.findIndex(item => item.label === fullKey);
t.assert(rawReference >= 0, 'the actual Space definition index is not inspectable');
await press('Home');
for (let index = 0; index < rawReference; index++) await press('ArrowDown');
await capture('msx-full-raw-key-feedback');
await press('ArrowLeft');
await press('Home');
for (let index = 0; index < storage; index++) await press('ArrowDown');
await press('ArrowLeft');
await capture('msx-component-structured-values');

for (let index = 0; index < t.logMessageCount(); index++) {
	const message = t.logMessage(index);
	t.assert(message.level !== 3, `UI workflow logged an error: ${message.message}`);
}
