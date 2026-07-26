import { extractSourceRangeText } from './source_text';
import { EXT_A_BITS, EXT_B_BITS, EXT_BX_BITS, EXT_C_BITS, INSTRUCTION_BYTES, MAX_BX_BITS, MAX_OPERAND_BITS, readInstructionWord, signExtend } from '../../machine/cpu/instruction_format';
import { OpCode, OPCODE_USES_BX, OPCODE_USES_DISP, decodeCallArgCount, getOpcodeName } from '../../machine/cpu/opcode_info';
import { formatNumber } from '../../machine/common/number_format';
import {
	BLUA32_FUNCTION_RECORD_SIZE,
	Blua32ConstantTag,
	type Blua32EncodedConstant,
	type Blua32ImageLayout,
} from '../../machine/cpu/blua32_image';
import {
	blua32SourceRangeAtPc,
	type SourceRange,
	type Blua32SymbolsImage,
} from './blua32_symbols';

export type DisassemblyOptions = {
	showConsts?: boolean;
	pcPrefix?: string;
	pcSuffix?: string;
	pcRadix?: 10 | 16;
	pcFormatter?: (pc: number, width: number) => string;
};

type DecodedInstruction = {
	pc: number;
	op: OpCode;
	a: number;
	b: number;
	c: number;
	bx: number;
	sbx: number;
	rkBitsB: number;
	rkBitsC: number;
	disp: number;
};

type Blua32DisassemblySource = {
	image: Blua32ImageLayout;
	symbols: Blua32SymbolsImage | null;
	code: Uint8Array;
};

type OperandField = 'a' | 'b' | 'c' | 'bx' | 'sbx' | 'disp' | 'mode';

export type InstructionOperandDebugInfo = {
	field: OperandField;
	label: string;
	text: string;
	registerIndex?: number;
};

export type InstructionDebugInfo = {
	pc: number;
	pcText: string;
	op: OpCode;
	opName: string;
	instructionText: string;
	operands: InstructionOperandDebugInfo[];
	sourceRange: SourceRange | null;
};

const normalizeOptions = ({
	showConsts = true,
	pcPrefix = '',
	pcSuffix = '',
	pcRadix = 10,
	pcFormatter,
}: DisassemblyOptions): DisassemblyOptions => {
	return {
		showConsts,
		pcPrefix,
		pcSuffix,
		pcRadix,
		pcFormatter,
	};
};

const SOURCE_COMMENT_MAX_CHARS = 120;

const getOpName = (op: OpCode): string => getOpcodeName(op);

const formatBool = (value: number): string => (value !== 0 ? 'true' : 'false');

const formatCount = (value: number): string => (value === 0 ? '*' : value.toString());
const formatCallArgCount = (value: number): string => (value === 0 ? '*' : decodeCallArgCount(value, 0).toString());

const formatBlua32Value = (constant: Blua32EncodedConstant): string => {
	switch (constant.tag) {
		case Blua32ConstantTag.Nil:
			return 'nil';
		case Blua32ConstantTag.False:
			return 'false';
		case Blua32ConstantTag.True:
			return 'true';
		case Blua32ConstantTag.Number:
			return formatNumber(constant.value);
		case Blua32ConstantTag.String:
			return JSON.stringify(constant.value);
	}
};

const formatSourceConst = (
	source: Blua32DisassemblySource,
	index: number,
	options: DisassemblyOptions,
): string => `k${index}${options.showConsts ? `(${formatBlua32Value(source.image.constants[index])})` : ''}`;

const describeSourceRK = (
	source: Blua32DisassemblySource,
	raw: number,
	bits: number,
	options: DisassemblyOptions,
): { text: string; registerIndex?: number } => {
	const rk = signExtend(raw, bits);
	if (rk < 0) {
		return { text: formatSourceConst(source, -1 - rk, options) };
	}
	return { text: `r${rk}`, registerIndex: rk };
};

const formatSourceRK = (
	source: Blua32DisassemblySource,
	raw: number,
	bits: number,
	options: DisassemblyOptions,
): string => describeSourceRK(source, raw, bits, options).text;

const formatSignedOffset = (value: number, width: number, options: DisassemblyOptions): string => {
	const sign = value < 0 ? '-' : '+';
	const absValue = Math.abs(value);
	return `${sign}${formatPc(absValue, width, options)}`;
};

const formatJump = (pc: number, sbx: number, pcWidth: number, options: DisassemblyOptions): string => {
	const offset = sbx * INSTRUCTION_BYTES;
	const target = pc + INSTRUCTION_BYTES + offset;
	const offsetText = formatSignedOffset(offset, pcWidth, options);
	const targetText = formatPc(target, pcWidth, options);
	return `${offsetText} -> ${targetText}`;
};

const formatPc = (pc: number, width: number, options: DisassemblyOptions): string => {
	const value = pc;
	const formatter = options.pcFormatter;
	if (formatter) {
		return formatter(value, width);
	}
	let text = value.toString(options.pcRadix);
	if (options.pcRadix === 16) {
		text = text.toUpperCase();
	}
	return `${options.pcPrefix}${text.padStart(width, '0')}${options.pcSuffix}`;
};

export const formatSourceSnippet = (range: SourceRange, sourceText: string, maxChars = SOURCE_COMMENT_MAX_CHARS): string => {
	const snippet = extractSourceRangeText(range, sourceText);
	if (snippet === null) {
		return '';
	}
	const compact = snippet.replace(/\s+/g, ' ').trim();
	if (compact.length === 0) {
		return '<empty>';
	}
	if (compact.length <= maxChars) {
		return compact;
	}
	return compact.slice(0, maxChars - 3) + '...';
};

const decodeInstruction = (code: Uint8Array, codeAddress: number, pc: number): DecodedInstruction => {
	const wordIndex = (pc - codeAddress) / INSTRUCTION_BYTES;
	const word = readInstructionWord(code, wordIndex);
	const ext = word >>> 24;
	const op = (word >>> 18) & 0x3f;
	const aLow = (word >>> 12) & 0x3f;
	const bLow = (word >>> 6) & 0x3f;
	const cLow = word & 0x3f;
	if (op === OpCode.WIDE) {
		const wideB = bLow;
		const hasWide = true;
		const nextWord = readInstructionWord(code, wordIndex + 1);
		const nextExt = nextWord >>> 24;
		const nextOp = (nextWord >>> 18) & 0x3f;
		const nextA = (nextWord >>> 12) & 0x3f;
		const nextB = (nextWord >>> 6) & 0x3f;
		const nextC = nextWord & 0x3f;
		const usesDisp = OPCODE_USES_DISP[nextOp] !== 0;
		const usesBx = !usesDisp && OPCODE_USES_BX[nextOp] !== 0;
		const extA = usesBx || usesDisp ? 0 : (nextExt >>> 6) & 0x3;
		const extB = usesBx || usesDisp ? 0 : (nextExt >>> 3) & 0x7;
		const extC = usesBx || usesDisp ? 0 : (nextExt & 0x7);
		const aShift = usesDisp ? MAX_OPERAND_BITS : MAX_OPERAND_BITS + (usesBx ? 0 : EXT_A_BITS);
		const bShift = usesDisp ? MAX_OPERAND_BITS : MAX_OPERAND_BITS + EXT_B_BITS;
		const cShift = usesDisp ? MAX_OPERAND_BITS : MAX_OPERAND_BITS + EXT_C_BITS;
		const a = (aLow << aShift) | (extA << MAX_OPERAND_BITS) | nextA;
		const b = (wideB << bShift) | (extB << MAX_OPERAND_BITS) | nextB;
		const c = (cLow << cShift) | (extC << MAX_OPERAND_BITS) | nextC;
		const bxLow = (nextB << 6) | nextC;
		const bxExt = usesBx ? nextExt : 0;
		const bx = (wideB << (MAX_BX_BITS + EXT_BX_BITS)) | (bxExt << MAX_BX_BITS) | bxLow;
		const sbxBits = MAX_BX_BITS + EXT_BX_BITS + (hasWide ? MAX_OPERAND_BITS : 0);
		const sbx = signExtend(bx, sbxBits);
		const rkBitsB = MAX_OPERAND_BITS + EXT_B_BITS + (hasWide ? MAX_OPERAND_BITS : 0);
		const rkBitsC = MAX_OPERAND_BITS + EXT_C_BITS + (hasWide ? MAX_OPERAND_BITS : 0);
		return {
			pc: pc + INSTRUCTION_BYTES,
			op: nextOp as OpCode,
			a,
			b,
			c,
			bx,
			sbx,
			rkBitsB,
			rkBitsC,
			disp: nextExt,
		};
	}
	const usesDisp = OPCODE_USES_DISP[op] !== 0;
	const usesBx = !usesDisp && OPCODE_USES_BX[op] !== 0;
	const extA = usesBx || usesDisp ? 0 : (ext >>> 6) & 0x3;
	const extB = usesBx || usesDisp ? 0 : (ext >>> 3) & 0x7;
	const extC = usesBx || usesDisp ? 0 : (ext & 0x7);
	const a = (extA << MAX_OPERAND_BITS) | aLow;
	const b = (extB << MAX_OPERAND_BITS) | bLow;
	const c = (extC << MAX_OPERAND_BITS) | cLow;
	const bxLow = (bLow << 6) | cLow;
	const bxExt = usesBx ? ext : 0;
	const bx = (bxExt << MAX_BX_BITS) | bxLow;
	const sbx = signExtend(bx, MAX_BX_BITS + EXT_BX_BITS);
	const rkBitsB = MAX_OPERAND_BITS + EXT_B_BITS;
	const rkBitsC = MAX_OPERAND_BITS + EXT_C_BITS;
	return {
		pc,
		op: op as OpCode,
		a,
		b,
		c,
		bx,
		sbx,
		rkBitsB,
		rkBitsC,
		disp: ext,
	};
};

const decodeInstructionAtPc = (
	code: Uint8Array,
	codeAddress: number,
	pc: number,
): DecodedInstruction => {
	if ((pc % INSTRUCTION_BYTES) !== 0) {
		throw new Error(`[Disassembler] Instruction pc ${pc} is not aligned.`);
	}
	if (pc < codeAddress || pc >= codeAddress + code.length) {
		throw new Error(`[Disassembler] Instruction pc ${pc} is out of bounds.`);
	}
	const wordIndex = (pc - codeAddress) / INSTRUCTION_BYTES;
	const word = readInstructionWord(code, wordIndex);
	const op = (word >>> 18) & 0x3f;
	if (op === OpCode.WIDE) {
		return decodeInstruction(code, codeAddress, pc);
	}
	if (wordIndex > 0) {
		const previous = readInstructionWord(code, wordIndex - 1);
		const previousOp = (previous >>> 18) & 0x3f;
		if (previousOp === OpCode.WIDE) {
			return decodeInstruction(code, codeAddress, pc - INSTRUCTION_BYTES);
		}
	}
	return decodeInstruction(code, codeAddress, pc);
};

const registerOperand = (field: 'a' | 'b' | 'c', label: string, registerIndex: number): InstructionOperandDebugInfo => ({
	field,
	label,
	text: `r${registerIndex}`,
	registerIndex,
});

const plainOperand = (field: OperandField, label: string, text: string): InstructionOperandDebugInfo => ({
	field,
	label,
	text,
});

const sourceRkOperand = (
	field: 'b' | 'c',
	label: string,
	source: Blua32DisassemblySource,
	raw: number,
	bits: number,
	options: DisassemblyOptions,
): InstructionOperandDebugInfo => {
	const rk = describeSourceRK(source, raw, bits, options);
	return {
		field,
		label,
		text: rk.text,
		registerIndex: rk.registerIndex,
	};
};

const formatSourceGlobalSlotOperand = (
	source: Blua32DisassemblySource,
	slot: number,
	system: boolean,
): string => {
	const prefix = system ? 'sys' : 'gl';
	const names = system ? source.image.systemGlobalNames : source.image.globalNames;
	return `${prefix}${slot} (${names[slot]})`;
};

const formatSourceFunctionOperand = (source: Blua32DisassemblySource, encodedAddress: number): string => {
	const address = (encodedAddress << 4) >>> 0;
	let text = `function@${address.toString(16).padStart(8, '0')}`;
	const first = source.image.header.functionTableAddress;
	const end = first + source.image.header.functionCount * BLUA32_FUNCTION_RECORD_SIZE;
	if (source.symbols !== null && address >= first && address < end) {
		const functionIndex = (address - first) / BLUA32_FUNCTION_RECORD_SIZE;
		text += ` (${source.symbols.metadata.functionIds[functionIndex]})`;
	}
	return text;
};

const sourceRangeAtPc = (source: Blua32DisassemblySource, pc: number): SourceRange | null => {
	return source.symbols === null
		? null
		: blua32SourceRangeAtPc(source.symbols, source.image.header.textAddress, pc);
};

const buildInstructionOperands = (
	decoded: DecodedInstruction,
	source: Blua32DisassemblySource,
	options: DisassemblyOptions,
	pcWidth: number,
): InstructionOperandDebugInfo[] => {
	const { op, a, b, c, bx, sbx, pc } = decoded;
	switch (op) {
		case OpCode.MOV:
			return [registerOperand('a', 'dst', a), registerOperand('b', 'src', b)];
		case OpCode.KNIL:
			return [registerOperand('a', 'dst', a)];
		case OpCode.KFALSE:
			return [registerOperand('a', 'dst', a)];
		case OpCode.KTRUE:
			return [registerOperand('a', 'dst', a)];
		case OpCode.K0:
			return [registerOperand('a', 'dst', a)];
		case OpCode.K1:
			return [registerOperand('a', 'dst', a)];
		case OpCode.KM1:
			return [registerOperand('a', 'dst', a)];
		case OpCode.KSMI:
			return [registerOperand('a', 'dst', a), plainOperand('bx', 'imm', formatNumber(sbx))];
		case OpCode.LOADK:
			return [registerOperand('a', 'dst', a), plainOperand('bx', 'const', formatSourceConst(source, bx, options))];
		case OpCode.LOADKR:
			return [registerOperand('a', 'dst', a), registerOperand('b', 'const_index', b)];
		case OpCode.LOADNIL:
			return [registerOperand('a', 'base', a), plainOperand('b', 'count', b.toString())];
		case OpCode.GETSYS:
			return [registerOperand('a', 'dst', a), plainOperand('bx', 'slot', formatSourceGlobalSlotOperand(source, bx, true))];
		case OpCode.SETSYS:
			return [registerOperand('a', 'src', a), plainOperand('bx', 'slot', formatSourceGlobalSlotOperand(source, bx, true))];
		case OpCode.GETGL:
			return [registerOperand('a', 'dst', a), plainOperand('bx', 'slot', formatSourceGlobalSlotOperand(source, bx, false))];
		case OpCode.SETGL:
			return [registerOperand('a', 'src', a), plainOperand('bx', 'slot', formatSourceGlobalSlotOperand(source, bx, false))];
		case OpCode.GETI:
			return [registerOperand('a', 'dst', a), registerOperand('b', 'table', b), plainOperand('c', 'index', c.toString())];
		case OpCode.SETI:
			return [registerOperand('a', 'table', a), plainOperand('b', 'index', b.toString()), sourceRkOperand('c', 'value', source, c, decoded.rkBitsC, options)];
		case OpCode.GETFIELD:
			return [registerOperand('a', 'dst', a), registerOperand('b', 'table', b), plainOperand('c', 'field', formatSourceConst(source, c, options))];
		case OpCode.SETFIELD:
			return [registerOperand('a', 'table', a), plainOperand('b', 'field', formatSourceConst(source, b, options)), sourceRkOperand('c', 'value', source, c, decoded.rkBitsC, options)];
		case OpCode.SELF:
			return [registerOperand('a', 'fn_dst', a), plainOperand('a', 'self_dst', `r${a + 1}`), registerOperand('b', 'table', b), plainOperand('c', 'field', formatSourceConst(source, c, options))];
		case OpCode.GETT:
			return [registerOperand('a', 'dst', a), registerOperand('b', 'table', b), sourceRkOperand('c', 'key', source, c, decoded.rkBitsC, options)];
		case OpCode.SETT:
			return [registerOperand('a', 'table', a), sourceRkOperand('b', 'key', source, b, decoded.rkBitsB, options), sourceRkOperand('c', 'value', source, c, decoded.rkBitsC, options)];
		case OpCode.NEWT:
			return [registerOperand('a', 'dst', a), plainOperand('b', 'array', b.toString()), plainOperand('c', 'hash', c.toString())];
		case OpCode.ADD:
		case OpCode.SUB:
		case OpCode.MUL:
		case OpCode.DIV:
		case OpCode.MOD:
		case OpCode.FLOORDIV:
		case OpCode.POW:
		case OpCode.BAND:
		case OpCode.BOR:
		case OpCode.BXOR:
		case OpCode.SHL:
		case OpCode.SHR:
		case OpCode.CONCAT:
			return [registerOperand('a', 'dst', a), sourceRkOperand('b', 'left', source, b, decoded.rkBitsB, options), sourceRkOperand('c', 'right', source, c, decoded.rkBitsC, options)];
		case OpCode.CONCATN:
			return [registerOperand('a', 'dst', a), registerOperand('b', 'base', b), plainOperand('c', 'count', c.toString())];
		case OpCode.UNM:
		case OpCode.NOT:
		case OpCode.LEN:
		case OpCode.BNOT:
			return [registerOperand('a', 'dst', a), registerOperand('b', 'value', b)];
		case OpCode.EQ:
		case OpCode.LT:
		case OpCode.LE:
			return [plainOperand('a', 'expect', formatBool(a)), sourceRkOperand('b', 'left', source, b, decoded.rkBitsB, options), sourceRkOperand('c', 'right', source, c, decoded.rkBitsC, options)];
		case OpCode.MFC0:
			return [registerOperand('a', 'dst', a), plainOperand('b', 'cp0', `c${b}`)];
		case OpCode.MTC0:
			return [registerOperand('a', 'src', a), plainOperand('b', 'cp0', `c${b}`)];
		case OpCode.RFE:
			return [];
		case OpCode.JMP:
			return [plainOperand('sbx', 'jump', formatJump(pc, sbx, pcWidth, options))];
		case OpCode.JMPIF:
		case OpCode.JMPIFNOT:
			return [registerOperand('a', 'cond', a), plainOperand('sbx', 'jump', formatJump(pc, sbx, pcWidth, options))];
		case OpCode.CLOSURE:
			return [registerOperand('a', 'dst', a), plainOperand('bx', 'function', formatSourceFunctionOperand(source, bx))];
		case OpCode.GETUP:
			return [registerOperand('a', 'dst', a), plainOperand('b', 'upvalue', `u${b}`)];
		case OpCode.SETUP:
			return [registerOperand('a', 'src', a), plainOperand('b', 'upvalue', `u${b}`)];
		case OpCode.VARARG:
			return [registerOperand('a', 'dst', a), plainOperand('b', 'count', formatCount(b))];
		case OpCode.CALL:
			return [registerOperand('a', 'callee', a), plainOperand('b', 'args', formatCallArgCount(b)), plainOperand('c', 'returns', formatCount(c))];
		case OpCode.RET:
			return [registerOperand('a', 'base', a), plainOperand('b', 'count', formatCount(b))];
		case OpCode.LOAD_MEM_D:
			return [registerOperand('a', 'dst', a), registerOperand('b', 'base', b), plainOperand('c', 'kind', c.toString()), plainOperand('disp', 'disp', `${decoded.disp << 2}`)];
		case OpCode.STORE_MEM_D:
			return [registerOperand('a', 'src', a), registerOperand('b', 'base', b), plainOperand('c', 'kind', c.toString()), plainOperand('disp', 'disp', `${decoded.disp << 2}`)];
		case OpCode.STORE_MEM_WORDS_D:
			return [registerOperand('a', 'src_base', a), registerOperand('b', 'base', b), plainOperand('c', 'count', c.toString()), plainOperand('disp', 'disp', `${decoded.disp << 2}`)];
		case OpCode.LOAD_MEM:
			return [registerOperand('a', 'dst', a), sourceRkOperand('b', 'addr', source, b, decoded.rkBitsB, options)];
		case OpCode.STORE_MEM:
			return [registerOperand('a', 'src', a), sourceRkOperand('b', 'addr', source, b, decoded.rkBitsB, options)];
		case OpCode.STORE_MEM_WORDS:
			return [registerOperand('a', 'src_base', a), sourceRkOperand('b', 'addr', source, b, decoded.rkBitsB, options), plainOperand('c', 'count', c.toString())];
		case OpCode.HALT:
			return [plainOperand('mode', 'mode', b ? 'vblank' : 'irq')];
		case OpCode.WIDE:
			throw new Error(`[Disassembler] Unexpected WIDE opcode at pc ${pc}.`);
		default:
			throw new Error(`[Disassembler] Unknown opcode ${op} at pc ${pc}.`);
	}
};

export const describeBlua32InstructionAtPc = (
	image: Blua32ImageLayout,
	symbols: Blua32SymbolsImage | null,
	pc: number,
	options: DisassemblyOptions = {},
): InstructionDebugInfo => {
	const opts = normalizeOptions({
		pcRadix: 16,
		pcPrefix: '0x',
		...options,
	});
	const code = image.bytes.subarray(
		image.header.textAddress - image.address,
		image.header.textAddress - image.address + image.header.textByteCount,
	);
	const source: Blua32DisassemblySource = { image, symbols, code };
	const lastPc = image.header.textAddress + image.header.textByteCount - INSTRUCTION_BYTES;
	const pcWidth = Math.max(1, lastPc.toString(opts.pcRadix).length);
	const decoded = decodeInstructionAtPc(code, image.header.textAddress, pc);
	return {
		pc: decoded.pc,
		pcText: formatPc(decoded.pc, pcWidth, opts),
		op: decoded.op,
		opName: getOpName(decoded.op),
		instructionText: formatInstruction(decoded, source, opts, pcWidth),
		operands: buildInstructionOperands(decoded, source, opts, pcWidth),
		sourceRange: sourceRangeAtPc(source, decoded.pc),
	};
};

const formatInstruction = (
	decoded: DecodedInstruction,
	source: Blua32DisassemblySource,
	options: DisassemblyOptions,
	pcWidth: number,
): string => {
	const { op, a, b, c, bx, sbx, pc } = decoded;
	switch (op) {
		case OpCode.MOV:
			return `MOV r${a}, r${b}`;
		case OpCode.KNIL:
			return `KNIL r${a}`;
		case OpCode.KFALSE:
			return `KFALSE r${a}`;
		case OpCode.KTRUE:
			return `KTRUE r${a}`;
		case OpCode.K0:
			return `K0 r${a}`;
		case OpCode.K1:
			return `K1 r${a}`;
		case OpCode.KM1:
			return `KM1 r${a}`;
		case OpCode.KSMI:
			return `KSMI r${a}, ${formatNumber(sbx)}`;
		case OpCode.LOADK:
			return `LOADK r${a}, ${formatSourceConst(source, bx, options)}`;
		case OpCode.LOADKR:
			return `LOADKR r${a}, r${b}`;
		case OpCode.LOADNIL:
			return `LOADNIL r${a}, ${b}`;
		case OpCode.GETSYS:
			return `GETSYS r${a}, ${formatSourceGlobalSlotOperand(source, bx, true)}`;
		case OpCode.SETSYS:
			return `SETSYS r${a}, ${formatSourceGlobalSlotOperand(source, bx, true)}`;
		case OpCode.GETGL:
			return `GETGL r${a}, ${formatSourceGlobalSlotOperand(source, bx, false)}`;
		case OpCode.SETGL:
			return `SETGL r${a}, ${formatSourceGlobalSlotOperand(source, bx, false)}`;
		case OpCode.GETI:
			return `GETI r${a}, r${b}, ${c}`;
		case OpCode.SETI:
			return `SETI r${a}, ${b}, ${formatSourceRK(source, c, decoded.rkBitsC, options)}`;
		case OpCode.GETFIELD:
			return `GETFIELD r${a}, r${b}, ${formatSourceConst(source, c, options)}`;
		case OpCode.SETFIELD:
			return `SETFIELD r${a}, ${formatSourceConst(source, b, options)}, ${formatSourceRK(source, c, decoded.rkBitsC, options)}`;
		case OpCode.SELF:
			return `SELF r${a}, r${a + 1}, r${b}, ${formatSourceConst(source, c, options)}`;
		case OpCode.GETT:
			return `GETT r${a}, r${b}, ${formatSourceRK(source, c, decoded.rkBitsC, options)}`;
		case OpCode.SETT:
			return `SETT r${a}, ${formatSourceRK(source, b, decoded.rkBitsB, options)}, ${formatSourceRK(source, c, decoded.rkBitsC, options)}`;
		case OpCode.NEWT:
			return `NEWT r${a}, ${b}, ${c}`;
		case OpCode.ADD:
			return `ADD r${a}, ${formatSourceRK(source, b, decoded.rkBitsB, options)}, ${formatSourceRK(source, c, decoded.rkBitsC, options)}`;
		case OpCode.SUB:
			return `SUB r${a}, ${formatSourceRK(source, b, decoded.rkBitsB, options)}, ${formatSourceRK(source, c, decoded.rkBitsC, options)}`;
		case OpCode.MUL:
			return `MUL r${a}, ${formatSourceRK(source, b, decoded.rkBitsB, options)}, ${formatSourceRK(source, c, decoded.rkBitsC, options)}`;
		case OpCode.DIV:
			return `DIV r${a}, ${formatSourceRK(source, b, decoded.rkBitsB, options)}, ${formatSourceRK(source, c, decoded.rkBitsC, options)}`;
		case OpCode.MOD:
			return `MOD r${a}, ${formatSourceRK(source, b, decoded.rkBitsB, options)}, ${formatSourceRK(source, c, decoded.rkBitsC, options)}`;
		case OpCode.FLOORDIV:
			return `FLOORDIV r${a}, ${formatSourceRK(source, b, decoded.rkBitsB, options)}, ${formatSourceRK(source, c, decoded.rkBitsC, options)}`;
		case OpCode.POW:
			return `POW r${a}, ${formatSourceRK(source, b, decoded.rkBitsB, options)}, ${formatSourceRK(source, c, decoded.rkBitsC, options)}`;
		case OpCode.BAND:
			return `BAND r${a}, ${formatSourceRK(source, b, decoded.rkBitsB, options)}, ${formatSourceRK(source, c, decoded.rkBitsC, options)}`;
		case OpCode.BOR:
			return `BOR r${a}, ${formatSourceRK(source, b, decoded.rkBitsB, options)}, ${formatSourceRK(source, c, decoded.rkBitsC, options)}`;
		case OpCode.BXOR:
			return `BXOR r${a}, ${formatSourceRK(source, b, decoded.rkBitsB, options)}, ${formatSourceRK(source, c, decoded.rkBitsC, options)}`;
		case OpCode.SHL:
			return `SHL r${a}, ${formatSourceRK(source, b, decoded.rkBitsB, options)}, ${formatSourceRK(source, c, decoded.rkBitsC, options)}`;
		case OpCode.SHR:
			return `SHR r${a}, ${formatSourceRK(source, b, decoded.rkBitsB, options)}, ${formatSourceRK(source, c, decoded.rkBitsC, options)}`;
		case OpCode.CONCAT:
			return `CONCAT r${a}, ${formatSourceRK(source, b, decoded.rkBitsB, options)}, ${formatSourceRK(source, c, decoded.rkBitsC, options)}`;
		case OpCode.CONCATN:
			return `CONCATN r${a}, r${b}, ${c}`;
		case OpCode.UNM:
			return `UNM r${a}, r${b}`;
		case OpCode.NOT:
			return `NOT r${a}, r${b}`;
		case OpCode.LEN:
			return `LEN r${a}, r${b}`;
		case OpCode.BNOT:
			return `BNOT r${a}, r${b}`;
		case OpCode.EQ:
			return `EQ ${formatBool(a)}, ${formatSourceRK(source, b, decoded.rkBitsB, options)}, ${formatSourceRK(source, c, decoded.rkBitsC, options)}`;
		case OpCode.LT:
			return `LT ${formatBool(a)}, ${formatSourceRK(source, b, decoded.rkBitsB, options)}, ${formatSourceRK(source, c, decoded.rkBitsC, options)}`;
		case OpCode.LE:
			return `LE ${formatBool(a)}, ${formatSourceRK(source, b, decoded.rkBitsB, options)}, ${formatSourceRK(source, c, decoded.rkBitsC, options)}`;
		case OpCode.JMP:
			return `JMP ${formatJump(pc, sbx, pcWidth, options)}`;
		case OpCode.JMPIF:
			return `JMPIF r${a}, ${formatJump(pc, sbx, pcWidth, options)}`;
		case OpCode.JMPIFNOT:
			return `JMPIFNOT r${a}, ${formatJump(pc, sbx, pcWidth, options)}`;
		case OpCode.CLOSURE:
			return `CLOSURE r${a}, ${formatSourceFunctionOperand(source, bx)}`;
		case OpCode.GETUP:
			return `GETUP r${a}, u${b}`;
		case OpCode.SETUP:
			return `SETUP r${a}, u${b}`;
		case OpCode.VARARG:
			return `VARARG r${a}, ${formatCount(b)}`;
		case OpCode.CALL:
			return `CALL r${a}, ${formatCallArgCount(b)}, ${formatCount(c)}`;
		case OpCode.RET:
			return `RET r${a}, ${formatCount(b)}`;
		case OpCode.MFC0:
			return `MFC0 r${a}, c${b}`;
		case OpCode.MTC0:
			return `MTC0 r${a}, c${b}`;
		case OpCode.RFE:
			return 'RFE';
		case OpCode.LOAD_MEM_D:
			return `LOAD_MEM_D r${a}, r${b}, ${c}, ${decoded.disp << 2}`;
		case OpCode.STORE_MEM_D:
			return `STORE_MEM_D r${a}, r${b}, ${c}, ${decoded.disp << 2}`;
		case OpCode.STORE_MEM_WORDS_D:
			return `STORE_MEM_WORDS_D r${a}, r${b}, ${c}, ${decoded.disp << 2}`;
		case OpCode.LOAD_MEM:
			return `LOAD_MEM r${a}, ${formatSourceRK(source, b, decoded.rkBitsB, options)}`;
		case OpCode.STORE_MEM:
			return `STORE_MEM r${a}, ${formatSourceRK(source, b, decoded.rkBitsB, options)}`;
		case OpCode.STORE_MEM_WORDS:
			return `STORE_MEM_WORDS r${a}, ${formatSourceRK(source, b, decoded.rkBitsB, options)}, ${c}`;
		case OpCode.HALT:
			return 'HALT_UNTIL_IRQ';
		case OpCode.WIDE:
			throw new Error(`[Disassembler] Unexpected WIDE opcode at pc ${pc}.`);
		default:
			throw new Error(`[Disassembler] Unknown opcode ${op} at pc ${pc}.`);
	}
};
