// Number-reference vectors focused on cancellation, leading-zero depth,
// exponent distance, subnormal transitions and sticky rounding. The C++
// Number owner independently replays these bytes in core_binary64_vectors.cpp.
const view = new DataView(new ArrayBuffer(8));
function number(bits: bigint): number { view.setBigUint64(0, bits); return view.getFloat64(0); }
function bits(value: number): bigint { view.setFloat64(0, value); return view.getBigUint64(0); }
function hex(value: bigint): string { return value.toString(16).padStart(16, '0'); }
let random = 0x97ba34189acdef61n;
function next(): bigint {
	random ^= random << 13n;
	random ^= random >> 7n;
	random ^= random << 17n;
	return random &= 0xffffffffffffffffn;
}
const rows: string[] = [];
function emit(a: bigint, b: bigint): void {
	const left = number(a), right = number(b);
	rows.push(`0 ${hex(a)} ${hex(b)} ${hex(bits(left + right))}`);
	rows.push(`1 ${hex(a)} ${hex(b)} ${hex(bits(left - right))}`);
}
for (const exponent of [1n, 2n, 3n, 4n, 25n, 100n, 500n, 1022n, 1023n, 1024n, 2045n, 2046n]) {
	for (let bit = 0n; bit < 52n; bit++) {
		for (const sign of [0n, 1n << 63n]) {
			const a = sign | (exponent << 52n) | ((1n << 52n) - 1n);
			const b = sign | (exponent << 52n) | (((1n << 52n) - 1n) ^ (1n << bit));
			emit(a, b);
			emit(a, b ^ (1n << 63n));
		}
	}
}
for (let i = 0; i < 5000; i++) {
	const exponent = next() % 2047n;
	const mantissa = next() & 0xfffffffffffffn;
	const sign = (next() & 1n) << 63n;
	const a = sign | (exponent << 52n) | mantissa;
	const distance = next() % 65n;
	const exponent2 = exponent > distance ? exponent - distance : 0n;
	const b = ((next() & 1n) << 63n) | (exponent2 << 52n) | (next() & 0xfffffffffffffn);
	emit(a, b);
	emit(a, sign | (exponent << 52n) | (mantissa ^ (1n << (next() % 52n))));
}
process.stdout.write(`${rows.length}\n${rows.join('\n')}\n`);
