import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const modifiers = { ctrl: false, shift: false, alt: false, meta: false };

const keyCodes = {
	' ': 'Space',
	'0': 'Digit0',
	'1': 'Digit1',
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

	const supervisorPressId = pressId;
	pressId += 1;
	const heldCartKeyPressId = pressId;
	pressId += 1;
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
			pressId: supervisorPressId,
			modifiers,
		},
	});
	captures.game = frame;
	event('KeyC', true, heldCartKeyPressId, 'hold cart key across BIOS monitor entry');
	frame += 2;
	event('F2', false, supervisorPressId, 'release BIOS monitor key');
	frame += 4;
	capture('entry', 'BIOS monitor entry');
	event('KeyC', false, heldCartKeyPressId, 'release cart key after first monitor scan');
	frame += 4;

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
	type('regs');
	tap('Enter', 'seed command history');
	type('cls');
	tap('Enter', 'submit CLS');
	tap('ArrowUp', 'recall CLS from command history');
	capture('historyRecall', 'command history restores the submitted line');
	tap('Enter', 'submit recalled CLS');
	capture('historyExecuted', 'recalled command executes as the original line');

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

	tap('F2', 'resume cart from BIOS monitor');
	frame += 8;
	capture('resumedF2', 'cart resumed through supervisor request line');
	tap('F2', 're-enter BIOS monitor');
	frame += 6;
	capture('secondEntry', 'BIOS monitor re-entry');
	type('cont');
	tap('Enter', 'submit CONT');
	frame += 10;
	capture('resumedCont', 'cart resumed through CONT');

	tap('F2', 're-enter BIOS monitor for nested fault');
	frame += 6;
	capture('faultEntry', 'BIOS monitor entry before nested fault');
	type('mem 1');
	tap('Enter', 'issue unaligned monitor memory read');
	frame += 10;
	capture('nestedFault', 'nested monitor address fault');
	tap('F2', 'attempt line exit from non-resumable nested fault');
	frame += 6;
	capture('nestedFaultAfterF2', 'nested fault remains after supervisor line edge');
	type('cont');
	tap('Enter', 'attempt CONT from non-resumable nested fault');
	frame += 4;
	capture('nonResumable', 'CONT reports non-resumable nested fault');

	return { entries, captures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	const outputPath = process.argv[2];
	fs.writeFileSync(outputPath, `${JSON.stringify(buildBiosMonitorTimeline().entries, null, '\t')}\n`);
}
