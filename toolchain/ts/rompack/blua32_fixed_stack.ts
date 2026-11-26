import { readLE32 } from '../../../machine/ts/common/endian';
import { BLUA32_CONSTANT_RECORD_SIZE, BLUA32_CONSTANT_TAG_OFFSET, Blua32ConstantTag } from '../../../machine/ts/spec/blua32/image_format';
import { CLOSURE_ADDRESS_REGISTER_FLAG, INSTRUCTION_BYTES, signExtend, ValueMoveKind } from '../../../machine/ts/spec/blua32/instruction_format';
import { MemoryAccessKind } from '../../../machine/ts/spec/blua32/memory_access_kind';
import {
	OpCode, OPCODE_RK_OPERANDS, OPCODE_SCALAR_REGISTER_READS, OPCODE_WRITES_REGISTER_A,
	REGISTER_OPERAND_A, REGISTER_OPERAND_B, REGISTER_OPERAND_C, RK_OPERAND_B, RK_OPERAND_C,
} from '../../../machine/ts/spec/blua32/opcode';
import { OPCODE_NAMES } from '../lua/opcode_metadata';
import { type Blua32ImageLayout, blua32FunctionIndexAtAddress } from './blua32_image';
import { decodeBlua32InstructionAtPc, type DecodedInstruction } from './blua32_instruction_decode';

export type Blua32FixedStack = {
	readonly valueSlots: number;
	readonly frames: number;
};

/**
 * Derive the backing required for fixed-window heap-service entry points and
 * check that the linked operations stay within their scalar instruction set.
 * Prove over linked instructions, after inlining and relocation. CALL places
 * the next non-vararg frame at A+1 in the current stack, not at the end of
 * the caller's own window. This does not give ordinary CALL/CLOSURE private
 * memory authority or remove the runtime's usual closure allocation.
 */
export function deriveBlua32FixedStack(image: Blua32ImageLayout, roots: readonly number[]): Blua32FixedStack {
	const visited = new Map<number, Blua32FixedStack>();
	const ancestors = new Set<number>();
	const constantTagOffset = image.header.constantTableAddress - image.address + BLUA32_CONSTANT_TAG_OFFSET;

	function admitConstant(index: number, reject: (reason: string) => never): void {
		if (index >= image.header.constantCount) reject('constant index exceeds the linked pool');
		const tag = readLE32(image.bytes, constantTagOffset + index * BLUA32_CONSTANT_RECORD_SIZE);
		if (tag !== Blua32ConstantTag.Nil && tag !== Blua32ConstantTag.False
			&& tag !== Blua32ConstantTag.True && tag !== Blua32ConstantTag.Integer)
			reject('constant is not an Integer, nil or Boolean');
	}

	function measure(index: number): Blua32FixedStack {
		const known = visited.get(index);
		if (known !== undefined) return known;
		const fn = image.functions[index];
		if (ancestors.has(index)) throw new Error(`Recursive fixed-stack function at 0x${fn.address.toString(16)}.`);
		if (!fn.staticClosure || fn.isVararg || fn.upvalues.length !== 0)
			throw new Error(`Fixed-stack function at 0x${fn.address.toString(16)} must be static, fixed-arity and capture-free.`);
		ancestors.add(index);
		const width = Math.max(1, fn.numParams, fn.maxStack);
		let valueSlots = width, frames = 1;
		const last = fn.codeAddress + fn.codeByteCount;
		const instructions = new Map<number, DecodedInstruction>();
		for (let pc = fn.codeAddress; pc < last;) {
			const instruction = decodeBlua32InstructionAtPc(image.textBytes, image.header.textAddress, pc);
			instructions.set(pc, instruction);
			pc = instruction.pc + INSTRUCTION_BYTES;
		}

		// Track a singleton static function record per register. Zero means
		// no single target proved. Joining divergent edges removes a target.
		const inputs = new Map<number, Uint32Array>();
		const pending: number[] = [];
		function merge(pc: number, registers: Uint32Array): void {
			if (!instructions.has(pc)) throw new Error(`Fixed-stack branch leaves its function at 0x${pc.toString(16)}.`);
			const other = inputs.get(pc);
			if (other === undefined) {
				inputs.set(pc, registers.slice());
				pending.push(pc);
				return;
			}
			let changed = false;
			for (let i = 0; i < width; ++i) {
				if (other[i] === 0 || other[i] === registers[i]) continue;
				other[i] = 0;
				changed = true;
			}
			if (changed) pending.push(pc);
		}
		const registers = new Uint32Array(width);
		merge(fn.codeAddress, registers);
		while (pending.length !== 0) {
			const pc = pending.pop()!;
			const { op, a, b, c, bx, sbx, pc: body, rkBitsB, rkBitsC } = instructions.get(pc)!;
			const next = body + INSTRUCTION_BYTES;
			registers.set(inputs.get(pc)!);
			const reject = (reason: string): never => {
				throw new Error(`Fixed-stack ${OPCODE_NAMES[op]} at 0x${pc.toString(16)}: ${reason}.`);
			};
			const reads = OPCODE_SCALAR_REGISTER_READS[op], rk = OPCODE_RK_OPERANDS[op];
			const rb = (rk & RK_OPERAND_B) !== 0 ? signExtend(b, rkBitsB) : b;
			const rc = (rk & RK_OPERAND_C) !== 0 ? signExtend(c, rkBitsC) : c;
			if (((reads & REGISTER_OPERAND_A) !== 0 && a >= width)
				|| ((reads & REGISTER_OPERAND_B) !== 0 && rb >= width)
				|| ((reads & REGISTER_OPERAND_C) !== 0 && rc >= width))
				reject('operand exceeds the function record');
			if (rb < 0) admitConstant(-1 - rb, reject);
			if (rc < 0) admitConstant(-1 - rc, reject);
			if (op === OpCode.LOADK) admitConstant(bx, reject);
			if ((op === OpCode.LOAD_MEM || op === OpCode.LOAD_MEM_D || op === OpCode.STORE_MEM || op === OpCode.STORE_MEM_D)
				&& c !== MemoryAccessKind.Word && c !== MemoryAccessKind.U32LE && c !== MemoryAccessKind.U8)
				reject('not a heap-service memory format');
			switch (op) {
				case OpCode.CLOSURE: {
					const address = bx << 4;
					const target = blua32FunctionIndexAtAddress(image, address);
					if ((c & CLOSURE_ADDRESS_REGISTER_FLAG) !== 0 || target < 0 || a >= width)
						reject('requires a local ROM function record');
					const record = image.functions[target];
					if (!record.staticClosure || record.isVararg || record.upvalues.length !== 0)
						reject('callee must be static, fixed-arity and capture-free');
					registers[a] = address;
					break;
				}
				case OpCode.CALL:
					if (b === 0 || c === 0) reject('open call window');
					if (a + b > width || a + c - 1 > width) reject('call window exceeds the function record');
					// The shared callee window and result overwrite this suffix.
					registers.fill(0, a);
					break;
				case OpCode.RET:
					if (b === 0) reject('open return window');
					if (a + b - 1 > width) reject('return window exceeds the function record');
					continue;
				case OpCode.MOV:
					if (a >= width || c !== ValueMoveKind.Copy) reject('not a scalar register copy');
					registers[a] = registers[b];
					break;
				case OpCode.LOADNIL:
					if (a + b > width) reject('nil window exceeds the function record');
					registers.fill(0, a, a + b);
					break;
				case OpCode.JMP:
				case OpCode.JMPIF:
				case OpCode.JMPIFNOT:
					merge(next + sbx * INSTRUCTION_BYTES, registers);
					if (op === OpCode.JMP) continue;
					break;
				case OpCode.EQ:
				case OpCode.LT:
				case OpCode.LE:
					if (!instructions.has(next)) reject('no following instruction to skip');
					merge(instructions.get(next)!.pc + INSTRUCTION_BYTES, registers);
					break;
				case OpCode.KNIL:
				case OpCode.KFALSE:
				case OpCode.KTRUE:
				case OpCode.K0:
				case OpCode.K1:
				case OpCode.KSMI:
				case OpCode.LOADK:
				case OpCode.LOAD_MEM_D:
				case OpCode.LOAD_MEM:
				case OpCode.STORE_MEM_D:
				case OpCode.STORE_MEM:
				case OpCode.ADD:
				case OpCode.SUB:
				case OpCode.MUL:
				case OpCode.BAND:
				case OpCode.BOR:
				case OpCode.BXOR:
				case OpCode.SHL:
				case OpCode.SHR:
				case OpCode.UNM:
				case OpCode.NOT:
				case OpCode.BNOT:
					if (OPCODE_WRITES_REGISTER_A[op] !== 0) {
						if (a >= width) reject('destination exceeds the function record');
						registers[a] = 0;
					}
					break;
				default:
					reject('not in the fixed-stack scalar instruction set');
			}
			merge(next, registers);
		}

		for (const [pc, input] of inputs) {
			const { op, a } = instructions.get(pc)!;
			if (op !== OpCode.CALL) continue;
			const target = blua32FunctionIndexAtAddress(image, input[a]);
			if (target < 0) throw new Error(`Fixed-stack CALL at 0x${pc.toString(16)} has no single static callee.`);
			const below = measure(target);
			valueSlots = Math.max(valueSlots, a + 1 + below.valueSlots);
			frames = Math.max(frames, 1 + below.frames);
		}
		ancestors.delete(index);
		const result = { valueSlots, frames };
		visited.set(index, result);
		return result;
	}

	let valueSlots = 0, frames = 0;
	for (const index of roots) {
		const size = measure(index);
		valueSlots = Math.max(valueSlots, size.valueSlots);
		frames = Math.max(frames, size.frames);
	}
	return { valueSlots, frames };
}
