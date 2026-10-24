// Real GPU observation/transport commands from client and collapsed-window scopes.
// Run: npm run ide:test -- nemesis_s tests/ide/gpu_window_transport.idetest.js
const capture = async label => { await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label); };
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
await t.waitForCart(); await t.frames(90); t.openLuaSource('cart.lua'); await t.frames(2);
const authored = t.activeWorkbenchTab(), source = authored.context.model.buffer.getText();
t.command('gpuDebugger'); await t.frames(2);
const input = t.activeWorkbenchTab();
t.assert(input.kind === 'gpu_debugger', 'the actual GPU contribution did not open');
for (let frame = 0; frame < 3; frame++) { t.command('stepFrame'); await t.frames(8); }
for (let font = 0; font < 2; font++) {
	const sequence = input.selected.sequence, cycles = t.runtime().machine.scheduler.nowCycles;
	t.command('runtime.focusTimeline'); await t.frames(2);
	// Depending on history availability, the range is either one more Tab stop or absent.
	// Both paths must return to the real list, whose next control is the GPU action bar.
	for (let stop = 0; stop < 3 && !input.actions.hasFocus; stop++) await press('Tab');
	t.assert(input.actions.hasFocus, 'Tab from the runtime timeline did not return through the real GPU content client');
	await capture(`gpu-timeline-forward-return-font-${font}`);
	t.command('runtime.focusTimeline'); await t.frames(2);
	await press('ShiftLeft', 'Tab'); await press('Tab');
	t.assert(input.actions.hasFocus, 'reverse Tab returned to a command root instead of the real GPU content client');
	t.assert(input.selected.sequence === sequence && t.runtime().machine.scheduler.nowCycles === cycles,
		'timeline focus traversal changed the inspected operation or executed the paused guest');
	await press('Tab');
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
t.command('gpu.details'); await t.frames(3);
const before = input.selected.sequence, cycles = t.runtime().machine.scheduler.nowCycles;
t.command('gpu.follow'); t.command('pause'); await t.frames(12);
t.assert(input.running && input.following, 'the focused floating client did not invoke its actual GPU transport/Follow owners');
t.assert(t.runtime().machine.scheduler.nowCycles > cycles && input.selected.sequence > before, 'resuming from the client did not advance the real guest and observation');
t.assert(input.detailsWindow.title.includes(`#${input.selected.sequence}`) && input.selected.sequence === input.history.endSequence - 1,
	'the visible window did not follow the same latest owned operation as the diagram');
await capture('gpu-window-live-follow');

// Freeze the observation, not the runtime. No independent Details pin/copy is introduced.
t.command('gpu.details'); await t.frames(2);
const sequence = input.selected.sequence, words = Array.from(input.selected.words.subarray(0, input.selected.wordCount));
const endSequence = input.history.endSequence;
await t.frames(8);
t.assert(input.running && !input.following && input.history.endSequence > endSequence, 'freezing an observation incorrectly stopped runtime capture');
t.assert(input.selected.sequence === sequence && words.every((word, index) => input.selected.words[index] === word), 'live capture replaced the pinned owned observation');
await capture('gpu-window-live-runtime-frozen-observation');

t.command('gpu.follow'); t.command('window.collapse'); await t.frames(8);
t.assert(input.detailsWindow.open && input.detailsWindow.collapsed && input.following && input.selected.sequence > sequence,
	'collapsed Details stopped observation following or lost its independent open intent');
t.assert(input.detailsWindow.title.includes(`#${input.selected.sequence}`), 'the collapsed caption retained another observation');
t.command('runtime.pause'); await t.frames(3);
t.assert(!input.running, 'the collapsed window scope did not pause its actual GPU runtime');
const stopped = t.runtime().machine.scheduler.nowCycles;
await t.frames(5);
t.assert(t.runtime().machine.scheduler.nowCycles === stopped, 'paused transport continued advancing behind the window');
t.command('window.collapse'); await t.frames(3);
t.assert(!input.detailsWindow.collapsed, 'the focused expand action did not restore its actual client');
await capture('gpu-window-follow-paused-expanded');
t.command('window.hide'); await t.frames(2);
t.assert(!input.detailsWindow.open, 'the focused Close action did not close its actual window');
t.assert(input.history.observing, 'closing the view destroyed the input-owned observation lease');
t.assert(authored.context.model.buffer.getText() === source, 'transport/window input changed canonical source');
for (let index = 0; index < t.logMessageCount(); index++)
	t.assert(t.logMessage(index).level !== 3, `GPU transport workflow logged an error: ${t.logMessage(index).message}`);
