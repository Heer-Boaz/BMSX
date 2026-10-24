// Actual guest focus/release routes; no native Studio or gameplay-execution claim.
// Run: npm run ide:test -- nemesis_s tests/ide/guest_focus_hint_ux.idetest.js --ttl 120
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const click = async (x, y) => {
	t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
};
const type = async text => {
	for (const character of text) await press(character === ' ' ? 'Space' : `Key${character.toUpperCase()}`);
};
let captures = 0;
const capture = async (label, x = 383, y = 285) => {
	t.assert(++captures <= 32, 'guest focus workflow exceeded its capture budget');
	t.controlInput([{ type: 'pointer', x, y }]); await t.frames(2);
	t.log(`VISUAL ${label}`); t.capture(label);
};
await t.waitForCart(); await t.frames(90); t.openLuaSource('cart.lua'); await t.frames(2);
const code = t.activeWorkbenchTab(), model = code.workingCopy;
const source = model.buffer.getText(), version = model.version, runtime = t.runtime();
const unchanged = () => {
	t.assert(code.workingCopy === model && model.buffer.getText() === source && model.version === version && !model.dirty,
		'guest focus or release changed the canonical source working copy');
	t.assert(t.runtime() === runtime && t.workbenchActive(), 'guest focus replaced the authoring runtime or left Studio');
};
const palette = async (query, kind) => {
	await press('ControlLeft', 'ShiftLeft', 'KeyP'); await type(query); await press('Enter'); await t.frames(2);
	t.assert(t.activeWorkbenchTab().kind === kind, 'released guest focus did not route the actual Palette command');
};
const terminalReturn = async () => {
	await press('ShiftLeft', 'F1'); await palette('bios terminal', 'terminal'); await press('ShiftLeft', 'F1'); unchanged();
};
const focusFrame = async (input, bounds, font, label) => {
	t.assert(input.layout.font.variant === font && bounds.right > bounds.left && bounds.bottom > bounds.top,
		'the actual guest frame or font does not match this test phase');
	await click((bounds.left + bounds.right) / 2, (bounds.top + bounds.bottom) / 2);
	await press('KeyA');
	t.assert(t.activeWorkbenchTab() === input, 'an ordinary guest key changed the active Studio input');
	unchanged(); await capture(label);
};

// A shipped integration module supplies the real independent Play target and completed bitmap.
t.command('scenarioLab'); await t.frames(3);
const lab = t.activeWorkbenchTab(), tests = lab.view.testPane;
const modulePath = 'tests/carts/nemesis_s/nemesis_s_pause_assert.lua';
const index = tests.rows.findIndex(row => row.kind === 'test' && row.test.resource.path === modulePath);
t.assert(index >= 0, 'the actual integration fixture is missing');
await press('Home'); for (let row = 0; row < index; row++) await press('ArrowDown');
t.assert(tests.rows[tests.selectionIndex].test.resource.path === modulePath, 'ordinary navigation selected another Play fixture');
t.command('scenarioLab.play'); await t.frames(3);
const play = t.activeWorkbenchTab(), handle = play.handle;
t.assert(play.kind === 'play_session' && handle.module.path === modulePath, 'Play lost the selected authored module identity');
for (let frame = 0; frame < 4000 && handle.session?.ready !== true && handle.state !== 'failed' && handle.state !== 'faulted'; frame++) await t.frames(1);
t.assert(handle.session?.ready === true, 'the real Play fixture did not reach Ready');
for (let frame = 0; frame < 120 && handle.session.frames.bitmap === undefined; frame++) await t.frames(1);
t.assert(handle.session.frames.bitmap !== undefined, 'Ready Play did not publish a completed guest bitmap');
const session = handle.session;
t.command('actorLab'); await t.frames(2); const actor = t.activeWorkbenchTab(); await press('Enter');
t.assert(actor.kind === 'actor_lab' && actor.actorPresent && actor.outline.rows[0].element.node.name === 'nemesis_s.intro',
	'the actual Intro actor was not selected');

for (const font of ['tiny', 'msx']) {
	for (const theme of ['light', 'dark']) {
		const label = `${font}-${theme}`;
		t.command('terminal'); await t.frames(3); const terminal = t.activeWorkbenchTab();
		t.assert(terminal.kind === 'terminal', 'the actual BIOS Terminal did not open');
		await focusFrame(terminal, terminal.frameBounds, font, `guest-terminal-${label}`);
		await press('ShiftLeft', 'F1'); await press('ControlLeft', 'ShiftLeft', 'KeyP');
		await capture(`guest-released-palette-${label}`);
		await type('bios terminal'); await press('Enter');
		t.assert(t.activeWorkbenchTab() === terminal, 'the released Palette did not return to the retained Terminal');
		await press('ShiftLeft', 'F1');

		t.command('gameView'); await t.frames(3); const game = t.activeWorkbenchTab();
		t.assert(game.kind === 'game_view', 'the actual Game view did not open');
		await focusFrame(game, game.frameBounds, font, `guest-game-view-${label}`);
		await click(12, 4); await capture(`guest-modal-takeover-${label}`); await press('Escape');
		await terminalReturn();

		t.command('events'); t.command('gameView.togglePanel'); await t.frames(3); const events = t.activeWorkbenchTab();
		t.assert(events.kind === 'event_viewer' && events.layout.right < 384, 'the actual Game Panel did not inset its owning pane');
		await focusFrame(events, { left: events.layout.right + 8, top: 70, right: 376, bottom: 220 }, font, `guest-game-panel-${label}`);
		await press('ShiftLeft', 'F1'); await palette('close game panel', 'event_viewer');
		t.assert(events.layout.right === 384, 'the actual Close Game Panel command retained the guest client');
		t.openLuaSource('cart.lua'); await t.frames(2);
		t.assert(t.activeWorkbenchTab() === code, 'guest client detach replaced the canonical source input');
		unchanged(); await capture(`guest-detached-source-${label}`);

		t.command('actorLab'); await t.frames(2);
		t.assert(t.activeWorkbenchTab() === actor && actor.actorPresent, 'Actor reveal replaced the retained Intro subject');
		const preview = actor.previewBounds, size = actor.controller.viewport.presenter.offscreenCanvasSize;
		t.assert(actor.layout.font.variant === font && preview.right > preview.left && preview.bottom > preview.top,
			'the actual Actor preview or font does not match this test phase');
		await click((preview.left + preview.right) / 2, (preview.top + preview.bottom) / 2); await press('KeyA');
		t.assert(t.activeWorkbenchTab() === actor, 'an ordinary guest key changed the active Actor input'); unchanged();
		const hit = actor.controller.viewportPicker.hit, hashId = hit.hashId;
		t.assert(hashId !== 0, 'ordinary preview input did not pick an actual rendered actor');
		const x = preview.left + (hit.left + hit.right) / 2 * (preview.right - preview.left) / size.x;
		const y = preview.top + (hit.top + hit.bottom) / 2 * (preview.bottom - preview.top) / size.y;
		await capture(`guest-actor-preview-${label}`, x, y);
		t.assert(actor.controller.viewportPicker.hit.hashId === hashId, 'the actual picked actor changed at its own preview bbox center');
		t.log(`ACTOR_GUEST_HOVER ${JSON.stringify({ label, hashId, subject: hit.label, x, y })}`); await terminalReturn();

		t.command('play.reveal'); await t.frames(3);
		t.assert(t.activeWorkbenchTab() === play && play.handle === handle && handle.session === session && session.ready,
			'Play reveal replaced the actual independent guest target');
		await focusFrame(play, play.frame, font, `guest-play-${label}`); await terminalReturn();
		t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
t.command('play.stop'); unchanged();
t.assert(captures === 32, 'the guest focus matrix omitted a declared state');
