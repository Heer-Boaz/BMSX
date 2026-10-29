// Actual JS Number arithmetic supplies expected bits. Cases focus on gradual
// underflow, exact/subnormal rounding, sign, exponent extremes and normalization.
const view = new DataView(new ArrayBuffer(8));
function fromBits(bits: bigint): number { view.setBigUint64(0, bits, false); return view.getFloat64(0, false); }
function toBits(value: number): bigint { view.setFloat64(0, value, false); return view.getBigUint64(0, false); }
function hex(value: bigint): string { return value.toString(16).padStart(16, '0'); }
const rows: string[] = [];
function emit(op: number, a: bigint, b: bigint): void {
 const x = fromBits(a), y = fromBits(b);
 rows.push(`${op} ${hex(a)} ${hex(b)} ${hex(toBits(op === 2 ? x * y : x / y))}`);
}

// Regression: the original Dawson divider rounds this to 0020000001000000.
emit(3, 0x0000000002000000n, 0x4000000000000001n);
const boundary = [1n, 2n, 3n, 0x007fffffn, 0x00ffffffn, 0x01000000n,
 0x01ffffffn, 0x02000000n, 0x02000001n, 0x000fffffffffffffn,
 0x0010000000000000n, 0x0010000000000001n, 0x3fefffffffffffffn,
 0x3ff0000000000000n, 0x3ff0000000000001n, 0x3fffffffffffffffn,
 0x4000000000000000n, 0x4000000000000001n, 0x7fefffffffffffffn];
const sign = 0x8000000000000000n;
for (const op of [2, 3]) for (const x of boundary) for (const y of boundary) {
 for (const sa of [0n, sign]) for (const sb of [0n, sign]) emit(op, x | sa, y | sb);
}
// Every subnormal leading-bit position, multiplied/divided by nearby powers
// and the extremes, with additional random signs and low significand bits.
let state = 0x97f4a7c15bb37e17n;
function next(): bigint { state ^= state << 13n; state ^= state >> 7n; state ^= state << 17n; state &= 0xffffffffffffffffn; return state; }
for (let bit = 0; bit < 52; bit++) {
 const a = 1n << BigInt(bit);
 for (const biased of [1n, 2n, 511n, 1022n, 1023n, 1024n, 1535n, 2045n, 2046n]) {
  for (const frac of [0n, 1n, 0x000fffffffffffffn]) {
   const b = (biased << 52n) | frac;
   for (const op of [2, 3]) { emit(op, a, b); emit(op, a | sign, b); }
  }
 }
}
for (let i = 0; i < 8192; i++) { const a = next(), b = next(); emit(2, a, b); emit(3, a, b); }
process.stdout.write(`${rows.length}\n${rows.join('\n')}\n`);
