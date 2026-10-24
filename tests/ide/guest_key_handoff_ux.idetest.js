// Palette acceptance must drain its held Enter before the real BIOS guest receives a fresh press.
// Run: npm run ide:test -- nemesis_s tests/ide/guest_key_handoff_ux.idetest.js --ttl 120
const press = async (...codes) => {
	t.controlInput(codes.map(code => ({ type: 'key', code, down: true }))); await t.frames(2);
	t.controlInput(codes.slice().reverse().map(code => ({ type: 'key', code, down: false }))); await t.frames(2);
};
const click = async bounds => {
	t.controlInput([{ type: 'pointer', x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 },
		{ type: 'button', button: 'primary', down: true }]); await t.frames(1);
	t.controlInput([{ type: 'button', button: 'primary', down: false }]); await t.frames(2);
};
const type = async text => {
	for (const character of text) await press(character === ' ' ? 'Space' : `Key${character.toUpperCase()}`);
};
let captures = 0;
const capture = async label => {
	t.assert(++captures <= 12, 'guest key handoff exceeded its capture budget');
	t.log(`VISUAL ${label}`); t.capture(label);
};
await t.waitForCart(); await t.frames(90); t.openLuaSource('cart.lua'); await t.frames(2);
const code = t.activeWorkbenchTab(), model = code.workingCopy;
const source = model.buffer.getText(), version = model.version, runtime = t.runtime();
const unchanged = () => {
	t.assert(code.workingCopy === model && model.buffer.getText() === source && model.version === version && !model.dirty,
		'guest keyboard handoff changed the canonical source working copy');
	t.assert(t.runtime() === runtime && t.workbenchActive(), 'guest keyboard handoff replaced the authoring runtime or left Studio');
};
t.command('terminal'); await t.frames(20); const terminal = t.activeWorkbenchTab();
t.assert(terminal.kind === 'terminal', 'the actual BIOS Terminal did not open');
const device = runtime.machine.inputController;
for (const font of ['tiny', 'msx']) {
	for (const theme of ['light', 'dark']) {
		const label = `${font}-${theme}`;
		t.assert(terminal.layout.font.variant === font && t.activeWorkbenchTab() === terminal,
			'the actual Terminal input or font changed');
		await click(terminal.frameBounds); await press('KeyA'); unchanged();
		await capture(`guest-key-before-${label}`);
		await press('ShiftLeft', 'F1'); await press('ControlLeft', 'ShiftLeft', 'KeyP'); await type('bios terminal');
		const beforeAccept = device.captureState().sampleSequence;
		t.log(`KEY_HANDOFF_UI_ACCEPT_DOWN ${label}`);
		t.controlInput([{ type: 'key', code: 'Enter', down: true }]);
		t.assert(t.activeWorkbenchTab() === terminal, 'actual Palette acceptance replaced the retained Terminal');
		const held = [];
		for (let frame = 0; frame < 4; frame++) {
			await t.frames(1); const sample = device.captureState();
			held.push(sample);
			t.log(`KEY_HANDOFF_SAMPLE ${JSON.stringify({ label, phase: 'ui-enter-held', frame, sequence: sample.sampleSequence, keyWords: sample.registers.keyWords })}`);
		}
		await capture(`guest-key-ui-enter-held-${label}`);
		t.assert(held[3].sampleSequence > beforeAccept, 'the resumed real BIOS guest did not latch input during the UI Enter hold');
		for (const sample of held) t.assert((sample.registers.keyWords[1] & 0x100) === 0,
			'the already-consumed Palette Enter became a guest press before physical release');

		t.controlInput([{ type: 'key', code: 'Enter', down: false }]); await t.frames(2);
		const released = device.captureState();
		t.assert((released.registers.keyWords[1] & 0x100) === 0, 'releasing UI Enter retained the guest Enter bit');
		t.log(`KEY_HANDOFF_FRESH_GUEST_DOWN ${label}`);
		t.controlInput([{ type: 'key', code: 'Enter', down: true }]);
		let fresh = device.captureState();
		for (let frame = 0; frame < 4 && fresh.sampleSequence === released.sampleSequence; frame++) {
			await t.frames(1); fresh = device.captureState();
		}
		t.log(`KEY_HANDOFF_SAMPLE ${JSON.stringify({ label, phase: 'fresh-enter-down', sequence: fresh.sampleSequence, keyWords: fresh.registers.keyWords })}`);
		t.assert(fresh.sampleSequence > released.sampleSequence && fresh.registers.keyWords[1] === 0x100,
			'the next real guest Enter press was not admitted at the next ICU sample');
		await t.frames(2); const stillHeld = device.captureState();
		t.assert(stillHeld.sampleSequence > fresh.sampleSequence && stillHeld.registers.keyWords[1] === 0x100,
			'the actual guest Enter level did not remain held');
		t.controlInput([{ type: 'key', code: 'Enter', down: false }]); await t.frames(2);
		const up = device.captureState();
		t.log(`KEY_HANDOFF_SAMPLE ${JSON.stringify({ label, phase: 'fresh-enter-up', sequence: up.sampleSequence, keyWords: up.registers.keyWords })}`);
		t.assert((up.registers.keyWords[1] & 0x100) === 0, 'the fresh guest Enter release did not clear its raw bit');
		t.assert(t.activeWorkbenchTab() === terminal, 'guest Enter changed the active Studio input');
		await capture(`guest-key-after-fresh-enter-${label}`); unchanged();
		t.log(`KEY_HANDOFF_CASE_COMPLETE ${label}`);
		await press('ShiftLeft', 'F1'); t.command('theme-toggle'); await t.frames(2);
	}
	await press('ControlLeft', 'ShiftLeft', 'KeyT');
}
unchanged(); t.assert(captures === 12, 'the guest keyboard handoff matrix omitted a declared state');
