// Actual shipped Rename Preview -> retained Workspace Review; no injected proposals or model edits.
// Run: npm run ide:test -- nemesis_s tests/ide/workspace_review_ux.idetest.js --ttl 120
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const capture = async label => { await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label); };
const click = async (x, y) => {
	t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
};
const focusContent = async input => { await click(input.viewport.bounds.left + 8, input.viewport.bounds.top + 3); };
const preview = async (line, replacement) => {
	t.openLuaSource('director.lua'); await t.frames(2);
	t.command('lineJump');
	for (const digit of String(line)) await press(`Digit${digit}`);
	await press('Enter');
	for (let index = 0; index < 7; index++) await press('ArrowRight');
	t.command('renamePreview'); await t.frames(2); await press('ControlLeft', 'KeyA');
	for (const char of replacement) {
		if (char === '_') await press('ShiftLeft', 'Minus');
		else await press(`Key${char.toUpperCase()}`);
	}
	await press('Enter'); await t.frames(3);
	const input = t.activeWorkbenchTab();
	t.assert(input.kind === 'workspace_edit_review' && input.proposal.state === 'pending', 'the real Rename Preview command did not create a pending review');
	return input;
};
const narrow = async input => {
	t.command('gameView.togglePanel'); await t.frames(3);
	t.controlInput([{ type: 'pointer', x: input.layout.right + 2, y: 80 }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'pointer', x: 50, y: 80 }]); await t.frames(2);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
	t.assert(input.layout.right === (input.layout.font.variant === 'tiny' ? 78 : 118), 'the actual review did not reach its supported font minimum');
	await focusContent(input);
};
const wide = async input => { t.command('gameView.closePanel'); await t.frames(3); await focusContent(input); };
const resizeAboveProblems = async (input, bottom) => {
	const x = input.layout.left + 12;
	t.controlInput([{ type: 'pointer', x, y: input.layout.bottom }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'pointer', x, y: bottom }]); await t.frames(2);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
};
const scrollToRow = async (input, index, fraction = 0.375) => {
	await focusContent(input); await press('Home');
	t.controlInput([{ type: 'pointer', x: input.viewport.bounds.left + 12, y: input.viewport.bounds.top + 6 }, { type: 'wheel', deltaY: index + fraction }]);
	await t.frames(3);
	t.assert(input.viewport.scrollTop === (index + fraction) * input.layout.rowHeight, 'the real wheel did not establish the requested fractional reading row');
};
const bookmark = input => {
	const index = Math.trunc(input.viewport.scrollTop / input.layout.rowHeight), row = input.rows[index];
	return { line: row.line, offset: row.start, decoration: row.decoration,
		fraction: input.viewport.scrollTop / input.layout.rowHeight - index, scroll: input.viewport.scrollTop };
};
const sameIntent = (input, expected) => {
	const reading = input.reading;
	t.assert(reading.line === expected.line && reading.offset === expected.offset && reading.decoration === expected.decoration
		&& reading.fraction === expected.fraction, 'reflow replaced the exact immutable file/hunk/side/source reading intent with projected pixels');
	const row = input.rows[Math.trunc(input.viewport.scrollTop / input.layout.rowHeight)];
	t.assert(row.line === expected.line, 'the visible first row jumped to another source line or before/after side');
	const displayOffset = expected.line.sourceToDisplay[expected.offset - expected.line.sourceOffset] + expected.decoration;
	const rowStart = row.line.sourceToDisplay[row.start - row.line.sourceOffset] + row.decoration;
	t.assert(displayOffset >= rowStart && displayOffset < rowStart + row.text.length,
		'the visible first row lost the original source position within the same wrapped line');
	t.assert(input.viewport.scrollTop / input.layout.rowHeight % 1 === expected.fraction,
		'the projected viewport lost the original fractional-row reading intent');
};

await t.waitForCart(); await t.frames(90);
t.command('gameView.closePanel'); t.openLuaSource('director.lua'); await t.frames(2);
const model = t.activeEditorDocument().model, source = model.buffer.getText(), version = model.version;
const cycles = t.runtime().machine.scheduler.nowCycles;
const unchanged = input => {
	t.assert(model.buffer.getText() === source && model.version === version && !model.dirty && !model.canUndo,
		'reading, layout or discarding wrote canonical source/history');
	t.assert(input.proposal.state === 'pending' && t.runtime().machine.scheduler.nowCycles === cycles,
		'review presentation settled edit authority or advanced the paused guest');
};
let input = await preview(20, 'director_for_the_current_nemesis_cartridge_scene_and_intro_lifecycle');
t.assert(input.proposal.files.length === 1 && input.proposal.files[0].model === model && input.proposal.files[0].hunks.length > 30,
	'the shipped director rename no longer supplies the canonical multi-hunk review fixture');
for (let font = 0; font < 2; font++) {
	const variant = input.layout.font.variant;
	const index = input.rows.findIndex(row => row.kind === 'after' && row.line.hunk.offset > 500
		&& row.start > row.line.sourceOffset && row.decoration === 0);
	t.assert(index > 0 && (index + 0.375) * input.layout.rowHeight < input.viewport.scrollbar.getMaximumScroll(), 'the authored review has no unclamped middle-source row');
	await scrollToRow(input, index);
	const expected = bookmark(input), lines = input.lines, firstRow = input.rows[0];
	await capture(`workspace-review-wide-${variant}`);
	await narrow(input); sameIntent(input, expected);
	for (let theme = 0; theme < 2; theme++) {
		unchanged(input); await capture(`workspace-review-minimum-${variant}-theme-${theme}`);
		t.command('theme-toggle'); await t.frames(2); sameIntent(input, expected);
	}
	await wide(input); sameIntent(input, expected);
	t.assert(input.viewport.scrollTop === expected.scroll, 'two-way width reflow accumulated reading drift');
	// Detach the actual pane, change font in a different ordinary source tab, then reopen this same input.
	t.openLuaSource('cart.lua'); await t.frames(2); await press('ControlLeft', 'ShiftLeft', 'KeyT');
	t.command('tabs.previous'); await t.frames(3);
	t.assert(t.activeWorkbenchTab() === input, 'ordinary tab navigation did not reopen the retained review input');
	sameIntent(input, expected);
	await capture(`workspace-review-reattached-${input.layout.font.variant}`);
	await press('ControlLeft', 'ShiftLeft', 'KeyT'); sameIntent(input, expected);
	t.assert(input.viewport.scrollTop === expected.scroll, 'detach/font roundtrip lost the original source row fraction');
	t.assert(input.lines === lines && input.rows[0] === firstRow, 'reflow recreated immutable correspondence or warm row records');
	const stable = input.rows[Math.trunc(input.viewport.scrollTop / input.layout.rowHeight)];
	await t.frames(20);
	t.assert(input.rows[Math.trunc(input.viewport.scrollTop / input.layout.rowHeight)] === stable && input.viewport.scrollTop === expected.scroll,
		'unchanged host frames reprojected or drifted the retained review');
	await focusContent(input); await press('End');
	t.assert(input.viewport.scrollTop === input.viewport.scrollbar.getMaximumScroll(), 'review End did not reveal its actual final source rows');
	await capture(`workspace-review-end-${variant}`);
	await narrow(input);
	t.assert(input.reading.end && input.viewport.scrollTop === input.viewport.scrollbar.getMaximumScroll(), 'a true user End did not follow the new bottom');
	await wide(input); unchanged(input); await press('Home');
	t.assert(input.viewport.scrollTop === 0, 'review Home did not return to its real file header');
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
await press('ControlLeft', 'KeyW');
t.assert(input.proposal.state === 'discarded' && model.buffer.getText() === source && !model.canUndo, 'closing the real review did not discard without source writes');

// A short real rename fits above a resized Problems panel at full width but overflows the MSX
// minimum. Its hidden intent survives a layout clamp; physical Home at that zero replaces it.
input = await preview(24, 'opening_duration_frames');
t.assert(input.proposal.files.length === 1 && input.proposal.files[0].model === model && input.proposal.files[0].hunks.length === 2,
	'the short rename no longer supplies two real hunks from the same canonical source');
if (input.layout.font.variant !== 'msx') await press('ControlLeft', 'ShiftLeft', 'KeyT');
t.command('problems'); await t.frames(3);
const reviewBottom = input.viewport.bounds.top + (input.rows.length + 1) * input.layout.rowHeight;
await resizeAboveProblems(input, reviewBottom); await focusContent(input);
t.assert(input.viewport.scrollbar.getMaximumScroll() === 0, 'the real short rename no longer fits the full-width MSX viewport');
await narrow(input);
t.assert(input.viewport.scrollbar.getMaximumScroll() > input.layout.rowHeight * 4, 'the real short rename did not overflow at the MSX minimum');
await scrollToRow(input, 3);
const clamped = bookmark(input);
await capture('workspace-review-short-minimum-msx');
await resizeAboveProblems(input, input.layout.top + 1);
t.assert(input.viewport.height === 0, 'the real Problems sash did not reduce the review viewport to zero height');
await resizeAboveProblems(input, reviewBottom); await focusContent(input); sameIntent(input, clamped);
t.assert(input.viewport.scrollTop === clamped.scroll, 'the actual zero-height lifecycle replaced hidden source intent');
await wide(input); t.assert(input.viewport.scrollTop === 0, 'all-content-fit geometry did not clamp the projected pixels');
await narrow(input); sameIntent(input, clamped);
t.assert(input.viewport.scrollTop === clamped.scroll, 'a width-only clamp overwrote hidden source intent');
await wide(input); await press('Home'); await narrow(input);
t.assert(input.viewport.scrollTop === 0 && input.reading.offset === 0 && input.reading.line === input.lines[0], 'physical Home at clamped zero did not replace the old hidden intent');
await press('End'); await wide(input); await narrow(input);
t.assert(input.reading.end && input.viewport.scrollTop === input.viewport.scrollbar.getMaximumScroll(), 'End intent was lost through an all-content-fit zero clamp');
await capture('workspace-review-short-end-msx'); unchanged(input);
await press('ControlLeft', 'KeyW');
t.assert(input.proposal.state === 'discarded' && model.buffer.getText() === source && model.version === version && !model.dirty && !model.canUndo,
	'final review disposal changed canonical bytes, version, dirty state or undo history');
t.assert(t.runtime().machine.scheduler.nowCycles === cycles, 'the complete reading workflow advanced the paused guest');

// A deliberate ordinary source edit retires a fresh proposal. Warning text remains readable,
// disabled Apply cannot change source, and undoing the edit never reauthorizes the old proposal.
t.command('gameView.closePanel'); await t.frames(2);
input = await preview(24, 'opening_duration_frames');
t.openLuaSource('director.lua'); await t.frames(2); await press('ControlLeft', 'Home'); await press('Space');
t.assert(model.buffer.getText() === ` ${source}` && model.version === version + 1, 'the deliberate source-edit probe did not insert exactly one ordinary space');
t.command('tabs.next'); await t.frames(3);
t.log(JSON.stringify({ staleReview: input.id, active: t.activeWorkbenchTab().id, kind: t.activeWorkbenchTab().kind,
	state: input.proposal.state, rendered: input.renderedState, status: input.status }));
t.assert(t.activeWorkbenchTab() === input && input.proposal.state === 'stale' && input.renderedState === 'stale'
	&& input.status.startsWith('1 file | stale:'), 'a canonical source edit did not visibly retire the exact accepted proposal');
for (let font = 0; font < 2; font++) {
	for (let theme = 0; theme < 2; theme++) {
		const apply = input.actionBar.items.find(item => item.command === 'workspaceEditReview.apply');
		t.assert(!apply.enabled, 'a stale proposal retained an enabled Apply control');
		await click((apply.bounds.left + apply.bounds.right) / 2, (apply.bounds.top + apply.bounds.bottom) / 2);
		t.assert(model.buffer.getText() === ` ${source}` && model.version === version + 1, 'disabled Apply wrote stale source or history');
		await capture(`workspace-review-stale-${input.layout.font.variant}-theme-${theme}`);
		t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
await press('ControlLeft', 'KeyW'); t.openLuaSource('director.lua'); await t.frames(2); await press('ControlLeft', 'KeyZ');
t.assert(input.proposal.state === 'stale' && model.buffer.getText() === source && model.version === version + 2 && !model.dirty && !model.canUndo,
	'ordinary Undo either failed to clean up the intentional edit or reauthorized a retired proposal');
t.assert(t.runtime().machine.scheduler.nowCycles === cycles, 'the source-retirement UI probe advanced the paused guest');
