import { InputControllerGamepadButtonBit as Button } from '../../../machine/ts/machine/devices/input/contracts';
import { NATIVE_KEYBOARD_PAGES, ON_SCREEN_KEY_DEFINITIONS, ON_SCREEN_KEY_INDEX_BY_CODE, ON_SCREEN_KEYBOARD_POSITION_TARGET, OnScreenKeyboardCommand as Command } from '../../../hosts/common/input/on_screen_keyboard_keys';

export type KeyboardVector = { name: string; command: string };

/** Platform-neutral model operations and the common relative-mouse/controller contract. */
export function keyboardVectors(): KeyboardVector[] {
	const vectors: KeyboardVector[] = [];
	const add = (name: string, op: string, ...args: number[]) => vectors.push({ name, command: [op, ...args].join(' ') });
	const key = (code: string) => ON_SCREEN_KEY_INDEX_BY_CODE.get(code);
	const q = key('KeyQ'), w = key('KeyW'), shift = key('ShiftLeft'), control = key('ControlLeft'), alt = key('AltLeft');
	const a = 1 << Button.A, select = 1 << Button.Select, page = 1 << Button.Y;
	const frame = (name: string, down = 0, pad0 = 0, pad1 = 0, dt = 20) => add(name, 'FRAME', dt, -1, -1, down, pad0, pad1);
	const point = (name: string, target: number, down: number, pad0 = 0, pad1 = 0) => add(name, 'FRAME_KEY', 20, target, 0, 0, down, pad0, pad1);
	add('canonical keys and native pages', 'SCHEMA');
	add('all key forwarding', 'RESET', 320, 240);
	for (let target = 0; target < ON_SCREEN_KEY_DEFINITIONS.length; target++) {
		const label = ON_SCREEN_KEY_DEFINITIONS[target].code;
		add(`${label} down`, 'PRESS', 0, target); add(`${label} polled down`, 'POLL', 20);
		add(`${label} up`, 'RELEASE', 0, 0); add(`${label} polled up`, 'POLL', 20);
	}
	add('shared source and modifier lifetimes', 'RESET', 320, 240);
	add('first Q source', 'PRESS', 0, q); add('second Q source', 'PRESS', 1, q);
	add('first Q source leaves', 'RELEASE', 0, 0); add('remaining Q reaches HID', 'POLL', 20);
	add('last Q source leaves', 'RELEASE', 1, 0); add('released Q reaches HID', 'POLL', 20);
	add('held Shift', 'PRESS', 0, shift); add('shifted Q', 'PRESS', 1, q); add('shifted W', 'PRESS', 2, w);
	add('shifted chord HID', 'POLL', 20); add('Q leaves chord', 'RELEASE', 1, 1);
	add('Shift leaves used chord', 'RELEASE', 0, 1); add('W leaves chord', 'RELEASE', 2, 1);
	add('unused Shift tap down', 'PRESS', 0, shift); add('unused Shift tap up', 'RELEASE', 0, 1);
	add('one-shot Q', 'PRESS', 1, q); add('one-shot W', 'PRESS', 2, w);
	add('one-shot first release', 'RELEASE', 1, 0); add('one-shot last release', 'RELEASE', 2, 0);
	add('sticky Ctrl', 'ACTIVATE', 3, control); add('sticky Alt', 'ACTIVATE', 4, alt);
	add('sticky chord', 'PRESS', 0, q); add('sticky chord HID', 'POLL', 20);
	add('sticky chord release', 'RELEASE', 0, 0); add('close clears all modifiers', 'CLOSE'); add('closed HID', 'POLL', 20);
	add('reopen clean state', 'OPEN');
	add('physical Q down', 'PHYSICAL', q, 113, 1); add('physical Q polled', 'POLL', 20);
	add('Shift while physical ordinary held', 'PRESS', 0, shift); add('used physical Shift release', 'RELEASE', 0, 1);
	add('physical Q up', 'PHYSICAL', q, 113, 0); add('physical Q up polled', 'POLL', 20);
	add('held Shift before physical tap', 'PRESS', 0, shift);
	add('physical Q transient down', 'PHYSICAL', q, 113, 1); add('physical Q transient up', 'PHYSICAL', q, 113, 0);
	add('physical transient invalidates sticky completion', 'RELEASE', 0, 1);
	add('physical Shift down', 'PHYSICAL', shift, 304, 1); add('physical Shift polled', 'POLL', 20);
	add('physical modifier display feedback', 'FEEDBACK', 160); add('physical Shift bitmap', 'PUBLISH');
	add('physical Shift up', 'PHYSICAL', shift, 304, 0); add('physical Shift up polled', 'POLL', 20);
	add('physical modifier display cleared', 'FEEDBACK', 180);

	for (const [width, height] of [[256, 192], [320, 240], [393, 852], [852, 393]]) {
		add(`bitmap ${width}x${height}`, 'RESET', width, height);
		for (let p = 0; p < NATIVE_KEYBOARD_PAGES.length; p++) {
			add(`page ${p} model`, 'PAGE', p); add(`page ${p} paint`, 'PUBLISH');
			for (const row of NATIVE_KEYBOARD_PAGES[p].rows) {
				add(`page ${p} row selection`, 'SELECT', row.keys[0], p);
				for (let column = 0; column <= row.keys.length; column++) add(`page ${p} horizontal wrap ${column}`, 'HORIZONTAL', 1);
				add(`page ${p} previous key`, 'HORIZONTAL', -1);
				add(`page ${p} nearest next row`, 'VERTICAL', 1); add(`page ${p} nearest previous row`, 'VERTICAL', -1);
			}
			add(`page ${p} navigation paint`, 'PUBLISH');
			add(`page ${p} shifted labels`, 'PRESS', 0, shift); add(`page ${p} shifted bitmap`, 'PUBLISH');
			add(`page ${p} Shift release`, 'RELEASE', 0, 0); add(`page ${p} bottom dock`, 'DOCK');
			add(`page ${p} bottom paint`, 'PUBLISH'); add(`page ${p} restore top`, 'DOCK');
		}
		add('exact fractional viewport', 'BOUNDS', 12.5, 9.5, width - 12.5, height - 9.5);
		add('fractional visible bounds paint', 'PUBLISH'); add('fractional bottom dock', 'DOCK'); add('fractional bottom paint', 'PUBLISH');
		add('outside published keys', 'HIT', 0, 0);
		add('page change without publication', 'PAGE', 0); add('old published hit remains pure', 'HIT', 30, 40);
		add('new page publication', 'PUBLISH');
	}

	add('mouse release and fresh controller activation', 'RESET', 320, 240);
	point('mouse Q capture', q, 1); point('held Q dragged across W', w, 1);
	frame('release-plus-A selects and activates W', 0, a);
	frame('W controller source releases');
	add('stationary release after controller selection', 'RESET', 320, 240);
	point('stationary mouse Q capture', q, 1); add('controller focus moved to W', 'SELECT', w, 0);
	frame('stationary release-plus-A selects and activates Q', 0, a); frame('Q controller source releases');
	add('dock UP publishes after old-geometry hit', 'RESET', 320, 240);
	point('mouse dock capture', ON_SCREEN_KEYBOARD_POSITION_TARGET, 1); point('dock drag over Q', q, 1);
	frame('dock release-plus-A types Q and moves once', 0, a); frame('dock stays once after release');
	add('captured mouse modifier and physical chord', 'RESET', 320, 240);
	point('mouse Shift down', shift, 1); frame('unused mouse Shift latches on UP');
	point('latched Shift types Q', q, 1); frame('typed Q consumes one-shot Shift');
	point('mouse Shift before physical Q', shift, 1);
	add('physical Q invalidates mouse modifier latch', 'PHYSICAL', q, 113, 1); frame('used mouse Shift UP');
	add('physical Q leaves after mouse Shift', 'PHYSICAL', q, 113, 0); frame('physical chord release');
	add('focus close suppresses held sequences', 'RESET', 320, 240);
	point('held Q before close', q, 1, a); add('close held mouse and pad', 'CLOSE'); add('open held mouse and pad', 'OPEN');
	frame('held mouse and pad remain ineligible', 1, a); frame('genuine all-up re-arms'); point('new Q contact after reopen', q, 1); frame('new Q contact releases');

	add('independent controllers and same-frame bindings', 'RESET', 320, 240);
	frame('both controllers A plus B/X', 0, a | (1 << Button.X), 1 << Button.B);
	for (let held = 0; held < 20; held++) frame(`held keys do not generate host typematic ${held}`, 0, a | (1 << Button.X), 1 << Button.B);
	frame('controller zero leaves other controller held', 0, 0, 1 << Button.B); frame('second controller leaves');
	frame('same-frame page Delete and activation', 0, select | page | (1 << Button.B) | a); frame('multi-command release');
	frame('page command to Functions', 0, select | page); frame('page command release');
	frame('controller navigation initial right', 0, 1 << Button.Right);
	for (let held = 0; held < 35; held++) frame(`controller navigation repeat ${held}`, 0, 1 << Button.Right);
	frame('controller navigation release');
	for (let index = 0; index < 10; index++) frame(`feedback expiry frame ${index}`);

	// Seeded transitions cover combinations without manufacturing invalid selection keys.
	add('seeded model transitions', 'RESET', 320, 240);
	let seed = 0x514b7a91, now = 0;
	const next = () => seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
	for (let index = 0; index < 1200; index++) {
		const op = next() % 11, source = next() % 8, target = next() % ON_SCREEN_KEY_DEFINITIONS.length;
		const name = `seeded transition ${index}`;
		switch (op) {
			case 0: add(name, 'PRESS', source, target); break;
			case 1: add(name, 'RELEASE', source, next() & 1); break;
			case 2: add(name, 'ACTIVATE', source, target); break;
			case 3: add(name, 'COMMAND', source, next() % (Command.TogglePage + 1)); break;
			case 4: add(name, 'PAGE', next() % NATIVE_KEYBOARD_PAGES.length); break;
			case 5: add(name, 'HORIZONTAL', (next() & 1) ? 1 : -1); break;
			case 6: add(name, 'VERTICAL', (next() & 1) ? 1 : -1); break;
			case 7: add(name, 'POLL', 20); now += 20; break;
			case 8: add(name, 'FEEDBACK', now); break;
			case 9: add(name, 'PUBLISH'); break;
			case 10: add(`${name} close`, 'CLOSE'); add(`${name} open`, 'OPEN'); break;
		}
	}
	return vectors;
}
