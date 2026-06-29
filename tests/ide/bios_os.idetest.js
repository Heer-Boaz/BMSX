// Headless IDE test: BIOS os.clock/clock_now/os.time are backed by BMSX machine time.
// Run: npm run ide:test -- <gameromname> tests/ide/bios_os.idetest.js

await t.waitForCart();
await t.frames(2);

const readClockState = () => t.evaluateLua(`
local time_ms<const>: *word = sys_time_ms
return time_ms[0], os.clock(), clock_now(), os.time(), os.difftime(125, 20)
`);

const before = readClockState();
await t.frames(7);
const after = readClockState();

const msDelta = after[0] - before[0];
const expectedSeconds = msDelta / 1000;

t.assert(msDelta >= 7, `sys_time_ms expected to advance, got +${msDelta}`);
t.assert(Math.abs((after[1] - before[1]) - expectedSeconds) < 0.000001, `os.clock delta mismatch: got ${after[1] - before[1]}, expected ${expectedSeconds}`);
t.assert(Math.abs((after[2] - before[2]) - msDelta) < 0.000001, `clock_now delta mismatch: got ${after[2] - before[2]}, expected ${msDelta}`);
t.assert(after[3] === Math.trunc(after[0] / 1000), `os.time default should return machine seconds, got ${after[3]} for ${after[0]}ms`);
t.assert(after[4] === 105, `os.difftime should subtract seconds in BIOS Lua, got ${after[4]}`);

const timeCases = t.evaluateLua(`
local noon<const> = os.time({ year = 1970, month = 1, day = 1 })
local epoch<const> = os.time({ year = 1970, month = 1, day = 1, hour = 0 })
local pre_epoch<const> = os.time({ year = 1969, month = 12, day = 31, hour = 23, min = 59, sec = 59 })
local normalized = { year = 1970, month = 13, day = 1, hour = 0 }
local normalized_timestamp<const> = os.time(normalized)
return noon, epoch, pre_epoch, normalized_timestamp, normalized.year, normalized.month, normalized.day, normalized.hour, normalized.min, normalized.sec, normalized.wday, normalized.yday, normalized.isdst
`);

t.assert(timeCases[0] === 43200, `os.time should default missing hour to noon, got ${timeCases[0]}`);
t.assert(timeCases[1] === 0, `os.time epoch should be 0, got ${timeCases[1]}`);
t.assert(timeCases[2] === -1, `os.time should support pre-epoch seconds, got ${timeCases[2]}`);
t.assert(timeCases[3] === 31536000, `os.time should normalize month overflow to 1971-01-01, got ${timeCases[3]}`);
t.assert(timeCases[4] === 1971 && timeCases[5] === 1 && timeCases[6] === 1, `os.time should write normalized date fields, got ${timeCases.slice(4, 7).join('-')}`);
t.assert(timeCases[7] === 0 && timeCases[8] === 0 && timeCases[9] === 0, `os.time should write normalized clock fields, got ${timeCases.slice(7, 10).join(':')}`);
t.assert(timeCases[10] === 6 && timeCases[11] === 1 && timeCases[12] === false, `os.time should write normalized calendar facts, got wday=${timeCases[10]} yday=${timeCases[11]} isdst=${timeCases[12]}`);

const fractionalDiffOk = t.evaluateLua('return pcall(function() return os.difftime(1.5, 1) end)')[0];
t.assert(fractionalDiffOk === false, 'os.difftime should reject fractional BMSX time values');
const fractionalTimeOk = t.evaluateLua('return pcall(function() return os.time({ year = 1970.5, month = 1, day = 1 }) end)')[0];
t.assert(fractionalTimeOk === false, 'os.time should reject fractional BMSX civil-time fields');
