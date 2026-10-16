import { InputControllerGamepadButtonBit as Button } from '../../../machine/ts/machine/devices/input/contracts';

export type ShortcutTrace = { action: number; keyboard: boolean; pads: number[]; keys: number[] };
export type ShortcutVector = { name: string; command: string; expected?: Partial<ShortcutTrace> };

/** Real host inputs, in canonical positional button words, on an injected host clock. */
export function shortcutVectors(): ShortcutVector[] {
	const vectors: ShortcutVector[] = [];
	const add = (name: string, command: string, expected?: Partial<ShortcutTrace>) => vectors.push({ name, command, expected });
	const select = 1 << Button.Select, start = 1 << Button.Start, west = 1 << Button.X;
	const south = 1 << Button.A, shoulder = 1 << Button.LeftBumper;
	const chord = select | start, targets = start | west | shoulder;
	const neutral = [0, 0, 0, 0];
	const reset = (name: string) => add(name, 'RESET');
	const frame = (name: string, time: number, keyboard = 0, pads = neutral, expected: Partial<ShortcutTrace> = {}) =>
		add(name, ['FRAME', time, keyboard, ...pads].join(' '), { action: 0, keyboard: false, ...expected });

	for (const source of ['keyboard', 'pad0', 'pad1', 'pad2', 'pad3']) {
		const inputs = (word: number): [number, number[]] => source === 'keyboard' ? [word, neutral]
			: [0, neutral.map((_, index) => source === `pad${index}` ? word : 0)];
		for (const modifierFirst of [false, true]) {
			const name = `${source} ${modifierFirst ? 'modifier' : 'target'} up first`;
			reset(name);
			frame(`${name}: down at zero`, 0, ...inputs(chord), { pads: neutral });
			frame(`${name}: 499ms held`, 499, ...inputs(chord), { pads: neutral });
			frame(`${name}: short release`, 499, ...inputs(modifierFirst ? start : select), { action: 1, pads: neutral });
			frame(`${name}: residual hold`, 1000, ...inputs(modifierFirst ? start : select), { pads: neutral });
			frame(`${name}: fully released`, 1001, ...inputs(0), { pads: neutral });
			frame(`${name}: rearmed`, 1100, ...inputs(chord));
			frame(`${name}: exact 500ms hold`, 1600, ...inputs(chord), { action: 2, pads: neutral });
			frame(`${name}: repeated same poll`, 1600, ...inputs(chord));
			frame(`${name}: held without repeat`, 2200, ...inputs(chord));
			frame(`${name}: release after hold`, 2201, ...inputs(modifierFirst ? start : select));
			frame(`${name}: hold fully released`, 2202, ...inputs(0));
		}
		reset(`${source}: sparse polling`);
		frame(`${source}: sparse down`, 10, ...inputs(chord));
		frame(`${source}: sparse release at threshold`, 510, ...inputs(0), { action: 2 });
		reset(`${source}: target held before modifier`);
		frame(`${source}: ordinary Start`, 10, ...inputs(start), { pads: inputs(start)[1] });
		frame(`${source}: modifier joins preheld target`, 20, ...inputs(chord));
		frame(`${source}: preheld target stays blocked`, 800, ...inputs(chord));
		frame(`${source}: target releases`, 810, ...inputs(select));
		frame(`${source}: fresh target with held modifier`, 820, ...inputs(chord));
		frame(`${source}: fresh target short release`, 900, ...inputs(select), { action: 1 });
		frame(`${source}: modifier releases`, 910, ...inputs(0));
		reset(`${source}: staggered eligible chord`);
		frame(`${source}: modifier alone`, 10, ...inputs(select));
		frame(`${source}: target joins much later`, 1000, ...inputs(chord));
		frame(`${source}: duration starts with complete chord`, 1499, ...inputs(chord));
		frame(`${source}: staggered threshold`, 1500, ...inputs(chord), { action: 2 });
		add(`${source}: modal focus cancellation`, 'CANCEL');
		frame(`${source}: cancellation retains capture`, 1510, ...inputs(chord), { pads: neutral });
		frame(`${source}: cancellation release is inert`, 1520, ...inputs(0));
		reset(`${source}: pending cancellation`);
		frame(`${source}: pending before cancel`, 10, ...inputs(chord));
		add(`${source}: cancel pending`, 'CANCEL');
		frame(`${source}: cancelled pending remains held`, 1000, ...inputs(chord));
		frame(`${source}: cancelled pending release`, 1100, ...inputs(0));
		frame(`${source}: west shortcut retains source eligibility`, 1200, ...inputs(select | west), { keyboard: source !== 'keyboard' });
		frame(`${source}: west shortcut held without repeats`, 1800, ...inputs(select | west));
		frame(`${source}: west shortcut releases`, 1810, ...inputs(0));
	}

	reset('independent sources');
	frame('keyboard modifier plus pad target is not a chord', 10, select, [start, 0, 0, 0], { pads: [start, 0, 0, 0] });
	frame('cross-source half chords never age into a gesture', 1000, select, [start, 0, 0, 0]);
	frame('release cross-source halves', 1010);
	frame('pad modifier plus keyboard target is not a chord', 1020, start, [select, 0, 0, 0]);
	frame('release reverse half chords', 1030);
	frame('first source pending', 1100, 0, [chord, 0, 0, 0]);
	frame('second source begins independently', 1500, chord, [chord, 0, 0, 0]);
	frame('first source releases short', 1550, chord, neutral, { action: 1 });
	frame('second source does not inherit elapsed time', 1999, chord);
	frame('second source reaches its own threshold', 2000, chord, neutral, { action: 2 });
	frame('both sources release after overlap', 2010);
	frame('first player pending', 2100, 0, [chord, 0, 0, 0]);
	frame('second player pending', 2400, 0, [chord, chord, 0, 0]);
	frame('first player released short', 2500, 0, [0, chord, 0, 0], { action: 1 });
	frame('second player retains own start time', 2899, 0, [0, chord, 0, 0]);
	frame('second player reaches threshold', 2900, 0, [0, chord, 0, 0], { action: 2 });
	frame('all players released', 2910);

	reset('context eligibility');
	frame('pending before keyboard context', 10, 0, [chord, 0, 0, 0]);
	add('keyboard context mask', `MASK ${start | west}`);
	frame('context change cancels pending gesture', 900, 0, [chord, 0, 0, 0]);
	frame('context change release does not open menu', 910);
	frame('keyboard context allows fresh menu gesture', 920, 0, [chord, 0, 0, 0]);
	add('unchanged context does not cancel gesture', `MASK ${start | west}`);
	frame('unchanged context preserves threshold', 1420, 0, [chord, 0, 0, 0], { action: 2 });
	frame('keyboard context gesture release', 1430);
	frame('keyboard-local shoulder remains routed', 1440, 0, [select | shoulder, 0, 0, 0], { pads: [shoulder, 0, 0, 0] });
	frame('release local shoulder', 1450);
	add('restore ordinary host targets', `MASK ${targets}`);
	frame('ordinary host keyboard opener', 1460, 0, [select | west, 0, 0, 0], { keyboard: true, pads: neutral });
	frame('keyboard opener hold does not repeat', 2000, 0, [select | west, 0, 0, 0]);
	frame('keyboard opener release', 2010);
	frame('old south rewind chord now remains guest input', 2020, 0, [select | south, 0, 0, 0], { pads: [south, 0, 0, 0] });
	frame('old south chord never becomes rewind', 2600, 0, [select | south, 0, 0, 0]);
	frame('old chord release', 2610);
	frame('physical editing letters are not gamepad host targets', 2620, select | south | west, neutral);
	frame('physical editing letters retain HID until release', 3200, select | south | west, neutral);
	frame('physical letter release', 3210);
	add('virtual keyboard chord is typing, not host command', `VIRTUAL ${chord}`);
	frame('virtual shortcut-looking chord passes through', 4000);
	frame('virtual chord cannot start a hold gesture', 5000);
	add('release virtual keys', 'VIRTUAL 0');
	frame('virtual release', 5010);
	reset('context change is source-local');
	frame('keyboard and gamepad pending before mask change', 10, chord, [chord, 0, 0, 0]);
	add('change only gamepad eligibility', `MASK ${start | west}`);
	frame('gamepad mask cannot cancel physical keyboard hold', 510, chord, [chord, 0, 0, 0], { action: 2 });
	frame('source-local mask release', 520);

	reset('controller removal');
	frame('pending controller before removal', 10, 0, [chord, 0, 0, 0]);
	add('disconnect controller zero', 'DEVICE 0 0');
	frame('controller removal cancels rather than releases', 900);
	add('reconnect controller zero', 'DEVICE 0 1');
	frame('reconnected neutral device', 1000);
	frame('reconnected fresh chord', 1100, 0, [chord, 0, 0, 0]);
	frame('reconnected device holds normally', 1600, 0, [chord, 0, 0, 0], { action: 2 });
	frame('reconnected device release', 1610);
	reset('controller removal is source-local');
	frame('two controllers pending before removal', 10, 0, [chord, chord, 0, 0]);
	add('disconnect only first pending controller', 'DEVICE 0 0');
	frame('disconnect does not release its pending gesture', 100, 0, [0, chord, 0, 0]);
	frame('other controller retains its pending duration', 510, 0, [0, chord, 0, 0], { action: 2 });
	frame('remaining controller releases normally', 520);
	reset('host input reset');
	frame('pending before host reset', 10, chord, [chord, 0, 0, 0]);
	add('host focus input reset', 'INPUT_RESET');
	frame('reset is not a short release', 1000);
	frame('fresh chord after reset', 1100, chord);
	frame('fresh keyboard hold after reset', 1600, chord, neutral, { action: 2 });

	reset('zero-origin retarget cancellation');
	frame('zero-origin chord before context change', 0, 0, [chord, 0, 0, 0]);
	add('retarget after initial zero-time poll', `MASK ${start | west}`);
	frame('zero-origin held target stays blocked after retarget', 499, 0, [chord, 0, 0, 0]);
	frame('zero-origin cancellation cannot rearm an old edge', 999, 0, [chord, 0, 0, 0]);
	frame('zero-origin cancelled gesture releases inertly', 1000);
	reset('same-timestamp input is distinct from published input');
	frame('same-time neutral poll', 10);
	frame('same-time fresh chord', 10, 0, [chord, 0, 0, 0]);
	frame('same-time repeated held poll', 10, 0, [chord, 0, 0, 0]);
	frame('same-time fresh short release', 10, 0, neutral, { action: 1 });
	frame('same-time another fresh chord', 10, 0, [chord, 0, 0, 0]);
	frame('same-time another hold starts independently', 510, 0, [chord, 0, 0, 0], { action: 2 });
	return vectors;
}
