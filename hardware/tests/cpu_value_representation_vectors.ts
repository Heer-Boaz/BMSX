// Probe the actual TS Number producer; these fixtures do not encode an ASIC ABI.
// Type identity, object handles and all other CPU operations remain unqualified.
import { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';

const numbers = [
  0n, 0x8000000000000000n, 1n, 0x7fefffffffffffffn,
  0x7ff0000000000000n, 0xfff0000000000000n,
  0x7ff0000000000001n, 0x7ff8000000000001n,
  0x7fffffffffffffffn, 0xfff8000000000001n,
];
const view = new DataView(new ArrayBuffer(8));
const slots = new ValueSlots(numbers.length);
for (let index = 0; index < numbers.length; index += 1) {
  view.setBigUint64(0, numbers[index]!, true);
  slots.setNumber(index, view.getFloat64(0, true));
  view.setFloat64(0, slots.getNumber(index), true);
  const result = view.getBigUint64(0, true);
  const expected = index >= 6 ? 0x7ff8000000000000n : numbers[index]!;
  if (result !== expected) {
    throw new Error(`Number ${index}: ${result.toString(16)} != ${expected.toString(16)}`);
  }
}
process.stdout.write(`PASS TS ValueSlots setNumber: ${numbers.length} signed-zero, finite, infinity and NaN bit cases\n`);
