// Actual context-menu visibility and capture lifetimes for the main and Play transports.
// Run: npm run ide:test -- nemesis_s tests/ide/runtime_timeline_visibility.idetest.js --ttl 240
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const rightClick = async point => {
	t.controlInput([{ type: 'pointer', ...point }, { type: 'button', button: 'secondary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'button', button: 'secondary', down: false }]); await t.frames(2);
};
const capture = async label => { await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label); };
const waitAt = async (runtime, cycles, label) => {
	for (let frame = 0; frame < 400 && runtime.machine.scheduler.nowCycles !== cycles; frame++) await t.frames(1);
	await t.frames(3);
	t.assert(runtime.machine.scheduler.nowCycles === cycles, label);
};

await t.waitForCart(); await t.frames(90); t.openLuaSource('cart.lua'); await t.frames(3);
t.command('runtime.pause'); await t.frames(2);
const code = t.activeWorkbenchTab(), model = code.workingCopy;
const source = model.buffer.getText(), version = model.version, undo = model.canUndo, redo = model.canRedo;
const main = t.runtime(), media = t.sourceState().currentBlua32Media;
const authoredUnchanged = () => {
	t.assert(code.workingCopy === model && model.buffer.getText() === source && model.version === version
		&& model.canUndo === undo && model.canRedo === redo && !model.dirty,
		'timeline presentation changed the canonical working copy or its history');
	t.assert(t.runtime() === main && t.sourceState().currentBlua32Media === media,
		'timeline presentation replaced the authoring runtime or installed source');
};

// Timeline is a shared workbench part. Its actual admitted extent is observable
// in its client's published bottom, not inferred from a pixel or label snapshot.
const exercise = async (input, runtime, right, headerPoint, consumer, identity) => {
	const present = runtime.history.latestCycles, earliest = runtime.history.earliestCycles;
	t.assert(earliest < present, 'the real physical target has no retained chronology to review');
	for (const font of ['tiny', 'msx']) {
		for (const theme of ['light', 'dark']) {
			const phase = `${consumer}-${font}-${theme}`;
			const hiddenBottom = input.layout.bottom, position = runtime.machine.scheduler.nowCycles;
			await rightClick(headerPoint()); await capture(`${phase}-show-context`);
			await press('Escape');
			t.assert(input.layout.bottom === hiddenBottom && runtime.machine.scheduler.nowCycles === position,
				'context-menu Escape changed visibility or the paused physical position');
			// The actual pointer origin must regain its own keyboard context menu.
			// Timeline visibility is the first contributed action, not a wording oracle.
			await press('ShiftLeft', 'F10'); await press('Home'); await press('Enter'); await t.frames(3);
			t.assert(t.activeWorkbenchTab() === input && input.layout.bottom < hiddenBottom,
				'the actual consumer context menu did not reveal Timeline after Escape returned focus');
			const shownBottom = input.layout.bottom;
			await capture(`${phase}-shown-no-close-affordance`); authoredUnchanged(); identity();

			// A timeline-strip menu has the same concrete keyboard origin on Escape.
			const strip = { x: right / 2, y: shownBottom + input.layout.font.lineHeight / 2 + 2 };
			await rightClick(strip); await capture(`${phase}-hide-context`); await press('Escape');
			await press('ShiftLeft', 'F10'); await press('Home'); await press('Enter'); await t.frames(3);
			t.assert(input.layout.bottom === hiddenBottom && runtime.machine.scheduler.nowCycles === position,
				'the timeline context Hide failed or altered the paused target');

			await rightClick(headerPoint()); await press('Home'); await press('Enter'); await t.frames(3);
			t.assert(input.layout.bottom === shownBottom, 'the consumer context menu could not show the hidden timeline');
			// Focus is a separate operation after context-menu Show; it must not be
			// used as a substitute for exercising that actual Show affordance.
			t.command('runtime.focusTimeline'); await t.frames(2); await press('Tab'); await press('Home');
			await waitAt(runtime, earliest, 'the actual slider did not enter retained-history review');
			t.assert(runtime.history.latestCycles === present, 'history review replaced its original present tip');

			// Hold a real range gesture while opening its keyboard context menu.
			// Hiding must retire that capture, not commit/resume/cancel chronology.
			t.controlInput([{ type: 'pointer', ...strip }, { type: 'button', button: 'primary', down: true }]); await t.frames(3);
			await press('ShiftLeft', 'F10'); await capture(`${phase}-captured-review-context`);
			await press('Home'); await press('Enter'); await t.frames(60);
			const historical = runtime.machine.scheduler.nowCycles;
			t.assert(input.layout.bottom === hiddenBottom && historical >= earliest && historical < present
				&& runtime.history.latestCycles === present, 'hiding a captured historical timeline finished review or left the part presented');
			await capture(`${phase}-historical-hidden`);
			t.controlInput([{ type: 'pointer', x: right - 1, y: strip.y }]); await t.frames(2);
			t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(3);
			t.assert(runtime.machine.scheduler.nowCycles === historical && input.layout.bottom === hiddenBottom,
				'a retired timeline capture replayed its held move/release into the recovered client');
			authoredUnchanged(); identity();

			await rightClick(headerPoint()); await press('Home'); await press('Enter'); await t.frames(3);
			t.assert(input.layout.bottom === shownBottom && runtime.machine.scheduler.nowCycles === historical,
				'showing Timeline lost the retained physical review position');
			await capture(`${phase}-historical-shown`);
			t.command('runtime.present'); await waitAt(runtime, present, 'Present did not restore the same retained physical tip');
			await rightClick({ ...strip, y: input.layout.bottom + input.layout.font.lineHeight / 2 + 2 });
			await press('Home'); await press('Enter'); await t.frames(3);
			t.assert(input.layout.bottom === hiddenBottom && runtime.machine.scheduler.nowCycles === present,
				'final context Hide restarted playback or retained Timeline admission');
			authoredUnchanged(); identity();
			t.command('theme-toggle'); await t.frames(2);
		}
		await press('ControlLeft', 'ShiftLeft', 'KeyT'); await t.frames(2);
	}
};

// The companion Game Panel is a genuine main-machine consumer; Events supplies
// its ordinary transport context while the scanout remains in its own part.
t.command('events'); await t.frames(3); const events = t.activeWorkbenchTab(), right = events.layout.right;
t.command('gameView.togglePanel'); await t.frames(3);
t.assert(events.kind === 'event_viewer' && events.layout.right < right, 'the real Game Panel was not admitted beside Events');
await exercise(events, main, right, () => ({ x: (events.layout.right + right) / 2,
	y: events.layout.top + events.layout.font.lineHeight / 2 + 2 }), 'game-panel', () => {
	t.assert(t.activeWorkbenchTab() === events && events.layout.right < right, 'timeline visibility replaced its owning input or closed the Game Panel');
});
t.command('gameView.closePanel'); await t.frames(2);
const mainPausedCycles = main.machine.scheduler.nowCycles;

// A shipped integration module supplies the real independent Play target.
t.command('scenarioLab'); await t.frames(3);
const lab = t.activeWorkbenchTab(), list = lab.view.testPane;
const modulePath = 'tests/carts/nemesis_s/nemesis_s_pause_assert.lua';
const index = list.rows.findIndex(row => row.kind === 'test' && row.test.resource.path === modulePath);
t.assert(index >= 0, 'the shipped Play fixture is unavailable');
await press('Home'); for (let row = 0; row < index; row++) await press('ArrowDown');
t.command('scenarioLab.play'); await t.frames(3);
const play = t.activeWorkbenchTab(), handle = play.handle;
t.assert(play.kind === 'play_session' && handle.module.path === modulePath, 'Play opened another authored module');
for (let frame = 0; frame < 4000 && handle.session?.ready !== true && handle.state !== 'failed' && handle.state !== 'faulted'; frame++) await t.frames(1);
t.assert(handle.session?.ready === true, 'the actual Play target did not become ready');
const session = handle.session;
if (session.execution.paused) t.command('pause');
await t.frames(60); t.command('runtime.pause'); await t.frames(3);
for (let frame = 0; frame < 120 && session.frames.bitmap === undefined; frame++) await t.frames(1);
t.assert(session.frames.bitmap !== undefined, 'the real Play target did not publish a completed bitmap');
const playMedia = session.currentBlua32Media;
await exercise(play, session.transport.runtime, play.layout.right, () => ({
	x: (play.layout.left + play.actionBar.items[0].bounds.left) / 2,
	y: play.layout.top + play.layout.font.lineHeight / 2 + 2,
}), 'play', () => {
	t.assert(t.activeWorkbenchTab() === play && play.handle === handle && handle.session === session && session.ready
		&& session.currentBlua32Media === playMedia && session.execution.paused,
		'timeline visibility replaced or resumed the independent Play target');
	t.assert(main.machine.scheduler.nowCycles === mainPausedCycles, 'Play timeline interaction advanced the paused main machine');
});
t.command('play.stop'); authoredUnchanged();
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `Timeline visibility logged an error: ${t.logMessage(index).message}`);
