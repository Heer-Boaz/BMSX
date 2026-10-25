// Real shared Moon-tree transfer -> source review, without injected proposals or source models.
// Run: npm run ide:test -- nemesis_s tests/ide/source_review_ux.idetest.js --ttl 120
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const capture = async label => { await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label); };
const focusContent = async review => {
	t.controlInput([{ type: 'pointer', x: review.viewport.bounds.left + 8, y: review.viewport.bounds.top + 3 },
		{ type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
};
const choose = async () => {
	t.command('gameView.closePanel'); t.openLuaSource('cart.lua'); await t.frames(2);
	t.command('behaviorLens'); await t.frames(2);
	for (const char of 'bt moon') await press(char === ' ' ? 'Space' : `Key${char.toUpperCase()}`);
	await press('Enter'); await t.frames(3);
	const input = t.activeWorkbenchTab();
	t.assert(input.kind === 'behavior_lens' && input.view.presentation.kind === 'graph'
		&& input.workingCopy.resource.path === 'enemies/moon_tree.lua', 'the shipped Moon behavior chooser opened another subject');
	return input;
};
const location = (viewport, node) => ({
	x: viewport.graphToViewportX((node.bounds.left + node.bounds.right) / 2),
	y: viewport.graphToViewportY(node.bounds.top + node.headerHeight / 2),
});
const propose = async input => {
	const viewport = input.view.presentation.viewport;
	for (let step = 0; step < 6; step++) { t.command('graph.zoomOut'); await t.frames(1); }
	t.assert(viewport.zoom === 0.25, 'the real graph zoom command did not reach its supported small scale');
	const root = viewport.model.nodes[0].children[0];
	const from = root.children[2].children[2].children[1].children[0];
	const to = root.children[3].children[1].children[0].children[0];
	t.assert(from.lines.some(line => line.includes('DEATH_RAY_MOVEMENT')) && to.lines.includes('FLY_ATTACK'),
		'the shared authored Moon branches changed');
	const a = location(viewport, from), b = location(viewport, to);
	const x = (viewport.bounds.left + viewport.bounds.right) / 2, y = (viewport.bounds.top + viewport.bounds.bottom) / 2;
	// Ordinary auxiliary-button panning centres the actual two visible drag endpoints.
	t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'aux', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'pointer', x: x + x - (a.x + b.x) / 2, y: y + y - (a.y + b.y) / 2 }]); await t.frames(2);
	t.controlInput([{ type: 'button', button: 'aux', down: false }]); await t.frames(2);
	const start = location(viewport, from), end = location(viewport, to);
	for (const point of [start, end]) t.assert(point.x > viewport.bounds.left && point.x < viewport.bounds.right
		&& point.y > viewport.bounds.top && point.y < viewport.bounds.bottom, 'the real shared source/target is outside the graph canvas');
	t.controlInput([{ type: 'pointer', ...start }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'pointer', ...end }]); await t.frames(3);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(3);
};
const focusTab = async input => {
	const tabs = t.workbenchTabs(), start = tabs.indexOf(t.activeWorkbenchTab()), target = tabs.indexOf(input);
	t.assert(target >= 0, 'the retained editor input disappeared from its group');
	for (let step = 0; step < (target - start + tabs.length) % tabs.length; step++) await press('ControlLeft', 'Tab');
	t.assert(t.activeWorkbenchTab() === input, 'ordinary tab navigation replaced the retained input');
};
const constrainFiles = async review => {
	const fullLeft = review.layout.left;
	t.command('resources'); await t.frames(3);
	const x = review.layout.left, y = (review.layout.top + review.layout.bottom) / 2;
	t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'pointer', x: (x + review.layout.right) / 2, y }]); await t.frames(2);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
	await focusContent(review);
	t.assert(review.layout.left > fullLeft, 'the real Files sibling was not presented for the reading reflow');
};
const pendingReview = () => {
	const review = t.activeWorkbenchTab();
	t.assert(review.kind === 'workspace_edit_review' && review.proposal.state === 'pending' && review.evidence.items.length > 0,
		'the physical authored transfer did not open a captured, pending workspace review');
	return review;
};

await t.waitForCart(); await t.frames(90);
let graph = await choose();
const model = graph.workingCopy, source = model.buffer.getText(), version = model.version;
const cycles = t.runtime().machine.scheduler.nowCycles, media = t.sourceState().currentBlua32Media;
const initialUndo = model.canUndo;
await propose(graph); let review = pendingReview();
let expected = source;
const file = review.proposal.files.find(file => file.kind === 'edit' && file.model === model);
// The immutable preview's exact bytes are the data-integrity oracle for Apply.
for (const hunk of file.hunks.slice().reverse())
	expected = expected.slice(0, hunk.offset) + hunk.after + expected.slice(hunk.offset + hunk.before.length);
t.assert(expected !== source, 'the real graph operation produced no authored source difference');
for (let font = 0; font < 2; font++) {
	const variant = review.layout.font.variant;
	await press('Escape'); await press('Home');
	for (let theme = 0; theme < 2; theme++) {
		await capture(`source-review-${variant}-${theme}-exact-diff-full`);
		t.command('theme-toggle'); await t.frames(2);
	}
	t.command('workspaceEditReview.impacts'); await t.frames(2);
	// An explicit destination remains source intent even if the viewport must
	// clamp it above the bottom; a clamped pixel is not a user End command.
	const { line, offset, decoration, fraction, edge } = review.reading;
	t.assert(line.part === 'impacts', 'the real Impacts command did not retain its semantic destination');
	await constrainFiles(review);
	t.assert(review.reading.line === line && review.reading.offset === offset && review.reading.decoration === decoration
		&& review.reading.fraction === fraction && review.reading.edge === edge,
		'Files resizing replaced the captured evidence reading position');
	for (let theme = 0; theme < 2; theme++) {
		await capture(`source-review-${variant}-${theme}-files-wrapped-impacts`);
		await press('Home'); await capture(`source-review-${variant}-${theme}-files-exact-diff`);
		await press('Tab'); await press('Home');
		await capture(`source-review-${variant}-${theme}-files-actions`);
		await press('Escape'); t.command('workspaceEditReview.impacts'); await t.frames(2);
		t.assert(t.activeWorkbenchTab() === review && model.buffer.getText() === source && model.version === version && model.canUndo === initialUndo,
			'font, theme, actual Files reflow or action focus changed pending source/history');
		t.command('theme-toggle'); await t.frames(2);
	}
	t.command('resources'); await t.frames(2);
	await press('ControlLeft', 'ShiftLeft', 'KeyT'); await t.frames(2);
	await focusContent(review);
}
const captured = review.evidence.items[0].location, position = { row: 0, column: 0 };
captured.model.buffer.positionAt(captured.offset, position);
t.command('workspaceEditReview.source'); await t.frames(3); await press('Home'); await press('Enter'); await t.frames(3);
const code = t.activeWorkbenchTab();
t.assert(code.kind === 'code_editor' && code.workingCopy === captured.model && code.workingCopy === model
	&& code.context.view.cursorRow === position.row && code.context.view.cursorColumn === position.column,
	'captured impact Source did not open the same canonical model at its UTF-16 offset');
t.assert(review.proposal.state === 'pending' && t.workbenchTabs().includes(review) && model.buffer.getText() === source,
	'Source consumed the proposal or applied its edit');
await capture('source-review-open-captured-canonical-impact');
await focusTab(graph); await press('ControlLeft', 'KeyW'); await focusTab(review);
t.assert(!t.workbenchTabs().includes(graph) && review.proposal.state === 'pending',
	'closing the originating graph disposed its independent source review');
t.command('workspaceEditReview.apply'); await t.frames(3);
t.assert(t.activeWorkbenchTab() === code && t.workbenchTabs().includes(review) && review.proposal.state === 'applied' && model.buffer.getText() === expected
	&& model.version === version + 1 && model.canUndo, 'Apply did not commit exactly the reviewed bytes as one canonical edit');
await focusTab(review); t.command('workspaceEditReview.impacts'); await t.frames(2); await capture('source-review-applied-retained-evidence');
await focusTab(code); t.command('undo'); await t.frames(3);
t.assert(model.buffer.getText() === source && model.canUndo === initialUndo && review.proposal.state === 'applied',
	'ordinary Source Undo lost exact authored bytes or revived settled authority');
t.command('redo'); await t.frames(3); t.assert(model.buffer.getText() === expected, 'Redo changed the reviewed operation');
t.command('undo'); await t.frames(3);

graph = await choose(); await propose(graph); review = pendingReview();
t.command('workspaceEditReview.source'); await t.frames(2); await press('Enter'); await t.frames(2);
await press('ControlLeft', 'End'); await press('Space');
t.assert(review.proposal.state === 'stale' && model.buffer.getText() !== source, 'real Source typing did not immediately revoke captured edit authority');
t.command('undo'); await t.frames(2); await focusTab(review);
t.assert(model.buffer.getText() === source && review.proposal.state === 'stale', 'Undo revived a stale source proposal');
t.command('workspaceEditReview.impacts'); await t.frames(2); await capture('source-review-stale-retained-evidence');
await focusTab(graph); await propose(graph); review = pendingReview();
t.command('workspaceEditReview.discard'); await t.frames(2);
t.assert(t.activeWorkbenchTab() === review && review.proposal.state === 'discarded' && model.buffer.getText() === source
	&& model.canUndo === initialUndo, 'Discard changed canonical source/history or removed readable evidence');
await capture('source-review-discarded-retained-evidence');
t.assert(t.runtime().machine.scheduler.nowCycles === cycles && t.sourceState().currentBlua32Media === media,
	'source review executed the paused guest or replaced installed source');
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Source review logged an error: ${t.logMessage(index).message}`);
