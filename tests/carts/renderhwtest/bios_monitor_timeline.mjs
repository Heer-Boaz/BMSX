import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const modifiers = { ctrl: false, shift: false, alt: false, meta: false };

const keyCodes = {
	' ': 'Space',
	'0': 'Digit0',
	'2': 'Digit2',
	'5': 'Digit5',
	'6': 'Digit6',
};

export function buildBiosMonitorTimeline() {
	const entries = [];
	const captures = {};
	let frame = 121;
	let pressId = 1;

	function event(code, down, id, description) {
		entries.push({
			description,
			frame,
			event: {
				type: 'button',
				deviceId: 'keyboard:0',
				code,
				down,
				value: down ? 1 : 0,
				timestamp: frame * 20,
				pressId: id,
				modifiers,
			},
		});
	}

	function tap(code, description) {
		const id = pressId;
		pressId += 1;
		event(code, true, id, description);
		frame += 2;
		event(code, false, id, `release ${description}`);
		frame += 2;
	}

	function withControl(code, description) {
		const controlId = pressId;
		pressId += 1;
		event('ControlLeft', true, controlId, `hold control for ${description}`);
		frame += 2;
		tap(code, description);
		event('ControlLeft', false, controlId, `release control after ${description}`);
		frame += 2;
	}

	function type(text) {
		for (const character of text) {
			const code = keyCodes[character] || `Key${character.toUpperCase()}`;
			tap(code, `type ${character}`);
		}
	}

	function capture(name, description) {
		captures[name] = frame;
		entries.push({ description, frame, capture: true });
		frame += 2;
	}

	entries.push({
		description: 'cart frame before BIOS monitor entry',
		frame,
		capture: true,
		event: {
			type: 'button',
			deviceId: 'keyboard:0',
			code: 'F2',
			down: true,
			value: 1,
			timestamp: frame * 20,
			pressId,
			modifiers,
		},
	});
	captures.game = frame;
	frame += 2;
	event('F2', false, pressId, 'release BIOS monitor key');
	pressId += 1;
	frame += 4;
	capture('entry', 'BIOS monitor entry');

	type('h');
	capture('uppercaseInput', 'unshifted input uses uppercase presentation');
	tap('Escape', 'clear input');
	type('r');
	tap('Tab', 'open command candidates');
	capture('firstCandidate', 'first completion candidate selected');
	tap('ArrowRight', 'select next command candidate');
	capture('secondCandidate', 'second completion candidate selected');
	tap('Enter', 'accept selected command candidate');
	capture('acceptedCandidate', 'selected completion candidate accepted');
	type('one two');
	withControl('ArrowLeft', 'move one word left');
	withControl('Backspace', 'erase previous word');
	capture('wordBackspace', 'word navigation and backward deletion');
	withControl('Delete', 'erase next word');
	capture('wordDelete', 'forward word deletion');
	tap('Escape', 'clear completed input');

	for (let repetition = 0; repetition < 6; repetition += 1) {
		type('help');
		tap('Enter', `submit HELP ${repetition + 1}`);
	}
	capture('scrolled', 'repeated output after retained VRAM scrolling');

	type('mem 0 256');
	tap('Enter', 'submit paginated memory command');
	capture('firstPage', 'first automatic memory page');
	tap('Space', 'advance automatic pager');
	capture('secondPage', 'second automatic memory page');

	return { entries, captures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const outputPath = process.argv[2];
	fs.writeFileSync(outputPath, `${JSON.stringify(buildBiosMonitorTimeline().entries, null, '\t')}\n`);
}
