await t.waitForCart();
await t.frames(10);

const cpu = t.runtime().machine.cpu;
t.assert(cpu.isUserMode(), 'cartridge did not begin in user mode');

t.postInput({ type: 'button', deviceId: 'keyboard:0', code: 'Backspace', down: true, value: 1, timestamp: 0, pressId: 1 });
t.postInput({ type: 'button', deviceId: 'keyboard:0', code: 'ShiftLeft', down: true, value: 1, timestamp: 0, pressId: 2 });
await t.frames(1);
t.postInput({ type: 'button', deviceId: 'keyboard:0', code: 'Backspace', down: false, value: 0, timestamp: 0, pressId: 1 });
t.postInput({ type: 'button', deviceId: 'keyboard:0', code: 'ShiftLeft', down: false, value: 0, timestamp: 0, pressId: 2 });

for (let frame = 0; frame < 60 && cpu.isUserMode(); frame += 1) {
	await t.frames(1);
}
t.assert(!cpu.isUserMode(), 'Select+L did not enter the BIOS monitor');
t.assert(cpu.isHaltedUntilIrq(), 'BIOS monitor did not reach its input wait');

t.postInput({ type: 'button', deviceId: 'keyboard:0', code: 'Backspace', down: true, value: 1, timestamp: 0, pressId: 3 });
t.postInput({ type: 'button', deviceId: 'keyboard:0', code: 'ShiftLeft', down: true, value: 1, timestamp: 0, pressId: 4 });
await t.frames(1);
t.postInput({ type: 'button', deviceId: 'keyboard:0', code: 'Backspace', down: false, value: 0, timestamp: 0, pressId: 3 });
t.postInput({ type: 'button', deviceId: 'keyboard:0', code: 'ShiftLeft', down: false, value: 0, timestamp: 0, pressId: 4 });

for (let frame = 0; frame < 60 && !cpu.isUserMode(); frame += 1) {
	await t.frames(1);
}
t.assert(cpu.isUserMode(), 'second Select+L edge did not resume the cartridge');
