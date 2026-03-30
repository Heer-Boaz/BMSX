import { OpCode, Table, isNativeFunction, isNativeObject, type Program, type ProgramMetadata, type SourceRange, type Value } from './cpu';
import { EXT_A_BITS, EXT_B_BITS, EXT_BX_BITS, EXT_C_BITS, INSTRUCTION_BYTES, MAX_BX_BITS, MAX_OPERAND_BITS, readInstructionWord } from './instruction_format';
import { formatNumber } from './number_format';
import { isStringValue, stringValueToString } from './string_pool';

export type DisassemblyOptions = {
	showPc?: boolean;
	showRaw?: boolean;
	showConsts?: boolean;
	showProtoHeaders?: boolean;
	showSourceComments?: boolean;
	sourceTextForPath?: (path: string) => string;
	formatStyle?: 'default' | 'assembly';
	pcPrefix?: string;
	pcSuffix?: string;
	pcRadix?: 10 | 16;
	pcFormatter?: (pc: number, width: number) => string;
	protoAddressOp?: string;
	pcBias?: number;
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
	rawWords: number[];
};

type ResolvedOptions = {
	showPc: boolean;
	showRaw: boolean;
	showConsts: boolean;
	showProtoHeaders: boolean;
	showSourceComments: boolean;
	sourceTextForPath: ((path: string) => string) | null;
	formatStyle: 'default' | 'assembly';
	pcPrefix: string;
	pcSuffix: string;
	pcRadix: 10 | 16;
	pcFormatter: ((pc: number, width: number) => string) | null;
	protoAddressOp: string | null;
	pcBias: number;
};

type OperandField = 'a' | 'b' | 'c' | 'bx' | 'sbx';

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

const normalizeOptions = (options: DisassemblyOptions): ResolvedOptions => {
	const formatStyle = options.formatStyle ?? 'default';
	const showPc = options.showPc ?? (formatStyle !== 'assembly');
	const pcRadix = options.pcRadix ?? (formatStyle === 'assembly' ? 16 : 10);
	const pcPrefix = options.pcPrefix ?? (formatStyle === 'assembly' ? '' : '');
	const pcSuffix = options.pcSuffix ?? (formatStyle === 'assembly' ? 'h' : '');
	const protoAddressOp = options.protoAddressOp ?? (formatStyle === 'assembly' ? '.ORG' : null);
	return {
		showPc,
		showRaw: options.showRaw === true,
		showConsts: options.showConsts !== false,
		showProtoHeaders: options.showProtoHeaders !== false,
		showSourceComments: options.showSourceComments === true,
		sourceTextForPath: options.sourceTextForPath ?? null,
		formatStyle,
		pcPrefix,
		pcSuffix,
		pcRadix,
		pcFormatter: options.pcFormatter ?? null,
		protoAddressOp,
		pcBias: options.pcBias ?? 0,
	};
};

const signExtend = (value: number, bits: number): number => {
	const shift = 32 - bits;
	return (value << shift) >> shift;
};

const formatHexWord = (word: number, options: ResolvedOptions): string => {
	const hex = word.toString(16);
	const upper = options.formatStyle === 'assembly' ? hex.toUpperCase() : hex;
	const prefix = options.formatStyle === 'assembly' ? options.pcPrefix : '0x';
	const suffix = options.formatStyle === 'assembly' ? options.pcSuffix : '';
	return `${prefix}${upper.padStart(INSTRUCTION_BYTES * 2, '0')}${suffix}`;
};

const SOURCE_COMMENT_MAX_CHARS = 120;

const getOpName = (op: OpCode): string => {
	switch (op) {
		case OpCode.WIDE: return 'WIDE';
		case OpCode.MOV: return 'MOV';
		case OpCode.LOADK: return 'LOADK';
		case OpCode.LOADNIL: return 'LOADNIL';
		case OpCode.LOADBOOL: return 'LOADBOOL';
		case OpCode.GETG: return 'GETG';
		case OpCode.SETG: return 'SETG';
		case OpCode.GETT: return 'GETT';
		case OpCode.SETT: return 'SETT';
		case OpCode.NEWT: return 'NEWT';
		case OpCode.ADD: return 'ADD';
		case OpCode.SUB: return 'SUB';
		case OpCode.MUL: return 'MUL';
		case OpCode.DIV: return 'DIV';
		case OpCode.MOD: return 'MOD';
		case OpCode.FLOORDIV: return 'FLOORDIV';
		case OpCode.POW: return 'POW';
		case OpCode.BAND: return 'BAND';
		case OpCode.BOR: return 'BOR';
		case OpCode.BXOR: return 'BXOR';
		case OpCode.SHL: return 'SHL';
		case OpCode.SHR: return 'SHR';
		case OpCode.CONCAT: return 'CONCAT';
		case OpCode.CONCATN: return 'CONCATN';
		case OpCode.UNM: return 'UNM';
		case OpCode.NOT: return 'NOT';
		case OpCode.LEN: return 'LEN';
		case OpCode.BNOT: return 'BNOT';
		case OpCode.EQ: return 'EQ';
		case OpCode.LT: return 'LT';
		case OpCode.LE: return 'LE';
		case OpCode.TEST: return 'TEST';
		case OpCode.TESTSET: return 'TESTSET';
		case OpCode.JMP: return 'JMP';
		case OpCode.JMPIF: return 'JMPIF';
		case OpCode.JMPIFNOT: return 'JMPIFNOT';
		case OpCode.CLOSURE: return 'CLOSURE';
		case OpCode.GETUP: return 'GETUP';
		case OpCode.SETUP: return 'SETUP';
		case OpCode.VARARG: return 'VARARG';
		case OpCode.CALL: return 'CALL';
		case OpCode.RET: return 'RET';
		case OpCode.LOAD_MEM: return 'LOAD_MEM';
		case OpCode.STORE_MEM: return 'STORE_MEM';
		case OpCode.STORE_MEM_WORDS: return 'STORE_MEM_WORDS';
		default:
			throw new Error(`[Disassembler] Unknown opcode ${op}.`);
	}
};

const formatBool = (value: number): string => (value !== 0 ? 'true' : 'false');

const formatCount = (value: number): string => (value === 0 ? '*' : value.toString());

const formatValue = (value: Value): string => {
	if (value === undefined) {
		throw new Error('[Disassembler] Unexpected undefined value.');
	}
	if (value === null) {
		return 'nil';
	}
	if (typeof value === 'boolean') {
		return value ? 'true' : 'false';
	}
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) {
			return Number.isNaN(value) ? 'nan' : (value < 0 ? '-inf' : 'inf');
		}
		return formatNumber(value);
	}
	if (isStringValue(value)) {
		return JSON.stringify(stringValueToString(value));
	}
	if (value instanceof Table) {
		return 'table';
	}
	if (isNativeFunction(value)) {
		return 'function';
	}
	if (isNativeObject(value)) {
		return 'native';
	}
	return 'function';
};

const formatConst = (program: Program, index: number, options: ResolvedOptions): string => {
	const base = `k${index}`;
	if (!options.showConsts) {
		return base;
	}
	return `${base}(${formatValue(program.constPool[index])})`;
};

const describeRK = (program: Program, raw: number, bits: number, options: ResolvedOptions): { text: string; registerIndex?: number } => {
	const rk = signExtend(raw, bits);
	if (rk < 0) {
		return { text: formatConst(program, -1 - rk, options) };
	}
	return { text: `r${rk}`, registerIndex: rk };
};

const formatRK = (program: Program, raw: number, bits: number, options: ResolvedOptions): string => {
	return describeRK(program, raw, bits, options).text;
};

const formatSignedOffset = (value: number, width: number, options: ResolvedOptions): string => {
	const sign = value < 0 ? '-' : '+';
	const absValue = Math.abs(value);
	return `${sign}${formatPc(absValue, width, options, false)}`;
};

const formatJump = (pc: number, sbx: number, pcWidth: number, options: ResolvedOptions): string => {
	const offset = sbx * INSTRUCTION_BYTES;
	const target = pc + INSTRUCTION_BYTES + offset;
	const offsetText = formatSignedOffset(offset, pcWidth, options);
	const targetText = formatPc(target, pcWidth, options);
	return `${offsetText} -> ${targetText}`;
};

const formatPc = (pc: number, width: number, options: ResolvedOptions, applyBias = true): string => {
	const formatter = options.pcFormatter;
	if (formatter) {
		const value = applyBias ? pc + options.pcBias : pc;
		return formatter(value, width);
	}
	const value = applyBias ? pc + options.pcBias : pc;
	let text = value.toString(options.pcRadix);
	if (options.pcRadix === 16) {
		text = text.toUpperCase();
	}
	return `${options.pcPrefix}${text.padStart(width, '0')}${options.pcSuffix}`;
};

const getSourceLines = (path: string, options: ResolvedOptions, cache: Map<string, string[]>): string[] => {
	const cached = cache.get(path);
	if (cached) {
		return cached;
	}
	const loader = options.sourceTextForPath;
	if (!loader) {
		throw new Error('[Disassembler] sourceTextForPath is required when showSourceComments is enabled.');
	}
	const text = loader(path);
	if (typeof text !== 'string') {
		throw new Error(`[Disassembler] Source text lookup returned invalid data for '${path}'.`);
	}
	const lines = text.split(/\r?\n/);
	cache.set(path, lines);
	return lines;
};

const extractSourceSnippet = (range: SourceRange, lines: readonly string[]): string => {
	const startLineIndex = range.start.line - 1;
	const endLineIndex = range.end.line - 1;
	if (startLineIndex < 0 || endLineIndex < 0 || startLineIndex >= lines.length || endLineIndex >= lines.length) {
		throw new Error(`[Disassembler] Source range line out of bounds for '${range.path}'.`);
	}
	if (endLineIndex < startLineIndex) {
		throw new Error(`[Disassembler] Source range ends before it starts for '${range.path}'.`);
	}
	const parts: string[] = [];
	if (startLineIndex === endLineIndex) {
		parts.push(lines[startLineIndex]);
	} else {
		for (let index = startLineIndex; index <= endLineIndex; index += 1) {
			parts.push(lines[index]);
		}
	}
	return parts.join(' ');
};

export const formatSourceSnippet = (range: SourceRange, sourceText: string, maxChars = SOURCE_COMMENT_MAX_CHARS): string => {
	const snippet = extractSourceSnippet(range, sourceText.split(/\r?\n/));
	const compact = snippet.replace(/\s+/g, ' ').trim();
	if (compact.length === 0) {
		return '<empty>';
	}
	if (compact.length <= maxChars) {
		return compact;
	}
	return compact.slice(0, maxChars - 3) + '...';
};

const formatSourceComment = (range: SourceRange, options: ResolvedOptions, cache: Map<string, string[]>): string => {
	const lines = getSourceLines(range.path, options, cache);
	return formatSourceSnippet(range, lines.join('\n'));
};

const decodeInstruction = (code: Uint8Array, pc: number): DecodedInstruction => {
	const wordIndex = pc / INSTRUCTION_BYTES;
	const word = readInstructionWord(code, wordIndex);
	const ext = word >>> 24;
	const op = (word >>> 18) & 0x3f;
	const aLow = (word >>> 12) & 0x3f;
	const bLow = (word >>> 6) & 0x3f;
	const cLow = word & 0x3f;
	if (op === OpCode.WIDE) {
		const wideA = aLow;
		const wideB = bLow;
		const wideC = cLow;
		const hasWide = true;
		const nextWord = readInstructionWord(code, wordIndex + 1);
		const nextExt = nextWord >>> 24;
		const nextOp = (nextWord >>> 18) & 0x3f;
		const nextA = (nextWord >>> 12) & 0x3f;
		const nextB = (nextWord >>> 6) & 0x3f;
		const nextC = nextWord & 0x3f;
		const usesBx = nextOp === OpCode.LOADK
			|| nextOp === OpCode.GETG
			|| nextOp === OpCode.SETG
			|| nextOp === OpCode.CLOSURE
			|| nextOp === OpCode.JMP
			|| nextOp === OpCode.JMPIF
			|| nextOp === OpCode.JMPIFNOT;
		const extA = usesBx ? 0 : (nextExt >>> 6) & 0x3;
		const extB = usesBx ? 0 : (nextExt >>> 3) & 0x7;
		const extC = usesBx ? 0 : (nextExt & 0x7);
		const aShift = MAX_OPERAND_BITS + (usesBx ? 0 : EXT_A_BITS);
		const a = (wideA << aShift) | (extA << MAX_OPERAND_BITS) | nextA;
		const b = (wideB << (MAX_OPERAND_BITS + EXT_B_BITS)) | (extB << MAX_OPERAND_BITS) | nextB;
		const c = (wideC << (MAX_OPERAND_BITS + EXT_C_BITS)) | (extC << MAX_OPERAND_BITS) | nextC;
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
			rawWords: [word, nextWord],
		};
	}
	const usesBx = op === OpCode.LOADK
		|| op === OpCode.GETG
		|| op === OpCode.SETG
		|| op === OpCode.CLOSURE
		|| op === OpCode.JMP
		|| op === OpCode.JMPIF
		|| op === OpCode.JMPIFNOT;
	const extA = usesBx ? 0 : (ext >>> 6) & 0x3;
	const extB = usesBx ? 0 : (ext >>> 3) & 0x7;
	const extC = usesBx ? 0 : (ext & 0x7);
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
		rawWords: [word],
	};
};

const decodeInstructionAtPc = (code: Uint8Array, pc: number): DecodedInstruction => {
	if ((pc % INSTRUCTION_BYTES) !== 0) {
		throw new Error(`[Disassembler] Instruction pc ${pc} is not aligned.`);
	}
	if (pc < 0 || pc >= code.length) {
		throw new Error(`[Disassembler] Instruction pc ${pc} is out of bounds.`);
	}
	const wordIndex = pc / INSTRUCTION_BYTES;
	const word = readInstructionWord(code, wordIndex);
	const op = (word >>> 18) & 0x3f;
	if (op === OpCode.WIDE) {
		return decodeInstruction(code, pc);
	}
	if (wordIndex > 0) {
		const previous = readInstructionWord(code, wordIndex - 1);
		const previousOp = (previous >>> 18) & 0x3f;
		if (previousOp === OpCode.WIDE) {
			return decodeInstruction(code, pc - INSTRUCTION_BYTES);
		}
	}
	return decodeInstruction(code, pc);
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

const rkOperand = (
	field: 'b' | 'c',
	label: string,
	program: Program,
	raw: number,
	bits: number,
	options: ResolvedOptions,
): InstructionOperandDebugInfo => {
	const rk = describeRK(program, raw, bits, options);
	return {
		field,
		label,
		text: rk.text,
		registerIndex: rk.registerIndex,
	};
};

const formatProtoOperand = (metadata: ProgramMetadata | null, bx: number): string => {
	if (!metadata) {
		return `p${bx}`;
	}
	const protoId = metadata.protoIds[bx];
	if (protoId === undefined) {
		throw new Error(`[Disassembler] Missing proto id for index ${bx}.`);
	}
	return `p${bx} (${protoId})`;
};

const buildInstructionOperands = (
	decoded: DecodedInstruction,
	program: Program,
	metadata: ProgramMetadata | null,
	options: ResolvedOptions,
	pcWidth: number,
): InstructionOperandDebugInfo[] => {
	const { op, a, b, c, bx, sbx, pc } = decoded;
	switch (op) {
		case OpCode.MOV:
			return [registerOperand('a', 'dst', a), registerOperand('b', 'src', b)];
		case OpCode.LOADK:
			return [registerOperand('a', 'dst', a), plainOperand('bx', 'const', formatConst(program, bx, options))];
		case OpCode.LOADNIL:
			return [registerOperand('a', 'base', a), plainOperand('b', 'count', b.toString())];
		case OpCode.LOADBOOL:
			return [registerOperand('a', 'dst', a), plainOperand('b', 'value', formatBool(b)), plainOperand('c', 'skip-next', formatBool(c))];
		case OpCode.GETG:
			return [registerOperand('a', 'dst', a), plainOperand('bx', 'global', formatConst(program, bx, options))];
		case OpCode.SETG:
			return [registerOperand('a', 'src', a), plainOperand('bx', 'global', formatConst(program, bx, options))];
		case OpCode.GETT:
			return [registerOperand('a', 'dst', a), registerOperand('b', 'table', b), rkOperand('c', 'key', program, c, decoded.rkBitsC, options)];
		case OpCode.SETT:
			return [registerOperand('a', 'table', a), rkOperand('b', 'key', program, b, decoded.rkBitsB, options), rkOperand('c', 'value', program, c, decoded.rkBitsC, options)];
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
			return [registerOperand('a', 'dst', a), rkOperand('b', 'left', program, b, decoded.rkBitsB, options), rkOperand('c', 'right', program, c, decoded.rkBitsC, options)];
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
			return [plainOperand('a', 'expect', formatBool(a)), rkOperand('b', 'left', program, b, decoded.rkBitsB, options), rkOperand('c', 'right', program, c, decoded.rkBitsC, options)];
		case OpCode.TEST:
			return [registerOperand('a', 'value', a), plainOperand('c', 'expect', formatBool(c))];
		case OpCode.TESTSET:
			return [registerOperand('a', 'dst', a), registerOperand('b', 'value', b), plainOperand('c', 'expect', formatBool(c))];
		case OpCode.JMP:
			return [plainOperand('sbx', 'jump', formatJump(pc, sbx, pcWidth, options))];
		case OpCode.JMPIF:
		case OpCode.JMPIFNOT:
			return [registerOperand('a', 'cond', a), plainOperand('sbx', 'jump', formatJump(pc, sbx, pcWidth, options))];
		case OpCode.CLOSURE:
			return [registerOperand('a', 'dst', a), plainOperand('bx', 'proto', formatProtoOperand(metadata, bx))];
		case OpCode.GETUP:
			return [registerOperand('a', 'dst', a), plainOperand('b', 'upvalue', `u${b}`)];
		case OpCode.SETUP:
			return [registerOperand('a', 'src', a), plainOperand('b', 'upvalue', `u${b}`)];
		case OpCode.VARARG:
			return [registerOperand('a', 'dst', a), plainOperand('b', 'count', formatCount(b))];
		case OpCode.CALL:
			return [registerOperand('a', 'callee', a), plainOperand('b', 'args', formatCount(b)), plainOperand('c', 'returns', formatCount(c))];
		case OpCode.RET:
			return [registerOperand('a', 'base', a), plainOperand('b', 'count', formatCount(b))];
		case OpCode.LOAD_MEM:
			return [registerOperand('a', 'dst', a), rkOperand('b', 'addr', program, b, decoded.rkBitsB, options)];
		case OpCode.STORE_MEM:
			return [registerOperand('a', 'src', a), rkOperand('b', 'addr', program, b, decoded.rkBitsB, options)];
		case OpCode.STORE_MEM_WORDS:
			return [registerOperand('a', 'src_base', a), rkOperand('b', 'addr', program, b, decoded.rkBitsB, options), plainOperand('c', 'count', c.toString())];
		case OpCode.WIDE:
			throw new Error(`[Disassembler] Unexpected WIDE opcode at pc ${pc}.`);
		default:
			throw new Error(`[Disassembler] Unknown opcode ${op} at pc ${pc}.`);
	}
};

const getProgramPcWidth = (program: Program, options: ResolvedOptions): number => {
	const lastPc = Math.max(0, program.code.length - INSTRUCTION_BYTES);
	const maxPc = lastPc + options.pcBias;
	return Math.max(1, maxPc.toString(options.pcRadix).length);
};

export const describeInstructionAtPc = (
	program: Program,
	pc: number,
	metadata: ProgramMetadata | null = null,
	options: DisassemblyOptions = {},
): InstructionDebugInfo => {
	const opts = normalizeOptions(options);
	const pcWidth = getProgramPcWidth(program, opts);
	const decoded = decodeInstructionAtPc(program.code, pc);
	const sourceRange = metadata ? metadata.debugRanges[decoded.pc / INSTRUCTION_BYTES] : null;
	return {
		pc: decoded.pc,
		pcText: formatPc(decoded.pc, pcWidth, opts),
		op: decoded.op,
		opName: getOpName(decoded.op),
		instructionText: formatInstruction(decoded, program, metadata, opts, pcWidth),
		operands: buildInstructionOperands(decoded, program, metadata, opts, pcWidth),
		sourceRange,
	};
};

const formatInstruction = (
	decoded: DecodedInstruction,
	program: Program,
	metadata: ProgramMetadata | null,
	options: ResolvedOptions,
	pcWidth: number,
): string => {
	const { op, a, b, c, bx, sbx, pc } = decoded;
	switch (op) {
		case OpCode.MOV:
			return `MOV r${a}, r${b}`;
		case OpCode.LOADK:
			return `LOADK r${a}, ${formatConst(program, bx, options)}`;
		case OpCode.LOADNIL:
			return `LOADNIL r${a}, ${b}`;
		case OpCode.LOADBOOL:
			return `LOADBOOL r${a}, ${formatBool(b)}, ${formatBool(c)}`;
		case OpCode.GETG:
			return `GETG r${a}, ${formatConst(program, bx, options)}`;
		case OpCode.SETG:
			return `SETG r${a}, ${formatConst(program, bx, options)}`;
		case OpCode.GETT:
			return `GETT r${a}, r${b}, ${formatRK(program, c, decoded.rkBitsC, options)}`;
		case OpCode.SETT:
			return `SETT r${a}, ${formatRK(program, b, decoded.rkBitsB, options)}, ${formatRK(program, c, decoded.rkBitsC, options)}`;
		case OpCode.NEWT:
			return `NEWT r${a}, ${b}, ${c}`;
		case OpCode.ADD:
			return `ADD r${a}, ${formatRK(program, b, decoded.rkBitsB, options)}, ${formatRK(program, c, decoded.rkBitsC, options)}`;
		case OpCode.SUB:
			return `SUB r${a}, ${formatRK(program, b, decoded.rkBitsB, options)}, ${formatRK(program, c, decoded.rkBitsC, options)}`;
		case OpCode.MUL:
			return `MUL r${a}, ${formatRK(program, b, decoded.rkBitsB, options)}, ${formatRK(program, c, decoded.rkBitsC, options)}`;
		case OpCode.DIV:
			return `DIV r${a}, ${formatRK(program, b, decoded.rkBitsB, options)}, ${formatRK(program, c, decoded.rkBitsC, options)}`;
		case OpCode.MOD:
			return `MOD r${a}, ${formatRK(program, b, decoded.rkBitsB, options)}, ${formatRK(program, c, decoded.rkBitsC, options)}`;
		case OpCode.FLOORDIV:
			return `FLOORDIV r${a}, ${formatRK(program, b, decoded.rkBitsB, options)}, ${formatRK(program, c, decoded.rkBitsC, options)}`;
		case OpCode.POW:
			return `POW r${a}, ${formatRK(program, b, decoded.rkBitsB, options)}, ${formatRK(program, c, decoded.rkBitsC, options)}`;
		case OpCode.BAND:
			return `BAND r${a}, ${formatRK(program, b, decoded.rkBitsB, options)}, ${formatRK(program, c, decoded.rkBitsC, options)}`;
		case OpCode.BOR:
			return `BOR r${a}, ${formatRK(program, b, decoded.rkBitsB, options)}, ${formatRK(program, c, decoded.rkBitsC, options)}`;
		case OpCode.BXOR:
			return `BXOR r${a}, ${formatRK(program, b, decoded.rkBitsB, options)}, ${formatRK(program, c, decoded.rkBitsC, options)}`;
		case OpCode.SHL:
			return `SHL r${a}, ${formatRK(program, b, decoded.rkBitsB, options)}, ${formatRK(program, c, decoded.rkBitsC, options)}`;
		case OpCode.SHR:
			return `SHR r${a}, ${formatRK(program, b, decoded.rkBitsB, options)}, ${formatRK(program, c, decoded.rkBitsC, options)}`;
		case OpCode.CONCAT:
			return `CONCAT r${a}, ${formatRK(program, b, decoded.rkBitsB, options)}, ${formatRK(program, c, decoded.rkBitsC, options)}`;
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
			return `EQ ${formatBool(a)}, ${formatRK(program, b, decoded.rkBitsB, options)}, ${formatRK(program, c, decoded.rkBitsC, options)}`;
		case OpCode.LT:
			return `LT ${formatBool(a)}, ${formatRK(program, b, decoded.rkBitsB, options)}, ${formatRK(program, c, decoded.rkBitsC, options)}`;
		case OpCode.LE:
			return `LE ${formatBool(a)}, ${formatRK(program, b, decoded.rkBitsB, options)}, ${formatRK(program, c, decoded.rkBitsC, options)}`;
		case OpCode.TEST:
			return `TEST r${a}, ${formatBool(c)}`;
		case OpCode.TESTSET:
			return `TESTSET r${a}, r${b}, ${formatBool(c)}`;
		case OpCode.JMP:
			return `JMP ${formatJump(pc, sbx, pcWidth, options)}`;
		case OpCode.JMPIF:
			return `JMPIF r${a}, ${formatJump(pc, sbx, pcWidth, options)}`;
		case OpCode.JMPIFNOT:
			return `JMPIFNOT r${a}, ${formatJump(pc, sbx, pcWidth, options)}`;
		case OpCode.CLOSURE: {
			if (!metadata) {
				return `CLOSURE r${a}, p${bx}`;
			}
			const protoId = metadata.protoIds[bx];
			if (protoId === undefined) {
				throw new Error(`[Disassembler] Missing proto id for index ${bx}.`);
			}
			return `CLOSURE r${a}, p${bx} (${protoId})`;
		}
		case OpCode.GETUP:
			return `GETUP r${a}, u${b}`;
		case OpCode.SETUP:
			return `SETUP r${a}, u${b}`;
		case OpCode.VARARG:
			return `VARARG r${a}, ${formatCount(b)}`;
		case OpCode.CALL:
			return `CALL r${a}, ${formatCount(b)}, ${formatCount(c)}`;
		case OpCode.RET:
			return `RET r${a}, ${formatCount(b)}`;
		case OpCode.LOAD_MEM:
			return `LOAD_MEM r${a}, ${formatRK(program, b, decoded.rkBitsB, options)}`;
		case OpCode.STORE_MEM:
			return `STORE_MEM r${a}, ${formatRK(program, b, decoded.rkBitsB, options)}`;
		case OpCode.STORE_MEM_WORDS:
			return `STORE_MEM_WORDS r${a}, ${formatRK(program, b, decoded.rkBitsB, options)}, ${c}`;
		case OpCode.WIDE:
			throw new Error(`[Disassembler] Unexpected WIDE opcode at pc ${pc}.`);
		default:
			throw new Error(`[Disassembler] Unknown opcode ${op} at pc ${pc}.`);
	}
};

const disassembleRange = (
	program: Program,
	start: number,
	end: number,
	metadata: ProgramMetadata | null,
	options: ResolvedOptions,
	pcWidth: number,
	lines: string[],
	sourceCache: Map<string, string[]>,
): void => {
	let pc = start;
	let lastRangeKey: string | null = null;
	while (pc < end) {
		const decoded = decodeInstruction(program.code, pc);
		const text = formatInstruction(decoded, program, metadata, options, pcWidth);
		const prefixParts: string[] = [];
		if (options.showPc) {
			prefixParts.push(formatPc(decoded.pc, pcWidth, options) + ':');
		}
		if (options.showRaw) {
			prefixParts.push(decoded.rawWords.map(word => formatHexWord(word, options)).join(' '));
		}
		const prefix = prefixParts.length > 0 ? `${prefixParts.join(' ')} ` : '';
		if (options.showSourceComments) {
			if (!metadata) {
				throw new Error('[Disassembler] Source comments require program metadata.');
			}
			const wordIndex = decoded.pc / INSTRUCTION_BYTES;
			const range = metadata.debugRanges[wordIndex];
			const rangeKey = range ? `${range.path}:${range.start.line}` : '<no source>';
			let comment: string | null = null;
			if (rangeKey !== lastRangeKey) {
				comment = range ? formatSourceComment(range, options, sourceCache) : '<no source>';
				lastRangeKey = rangeKey;
			}
			lines.push(comment ? `${prefix}${text} ; ${comment}` : `${prefix}${text}`);
		} else {
			lines.push(`${prefix}${text}`);
		}
		pc += decoded.rawWords.length * INSTRUCTION_BYTES;
	}
};

export const disassembleProto = (
	program: Program,
	protoIndex: number,
	metadata: ProgramMetadata | null = null,
	options: DisassemblyOptions = {},
): string => {
	const opts = normalizeOptions(options);
	if (opts.showSourceComments) {
		if (!metadata) {
			throw new Error('[Disassembler] Source comments require program metadata.');
		}
		if (!opts.sourceTextForPath) {
			throw new Error('[Disassembler] sourceTextForPath is required when showSourceComments is enabled.');
		}
	}
	const proto = program.protos[protoIndex];
	const start = proto.entryPC;
	const end = start + proto.codeLen;
	const lastPc = Math.max(start, end - INSTRUCTION_BYTES);
	const pcWidth = Math.max(1, lastPc.toString(opts.pcRadix).length);
	const lines: string[] = [];
	const sourceCache = new Map<string, string[]>();
	if (opts.showProtoHeaders) {
		const headerParts = [`proto=${protoIndex}`];
		if (metadata) {
			const protoId = metadata.protoIds[protoIndex];
			if (protoId === undefined) {
				throw new Error(`[Disassembler] Missing proto id for index ${protoIndex}.`);
			}
			headerParts.push(`id=${protoId}`);
		}
		headerParts.push(
			`entry=${proto.entryPC}`,
			`len=${proto.codeLen}`,
			`params=${proto.numParams}`,
			`vararg=${proto.isVararg ? 1 : 0}`,
			`stack=${proto.maxStack}`,
			`upvalues=${proto.upvalueDescs.length}`,
		);
		lines.push(`; ${headerParts.join(' ')}`);
	}
	if (opts.protoAddressOp) {
		lines.push(`${opts.protoAddressOp} ${formatPc(proto.entryPC, pcWidth, opts)}`);
	}
	disassembleRange(program, start, end, metadata, opts, pcWidth, lines, sourceCache);
	return lines.join('\n');
};

export const disassembleProgram = (program: Program, metadata: ProgramMetadata | null = null, options: DisassemblyOptions = {}): string => {
	const opts = normalizeOptions(options);
	if (opts.showSourceComments) {
		if (!metadata) {
			throw new Error('[Disassembler] Source comments require program metadata.');
		}
		if (!opts.sourceTextForPath) {
			throw new Error('[Disassembler] sourceTextForPath is required when showSourceComments is enabled.');
		}
	}
	const lastPc = Math.max(0, program.code.length - INSTRUCTION_BYTES);
	const maxPc = lastPc + opts.pcBias;
	const pcWidth = Math.max(1, maxPc.toString(opts.pcRadix).length);
	const lines: string[] = [];
	const sourceCache = new Map<string, string[]>();
	for (let index = 0; index < program.protos.length; index += 1) {
		const proto = program.protos[index];
		if (opts.showProtoHeaders) {
			const headerParts = [`proto=${index}`];
			if (metadata) {
				const protoId = metadata.protoIds[index];
				if (protoId === undefined) {
					throw new Error(`[Disassembler] Missing proto id for index ${index}.`);
				}
				headerParts.push(`id=${protoId}`);
			}
			headerParts.push(
				`entry=${proto.entryPC}`,
				`len=${proto.codeLen}`,
				`params=${proto.numParams}`,
				`vararg=${proto.isVararg ? 1 : 0}`,
				`stack=${proto.maxStack}`,
				`upvalues=${proto.upvalueDescs.length}`,
			);
			lines.push(`; ${headerParts.join(' ')}`);
		}
		if (opts.protoAddressOp) {
			lines.push(`${opts.protoAddressOp} ${formatPc(proto.entryPC, pcWidth, opts)}`);
		}
		disassembleRange(program, proto.entryPC, proto.entryPC + proto.codeLen, metadata, opts, pcWidth, lines, sourceCache);
		if (index < program.protos.length - 1) {
			lines.push('');
		}
	}
	return lines.join('\n');
};
