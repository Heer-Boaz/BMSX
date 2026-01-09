import { OpCode, Table, isNativeFunction, isNativeObject, type Program, type ProgramMetadata, type SourceRange, type Value } from './cpu';
import { INSTRUCTION_BYTES, readInstructionWord } from './instruction_format';
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
	pcRadix?: 10 | 16;
	pcFormatter?: (pc: number, width: number) => string;
	protoAddressOp?: string;
};

type DecodedInstruction = {
	pc: number;
	op: OpCode;
	a: number;
	b: number;
	c: number;
	bx: number;
	sbx: number;
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
	pcRadix: 10 | 16;
	pcFormatter: ((pc: number, width: number) => string) | null;
	protoAddressOp: string | null;
};

const normalizeOptions = (options: DisassemblyOptions): ResolvedOptions => {
	const formatStyle = options.formatStyle ?? 'default';
	const showPc = options.showPc ?? (formatStyle !== 'assembly');
	const pcRadix = options.pcRadix ?? (formatStyle === 'assembly' ? 16 : 10);
	const pcPrefix = options.pcPrefix ?? (formatStyle === 'assembly' ? '$' : '');
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
		pcRadix,
		pcFormatter: options.pcFormatter ?? null,
		protoAddressOp,
	};
};

const signExtend12 = (value: number): number => (value << 20) >> 20;

const signExtend18 = (value: number): number => (value << 14) >> 14;

const formatHexWord = (word: number, options: ResolvedOptions): string => {
	const hex = word.toString(16);
	const upper = options.formatStyle === 'assembly' ? hex.toUpperCase() : hex;
	const prefix = options.formatStyle === 'assembly' ? options.pcPrefix : '0x';
	return `${prefix}${upper.padStart(6, '0')}`;
};

const SOURCE_COMMENT_MAX_CHARS = 120;

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

const formatRK = (program: Program, raw: number, options: ResolvedOptions): string => {
	const rk = signExtend12(raw);
	if (rk < 0) {
		return formatConst(program, -1 - rk, options);
	}
	return `r${rk}`;
};

const formatSignedOffset = (value: number, width: number, options: ResolvedOptions): string => {
	const sign = value < 0 ? '-' : '+';
	const absValue = Math.abs(value);
	return `${sign}${formatPc(absValue, width, options)}`;
};

const formatJump = (pc: number, sbx: number, pcWidth: number, options: ResolvedOptions): string => {
	const target = pc + 1 + sbx;
	const offset = formatSignedOffset(sbx, pcWidth, options);
	const targetText = formatPc(target, pcWidth, options);
	return `${offset} -> ${targetText}`;
};

const formatPc = (pc: number, width: number, options: ResolvedOptions): string => {
	const formatter = options.pcFormatter;
	if (formatter) {
		return formatter(pc, width);
	}
	let text = pc.toString(options.pcRadix);
	if (options.pcRadix === 16) {
		text = text.toUpperCase();
	}
	return `${options.pcPrefix}${text.padStart(width, '0')}`;
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

const formatSourceComment = (range: SourceRange, options: ResolvedOptions, cache: Map<string, string[]>): string => {
	const lines = getSourceLines(range.path, options, cache);
	const snippet = extractSourceSnippet(range, lines);
	const compact = snippet.replace(/\s+/g, ' ').trim();
	if (compact.length === 0) {
		return '<empty>';
	}
	if (compact.length <= SOURCE_COMMENT_MAX_CHARS) {
		return compact;
	}
	return compact.slice(0, SOURCE_COMMENT_MAX_CHARS - 3) + '...';
};

const decodeInstruction = (code: Uint8Array, pc: number): DecodedInstruction => {
	const word = readInstructionWord(code, pc);
	const op = (word >>> 18) & 0x3f;
	const aLow = (word >>> 12) & 0x3f;
	const bLow = (word >>> 6) & 0x3f;
	const cLow = word & 0x3f;
	if (op === OpCode.WIDE) {
		const wideA = aLow;
		const wideB = bLow;
		const wideC = cLow;
		const nextWord = readInstructionWord(code, pc + 1);
		const nextOp = (nextWord >>> 18) & 0x3f;
		const nextA = (nextWord >>> 12) & 0x3f;
		const nextB = (nextWord >>> 6) & 0x3f;
		const nextC = nextWord & 0x3f;
		const a = (wideA << 6) | nextA;
		const b = (wideB << 6) | nextB;
		const c = (wideC << 6) | nextC;
		const bx = (wideB << 12) | (nextB << 6) | nextC;
		const sbx = signExtend18(bx);
		return {
			pc: pc + 1,
			op: nextOp as OpCode,
			a,
			b,
			c,
			bx,
			sbx,
			rawWords: [word, nextWord],
		};
	}
	const a = aLow;
	const b = bLow;
	const c = cLow;
	const bx = (bLow << 6) | cLow;
	const sbx = signExtend18(bx);
	return {
		pc,
		op: op as OpCode,
		a,
		b,
		c,
		bx,
		sbx,
		rawWords: [word],
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
			return `GETT r${a}, r${b}, ${formatRK(program, c, options)}`;
		case OpCode.SETT:
			return `SETT r${a}, ${formatRK(program, b, options)}, ${formatRK(program, c, options)}`;
		case OpCode.NEWT:
			return `NEWT r${a}, ${b}, ${c}`;
		case OpCode.ADD:
			return `ADD r${a}, ${formatRK(program, b, options)}, ${formatRK(program, c, options)}`;
		case OpCode.SUB:
			return `SUB r${a}, ${formatRK(program, b, options)}, ${formatRK(program, c, options)}`;
		case OpCode.MUL:
			return `MUL r${a}, ${formatRK(program, b, options)}, ${formatRK(program, c, options)}`;
		case OpCode.DIV:
			return `DIV r${a}, ${formatRK(program, b, options)}, ${formatRK(program, c, options)}`;
		case OpCode.MOD:
			return `MOD r${a}, ${formatRK(program, b, options)}, ${formatRK(program, c, options)}`;
		case OpCode.FLOORDIV:
			return `FLOORDIV r${a}, ${formatRK(program, b, options)}, ${formatRK(program, c, options)}`;
		case OpCode.POW:
			return `POW r${a}, ${formatRK(program, b, options)}, ${formatRK(program, c, options)}`;
		case OpCode.BAND:
			return `BAND r${a}, ${formatRK(program, b, options)}, ${formatRK(program, c, options)}`;
		case OpCode.BOR:
			return `BOR r${a}, ${formatRK(program, b, options)}, ${formatRK(program, c, options)}`;
		case OpCode.BXOR:
			return `BXOR r${a}, ${formatRK(program, b, options)}, ${formatRK(program, c, options)}`;
		case OpCode.SHL:
			return `SHL r${a}, ${formatRK(program, b, options)}, ${formatRK(program, c, options)}`;
		case OpCode.SHR:
			return `SHR r${a}, ${formatRK(program, b, options)}, ${formatRK(program, c, options)}`;
		case OpCode.CONCAT:
			return `CONCAT r${a}, ${formatRK(program, b, options)}, ${formatRK(program, c, options)}`;
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
			return `EQ ${formatBool(a)}, ${formatRK(program, b, options)}, ${formatRK(program, c, options)}`;
		case OpCode.LT:
			return `LT ${formatBool(a)}, ${formatRK(program, b, options)}, ${formatRK(program, c, options)}`;
		case OpCode.LE:
			return `LE ${formatBool(a)}, ${formatRK(program, b, options)}, ${formatRK(program, c, options)}`;
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
			return `LOAD_MEM r${a}, r${b}`;
		case OpCode.STORE_MEM:
			return `STORE_MEM r${a}, r${b}`;
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
			const range = metadata.debugRanges[decoded.pc];
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
		pc += decoded.rawWords.length;
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
	const pcWidth = Math.max(1, (end - 1).toString(opts.pcRadix).length);
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
	const instructionCount = program.code.length / INSTRUCTION_BYTES;
	const pcWidth = Math.max(1, (instructionCount - 1).toString(opts.pcRadix).length);
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
