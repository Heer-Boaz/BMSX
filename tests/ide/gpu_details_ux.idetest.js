// Actual Nemesis emitted operations; no model-injected hardware observations.
// Run: npm run ide:test -- nemesis_s tests/ide/gpu_details_ux.idetest.js
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true })));
	await t.frames(2);
	t.controlInput(codes.map(code => ({ type: 'key', code, down: false })));
	await t.frames(2);
};
const click = async (x, y) => {
	t.controlInput([{ type: 'pointer', x, y }, { type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
};
const capture = async label => { await t.frames(2); t.log(`VISUAL ${label}`); t.capture(label); };
await t.waitForCart(); await t.frames(90); t.openLuaSource('cart.lua'); await t.frames(2);
const authored = t.activeWorkbenchTab(), source = authored.context.model.buffer.getText();
t.command('gpuDebugger'); await t.frames(2);
const input = t.activeWorkbenchTab();
t.assert(input.kind === 'gpu_debugger', 'the actual GPU Operations contribution did not open');
for (let step = 0; step < 4; step++) { t.command('stepFrame'); await t.frames(8); }
t.assert(input.history.count > 0 && input.selected.sequence >= 0, 'the cart did not emit observable GPU operations');
t.command('gpu.details'); await t.frames(2);
const sequence = input.selected.sequence, words = Array.from(input.selected.words.subarray(0, input.selected.wordCount));
const cycles = t.runtime().machine.scheduler.nowCycles;
for (let font = 0; font < 2; font++) {
	const variant = input.layout.font.variant;
	for (let theme = 0; theme < 2; theme++) {
		await press('Home'); await capture(`gpu-details-${variant}-${theme}-compact`);
		await press('End');
		if (theme === 0) {
			await click(6, input.layout.bottom - 10);
			await capture(`gpu-details-${variant}-${theme}-pointer-explanation`);
			await press('ArrowLeft'); await press('End');
		}
		await press('ArrowRight'); await capture(`gpu-details-${variant}-${theme}-raw-word-explanation`);
		await press('ArrowLeft'); await press('Home');
		t.assert(input.selected.sequence === sequence, 'local disclosure retargeted the captured operation');
		t.assert(words.every((word, index) => input.selected.words[index] === word) && input.selected.wordCount === words.length,
			'local disclosure changed a retained raw operation word');
		t.assert(t.runtime().machine.scheduler.nowCycles === cycles, 'property presentation advanced the paused guest');
		t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
await press('Escape');
t.assert(t.activeWorkbenchTab() === input && input.selected.sequence === sequence, 'Back lost the captured operation');
t.assert(authored.context.model.buffer.getText() === source, 'hardware inspection changed authored source');
await capture('gpu-details-back-to-observation');
