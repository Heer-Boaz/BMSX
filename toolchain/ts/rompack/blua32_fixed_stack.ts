import {
	COP0_RAM_END, COP0_CONTEXT, COP0_EPC, COP0_EXCEPTION_TARGET, COP0_IRQ_VECTOR, COP0_STATUS, COP0_SYSTEM_VECTOR,
	COP0_TABLE_LOOKUP_KEY, COP0_STRING_INDEX_TABLE, cop0FieldImplemented,
} from '../../../machine/ts/spec/blua32/cop0';
import { readLE32 } from '../../../machine/ts/common/endian';
import { BLUA32_CONSTANT_PAYLOAD_OFFSET, BLUA32_CONSTANT_RECORD_SIZE, BLUA32_CONSTANT_TAG_OFFSET, BLUA32_FUNCTION_CODE, Blua32ConstantTag } from '../../../machine/ts/spec/blua32/image_format';
import { INSTRUCTION_BYTES, RegisterJumpMode, signExtend, ValueMoveKind } from '../../../machine/ts/spec/blua32/instruction_format';
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

export type Blua32FixedStackBoundary = {
	readonly reset?: number;
	readonly exceptionVectors: ReadonlySet<number>;
	readonly interruptible: boolean;
};

type RegisterTargets = { readonly words: readonly number[]; readonly external?: boolean };
type FixedStackFootprint = Blua32FixedStack & { readonly firstClobbered: number };
type FixedStackInput = {
	pc: number;
	basis: number;
	values: Uint32Array;
	words: Map<number, RegisterTargets> | null;
};

/**
 * Derive the backing required for fixed-window ROM entry points and
 * check that the linked operations stay within their scalar instruction set.
 * Prove over linked instructions, after inlining and relocation. CALL places
 * the next non-vararg frame at A+1 in the current stack, not at the end of
 * the caller's own window. This does not give ordinary calls private memory authority.
 */
export function deriveBlua32FixedStack(
	image: Blua32ImageLayout,
	roots: readonly number[],
	boundary?: Blua32FixedStackBoundary,
): Blua32FixedStack {
	const visited = new Map<string, FixedStackFootprint>();
	const ancestors = new Set<number>();
	const constantTableOffset = image.header.constantTableAddress - image.address;
	const functionByEntry = new Map(image.functions.map((fn, index) => [fn.codeAddress, index]));
	const decoded = new Map<number, Map<number, DecodedInstruction>>();

	function instructionsFor(index: number): Map<number, DecodedInstruction> {
		const cached = decoded.get(index);
		if (cached !== undefined) return cached;
		const fn = image.functions[index];
		const last = fn.codeAddress + fn.codeByteCount;
		const instructions = new Map<number, DecodedInstruction>();
		for (let pc = fn.codeAddress; pc < last;) {
			const instruction = decodeBlua32InstructionAtPc(image.textBytes, image.header.textAddress, pc);
			instructions.set(pc, instruction);
			pc = instruction.pc + INSTRUCTION_BYTES;
		}
		decoded.set(index, instructions);
		return instructions;
	}

	function admitConstant(index: number, reject: (reason: string) => never, load = false): number {
		if (index >= image.header.constantCount) reject('constant index exceeds the linked pool');
		const offset = constantTableOffset + index * BLUA32_CONSTANT_RECORD_SIZE;
		const tag = readLE32(image.bytes, offset + BLUA32_CONSTANT_TAG_OFFSET);
		if (load && tag === Blua32ConstantTag.CodeFunction) {
			const address = readLE32(image.bytes, offset + BLUA32_CONSTANT_PAYLOAD_OFFSET);
			const target = blua32FunctionIndexAtAddress(image, address);
			if (target < 0) reject('requires a local ROM function record');
			const record = image.functions[target];
			if ((record.flags & BLUA32_FUNCTION_CODE) === 0 || !record.staticClosure || record.isVararg || record.upvalues.length !== 0)
				reject('CodeFunction must be static, fixed-arity and capture-free');
			return address;
		}
		if (tag !== Blua32ConstantTag.Nil && tag !== Blua32ConstantTag.False
			&& tag !== Blua32ConstantTag.True && tag !== Blua32ConstantTag.Integer)
			reject('constant is not an Integer, nil or Boolean');
		return 0;
	}

	function measure(index: number, entryLink?: number): FixedStackFootprint {
		const key = `${index}:${entryLink}`;
		const known = visited.get(key);
		if (known !== undefined) return known;
		const fn = image.functions[index];
		if (ancestors.has(index)) throw new Error(`Recursive fixed-stack function at 0x${fn.address.toString(16)}.`);
		// A proved physical entry already supplies the bounded register window.
		// The source signature only controls ordinary CALL/direct entry.
		const ordinary = entryLink === undefined;
		if (!fn.staticClosure || fn.upvalues.length !== 0 || (ordinary && fn.isVararg))
			throw new Error(`Fixed-stack function at 0x${fn.address.toString(16)} must be static${ordinary ? ', fixed-arity' : ''} and capture-free.`);
		ancestors.add(index);
		const frameWidth = Math.max(1, fn.numParams, fn.maxStack);
		let valueSlots = frameWidth, frames = 1, firstClobbered = frameWidth;
		// Index facts by physical backing, not by the current register basis.
		// A linked software branch changes neither the backing nor its depth.
		const inputs = new Map<number, FixedStackInput>();
		const pending: FixedStackInput[] = [];
		const values = new Uint32Array(frameWidth);
		const views = new Map([[0, values]]);
		let tracksRawWords = false;
		const instructions = instructionsFor(index);
		for (const instruction of instructions.values()) {
			tracksRawWords ||= instruction.op === OpCode.JREG || instruction.op === OpCode.JAL
				|| instruction.op === OpCode.MOV
					&& (instruction.c === ValueMoveKind.ReadIndexed || instruction.c === ValueMoveKind.WriteIndexed);
		}
		const branches = tracksRawWords || entryLink !== undefined ? new Map<number, RegisterTargets>() : null;
		function rawWords(slot: number): readonly number[] | undefined {
			const fact = branches!.get(slot);
			return fact?.external ? undefined : fact?.words;
		}
		function merge(pc: number, basis: number): void {
			if (!instructions.has(pc)) throw new Error(`Fixed-stack branch leaves its function at 0x${pc.toString(16)}.`);
			const key = pc + basis * image.textBytes.length;
			const other = inputs.get(key);
			if (other === undefined) {
				const input = { pc, basis, values: values.slice(), words: branches === null ? null : new Map(branches) };
				inputs.set(key, input);
				pending.push(input);
				return;
			}
			let changed = false;
			for (let i = 0; i < frameWidth; ++i) {
				if (other.values[i] === 0 || other.values[i] === values[i]) continue;
				other.values[i] = 0;
				changed = true;
			}
			if (branches !== null) {
				for (const [register, earlier] of other.words!) {
					const later = branches.get(register);
					if (later === undefined) {
						other.words!.delete(register);
						changed = true;
					} else if (earlier !== later) {
						const external = earlier.external || later.external;
						const laterWords = later.words;
						if (external !== earlier.external || laterWords.some(target => !earlier.words.includes(target))) {
							other.words!.set(register, { words: [...new Set([...earlier.words, ...laterWords])], external });
							changed = true;
						}
					}
				}
			}
			if (changed) pending.push(other);
		}
		if (entryLink !== undefined) {
			if (entryLink >= frameWidth) throw new Error(`Fixed-stack link at 0x${fn.codeAddress.toString(16)} exceeds the callee's register extent.`);
			branches!.set(entryLink, { words: [], external: true });
		}
		merge(fn.codeAddress, 0);
		while (pending.length !== 0) {
			const input = pending.pop()!;
			const { pc, basis } = input;
			const { op, a, b, c, bx, sbx, pc: body, rkBitsB, rkBitsC } = instructions.get(pc)!;
			const next = body + INSTRUCTION_BYTES;
			const width = frameWidth - basis;
			const cached = views.get(basis);
			const registers = cached ?? values.subarray(basis);
			if (cached === undefined) views.set(basis, registers);
			values.set(input.values);
			if (branches !== null) {
				branches.clear();
				for (const [register, targets] of input.words!) branches.set(register, targets);
			}
			const reject = (reason: string): never => {
				throw new Error(`Fixed-stack ${OPCODE_NAMES[op]} at 0x${pc.toString(16)}: ${reason}.`);
			};
			// A foreign TEXT entry is proved once with its incoming link
			// abstracted, rather than re-analysed for every path into it.
			// Code can use fixed high slots without rebasing the register bank.
			// Propagate where the callee can clobber slots, separately
			// from how much backing it requires.
			function applyLinkedTargets(targets: readonly number[], link: number): void {
				registers[link] = 0;
				branches!.set(basis + link, { words: [next] });
				firstClobbered = Math.min(firstClobbered, basis + link);
				let clobbered = 0, clobberedFrom = width, returned = false;
				for (const target of targets) {
					if (instructions.has(target)) {
						merge(target, basis);
						continue;
					}
					const callee = functionByEntry.get(target) ?? reject('no finite local target or linked entry');
					const below = measure(callee, link);
					if (below.valueSlots > width) reject('linked entry exceeds the admitted frame');
					clobbered = Math.max(clobbered, below.valueSlots);
					clobberedFrom = Math.min(clobberedFrom, below.firstClobbered);
					frames = Math.max(frames, below.frames);
					returned = true;
				}
				if (returned) {
					firstClobbered = Math.min(firstClobbered, basis + clobberedFrom);
					registers.fill(0, clobberedFrom, clobbered);
					for (const register of branches!.keys())
						if (register >= basis + clobberedFrom && register < basis + clobbered) branches!.delete(register);
					merge(next, basis);
				}
			}
			// AddBase's B is a signed immediate, and it does not write A.
			if (op === OpCode.MOV && c === ValueMoveKind.AddBase) {
				const base = basis + signExtend(b, rkBitsB);
				if (base < 0 || base > frameWidth) reject('basis exceeds the admitted frame');
				merge(next, base);
				continue;
			}
			let reads = OPCODE_SCALAR_REGISTER_READS[op];
			if (op === OpCode.MOV && (c === ValueMoveKind.ReadTop || c === ValueMoveKind.SetTopImmediate))
				reads = 0;
			else if (op === OpCode.MOV && c === ValueMoveKind.WriteIndexed)
				reads = REGISTER_OPERAND_A | REGISTER_OPERAND_B;
			const rk = OPCODE_RK_OPERANDS[op];
			const rb = (rk & RK_OPERAND_B) !== 0 ? signExtend(b, rkBitsB) : b;
			const rc = (rk & RK_OPERAND_C) !== 0 ? signExtend(c, rkBitsC) : c;
			if (((reads & REGISTER_OPERAND_A) !== 0 && a >= width)
				|| ((reads & REGISTER_OPERAND_B) !== 0 && rb >= width)
				|| ((reads & REGISTER_OPERAND_C) !== 0 && rc >= width))
				reject('operand exceeds the function record');
			if (rb < 0) admitConstant(-1 - rb, reject);
			if (rc < 0) admitConstant(-1 - rc, reject);
			// Only LOAD_MEM can read the issuing context. Other loads and
			// stores take the ordinary bus formats.
			if ((op === OpCode.LOAD_MEM || op === OpCode.LOAD_MEM_D || op === OpCode.STORE_MEM || op === OpCode.STORE_MEM_D)
				&& c > MemoryAccessKind.Value && (op !== OpCode.LOAD_MEM || c !== MemoryAccessKind.ContextWord))
				reject('not an ordinary CPU memory format');
			if ((OPCODE_WRITES_REGISTER_A[op] !== 0 && op !== OpCode.MOV && op !== OpCode.JAL)
				|| (op === OpCode.LOADNIL && b !== 0) || op === OpCode.CALL)
				firstClobbered = Math.min(firstClobbered, basis + a);
			switch (op) {
				case OpCode.LOADK:
					if (a >= width) reject('destination exceeds the function record');
					registers[a] = admitConstant(bx, reject, true);
					if (branches !== null) {
						const constant = constantTableOffset + bx * BLUA32_CONSTANT_RECORD_SIZE;
						const tag = readLE32(image.bytes, constant + BLUA32_CONSTANT_TAG_OFFSET);
						const target = readLE32(image.bytes, constant + BLUA32_CONSTANT_PAYLOAD_OFFSET);
						if (tag === Blua32ConstantTag.Integer) branches.set(basis + a, { words: [target] });
						else branches.delete(basis + a);
					}
					break;
				case OpCode.CALL:
					if (b === 0 || c === 0) reject('open call window');
					if (a + b > width || a + c - 1 > width) reject('call window exceeds the function record');
					// The shared callee window and result overwrite this suffix.
					registers.fill(0, a);
					if (branches !== null) for (const register of branches.keys()) if (register >= basis + a) branches.delete(register);
					break;
				case OpCode.RET:
					if (entryLink !== undefined || basis !== 0) reject('register link has not returned to the owning frame');
					if (boundary?.exceptionVectors.has(index))
						reject('exception vector ends with RFE or an exception transfer');
					if (c !== 0) reject('return from a variadic window requires an ordinary activation');
					if (b === 0) reject('open return window');
					if (a + b - 1 > width) reject('return window exceeds the function record');
					continue;
				case OpCode.HALT:
					if (boundary?.interruptible !== true) reject('HALT requires an ordinary interruptible frame');
					break;
				case OpCode.RFE:
					if (entryLink !== undefined || basis !== 0 || !boundary?.exceptionVectors.has(index)) reject('not an authored exception vector');
					continue;
				case OpCode.ARGC:
					if (!ordinary || basis !== 0) reject('argument count requires an ordinary activation');
					if (a >= width) reject('not an ordinary CPU argument count read');
					registers[a] = 0;
					branches?.delete(basis + a);
					break;
				case OpCode.MFC0:
					if (!cop0FieldImplemented(b) || a >= width)
						reject('not an ordinary CPU control read');
					registers[a] = 0;
					branches?.delete(basis + a);
					break;
				case OpCode.MTC0:
					if (!cop0FieldImplemented(b) || a >= width)
						reject('not an ordinary CPU control write');
					if (b === COP0_EXCEPTION_TARGET) {
						if (entryLink !== undefined || basis !== 0 || !boundary?.exceptionVectors.has(index))
							reject('not an authored exception vector');
						continue;
					}
					if (b === COP0_CONTEXT) {
						if (entryLink !== undefined || basis !== 0 || index !== boundary?.reset) reject('context selection belongs to the reset root');
						continue;
					}
					if (b !== COP0_STATUS && b !== COP0_EPC && b !== COP0_IRQ_VECTOR && b !== COP0_SYSTEM_VECTOR && b !== COP0_RAM_END
						&& (b < COP0_TABLE_LOOKUP_KEY || b > COP0_STRING_INDEX_TABLE)) {
						reject('not a bounded direct-vector control write');
					}
					break;
				case OpCode.MOV: {
					if (c === ValueMoveKind.SetTop) {
						// An interrupt may collect and clear the suffix immediately.
						const tops = branches === null ? undefined : rawWords(basis + b);
						if (tops === undefined) firstClobbered = Math.min(firstClobbered, basis);
						else for (const top of tops) firstClobbered = Math.min(firstClobbered, basis + top);
						break;
					}
					if (c === ValueMoveKind.SetTopImmediate) {
						if (a > width) reject('frontier exceeds the owning register window');
						firstClobbered = Math.min(firstClobbered, basis + a);
						break;
					}
					if (c === ValueMoveKind.WriteIndexed) {
						const targets = rawWords(basis + a);
						if (targets === undefined) {
							firstClobbered = Math.min(firstClobbered, basis);
							registers.fill(0);
							for (const register of branches!.keys()) if (register >= basis) branches!.delete(register);
						} else for (const slot of targets) {
							if (slot >= width) continue;
							firstClobbered = Math.min(firstClobbered, basis + slot);
							const source = targets.length === 1 ? branches!.get(basis + b) : undefined;
							registers[slot] = targets.length === 1 ? registers[b] : 0;
							if (source === undefined) branches!.delete(basis + slot);
							else branches!.set(basis + slot, source);
						}
						break;
					}
					if (a >= width) reject('destination exceeds the function record');
					firstClobbered = Math.min(firstClobbered, basis + a);
					const indexed = c === ValueMoveKind.ReadIndexed ? rawWords(basis + b) : undefined;
					const sourceRegister = c === ValueMoveKind.Copy ? b : indexed?.length === 1 && indexed[0] < width ? indexed[0] : -1;
					if (sourceRegister >= 0) {
						registers[a] = registers[sourceRegister];
						if (branches !== null) {
							const source = branches.get(basis + sourceRegister);
							if (source === undefined) branches.delete(basis + a);
							else branches.set(basis + a, source);
						}
					} else if (c === ValueMoveKind.Tag || c === ValueMoveKind.Payload || c === ValueMoveKind.FloatBits || c === ValueMoveKind.FloatFromBits
						|| c === ValueMoveKind.ReadTop || c === ValueMoveKind.ReadIndexed) {
						registers[a] = 0;
						branches?.delete(basis + a);
					} else reject('invalid register move format');
					break;
				}
				case OpCode.LOADNIL:
					if (a + b > width) reject('nil window exceeds the function record');
					registers.fill(0, a, a + b);
					if (branches !== null) for (let register = a; register < a + b; ++register) branches.delete(basis + register);
					break;
				case OpCode.JREG: {
					if (c > RegisterJumpMode.Link || (c === RegisterJumpMode.Link && b >= width))
						reject('requires a legal register jump within the function record');
					const targets = branches!.get(basis + a) ?? reject('no finite local target set');
					if (c === RegisterJumpMode.Link) {
						if (targets.external) reject('a continuation is not a linked entry');
						applyLinkedTargets(targets.words, b);
					} else {
						if (targets.external && basis !== 0) reject('linked return changes the entry basis');
						for (const target of targets.words) {
							if (!instructions.has(target)) reject('no finite local target set');
							merge(target, basis);
						}
					}
					continue;
				}
				case OpCode.JAL:
					if (a >= width) reject('link exceeds the function record');
					applyLinkedTargets([next + sbx * INSTRUCTION_BYTES], a);
					continue;
				case OpCode.JMP:
				case OpCode.JMPIF:
				case OpCode.JMPIFNOT:
					merge(next + sbx * INSTRUCTION_BYTES, basis);
					if (op === OpCode.JMP) continue;
					break;
				case OpCode.EQ:
				case OpCode.LT:
				case OpCode.LE:
					if (!instructions.has(next)) reject('no following instruction to skip');
					merge(instructions.get(next)!.pc + INSTRUCTION_BYTES, basis);
					break;
				case OpCode.KSMI:
					if (a >= width) reject('destination exceeds the function record');
					registers[a] = 0;
					branches?.set(basis + a, { words: [sbx >>> 0] });
					break;
				case OpCode.KNIL:
				case OpCode.KFALSE:
				case OpCode.KTRUE:
				case OpCode.K0:
				case OpCode.K1:
				case OpCode.LOAD_MEM_D:
				case OpCode.LOAD_MEM:
				case OpCode.STORE_MEM_D:
				case OpCode.STORE_MEM:
				case OpCode.ADD:
				case OpCode.SUB:
				case OpCode.MUL:
				case OpCode.FLOORDIV:
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
						branches?.delete(basis + a);
					}
					break;
				default:
					reject('not in the fixed-stack scalar instruction set');
			}
			merge(next, basis);
		}

		for (const { pc, basis, values } of inputs.values()) {
			const { op, a } = instructions.get(pc)!;
			if (op !== OpCode.CALL) continue;
			const target = blua32FunctionIndexAtAddress(image, values[basis + a]);
			if (target < 0) throw new Error(`Fixed-stack CALL at 0x${pc.toString(16)} has no single static callee.`);
			const below = measure(target);
			valueSlots = Math.max(valueSlots, basis + a + 1 + below.valueSlots);
			frames = Math.max(frames, 1 + below.frames);
		}
		ancestors.delete(index);
		const result = { valueSlots, frames, firstClobbered };
		visited.set(key, result);
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
