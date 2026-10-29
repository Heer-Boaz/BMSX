// IEEE sqrt reference for GEO's ECMAScript Math.sqrt numerical operation.
// The C++ check independently compares the generated results with std::sqrt.
const bits = new DataView(new ArrayBuffer(8));
function value(x) { bits.setBigUint64(0, x); return bits.getFloat64(0); }
function word(x) { bits.setFloat64(0, x); return bits.getBigUint64(0); }
const edge = [0n, 1n, 2n, 0xfffffffffffffn, 0x10000000000000n,
  0x3fefffffffffffffn, 0x3ff0000000000000n, 0x3ff0000000000001n,
  0x4000000000000000n, 0x4010000000000000n, 0x7fefffffffffffffn,
  0x7ff0000000000000n, 0x7ff0000000000001n, 0x7ff8000000000000n,
  0x8000000000000000n, 0x8000000000000001n, 0xbff0000000000000n,
  0xfff0000000000000n, 0xfff8000000000000n];
// Exercise each exponent at the significand boundaries, and the numbers
// immediately adjacent to exact integer squares.
for (let exponent = 0n; exponent < 2047n; ++exponent)
  for (const fraction of [0n, 1n, 0x7ffffffffffffn, 0xfffffffffffffn])
    edge.push(exponent << 52n | fraction);
for (let i = 1; i <= 4096; ++i) {
  const square = word(i * i);
  edge.push(square - 1n, square, square + 1n);
}
let seed = 0x9e3779b97f4a7c15n;
const mask = (1n << 64n) - 1n;
const vectors = [...edge];
for (let i = 0; i < 16384; ++i) {
  seed ^= seed << 13n & mask; seed ^= seed >> 7n; seed ^= seed << 17n & mask;
  vectors.push(seed & mask);
  // Extra positive inputs exercise normal computation rather than negative NaNs.
  vectors.push(seed & 0x7fffffffffffffffn);
}
console.log(vectors.length);
for (const x of vectors) console.log(x.toString(16).padStart(16, '0'), word(Math.sqrt(value(x))).toString(16).padStart(16, '0'));
