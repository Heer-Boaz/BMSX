// Headless IDE test: BIOS os.clock and clock_now are backed by BMSX machine milliseconds.
// Run: npm run ide:test -- <gameromname> tests/ide/bios_os.idetest.js

await t.waitForCart();
await t.frames(2);

const readClockState = () => t.evaluateLua(`
local time_ms<const>: *word = sys_time_ms
return time_ms[0], os.clock(), clock_now()
`);

const before = readClockState();
await t.frames(7);
const after = readClockState();

const msDelta = after[0] - before[0];
const expectedSeconds = msDelta / 1000;

t.assert(msDelta >= 7, `sys_time_ms expected to advance, got +${msDelta}`);
t.assert(Math.abs((after[1] - before[1]) - expectedSeconds) < 0.000001, `os.clock delta mismatch: got ${after[1] - before[1]}, expected ${expectedSeconds}`);
t.assert(Math.abs((after[2] - before[2]) - msDelta) < 0.000001, `clock_now delta mismatch: got ${after[2] - before[2]}, expected ${msDelta}`);
