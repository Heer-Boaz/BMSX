// Exercise the actual CPU's logical accounting for recursive stack slots and
// image globals. This is not an ASIC size estimate or a large-name test.
import { linkRawTestSystemBlua32, createTestSystemCpu } from '../../tests/helpers/blua32';
import { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { INSTRUCTION_BYTES, writeInstruction } from '../../machine/ts/spec/blua32/instruction_format';
import { ValueTag } from '../../machine/ts/machine/cpu/value';
import { THREAD_STACK_SLOT_BYTES } from '../../machine/ts/machine/cpu/thread';

const text = new Uint8Array(3 * INSTRUCTION_BYTES);
writeInstruction(text, 0, OpCode.GETGL, 0, 0, 0);
writeInstruction(text, 1, OpCode.CALL, 0, 1, 1);
writeInstruction(text, 2, OpCode.RET, 0, 1, 0);
const image = linkRawTestSystemBlua32({
	text,
	functions: [{ firstWord: 0, wordCount: 3, maxStack: 1 }],
	globalNames: ['rec'],
});
const { cpu } = createTestSystemCpu(image);
cpu.setGlobalByKey(cpu.stringPool.intern('rec', false), ValueTag.Closure, NaN,
	cpu.activeThread.frames[0]!.closure);
const before = cpu.collectTrackedHeapBytes();
const initialCapacity = cpu.activeThread.stackRegisters.capacity();
cpu.runUntilDepth(0, 20000);
const after = cpu.collectTrackedHeapBytes();
const capacity = cpu.activeThread.stackRegisters.capacity();
const frames = cpu.activeThread.frames;
if (frames.length !== 6668 || capacity !== 8192 ||
	after - before !== (capacity - initialCapacity) * THREAD_STACK_SLOT_BYTES ||
	frames.some(frame => frame.stackCapacity !== 1)) {
	throw Error(`unexpected frame/accounting result: frames=${frames.length}, capacity=${capacity}, delta=${after - before}`);
}
process.stdout.write(`PASS actual TS CPU: ${frames.length} one-slot recursive frames, ${capacity} reserved stack slots, ${after - before} additional tracked bytes; separate frame state not charged per frame\n`);

// The name text and global slots from an image are separate from the logical
// language heap. Exercise guest SETGL, not merely an internal array write;
// distinct immediates and lookups establish that the slots do not alias.
let noGlobalsCharge = 0;
for (const nameCount of [0, 16]) {
	const code = new Uint8Array((2 * nameCount + 1) * INSTRUCTION_BYTES);
	const names = Array.from({ length: nameCount }, (_, index) => `zzQ${index.toString(16)}`);
	for (let index = 0; index < nameCount; index += 1) {
		writeInstruction(code, index * 2, OpCode.KSMI, 0, 0, index);
		writeInstruction(code, index * 2 + 1, OpCode.SETGL, 0, 0, index);
	}
	writeInstruction(code, nameCount * 2, OpCode.RET, 0, 1, 0);
	const globalImage = linkRawTestSystemBlua32({
		text: code,
		functions: [{ firstWord: 0, wordCount: 2 * nameCount + 1, maxStack: 1 }],
		globalNames: names,
	});
	const { cpu: globalCpu } = createTestSystemCpu(globalImage);
	const initialCharge = globalCpu.luaHeap.usedBytes();
	globalCpu.runUntilDepth(0, 1000);
	const finalCharge = globalCpu.luaHeap.usedBytes();
	for (let index = 0; index < nameCount; index += 1) {
		const name = globalCpu.stringPool.intern(names[index], false);
		if (globalCpu.getGlobalByKey(name) !== index) {
			throw Error(`global slot ${index} did not retain its guest-written Number`);
		}
	}
	if (nameCount === 0) noGlobalsCharge = initialCharge;
	if (initialCharge !== noGlobalsCharge || finalCharge !== noGlobalsCharge) {
		throw Error(`global accounting changed for ${nameCount} names: baseline=${noGlobalsCharge}, initial=${initialCharge}, final=${finalCharge}`);
	}
}
process.stdout.write(`PASS actual TS CPU: 0 versus 16 ROM global names and guest-written distinct Numbers retain the same ${noGlobalsCharge}-byte language-heap charge\n`);
