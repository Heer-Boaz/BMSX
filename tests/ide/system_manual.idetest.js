// Real supervisor-request levels and read-only physical observations. No guest
// expressions, forced handlers, state writes or restoration through the harness.
const memory = t.runtime().machine.memory;
await t.frames(80);
t.assert(memory.readMappedU32LE(0x08010350) === 0, 'ordinary cartridge context');
t.assert(memory.readMappedU32LE(0x08000008) === 4, 'cartridge VBlank mask');
const before = memory.readMappedU32LE(0x08010228);

t.postInput({ type: 'supervisor-request', down: true });
await t.frames(3);
t.postInput({ type: 'supervisor-request', down: false });
await t.frames(12);
t.assert(memory.readMappedU32LE(0x08010350) === 5, 'activated resumable supervisor context');
t.assert(memory.readMappedU32LE(0x08010428) === 0, 'NMI does not publish a fault');
t.assert(memory.readMappedU32LE(0x08010228) > before, 'machine time advances during supervisor service');
t.capture('SYSTEM monitor: BIOS history excludes raw diagnostic line');

t.postInput({ type: 'supervisor-request', down: true });
await t.frames(3);
t.postInput({ type: 'supervisor-request', down: false });
await t.frames(12);
t.assert(memory.readMappedU32LE(0x08010350) === 0, 'user device context restored');
t.assert(memory.readMappedU32LE(0x08000008) === 4, 'cartridge IRQ mask restored');
t.assert(memory.readMappedU32LE(0x0801034c) === 0, 'CONTROL still self-cleared');
t.assert(memory.readMappedU32LE(0x08010428) === 0, 'normal return is not fault publication');

t.postInput({ type: 'supervisor-request', down: true });
await t.frames(3);
t.postInput({ type: 'supervisor-request', down: false });
await t.frames(12);
t.assert(memory.readMappedU32LE(0x08010350) === 5, 'fresh observed rising edge can enter again');
t.assert(memory.readMappedU32LE(0x08010428) === 0, 'second NMI still does not publish a fault');
t.log('actual request -> STATUS5 -> leave STATUS0/MASK4 -> reentry STATUS5; clock advances; no fault publication');
