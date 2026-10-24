import assert from 'node:assert/strict';
import test from 'node:test';
import { Input } from '../../hosts/common/input/manager';
import { OnScreenKeyboard } from '../../hosts/common/input/on_screen_keyboard';
import { NATIVE_KEYBOARD_PAGES, ON_SCREEN_KEY_INDEX_BY_CODE, OnScreenKeyboardCommand } from '../../hosts/common/input/on_screen_keyboard_keys';
import { KeyInputEvent, KeyModifier, type TextInputHost, type TextInputTarget } from '../../hosts/common/input/text';
import { VirtualHeadlessClock } from '../../hosts/node/headless/clock';
import { createInputControllerSnapshot } from '../../machine/ts/machine/devices/input/contracts';
import { RemoteInput } from '../../hosts/common/input/remote';
import { hidKeyUsageForCode } from '../../hosts/common/input/hid_keys';

function fixture(text = '', offset = 0) {
	const clock = new VirtualHeadlessClock();
	const input = new Input(clock, { devices: () => [], subscribe: () => () => {} }, -1);
	const keyboard = new OnScreenKeyboard(input, NATIVE_KEYBOARD_PAGES);
	const events: KeyInputEvent[] = [];
	const state = { text, selectionStart: text.length, selectionEnd: text.length, offset };
	const target: TextInputTarget = {
		readOnly: false, revision: 0,
		readText: () => state,
		replaceText(from, to, value) {
			const start = from - offset;
			state.text = state.text.slice(0, start) + value + state.text.slice(to - offset);
			state.selectionStart = state.selectionEnd = start + value.length;
			return true;
		},
		setSelection(from, to) { state.selectionStart = from - offset; state.selectionEnd = to - offset; },
		caretRect: () => ({ x: 0, y: 0, width: 1, height: 1 }),
	};
	const host: TextInputHost = {
		textTarget: target,
		dispatchKey(event) { events.push(event); return false; },
		cancelPointerInput() {},
		cancelInput() {},
		onDidChangeTarget: () => () => {},
	};
	keyboard.open();
	return { input, keyboard, host, target, state, events, clock,
		press(code: string) {
			const source = keyboard.allocateSource();
			keyboard.pressKey(source, ON_SCREEN_KEY_INDEX_BY_CODE.get(code));
			return source;
		},
		physical(code: string, down: boolean) { input.inputButton('keyboard:0', code, down, down ? 1 : 0, clock.now(), 1); },
		snapshot() {
			clock.advance(20);
			input.pollInput();
			const snapshot = createInputControllerSnapshot();
			input.sampleInputControllerSnapshot(snapshot, 0);
			return snapshot;
		},
	};
}

test('virtual typing preserves occurrence order and repeated letters without a host poll', t => {
	const f = fixture(); t.after(() => f.input.dispose()); f.input.setEditingInput(f.host);
	for (const code of ['KeyB', 'KeyA', 'KeyB', 'KeyB']) f.keyboard.releaseSource(f.press(code));
	assert.equal(f.state.text, 'babb');
	assert.deepEqual(f.events.map(event => [event.code, event.down]), [
		['KeyB', true], ['KeyB', false], ['KeyA', true], ['KeyA', false],
		['KeyB', true], ['KeyB', false], ['KeyB', true], ['KeyB', false],
	]);
	assert.equal(f.input.getPlayerInput(1).pollFrame, 0);
});

test('independent same-key contacts produce distinct editing activations without extra raw edges', t => {
	const f = fixture(); t.after(() => f.input.dispose()); f.input.setEditingInput(f.host);
	const first = f.press('KeyB');
	f.snapshot();
	const raw = f.input.getPlayerInput(1).inputHandlers.keyboard!;
	const originalPress = raw.getKeyState('KeyB').pressId;
	const second = f.press('KeyB');
	f.snapshot();
	assert.equal(f.state.text, 'bb');
	assert.equal(raw.getKeyState('KeyB').pressId, originalPress);
	assert.equal(raw.getKeyState('KeyB').justpressed, false);
	f.keyboard.releaseSource(first); f.snapshot();
	assert.equal(raw.getKeyState('KeyB').pressed, true);
	f.keyboard.releaseSource(second); f.snapshot();
	assert.equal(raw.getKeyState('KeyB').pressed, false);
	assert.equal(raw.getKeyState('KeyB').justreleased, true);
});

test('virtual editing snapshots both physical modifier sides before later releases', t => {
	const f = fixture(); t.after(() => f.input.dispose()); f.input.setEditingInput(f.host);
	f.physical('ShiftRight', true);
	const first = f.press('KeyB');
	f.physical('ShiftRight', false); f.keyboard.releaseSource(first);
	const shift = f.press('ShiftLeft');
	const second = f.press('Digit1');
	f.keyboard.releaseSource(shift); f.keyboard.releaseSource(second);
	f.keyboard.releaseSource(f.press('KeyA'));
	assert.equal(f.state.text, 'B!a');
	assert.deepEqual(f.events.filter(event => event.down && ['KeyB', 'Digit1', 'KeyA'].includes(event.code))
		.map(event => event.modifiers), [KeyModifier.shift, KeyModifier.shift, KeyModifier.none]);
	for (const [code, modifier] of [['ControlRight', KeyModifier.ctrl], ['AltRight', KeyModifier.alt], ['MetaRight', KeyModifier.meta]] as const) {
		f.physical(code, true);
		f.keyboard.releaseSource(f.press('KeyQ'));
		assert.equal(f.events[f.events.length - 2].modifiers, modifier);
		f.physical(code, false);
	}
	assert.equal(f.state.text, 'B!a');
});

test('virtual navigation and consumed commands run in source order before following text', t => {
	const f = fixture(); t.after(() => f.input.dispose());
	f.host.dispatchKey = event => {
		f.events.push(event);
		if (!event.down || event.code !== 'ArrowLeft' && event.code !== 'KeyS') return false;
		if (event.code === 'ArrowLeft') f.state.selectionStart = f.state.selectionEnd = f.state.selectionStart - 1;
		event.consumed = true;
		return true;
	};
	f.input.setEditingInput(f.host);
	for (const code of ['KeyB', 'KeyA', 'ArrowLeft', 'KeyS', 'KeyX']) f.keyboard.releaseSource(f.press(code));
	assert.equal(f.state.text, 'bxa');
	assert.equal(f.state.selectionStart, 2);
});

test('controller keyboard activation edits its selected key without retargeting an older hold', t => {
	const f = fixture(); t.after(() => f.input.dispose()); f.input.setEditingInput(f.host);
	const first = f.keyboard.allocateSource(), second = f.keyboard.allocateSource();
	f.keyboard.selectKey(ON_SCREEN_KEY_INDEX_BY_CODE.get('KeyB'));
	f.keyboard.command(first, OnScreenKeyboardCommand.Activate);
	f.keyboard.selectKey(ON_SCREEN_KEY_INDEX_BY_CODE.get('KeyA'));
	f.keyboard.command(second, OnScreenKeyboardCommand.Activate);
	assert.equal(f.state.text, 'ba');
	f.keyboard.releaseSource(first); f.keyboard.releaseSource(second);
	assert.deepEqual(f.events.map(event => event.code), ['KeyB', 'KeyA', 'KeyB', 'KeyA']);
});

test('virtual text uses absolute UTF-16 replacement offsets and never edits a read-only target', t => {
	const f = fixture('a😀b', 42); t.after(() => f.input.dispose()); f.input.setEditingInput(f.host);
	f.state.selectionStart = 1; f.state.selectionEnd = 3;
	f.keyboard.releaseSource(f.press('KeyX'));
	f.keyboard.releaseSource(f.press('Space'));
	assert.equal(f.state.text, 'ax b');
	const readonly = { ...f.target, readOnly: true };
	f.input.setEditingInput({ ...f.host, textTarget: readonly });
	f.keyboard.releaseSource(f.press('KeyQ'));
	assert.equal(f.state.text, 'ax b');
	f.input.setEditingInput(undefined);
	f.keyboard.releaseSource(f.press('KeyZ'));
	assert.equal(f.state.text, 'ax b');
});

test('an unhandled editing recipient leaves guest keyboard samples unchanged', t => {
	const baseline = fixture(), editing = fixture();
	t.after(() => { baseline.input.dispose(); editing.input.dispose(); });
	editing.input.setEditingInput({ ...editing.host, textTarget: undefined });
	const baselineSources: number[] = [], editingSources: number[] = [];
	for (const code of ['ShiftLeft', 'KeyB', 'KeyB', 'ArrowLeft', 'ControlLeft', 'Space']) {
		baselineSources.push(baseline.press(code)); editingSources.push(editing.press(code));
		assert.deepEqual(editing.snapshot(), baseline.snapshot());
	}
	for (let source = 0; source < baselineSources.length; source += 1) {
		baseline.keyboard.releaseSource(baselineSources[source]); editing.keyboard.releaseSource(editingSources[source]);
		assert.deepEqual(editing.snapshot(), baseline.snapshot());
	}
	assert.equal(editing.state.text, '');
});

test('global and keyboard resets cancel host keyboard gestures without treating pointer reset as keyboard cancellation', t => {
	const f = fixture('ab'); t.after(() => f.input.dispose());
	let cancellations = 0, pointerCancellations = 0;
	f.host.cancelInput = () => { cancellations += 1; };
	f.host.cancelPointerInput = () => { pointerCancellations += 1; };
	f.input.setEditingInput(f.host);
	f.input.resetInput('pointer:0');
	assert.equal(cancellations, 0);
	assert.equal(pointerCancellations, 1, 'pointer retirement uses its own input-lifetime capability');
	f.input.resetInput('keyboard:0');
	assert.equal(cancellations, 1);
	f.input.resetInput();
	assert.equal(cancellations, 2);
	assert.equal(f.state.text, 'ab');
	assert.equal(f.host.textTarget, f.target);
	assert.deepEqual(f.events, [], 'cancellation is not a fabricated key-up event');
});

test('a RemoteInput editor-consumed hold stays masked after guest recipient gain until physical release', t => {
	const f = fixture(); t.after(() => f.input.dispose());
	f.host.dispatchKey = event => { f.events.push(event); event.consumed = event.code === 'Enter'; return event.consumed; };
	f.input.setEditingInput(f.host);
	const remote = new RemoteInput(f.input, f.clock, f.input.dispatchEditingKey.bind(f.input));
	f.input.guestInputRecipient = null;
	remote.apply([{ type: 'key', code: 'Enter', down: true }]);
	assert.equal(f.events[0].consumed, true, 'the actual ordered editing consumer accepted the physical occurrence');
	const usage = hidKeyUsageForCode('Enter'), word = usage >>> 5, mask = 1 << (usage & 31);
	f.input.setEditingInput(undefined); f.input.guestInputRecipient = f.input;
	for (let frame = 0; frame < 50; frame++) {
		assert.equal(f.snapshot().keyWords[word] & mask, 0, `the original editor hold is not a fresh guest Enter on poll ${frame}`);
		assert.equal(f.input.getPlayerInput(1).inputHandlers.keyboard!.physicalKeyPressed('Enter'), true,
			'UI ownership does not fabricate a raw physical release');
	}
	remote.apply([{ type: 'key', code: 'Enter', down: false }]);
	assert.equal(f.snapshot().keyWords[word] & mask, 0);
	remote.apply([{ type: 'key', code: 'Enter', down: true }]);
	assert.notEqual(f.snapshot().keyWords[word] & mask, 0, 'a genuinely fresh guest press is admitted');
	remote.release();
});

test('a consumed Enter release and fresh guest repress between polls cannot alias the old UI hold', t => {
	const f = fixture(); t.after(() => f.input.dispose());
	f.host.dispatchKey = event => event.down && event.code === 'Enter';
	f.input.setEditingInput(f.host);
	const remote = new RemoteInput(f.input, f.clock, f.input.dispatchEditingKey.bind(f.input));
	remote.apply([{ type: 'key', code: 'Enter', down: true }]);
	const usage = hidKeyUsageForCode('Enter'), word = usage >>> 5, mask = 1 << (usage & 31);
	assert.equal(f.snapshot().keyWords[word] & mask, 0);
	f.input.setEditingInput(undefined);
	remote.apply([{ type: 'key', code: 'Enter', down: false }, { type: 'key', code: 'Enter', down: true }]);
	assert.notEqual(f.snapshot().keyWords[word] & mask, 0, 'release/repress is an event boundary, not a polled-state inference');
	remote.release();
});

for (const captured of ['physical', 'virtual'] as const) {
	test(`an editor-consumed ${captured} Enter does not consume the independent same-usage source`, t => {
		const f = fixture(); t.after(() => f.input.dispose());
		f.host.dispatchKey = event => event.code === 'Enter'; f.input.setEditingInput(f.host);
		const remote = new RemoteInput(f.input, f.clock, f.input.dispatchEditingKey.bind(f.input));
		let contact: number;
		if (captured === 'physical') remote.apply([{ type: 'key', code: 'Enter', down: true }]);
		else contact = f.press('Enter');
		const usage = hidKeyUsageForCode('Enter'), word = usage >>> 5, mask = 1 << (usage & 31);
		assert.equal(f.snapshot().keyWords[word] & mask, 0);
		f.input.setEditingInput(undefined);
		if (captured === 'physical') contact = f.press('Enter');
		else remote.apply([{ type: 'key', code: 'Enter', down: true }]);
		assert.notEqual(f.snapshot().keyWords[word] & mask, 0, 'only the source occurrence accepted by the editor is owned');
		if (captured === 'physical') f.keyboard.releaseSource(contact);
		else remote.apply([{ type: 'key', code: 'Enter', down: false }]);
		assert.equal(f.snapshot().keyWords[word] & mask, 0, 'the remaining original UI hold stays masked');
		remote.release(); f.keyboard.close();
	});
}

test('successful printable editing owns the physical hold without consuming unrelated gameplay or host chords', t => {
	const f = fixture(); t.after(() => f.input.dispose()); f.input.setEditingInput(f.host);
	const remote = new RemoteInput(f.input, f.clock, f.input.dispatchEditingKey.bind(f.input));
	remote.apply([{ type: 'key', code: 'KeyB', down: true }]);
	assert.equal(f.state.text, 'b', 'the real manager text producer performed the insertion');
	const b = hidKeyUsageForCode('KeyB'), q = hidKeyUsageForCode('KeyQ');
	f.input.setEditingInput(undefined);
	remote.apply([{ type: 'key', code: 'KeyQ', down: true }]);
	for (let frame = 0; frame < 20; frame++) {
		const snapshot = f.snapshot();
		assert.equal(snapshot.keyWords[b >>> 5] & (1 << (b & 31)), 0);
		assert.notEqual(snapshot.keyWords[q >>> 5] & (1 << (q & 31)), 0, 'ordinary guest keys have no global keyboard capture');
		assert.equal(f.input.getPlayerInput(1).inputHandlers.keyboard!.physicalKeyPressed('KeyB'), true);
	}
	remote.apply([{ type: 'key', code: 'ControlRight', down: true }, { type: 'key', code: 'ShiftLeft', down: true }]);
	f.snapshot(); assert.equal(f.input.supervisorRequestLineHigh(), true, 'the physical host chord still observes its raw source');
	assert.equal(f.state.text, 'b'); remote.release();
});

test('explicit physical host-chord ownership remains independent of an unhandled text-context modifier', t => {
	const f = fixture(); t.after(() => f.input.dispose());
	const remote = new RemoteInput(f.input, f.clock, f.input.dispatchEditingKey.bind(f.input));
	remote.apply([{ type: 'key', code: 'ControlRight', down: true }]);
	f.snapshot();
	f.input.setEditingInput(f.host);
	remote.apply([{ type: 'key', code: 'ShiftLeft', down: true }]);
	assert.equal(f.events[0].consumed, false, 'the editor did not accept a modifier as an ordinary action');
	const usage = hidKeyUsageForCode('ShiftLeft'), word = usage >>> 5, mask = 1 << (usage & 31);
	f.input.setEditingInput(undefined);
	assert.equal(f.snapshot().keyWords[word] & mask, 0);
	assert.equal(f.input.getPlayerInput(1).inputHandlers.keyboard!.physicalKeyPressed('ShiftLeft'), true);
	assert.equal(f.input.supervisorRequestLineHigh(), true, 'the explicit host chord owns its raw modifier independently of editing');
	remote.release();
});

test('an OSK sticky Shift latched in a text context agrees with the next guest Digit1 after focus transfer', t => {
	const f = fixture(); t.after(() => f.input.dispose()); f.input.setEditingInput(f.host);
	const shift = f.press('ShiftLeft'); f.keyboard.releaseSource(shift, true);
	const digit = ON_SCREEN_KEY_INDEX_BY_CODE.get('Digit1');
	assert.equal(f.keyboard.label(digit), '!'); assert.equal(f.keyboard.shiftActive, true);
	f.snapshot();
	f.input.setEditingInput(undefined);
	const contact = f.press('Digit1'), snapshot = f.snapshot();
	const shiftUsage = hidKeyUsageForCode('ShiftLeft'), digitUsage = hidKeyUsageForCode('Digit1');
	assert.equal(f.keyboard.label(digit), '!');
	assert.notEqual(snapshot.keyWords[digitUsage >>> 5] & (1 << (digitUsage & 31)), 0, 'the new guest digit is admitted');
	assert.notEqual(snapshot.keyWords[shiftUsage >>> 5] & (1 << (shiftUsage & 31)), 0,
		'the sticky modifier shown by the OSK must accompany the new guest digit');
	assert.equal(f.state.text, '', 'the post-transfer digit never edits the retired text target');
	f.keyboard.releaseSource(contact);
	assert.equal(f.keyboard.label(digit), '1', 'the actual sticky Shift still expires after its ordinary key release');
});

test('a physical Shift held in a text context gives the OSK the same shifted legend as actual virtual typing', t => {
	const f = fixture(); t.after(() => f.input.dispose()); f.input.setEditingInput(f.host);
	const remote = new RemoteInput(f.input, f.clock, f.input.dispatchEditingKey.bind(f.input));
	remote.apply([{ type: 'key', code: 'ShiftLeft', down: true }]);
	f.snapshot(); f.keyboard.updateFeedback(f.clock.now());
	const digit = ON_SCREEN_KEY_INDEX_BY_CODE.get('Digit1'), shown = f.keyboard.label(digit);
	const contact = f.press('Digit1');
	assert.equal(f.state.text, '!', 'the real manager inserts the character selected by the held physical modifier');
	assert.equal(shown, '!', 'the visible key legend must describe the character the same source actually inserts');
	f.keyboard.releaseSource(contact); remote.release();
});

for (const reset of ['keyboard', 'all', 'remote'] as const) {
	test(`${reset} cancellation retires consumed keyboard ownership before a new guest occurrence`, t => {
		const f = fixture(); t.after(() => f.input.dispose());
		f.host.dispatchKey = event => event.code === 'Enter'; f.input.setEditingInput(f.host);
		const remote = new RemoteInput(f.input, f.clock, f.input.dispatchEditingKey.bind(f.input));
		remote.apply([{ type: 'key', code: 'Enter', down: true }]);
		const usage = hidKeyUsageForCode('Enter'), word = usage >>> 5, mask = 1 << (usage & 31);
		assert.equal(f.snapshot().keyWords[word] & mask, 0);
		if (reset === 'remote') remote.release();
		else f.input.resetInput(reset === 'keyboard' ? 'keyboard:0' : undefined);
		assert.equal(f.snapshot().keyWords[word] & mask, 0);
		f.input.setEditingInput(undefined);
		f.physical('Enter', true);
		assert.notEqual(f.snapshot().keyWords[word] & mask, 0, 'cancellation does not leave a stale mask on the next physical press');
		remote.release();
	});
}
