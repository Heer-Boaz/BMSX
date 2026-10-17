// Exercise the installed BIOS terminal through real keyboard events. Runtime
// reads below only inspect the physical latches; they do not repair the fault,
// replace a handler, execute a guest expression or drive a Studio command.
const memory = t.runtime().machine.memory;
const faultSequenceAddress = 0x08010428;
for (let frame = 0; frame < 1200 && memory.readMappedU32LE(faultSequenceAddress) === 0; frame += 1) {
	await t.frames(1);
}
const firstSequence = memory.readMappedU32LE(faultSequenceAddress);
t.assert(firstSequence !== 0, 'BIOS did not publish the physical fault');
await t.frames(15);
t.assert(memory.readMappedU32LE(0x08010208) === 1, 'unmapped CODE');
t.assert(memory.readMappedU32LE(0x0801020c) === 0x01000000, 'unmapped byte ADDR');
t.assert(memory.readMappedU32LE(0x08010210) === 0x00000801, 'Word read ACCESS');
t.assert(memory.readMappedU32LE(0x0801042c) === 0x0000001c, 'saved DBE cause');
t.assert(memory.readMappedU32LE(0x0801043c) === 0, 'fault belongs to cartridge slot 0');
t.assert(t.faultStack().length !== 0, 'fault did not retain cartridge source');
t.capture('unmapped Word load: installed BIOS fault terminal');

let pressId = 0;
for (const command of ['MEM 08010208 3', 'FAULT CLEAR', 'CONT']) {
	for (const character of command + '\n') {
		const code = character === '\n' ? 'Enter'
			: character === ' ' ? 'Space'
			: character >= '0' && character <= '9' ? 'Digit' + character
			: 'Key' + character;
		pressId += 1;
		t.postInput({ type: 'button', deviceId: 'keyboard:0', code, down: true, value: 1, timestamp: 0, pressId });
		await t.frames(2);
		t.postInput({ type: 'button', deviceId: 'keyboard:0', code, down: false, value: 0, timestamp: 0, pressId });
		await t.frames(2);
	}
	await t.frames(15);
	t.assert(memory.readMappedU32LE(0x08010208) === 1, command + ' must not acknowledge the hardware fault');
	t.assert(memory.readMappedU32LE(0x0801020c) === 0x01000000, command + ' must retain first fault address');
	t.assert(memory.readMappedU32LE(0x08010210) === 0x00000801, command + ' must retain first fault access');
	if (command === 'CONT') {
		t.assert(memory.readMappedU32LE(faultSequenceAddress) !== firstSequence, 'CONT must retry the still-faulting load');
		t.assert(memory.readMappedU32LE(0x0801042c) === 0x0000001c, 'retry must publish another DBE');
	} else {
		t.assert(memory.readMappedU32LE(faultSequenceAddress) === firstSequence, command + ' must not resume cartridge execution');
	}
	t.capture(command + ': installed BIOS terminal');
}
t.log('unmapped Word load -> DBE; MEM shows CODE/ADDR/ACCESS; FAULT CLEAR leaves hardware latch; CONT retries without repair');
