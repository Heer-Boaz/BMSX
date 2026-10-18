// All guest changes are typed through the installed BIOS monitor. Runtime
// observations below are read-only; no host expression evaluation or writes.
const memory = t.runtime().machine.memory;
const cpu = t.runtime().machine.cpu;
for (let frame = 0; frame < 1200 && memory.readMappedU32LE(0x08010428) === 0; frame += 1) {
	await t.frames(1);
}
const sequence = memory.readMappedU32LE(0x08010428);
t.assert(sequence !== 0, 'physical fault was not published');
await t.frames(15);
t.assert(memory.readMappedU32LE(0x08010208) === 1, 'expected initial unmapped load');
let retained = -1;
for (let index = 0; index < cpu.getFrameDepth(); index += 1) {
	t.log('physical frame ' + index + ' domain ' + cpu.readFrameExecutionDomain(index));
	if (cpu.isExceptionFrame(index)) {
		retained = index - 1;
		break;
	}
}
t.assert(retained >= 0, 'original interrupted frame not retained');
t.log('selected retained frame ' + retained);
t.capture('initial physical fault');
let pressId = 0;
for (const command of [
	'frames',
	'lua --frame 0x' + retained.toString(16) + ' 0 source = safe_words',
	'cont',
]) {
	for (const character of command + '\n') {
		const code = character === '\n' ? 'Enter' : character === ' ' ? 'Space'
			: character === '-' || character === '_' ? 'Minus' : character === '=' ? 'Equal'
			: character >= '0' && character <= '9' ? 'Digit' + character : 'Key' + character.toUpperCase();
		pressId += 1;
		if (character === '_') {
			t.postInput({ type: 'button', deviceId: 'keyboard:0', code: 'ShiftLeft', down: true, value: 1, timestamp: 0, pressId });
			await t.frames(2);
		}
		t.postInput({ type: 'button', deviceId: 'keyboard:0', code, down: true, value: 1, timestamp: 0, pressId });
		await t.frames(2);
		t.postInput({ type: 'button', deviceId: 'keyboard:0', code, down: false, value: 0, timestamp: 0, pressId });
		await t.frames(2);
		if (character === '_') {
			t.postInput({ type: 'button', deviceId: 'keyboard:0', code: 'ShiftLeft', down: false, value: 0, timestamp: 0, pressId });
			await t.frames(2);
		}
	}
	await t.frames(20);
	t.log('typed ' + command);
	if (command !== 'cont') {
		t.assert(memory.readMappedU32LE(0x08010208) === 1, 'inspection/repair must not ACK the old Memory report');
		t.assert(memory.readMappedU32LE(0x08010428) === sequence, 'inspection/repair must not resume the load');
	}
	t.capture(command);
}
const diagnosticCount = t.logMessageCount();
let recovered = false;
let words = false;
let acknowledged = false;
for (let index = 0; index < diagnosticCount; index += 1) {
	const message = t.logMessage(index).message;
	if (message === 'RECOVERED') recovered = true;
	if (message === 'WORDS 12345678 9ABCDEF0') words = true;
	if (message === 'FAULT 00000001 -> 00000000') acknowledged = true;
}
t.assert(recovered && words && acknowledged, 'recovered cartridge diagnostic values');
t.assert(memory.readMappedU32LE(0x08010428) === sequence, 'retry faulted again');
t.assert(memory.readMappedU32LE(0x08010208) === 0, 'successful entry did not reach ACK');
t.log('physical monitor repair then CONT reached program ACK without another fault');
