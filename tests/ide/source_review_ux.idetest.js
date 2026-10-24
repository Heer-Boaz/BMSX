// Real shared Moon-tree transfer -> source review, without injected proposals or source models.
// Run: npm run ide:test -- nemesis_s tests/ide/source_review_ux.idetest.js --ttl 120
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const capture = async label => { await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label); };
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
	await press('Tab'); await press('Home');
};
const requestCompanion = async input => {
	t.command('gameView.closePanel'); await t.frames(3);
	const fullRight = input.view.layout.right;
	t.command('gameView.togglePanel'); await t.frames(3);
	const companion = input.view.layout.right < fullRight;
	if (companion) {
		t.controlInput([{ type: 'pointer', x: input.view.layout.right + 2, y: 80 }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
		t.controlInput([{ type: 'pointer', x: 50, y: 80 }]); await t.frames(2);
		t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
	}
	// Return focus to the actual review after the optional sash interaction.
	t.controlInput([{ type: 'pointer', x: input.view.layout.left + 5, y: input.view.layout.top + 3 },
		{ type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
	return companion ? 'companion' : 'full-preview-unavailable';
};

await t.waitForCart(); await t.frames(90);
let input = await choose();
const originalInput = input, model = input.workingCopy, source = model.buffer.getText(), version = model.version;
const cycles = t.runtime().machine.scheduler.nowCycles;
t.assert(!model.canUndo, 'the source-review fixture must start without prior document edits');
await propose(input);
// The actual initial review focus was the impact list; Tab now focuses its explicit Apply action.
for (let font = 0; font < 2; font++) {
	const variant = input.view.layout.font.variant;
	t.command('gameView.closePanel'); await t.frames(3);
	await press('Escape');
	for (let theme = 0; theme < 2; theme++) {
		t.controlInput([{ type: 'pointer', x: 2, y: 285 }]); await t.frames(2);
		await capture(`source-review-${variant}-${theme}-full`);
		t.command('theme-toggle'); await t.frames(2);
	}
	const phase = await requestCompanion(input);
	for (let theme = 0; theme < 2; theme++) {
		await capture(`source-review-${variant}-${theme}-${phase}`);
		t.controlInput([{ type: 'pointer', x: input.view.layout.left + 8, y: input.view.layout.top + 4 }]); await t.frames(3);
		await capture(`source-review-${variant}-${theme}-${phase}-title-hint`);
		t.controlInput([{ type: 'pointer', x: input.view.layout.left + 8,
			y: input.view.layout.top + input.view.layout.font.lineHeight + 7 }]); await t.frames(3);
		await capture(`source-review-${variant}-${theme}-${phase}-summary-hint`);
		await press('Tab'); await press('Home');
		await capture(`source-review-${variant}-${theme}-${phase}-actions`);
		await press('Escape');
		t.assert(t.activeWorkbenchTab() === input && model.buffer.getText() === source && model.version === version,
			'font, theme, resize or owned popup changed the proposal source');
		t.command('theme-toggle'); await t.frames(2);
	}
	t.command('gameView.closePanel'); await t.frames(3);
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
	// Restore the review action focus for the next iteration's Escape-to-content.
	await press('Tab'); await press('Home');
}
await press('Escape'); await requestCompanion(input);
t.command('sourceEditReview.source'); await t.frames(3);
t.assert(t.activeWorkbenchTab().kind === 'code_editor' && t.activeWorkbenchTab().workingCopy === model,
	'actual review Source did not reveal the proposal\'s canonical written expression');
t.assert(model.buffer.getText() === source && model.version === version, 'impact Source applied the proposal');
await capture('source-review-open-canonical-impact');

input = await choose(); t.assert(input === originalInput, 'returning to the Moon graph replaced its retained input');
await propose(input); await press('Escape'); t.command('sourceEditReview.discard'); await t.frames(3); await press('Home');
t.assert(input.view.presentation.viewport.selection === input.view.presentation.viewport.model.nodes[0],
	'Discard did not return keyboard navigation to the owning graph');
t.assert(model.buffer.getText() === source && !model.canUndo, 'Discard created document history');
await capture('source-review-discarded-return-to-graph');

await propose(input); await press('Enter'); await t.frames(3);
const accepted = model.buffer.getText();
t.assert(accepted !== source && model.version === version + 1 && model.canUndo, 'explicit Apply did not perform exactly one canonical source edit');
await capture('source-review-applied-one-source-edit');
t.command('undo'); await t.frames(3); t.assert(model.buffer.getText() === source && !model.canUndo, 'one ordinary Undo did not restore exact authored source');
t.command('redo'); await t.frames(3); t.assert(model.buffer.getText() === accepted, 'Redo lost the admitted source operation');
t.command('undo'); await t.frames(3); t.assert(model.buffer.getText() === source && !model.dirty, 'final Undo did not restore the original clean source');
t.assert(t.runtime().machine.scheduler.nowCycles === cycles, 'source review UI executed the paused guest');
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Source review logged an error: ${t.logMessage(index).message}`);
