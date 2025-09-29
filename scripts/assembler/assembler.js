const fs = require('fs');
const path = require('path');

const DATA_LINE_NUMBER_START = 10000;
const DATA_LINE_NUMBER_INCREMENT = 1;
const DATA_BYTES_PER_LINE_DECIMAL = 32;
const DATA_BYTES_PER_LINE_HEX = 64;
const DATA_BYTES_PER_LINE_BASE64 = 64;
const DEFAULT_DATA_FORMAT = 'dec';
const SUPPORTED_DATA_FORMATS = new Set(['dec', 'hex', 'b64', 'rom']);
const DEFAULT_ROM_MAPPER = 'linear';
const SUPPORTED_ROM_MAPPERS = new Set([
	'linear',
	'konami8k',
	'konami4',
	'konami',
	'ascii8',
	'ascii8k',
	'ascii16',
	'ascii16k',
	'scc',
	'scc+',
	'sccplus',
	'scc512'
]);
const ROM_DEFAULT_FILL_VALUE = 0xFF;
const ROM_DEFAULT_BANK_SIZE = 0x2000; // 8 KB banks for typical MSX MegaROMs
const SEGMENT_START_MARKER = 254;
const SEGMENT_END_MARKER = 255;

function readOptionValue(argv, optionNames) {
	for (let i = 2; i < argv.length; i++) {
		const arg = argv[i];
		for (const name of optionNames) {
			if (arg === name) {
				const next = argv[i + 1];
				if (next && !next.startsWith('-')) {
					return next;
				}
			} else if (arg.startsWith(`${name}=`)) {
				return arg.slice(name.length + 1);
			}
		}
	}
	return null;
}

/**
 * An array of 8-bit register names used in the assembler.
 *
 * @type {string[]}
 * @constant
 */
const eightBitRegisters = ['A', 'B', 'C', 'D', 'E', 'H', 'L', 'I', 'R', 'IXH', 'IXL', 'IYH', 'IYL'];

/**
 * An array of 16-bit register names used in the assembler.
 *
 * @type {string[]}
 * @constant
 */
const sixteenBitRegisters = ['BC', 'DE', 'HL', 'SP', 'IX', 'IY', 'AF'];

/**
 * An array containing all the registers, including both 8-bit and 16-bit registers.
 *
 * @constant {Array} allRegisters
 */
const allRegisters = [...eightBitRegisters, ...sixteenBitRegisters, "AF'"];

const indexRegisterInfo = {
	IXH: { base: 'H', prefix: 0xDD },
	IXL: { base: 'L', prefix: 0xDD },
	IYH: { base: 'H', prefix: 0xFD },
	IYL: { base: 'L', prefix: 0xFD }
};

/**
 * An array of condition codes used in assembly language.
 *
 * The condition codes are:
 * - 'NZ': Not Zero
 * - 'Z': Zero
 * - 'NC': No Carry
 * - 'C': Carry
 *
 * @type {string[]}
 */
const conditionCodes = ['NZ', 'Z', 'NC', 'C', 'PO', 'PE', 'P', 'M'];

/**
 * A mapping of condition codes to their corresponding hexadecimal values.
 *
 * The condition codes are used in assembly language to represent different
 * conditions for branching or other conditional operations.
 *
 * The map includes the following condition codes:
 * - ''  : 0x18 (No condition)
 * - 'NZ': 0x20 (Not Zero)
 * - 'Z' : 0x28 (Zero)
 * - 'NC': 0x30 (Not Carry)
 * - 'C' : 0x38 (Carry)
 *
 * @type {Object.<string, number>}
 */
const conditionCodesMap = {
	'': 0x18,
	'NZ': 0x20,
	'Z': 0x28,
	'NC': 0x30,
	'C': 0x38
};

/**
 * An array of assembler directives.
 *
 * @constant {string[]}
 * @default
 */
const directives = ['EQU', 'ORG', 'END', 'DB', 'DW', 'INCLUDE', 'BYTE', 'WORD', 'DS', '#', 'ASSERT', 'MAP', 'MAPALIGN', 'ENDMAP', 'PAGE', 'DEFPAGE', 'STRUCT', 'ENDS', 'INCBIN', 'DEFB', 'DEFW', 'DEFS'];

/**
 * An array of valid mnemonics for the assembler.
 * These mnemonics represent various assembly instructions.
 *
 * @constant {string[]}
 * @default
 */
const validMnemonic = ['LD', 'INC', 'DEC', 'ADD', 'SUB', 'CP', 'AND', 'OR', 'XOR', 'RLCA', 'RRCA', 'RLA', 'RRA', 'RLC', 'RRC', 'RL', 'RR', 'SLA', 'SRA', 'SRL', 'NOP', 'SCF', 'CCF', 'CPL', 'DAA', 'NEG', 'EI', 'DI', 'HALT', 'RET', 'JP', 'JR', 'CALL', 'SET', 'RES', 'BIT', 'PUSH', 'POP', 'RLD', 'RRD', 'INIR'];

/**
 * Regular expression to match different components in an assembler code.
 *
 * The regex captures the following groups:
 * 1. Labels: Identifiers followed by a colon (e.g., `label:`).
 * 2. Identifiers: Alphanumeric strings starting with a letter or underscore (e.g., `variable`).
 * 3. Literals: Hexadecimal numbers, characters, strings, or decimal numbers (e.g., `$1F`, `#1F`, `'A'`, `"string"`, `123`).
 * 4. Punctuation: Commas, parentheses (e.g., `,`, `(`, `)`).
 * 5. Any other non-whitespace character.
 *
 * @type {RegExp}
 */
const regex = /([A-Za-z_][A-Za-z0-9_\.]*:)|([A-Za-z_][A-Za-z0-9_\.]*)|((?:0x|&H|#|\$)[0-9A-Fa-f]+|[0-9A-Fa-f]+[Hh]|%[01]+|[01]+[Bb]|\d+)|(\".*?\"|'.')|([,\(\)\+\-\*/])|(\S)/g;
// Define ANSI escape codes for colors
const colors = {
	reset: "\x1b[0m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
	white: "\x1b[37m"
};

/**
 * An object representing the symbol table used in the assembler.
 * The symbol table is used to store and retrieve symbols and their corresponding values.
 *
 * @type {Object.<string, any>}
 */
const symbolTable = {};
const persistentSymbols = {};

function splitArguments(text) {
	if (!text) {
		return [];
	}
	const result = [];
	let current = '';
	let inString = false;
	let stringChar = null;
	let escape = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (escape) {
			current += ch;
			escape = false;
			continue;
		}
		if (ch === '\\') {
			current += ch;
			escape = true;
			continue;
		}
		if ((ch === '"' || ch === '\'') && (!inString || ch === stringChar)) {
			inString = !inString;
			stringChar = inString ? ch : null;
			current += ch;
			continue;
		}
		if (ch === ',' && !inString) {
			if (current.trim().length > 0) {
				result.push(current.trim());
			}
			current = '';
			continue;
		}
		current += ch;
	}
	if (current.trim().length > 0) {
		result.push(current.trim());
	}
	return result;
}

function clearAllSymbolTables() {
	for (const key of Object.keys(symbolTable)) {
		delete symbolTable[key];
	}
	for (const key of Object.keys(persistentSymbols)) {
		delete persistentSymbols[key];
	}
}

function resetSymbolTableForAssembly() {
	for (const key of Object.keys(symbolTable)) {
		delete symbolTable[key];
	}
	for (const key of Object.keys(persistentSymbols)) {
		symbolTable[key] = persistentSymbols[key];
	}
}

function setPersistentSymbol(name, value) {
	persistentSymbols[name] = value;
	symbolTable[name] = value;
}
let entryLabel = null;
let entryAddress = null;

/**
 * A mapping of assembly instructions to their corresponding opcodes and operands.
 *
 * The `opcodeMap` object contains key-value pairs where the key is a string representing
 * an assembly instruction and the value is an array representing the opcode and its operands.
 *
 * The operands are represented as strings ('n', 'nn_low', 'nn_high', 'addr_low', 'addr_high', 'e')
 * which are placeholders for actual values that will be substituted during the assembly process.
 * The assembler will replace these placeholders with the correct values based on the instruction.
 * The placeholders correspond to the following types of operands:
 * - 'n': 8-bit immediate value
 * - 'nn': 16-bit immediate value
 * - '(addr)': Memory address (indirect)
 * - '(HL)': Memory address stored in HL register pair
 * - 'nn_low': Low byte of a 16-bit immediate value
 * - 'nn_high': High byte of a 16-bit immediate value
 * - 'addr_low': Low byte of a memory address
 * - 'addr_high': High byte of a memory address
 * - 'E': 8-bit signed offset for relative jumps
 * - 'A': 8-bit accumulator register (A)
 * - 'B': 8-bit B register
 * - 'C': 8-bit C register
 * - 'D': 8-bit D register
 * - 'E': 8-bit E register
 * - 'H': 8-bit H register
 * - 'L': 8-bit L register
 * - 'BC': 16-bit BC register pair
 * - 'DE': 16-bit DE register pair
 * - 'HL': 16-bit HL register pair
 * - 'SP': 16-bit stack pointer register
 * - 'IX': 16-bit IX index register
 * - 'IY': 16-bit IY index register
 *
 * Example:
 * - 'LD A,n': [0x3E, 'n'] - Load immediate value 'n' into register A.
 * - 'JP nn': [0xC3, 'nn_low', 'nn_high'] - Jump to address 'nn'.
 *
 * Categories of instructions included:
 * - Data Transfer Instructions
 * - Arithmetic and Logical Instructions
 * - Bit Operations
 * - Jump and Call Instructions
 * - CPU Control Instructions
 * - Rotate and Shift Instructions
 * - Miscellaneous Instructions
 * - Stack Operations
 * - Input/Output Instructions
 *
 * @type {Object.<string, Array.<number|string>>}
 */
const opcodeMap = {
	'NOP': [0x00],
	'LD BC,nn': [0x01, 'nn_low', 'nn_high'],
	'LD (BC),A': [0x02],
	'INC BC': [0x03],
	'INC B': [0x04],
	'DEC B': [0x05],
	'LD B,n': [0x06, 'n'],
	'RLCA': [0x07],
	'EX AF,AF\'': [0x08],
	'ADD HL,BC': [0x09],
	'LD A,(BC)': [0x0A],
	'DEC BC': [0x0B],
	'INC C': [0x0C],
	'DEC C': [0x0D],
	'LD C,n': [0x0E, 'n'],
	'RRCA': [0x0F],

	'DJNZ e': [0x10, 'e'],
	'LD DE,nn': [0x11, 'nn_low', 'nn_high'],
	'LD (DE),A': [0x12],
	'INC DE': [0x13],
	'INC D': [0x14],
	'DEC D': [0x15],
	'LD D,n': [0x16, 'n'],
	'RLA': [0x17],
	'JR e': [0x18, 'e'],
	'ADD HL,DE': [0x19],
	'LD A,(DE)': [0x1A],
	'DEC DE': [0x1B],
	'INC E': [0x1C],
	'DEC E': [0x1D],
	'LD E,n': [0x1E, 'n'],
	'RRA': [0x1F],

	'JR NZ,e': [0x20, 'e'],
	'LD HL,nn': [0x21, 'nn_low', 'nn_high'],
	'LD (nn),HL': [0x22, 'addr_low', 'addr_high'],
	'INC HL': [0x23],
	'INC H': [0x24],
	'DEC H': [0x25],
	'LD H,n': [0x26, 'n'],
	'DAA': [0x27],
	'JR Z,e': [0x28, 'e'],
	'ADD HL,HL': [0x29],
	'LD HL,(nn)': [0x2A, 'addr_low', 'addr_high'],
	'DEC HL': [0x2B],
	'INC L': [0x2C],
	'DEC L': [0x2D],
	'LD L,n': [0x2E, 'n'],
	'CPL': [0x2F],

	'JR NC,e': [0x30, 'e'],
	'LD SP,nn': [0x31, 'nn_low', 'nn_high'],
	'LD (nn),A': [0x32, 'addr_low', 'addr_high'],
	'INC SP': [0x33],
	'INC (HL)': [0x34],
	'DEC (HL)': [0x35],
	'LD (HL),n': [0x36, 'n'],
	'SCF': [0x37],
	'JR C,e': [0x38, 'e'],
	'ADD HL,SP': [0x39],
	'LD A,(nn)': [0x3A, 'addr_low', 'addr_high'],
	'DEC SP': [0x3B],
	'INC A': [0x3C],
	'DEC A': [0x3D],
	'LD A,n': [0x3E, 'n'],
	'CCF': [0x3F],

	'LD B,B': [0x40],
	'LD B,C': [0x41],
	'LD B,D': [0x42],
	'LD B,E': [0x43],
	'LD B,H': [0x44],
	'LD B,L': [0x45],
	'LD B,(HL)': [0x46],
	'LD B,A': [0x47],
	'LD C,B': [0x48],
	'LD C,C': [0x49],
	'LD C,D': [0x4A],
	'LD C,E': [0x4B],
	'LD C,H': [0x4C],
	'LD C,L': [0x4D],
	'LD C,(HL)': [0x4E],
	'LD C,A': [0x4F],
	'LD D,B': [0x50],
	'LD D,C': [0x51],
	'LD D,D': [0x52],
	'LD D,E': [0x53],
	'LD D,H': [0x54],
	'LD D,L': [0x55],
	'LD D,(HL)': [0x56],
	'LD D,A': [0x57],
	'LD E,B': [0x58],
	'LD E,C': [0x59],
	'LD E,D': [0x5A],
	'LD E,E': [0x5B],
	'LD E,H': [0x5C],
	'LD E,L': [0x5D],
	'LD E,(HL)': [0x5E],
	'LD E,A': [0x5F],
	'LD H,B': [0x60],
	'LD H,C': [0x61],
	'LD H,D': [0x62],
	'LD H,E': [0x63],
	'LD H,H': [0x64],
	'LD H,L': [0x65],
	'LD H,(HL)': [0x66],
	'LD H,A': [0x67],
	'LD L,B': [0x68],
	'LD L,C': [0x69],
	'LD L,D': [0x6A],
	'LD L,E': [0x6B],
	'LD L,H': [0x6C],
	'LD L,L': [0x6D],
	'LD L,(HL)': [0x6E],
	'LD L,A': [0x6F],
	'LD (HL),B': [0x70],
	'LD (HL),C': [0x71],
	'LD (HL),D': [0x72],
	'LD (HL),E': [0x73],
	'LD (HL),H': [0x74],
	'LD (HL),L': [0x75],
	'HALT': [0x76],
	'LD (HL),A': [0x77],
	'LD A,B': [0x78],
	'LD A,C': [0x79],
	'LD A,D': [0x7A],
	'LD A,E': [0x7B],
	'LD A,H': [0x7C],
	'LD A,L': [0x7D],
	'LD A,(HL)': [0x7E],
	'LD A,A': [0x7F],

	'ADD A,B': [0x80],
	'ADD A,C': [0x81],
	'ADD A,D': [0x82],
	'ADD A,E': [0x83],
	'ADD A,H': [0x84],
	'ADD A,L': [0x85],
	'ADD A,(HL)': [0x86],
	'ADD A,A': [0x87],
	'ADC A,B': [0x88],
	'ADC A,C': [0x89],
	'ADC A,D': [0x8A],
	'ADC A,E': [0x8B],
	'ADC A,H': [0x8C],
	'ADC A,L': [0x8D],
	'ADC A,(HL)': [0x8E],
	'ADC A,A': [0x8F],
	'SUB B': [0x90],
	'SUB C': [0x91],
	'SUB D': [0x92],
	'SUB E': [0x93],
	'SUB H': [0x94],
	'SUB L': [0x95],
	'SUB (HL)': [0x96],
	'SUB A': [0x97],
	'SBC A,B': [0x98],
	'SBC A,C': [0x99],
	'SBC A,D': [0x9A],
	'SBC A,E': [0x9B],
	'SBC A,H': [0x9C],
	'SBC A,L': [0x9D],
	'SBC A,(HL)': [0x9E],
	'SBC A,A': [0x9F],
	'AND B': [0xA0],
	'AND C': [0xA1],
	'AND D': [0xA2],
	'AND E': [0xA3],
	'AND H': [0xA4],
	'AND L': [0xA5],
	'AND (HL)': [0xA6],
	'AND A': [0xA7],
	'XOR B': [0xA8],
	'XOR C': [0xA9],
	'XOR D': [0xAA],
	'XOR E': [0xAB],
	'XOR H': [0xAC],
	'XOR L': [0xAD],
	'XOR (HL)': [0xAE],
	'XOR A': [0xAF],
	'OR B': [0xB0],
	'OR C': [0xB1],
	'OR D': [0xB2],
	'OR E': [0xB3],
	'OR H': [0xB4],
	'OR L': [0xB5],
	'OR (HL)': [0xB6],
	'OR A': [0xB7],
	'CP B': [0xB8],
	'CP C': [0xB9],
	'CP D': [0xBA],
	'CP E': [0xBB],
	'CP H': [0xBC],
	'CP L': [0xBD],
	'CP (HL)': [0xBE],
	'CP A': [0xBF],

	'RET NZ': [0xC0],
	'POP BC': [0xC1],
	'JP NZ,nn': [0xC2, 'nn_low', 'nn_high'],
	'JP nn': [0xC3, 'nn_low', 'nn_high'],
	'CALL NZ,nn': [0xC4, 'nn_low', 'nn_high'],
	'PUSH BC': [0xC5],
	'ADD A,n': [0xC6, 'n'],
	'RST 0': [0xC7],
	'RET Z': [0xC8],
	'RET': [0xC9],
	'JP Z,nn': [0xCA, 'nn_low', 'nn_high'],
	// 'Prefix CB': [0xCB], // Handled separately
	'CALL Z,nn': [0xCC, 'nn_low', 'nn_high'],
	'CALL nn': [0xCD, 'nn_low', 'nn_high'],
	'ADC A,n': [0xCE, 'n'],
	'RST 8': [0xCF],

	'RET NC': [0xD0],
	'POP DE': [0xD1],
	'JP NC,nn': [0xD2, 'nn_low', 'nn_high'],
	'OUT (n),A': [0xD3, 'n'],
	'CALL NC,nn': [0xD4, 'nn_low', 'nn_high'],
	'PUSH DE': [0xD5],
	'SUB n': [0xD6, 'n'],
	'RST 10': [0xD7],
	'RET C': [0xD8],
	'EXX': [0xD9],
	'JP C,nn': [0xDA, 'nn_low', 'nn_high'],
	'IN A,(n)': [0xDB, 'n'],
	'CALL C,nn': [0xDC, 'nn_low', 'nn_high'],
	// 'Prefix DD': [0xDD], // Handled separately
	'SBC A,n': [0xDE, 'n'],
	'RST 18': [0xDF],

	'RET PO': [0xE0],
	'POP HL': [0xE1],
	'JP PO,nn': [0xE2, 'nn_low', 'nn_high'],
	'EX (SP),HL': [0xE3],
	'CALL PO,nn': [0xE4, 'nn_low', 'nn_high'],
	'PUSH HL': [0xE5],
	'AND n': [0xE6, 'n'],
	'RST 20': [0xE7],
	'RET PE': [0xE8],
	'JP (HL)': [0xE9],
	'JP PE,nn': [0xEA, 'nn_low', 'nn_high'],
	'EX DE,HL': [0xEB],
	'CALL PE,nn': [0xEC, 'nn_low', 'nn_high'],
	// 'Prefix ED': [0xED], // Handled separately
	'XOR n': [0xEE, 'n'],
	'RST 28': [0xEF],

	'RET P': [0xF0],
	'POP AF': [0xF1],
	'JP P,nn': [0xF2, 'nn_low', 'nn_high'],
	'DI': [0xF3],
	'CALL P,nn': [0xF4, 'nn_low', 'nn_high'],
	'PUSH AF': [0xF5],
	'OR n': [0xF6, 'n'],
	'RST 30': [0xF7],
	'RET M': [0xF8],
	'LD SP,HL': [0xF9],
	'JP M,nn': [0xFA, 'nn_low', 'nn_high'],
	'EI': [0xFB],
	'CALL M,nn': [0xFC, 'nn_low', 'nn_high'],
	// 'Prefix FD': [0xFD], // Handled separately
	'CP n': [0xFE, 'n'],
	'RST 38': [0xFF],

	'RLC A': [0xCB, 0x07],
	'RRC A': [0xCB, 0x0F],
	'RL A': [0xCB, 0x17],
	'RR A': [0xCB, 0x1F],

	'NEG': [0xED, 0x44],

	'SET 0,B': [0xCB, 0xC0],
	'SET 1,B': [0xCB, 0xC8],
	'SET 2,B': [0xCB, 0xD0],
	'SET 3,B': [0xCB, 0xD8],
	'SET 4,B': [0xCB, 0xE0],
	'SET 5,B': [0xCB, 0xE8],
	'SET 6,B': [0xCB, 0xF0],
	'SET 7,B': [0xCB, 0xF8],
	'SET 0,C': [0xCB, 0xC1],
	'SET 1,C': [0xCB, 0xC9],
	'BIT 0,A': [0xCB, 0x47],
	'BIT 1,A': [0xCB, 0x4F],
	'BIT 2,A': [0xCB, 0x57],
	'BIT 3,A': [0xCB, 0x5F],
	'BIT 4,A': [0xCB, 0x67],
	'BIT 5,A': [0xCB, 0x6F],
	'BIT 6,A': [0xCB, 0x77],
	'BIT 7,A': [0xCB, 0x7F],

	'LD A,(addr)': [0x3A, 'addr_low', 'addr_high'],
	'LD (addr),A': [0x32, 'addr_low', 'addr_high'],
	'LD HL,(addr)': [0x2A, 'addr_low', 'addr_high'],
	'LD (addr),HL': [0x22, 'addr_low', 'addr_high'],
	'LD (addr),BC': [0xED, 0x43, 'addr_low', 'addr_high'],
	'LD (addr),DE': [0xED, 0x53, 'addr_low', 'addr_high'],
	'LD (addr),SP': [0xED, 0x73, 'addr_low', 'addr_high'],
	'LD BC,(addr)': [0xED, 0x4B, 'addr_low', 'addr_high'],
	'LD DE,(addr)': [0xED, 0x5B, 'addr_low', 'addr_high'],
	'LD SP,(addr)': [0xED, 0x7B, 'addr_low', 'addr_high'],

	'INC IX': [0xDD, 0x23],
	'DEC IX': [0xDD, 0x2B],
	'INC IY': [0xFD, 0x23],
	'DEC IY': [0xFD, 0x2B],
};

Object.assign(opcodeMap, {
	'LD IX,nn': [0xDD, 0x21, 'nn_low', 'nn_high'],
	'LD IY,nn': [0xFD, 0x21, 'nn_low', 'nn_high'],
	'LD (addr),IX': [0xDD, 0x22, 'addr_low', 'addr_high'],
	'LD (addr),IY': [0xFD, 0x22, 'addr_low', 'addr_high'],
	'LD IX,(addr)': [0xDD, 0x2A, 'addr_low', 'addr_high'],
	'LD IY,(addr)': [0xFD, 0x2A, 'addr_low', 'addr_high'],
	'PUSH IX': [0xDD, 0xE5],
	'POP IX': [0xDD, 0xE1],
	'PUSH IY': [0xFD, 0xE5],
	'POP IY': [0xFD, 0xE1],
	'EX (SP),IX': [0xDD, 0xE3],
	'EX (SP),IY': [0xFD, 0xE3],
	'LD SP,IX': [0xDD, 0xF9],
	'LD SP,IY': [0xFD, 0xF9],
	'JP (IX)': [0xDD, 0xE9],
	'JP (IY)': [0xFD, 0xE9],
});

Object.assign(opcodeMap, {
	'ADD IX,BC': [0xDD, 0x09],
	'ADD IX,DE': [0xDD, 0x19],
	'ADD IX,IX': [0xDD, 0x29],
	'ADD IX,SP': [0xDD, 0x39],
	'ADD IY,BC': [0xFD, 0x09],
	'ADD IY,DE': [0xFD, 0x19],
	'ADD IY,IY': [0xFD, 0x29],
	'ADD IY,SP': [0xFD, 0x39],
	'ADC HL,BC': [0xED, 0x4A],
	'ADC HL,DE': [0xED, 0x5A],
	'ADC HL,HL': [0xED, 0x6A],
	'ADC HL,SP': [0xED, 0x7A],
	'SBC HL,BC': [0xED, 0x42],
	'SBC HL,DE': [0xED, 0x52],
	'SBC HL,HL': [0xED, 0x62],
	'SBC HL,SP': [0xED, 0x72],
	'LDI': [0xED, 0xA0],
	'LDIR': [0xED, 0xB0],
	'LDD': [0xED, 0xA8],
	'LDDR': [0xED, 0xB8],
	'CPI': [0xED, 0xA1],
	'CPIR': [0xED, 0xB1],
	'CPD': [0xED, 0xA9],
	'CPDR': [0xED, 0xB9],
	'IN B,(C)': [0xED, 0x40],
	'IN C,(C)': [0xED, 0x48],
	'IN D,(C)': [0xED, 0x50],
	'IN E,(C)': [0xED, 0x58],
	'IN H,(C)': [0xED, 0x60],
	'IN L,(C)': [0xED, 0x68],
	'IN A,(C)': [0xED, 0x78],
	'OUT (C),B': [0xED, 0x41],
	'OUT (C),C': [0xED, 0x49],
	'OUT (C),D': [0xED, 0x51],
	'OUT (C),E': [0xED, 0x59],
	'OUT (C),H': [0xED, 0x61],
	'OUT (C),L': [0xED, 0x69],
	'OUT (C),A': [0xED, 0x79],
	'IM 0': [0xED, 0x46],
	'IM 1': [0xED, 0x56],
	'IM 2': [0xED, 0x5E],
	'RETI': [0xED, 0x4D],
	'RETN': [0xED, 0x45],
	'LD I,A': [0xED, 0x47],
	'LD R,A': [0xED, 0x4F],
	'LD A,I': [0xED, 0x57],
	'LD A,R': [0xED, 0x5F],
	'OTIR': [0xED, 0xB3],
});

Object.assign(opcodeMap, {
	'RLC B': [0xCB, 0x00],
	'RLC C': [0xCB, 0x01],
	'RLC D': [0xCB, 0x02],
	'RLC E': [0xCB, 0x03],
	'RLC H': [0xCB, 0x04],
	'RLC L': [0xCB, 0x05],
	'RLC (HL)': [0xCB, 0x06],
	'RLC A': [0xCB, 0x07],
	'RRC B': [0xCB, 0x08],
	'RRC C': [0xCB, 0x09],
	'RRC D': [0xCB, 0x0A],
	'RRC E': [0xCB, 0x0B],
	'RRC H': [0xCB, 0x0C],
	'RRC L': [0xCB, 0x0D],
	'RRC (HL)': [0xCB, 0x0E],
	'RRC A': [0xCB, 0x0F],
	'RL B': [0xCB, 0x10],
	'RL C': [0xCB, 0x11],
	'RL D': [0xCB, 0x12],
	'RL E': [0xCB, 0x13],
	'RL H': [0xCB, 0x14],
	'RL L': [0xCB, 0x15],
	'RL (HL)': [0xCB, 0x16],
	'RL A': [0xCB, 0x17],
	'RR B': [0xCB, 0x18],
	'RR C': [0xCB, 0x19],
	'RR D': [0xCB, 0x1A],
	'RR E': [0xCB, 0x1B],
	'RR H': [0xCB, 0x1C],
	'RR L': [0xCB, 0x1D],
	'RR (HL)': [0xCB, 0x1E],
	'RR A': [0xCB, 0x1F],
	'SLA B': [0xCB, 0x20],
	'SLA C': [0xCB, 0x21],
	'SLA D': [0xCB, 0x22],
	'SLA E': [0xCB, 0x23],
	'SLA H': [0xCB, 0x24],
	'SLA L': [0xCB, 0x25],
	'SLA (HL)': [0xCB, 0x26],
	'SLA A': [0xCB, 0x27],
	'SRA B': [0xCB, 0x28],
	'SRA C': [0xCB, 0x29],
	'SRA D': [0xCB, 0x2A],
	'SRA E': [0xCB, 0x2B],
	'SRA H': [0xCB, 0x2C],
	'SRA L': [0xCB, 0x2D],
	'SRA (HL)': [0xCB, 0x2E],
	'SRA A': [0xCB, 0x2F],
	'SRL B': [0xCB, 0x38],
	'SRL C': [0xCB, 0x39],
	'SRL D': [0xCB, 0x3A],
	'SRL E': [0xCB, 0x3B],
	'SRL H': [0xCB, 0x3C],
	'SRL L': [0xCB, 0x3D],
	'SRL (HL)': [0xCB, 0x3E],
	'SRL A': [0xCB, 0x3F],
	'RLD': [0xED, 0x6F],
	'RRD': [0xED, 0x67],
	'INIR': [0xED, 0xB2],
});

/**
 * Tokenizes a given line of assembly code by removing comments and splitting it into tokens.
 *
 * @param {string} line - The line of assembly code to tokenize.
 * @returns {string[]} An array of tokens extracted from the line.
 */
function tokenize(line) {
	// Remove comments
	line = line.split(';')[0].trim();
	if (line === '') return [];

	// Regular expressions for different token types
	const tokens = [];
	let match;
	regex.lastIndex = 0;

	while ((match = regex.exec(line)) !== null) {
		tokens.push(match[0]);
	}

	return tokens;
}

/**
 * Parses an array of tokens into an instruction object.
 *
 * @param {string[]} tokens - The array of tokens to parse.
 * @returns {Object} The parsed instruction object.
 * @returns {string|null} return.label - The label of the instruction, if any.
 * @returns {string|null} return.mnemonic - The mnemonic of the instruction, if any.
 * @returns {string[]} return.operands - The operands of the instruction.
 * @returns {string|null} return.directive - The directive of the instruction, if any.
 * @returns {string[]} return.args - The arguments of the instruction.
 */
function parse(tokens) {
	const instruction = {
		label: null,
		mnemonic: null,
		operands: [],
		directive: null,
		directiveOriginal: null,
		args: []
	};

	const canonicalDirective = dir => {
		switch (dir) {
			case 'BYTE':
				return 'DB';
			case 'WORD':
				return 'DW';
			case '#':
				return 'DS';
			case 'DEFB':
				return 'DB';
			case 'DEFW':
				return 'DW';
			case 'DEFS':
				return 'DS';
			case '##':
				return 'MAPALIGN';
			default:
				return dir;
		}
	};

	let index = 0;

	const mnemonics = Object.keys(opcodeMap);

	// Check for a label
	if (tokens[index].endsWith(':')) {
		instruction.label = tokens[index].slice(0, -1);
		index++;
	} else if (tokens[index + 1] && (directives.includes(tokens[index + 1].toUpperCase()) || mnemonics.includes(tokens[index + 1].toUpperCase()))) {
		// Label without colon
		instruction.label = tokens[index];
		index++;
	}

	if (tokens[index] && directives.includes(tokens[index].toUpperCase())) {
		const rawDirective = tokens[index].toUpperCase();
		instruction.directiveOriginal = rawDirective;
		instruction.directive = canonicalDirective(rawDirective);
		index++;
		const result = parseOperands(tokens, index);
		instruction.operands = result.operands;
	} else if (tokens[index]) {
		// It's an instruction
		instruction.mnemonic = tokens[index].toUpperCase();
		index++;
		const result = parseOperands(tokens, index);
		instruction.operands = result.operands;
	}

	return instruction;
}

/**
 * Parses a list of operands from the given tokens starting at the specified index.
 *
 * @param {string[]} tokens - The array of token strings to parse.
 * @param {number} index - The starting index in the tokens array.
 * @returns {{ operands: string[], index: number }} An object containing the parsed operands and the updated index.
 */
function parseOperands(tokens, index) {
	const operands = [];
	while (index < tokens.length) {
		let operandTokens = [];
		while (index < tokens.length && tokens[index] !== ',') {
			operandTokens.push(tokens[index]);
			index++;
		}
		let operand = operandTokens.join('').trim();
		if (operand) {
			operands.push(operand);
		}
		if (index < tokens.length && tokens[index] === ',') {
			index++; // Skip comma
		}
	}
	return { operands, index };
}

/**
 * Handles assembler directives such as EQU and ORG.
 *
 * @param {Object} instruction - The instruction object containing the directive and operands.
 * @param {number} locationCounter - The current location counter.
 * @param {number} lineNumber - The line number of the instruction in the source code.
 * @param {string} line - The full line of the source code.
 * @returns {number} - The updated location counter.
 * @throws {Error} - Throws an error if the directive is missing required values.
 */
function resolveCurrentLocation(state, locationCounter) {
	return state.mapActive ? state.mapAddress : locationCounter;
}

function ensurePageInfo(state, pageNumber) {
	if (!Number.isInteger(pageNumber) || pageNumber < 0) {
		throw new Error(`Invalid page number: ${pageNumber}`);
	}
	if (!state.pageTable.has(pageNumber)) {
		state.pageTable.set(pageNumber, { origin: null, size: null, explicitOrigin: false });
		if (!state.pageOrder.includes(pageNumber)) {
			state.pageOrder.push(pageNumber);
		}
	}
	return state.pageTable.get(pageNumber);
}

function expandPageSpecification(spec, state, locationCounter, lineNumber, line) {
	const trimmed = (spec || '').trim();
	if (!trimmed) {
		throw new Error(`Line ${lineNumber}: Page specification expected\n"${line}"`);
	}
	const parts = trimmed.split('..');
	const currentLocation = resolveCurrentLocation(state, locationCounter);
	const evaluate = expr => evaluateExpression(expr, lineNumber, line, { currentLocation });
	let start;
	let end;
	if (parts.length === 1) {
		start = end = evaluate(parts[0]);
	} else if (parts.length === 2) {
		start = evaluate(parts[0]);
		end = evaluate(parts[1]);
		if (end < start) {
			throw new Error(`Line ${lineNumber}: Invalid page range ${spec}\n"${line}"`);
		}
	} else {
		throw new Error(`Line ${lineNumber}: Invalid page specification ${spec}\n"${line}"`);
	}
	const pages = [];
	for (let value = start; value <= end; value++) {
		const pageNumber = value | 0;
		if (pageNumber < 0 || pageNumber > 255) {
			throw new Error(`Line ${lineNumber}: Page number out of range (${pageNumber})\n"${line}"`);
		}
		pages.push(pageNumber);
	}
	return pages;
}

function handleDirective(instruction, state, locationCounter, lineNumber, line) {
	const { directive, operands } = instruction;
	const currentLocation = resolveCurrentLocation(state, locationCounter);
	switch (directive) {
		case 'EQU': {
			const symbol = instruction.label;
			const valueExpr = operands[0];
			if (symbol && valueExpr) {
				symbolTable[symbol] = evaluateExpression(valueExpr, lineNumber, line, { currentLocation });
			} else {
				throw new Error(`Line ${lineNumber}: Missing value for EQU directive\n"${line}"`);
			}
			break;
		}
		case 'ORG': {
			const valueExpr = operands[0];
			if (!valueExpr) {
				throw new Error(`Line ${lineNumber}: Missing value for ORG directive\n"${line}"`);
			}
			const newAddress = evaluateExpression(valueExpr, lineNumber, line, { currentLocation });
			const normalizedAddress = newAddress | 0;
			state.currentAddressSpace = 'rom';
			state.mapActive = false;
			const pageInfo = ensurePageInfo(state, state.currentPage);
			pageInfo.origin = normalizedAddress;
			pageInfo.explicitOrigin = true;
			state.pageAddress.set(state.currentPage, normalizedAddress);
			state.pendingSegmentReset = true;
			return normalizedAddress;
		}
		case 'MAP': {
			const valueExpr = operands[0];
			if (!valueExpr) {
				throw new Error(`Line ${lineNumber}: Missing value for MAP directive\n"${line}"`);
			}
			state.mapStack.push({
				mapAddress: state.mapAddress,
				mapActive: state.mapActive,
				currentAddressSpace: state.currentAddressSpace
			});
			state.mapAddress = evaluateExpression(valueExpr, lineNumber, line, { currentLocation }) | 0;
			state.mapActive = true;
			state.currentAddressSpace = 'ram';
			break;
		}
		case 'MAPALIGN': {
			const valueExpr = operands[0] || '4';
			const alignment = evaluateExpression(valueExpr, lineNumber, line, { currentLocation });
			if (alignment <= 0) {
				throw new Error(`Line ${lineNumber}: MAPALIGN requires a positive value\n"${line}"`);
			}
			const mask = alignment - 1;
			state.mapAddress = (state.mapAddress + mask) & ~mask;
			break;
		}
		case 'ENDMAP': {
			if (state.mapStack.length === 0) {
				throw new Error(`Line ${lineNumber}: ENDMAP without preceding MAP\n"${line}"`);
			}
			const previous = state.mapStack.pop();
			state.mapAddress = previous.mapAddress | 0;
			state.mapActive = previous.mapActive;
			state.currentAddressSpace = previous.currentAddressSpace;
			if (state.currentAddressSpace === 'rom') {
				state.pendingSegmentReset = true;
			}
			break;
		}
		case 'PAGE': {
			if (!operands || operands.length === 0) {
				throw new Error(`Line ${lineNumber}: PAGE requires at least one operand\n"${line}"`);
			}
			const pageNumber = evaluateExpression(operands[0], lineNumber, line, { currentLocation }) | 0;
			if (pageNumber < 0 || pageNumber > 255) {
				throw new Error(`Line ${lineNumber}: Page number out of range (${pageNumber})\n"${line}"`);
			}
			if (!state.mapActive) {
				state.pageAddress.set(state.currentPage, locationCounter);
			}
			state.pageExplicitlySet = true;
			state.currentPage = pageNumber;
			state.mapActive = false;
			state.currentAddressSpace = 'rom';
			const pageInfo = ensurePageInfo(state, pageNumber);
			let newAddress;
			if (operands.length > 1 && operands[1]) {
				newAddress = evaluateExpression(operands[1], lineNumber, line, { currentLocation }) | 0;
				pageInfo.origin = newAddress;
				pageInfo.explicitOrigin = true;
				state.pageAddress.set(pageNumber, newAddress);
			} else if (state.pageAddress.has(pageNumber)) {
				newAddress = state.pageAddress.get(pageNumber) | 0;
			} else if (pageInfo.origin !== null) {
				newAddress = pageInfo.origin | 0;
				state.pageAddress.set(pageNumber, newAddress);
			} else {
				const fallback = state.defaultPageOrigin | 0;
				pageInfo.origin = fallback;
				state.pageAddress.set(pageNumber, fallback);
				newAddress = fallback;
			}
			state.pendingSegmentReset = true;
			return newAddress;
		}
		case 'DEFPAGE': {
			if (!operands || operands.length === 0) {
				throw new Error(`Line ${lineNumber}: DEFPAGE requires a page specification\n"${line}"`);
			}
			state.pageExplicitlySet = true;
			const pages = expandPageSpecification(operands[0], state, locationCounter, lineNumber, line);
			const originExpr = operands.length > 1 ? operands[1] : null;
			const sizeExpr = operands.length > 2 ? operands[2] : null;
			const originValue = originExpr ? (evaluateExpression(originExpr, lineNumber, line, { currentLocation }) | 0) : null;
			const sizeValue = sizeExpr ? (evaluateExpression(sizeExpr, lineNumber, line, { currentLocation }) | 0) : null;
			for (const page of pages) {
				const info = ensurePageInfo(state, page);
				if (originValue !== null) {
					info.origin = originValue;
					info.explicitOrigin = true;
					if (!state.pageAddress.has(page)) {
						state.pageAddress.set(page, originValue);
					}
				}
				if (sizeValue !== null) {
					info.size = sizeValue;
				}
			}
			break;
		}
		case 'SIZE': {
			if (!operands || operands.length === 0) {
				throw new Error(`Line ${lineNumber}: SIZE requires a value\n"${line}"`);
			}
			const sizeValue = evaluateExpression(operands[0], lineNumber, line, { currentLocation }) | 0;
			const info = ensurePageInfo(state, state.currentPage);
			info.size = sizeValue;
			break;
		}
		case 'END': {
			if (operands && operands.length > 0 && operands[0]) {
				entryLabel = operands[0];
				entryAddress = evaluateExpression(operands[0], lineNumber, line, { currentLocation });
			}
			break;
		}
		case 'STRUCT':
		case 'ENDS':
			// handled elsewhere
			break;
		case 'ASSERT': {
			if (!operands || operands.length === 0) {
				throw new Error(`Line ${lineNumber}: ASSERT requires an expression\n"${line}"`);
			}
			const value = evaluateExpression(operands[0], lineNumber, line, { currentLocation });
			if (!value) {
				throw new Error(`Line ${lineNumber}: ASSERT failed: ${operands[0]}\n"${line}"`);
			}
			break;
		}
		default:
			break;
	}
	return locationCounter;
}

/**
 * Evaluates an assembly-like expression, handling character literals, hexadecimal numbers, registers, and symbols.
 *
 * @param {string} expr - The expression to evaluate.
 * @param {number} lineNumber - The line number where the expression is located, used for error reporting.
 * @param {string} line - The entire line of code containing the expression, used for error reporting.
 * @throws {Error} If the expression is empty, contains invalid character literals, or contains undefined symbols.
 * @returns {number|string} The evaluated result of the expression.
 */
function lexExpression(source) {
	const tokens = [];
	let i = 0;
	const length = source.length;
	const push = (type, value, pos) => tokens.push({ type, value, pos });
	const isIdStart = char => /[A-Za-z_.$]/.test(char);
	const isIdBody = char => /[A-Za-z0-9_.$]/.test(char);
	const twoCharOps = new Set(['<<', '>>', '&&', '||', '==', '!=', '>=', '<=']);

	const readHex = (start) => {
		let j = start;
		while (j < length && /[0-9A-Fa-f]/.test(source[j])) {
			j++;
		}
		if (j === start) {
			throw new Error(`Invalid hexadecimal constant near position ${start}`);
		}
		const value = parseInt(source.slice(start, j), 16);
		return { value, next: j };
	};

	while (i < length) {
		const pos = i;
		const char = source[i];

		if (char === ';') {
			break;
		}

		if (/\s/.test(char)) {
			i++;
			continue;
		}

		if (char === '\'') {
			if (i + 1 >= length) {
				throw new Error('Unterminated character literal');
			}
			let value;
			let consumed = 0;
			if (source[i + 1] === '\\') {
				const escape = source[i + 2];
				const map = { n: '\n', r: '\r', t: '\t', "'": "'", '"': '"', '\\': '\\', '0': '\0' };
				if (escape === 'x' || escape === 'X') {
					const { value: hexValue, next } = readHex(i + 3);
					value = hexValue & 0xFF;
					consumed = next - (i + 1);
				} else {
					const mapped = map[escape];
					if (mapped === undefined) {
						throw new Error(`Unknown escape sequence \\${escape}`);
					}
					value = mapped.charCodeAt(0);
					consumed = 2;
				}
			} else {
				value = source[i + 1].charCodeAt(0);
				consumed = 1;
			}
			const closingIndex = i + consumed + 1;
			if (closingIndex >= length || source[closingIndex] !== '\'') {
				throw new Error('Unterminated character literal');
			}
			push('num', value & 0xFF, pos);
			i = closingIndex + 1;
			continue;
		}

		if (char === '&' && (source[i + 1] === 'H' || source[i + 1] === 'h')) {
			const { value, next } = readHex(i + 2);
			push('num', value, pos);
			i = next;
			continue;
		}

		if (char === '%' && /[01]/.test(source[i + 1] || '')) {
			let j = i + 1;
			while (j < length && /[01]/.test(source[j])) j++;
			const value = parseInt(source.slice(i + 1, j) || '0', 2);
			push('num', value, pos);
			i = j;
			continue;
		}

		if (char === '$' && /[0-9A-Fa-f]/.test(source[i + 1] || '')) {
			const { value, next } = readHex(i + 1);
			push('num', value, pos);
			i = next;
			continue;
		}

		if (char === '#') {
			const { value, next } = readHex(i + 1);
			push('num', value, pos);
			i = next;
			continue;
		}

	if (char === '0' || char === '1') {
		let j = i;
		while (j < length && /[01]/.test(source[j])) j++;
		const suffixChar = source[j] || '';
		const afterSuffix = source[j + 1] || '';
		if ((suffixChar === 'b' || suffixChar === 'B') && afterSuffix.toLowerCase() !== 'h') {
			const digits = source.slice(i, j) || '0';
			push('num', parseInt(digits, 2), pos);
			i = j + 1;
			continue;
		}
	}

	if (/[0-9]/.test(char)) {
			if (char === '0' && (source[i + 1] === 'x' || source[i + 1] === 'X')) {
				const { value, next } = readHex(i + 2);
				push('num', value, pos);
				i = next;
				continue;
			}
			if (char === '0' && (source[i + 1] === 'b' || source[i + 1] === 'B') && /[01]/.test(source[i + 2] || '')) {
				let j = i + 2;
				while (j < length && /[01]/.test(source[j])) j++;
				const value = parseInt(source.slice(i + 2, j) || '0', 2);
				push('num', value, pos);
				i = j;
				continue;
			}
			if (char === '0' && (source[i + 1] === 'o' || source[i + 1] === 'O')) {
				let j = i + 2;
				while (j < length && /[0-7]/.test(source[j])) j++;
				const value = parseInt(source.slice(i + 2, j) || '0', 8);
				push('num', value, pos);
				i = j;
				continue;
			}

			let j = i;
			while (j < length && /[0-9A-Fa-f]/.test(source[j])) j++;
			const digits = source.slice(i, j);
			const suffix = (source[j] || '').toLowerCase();
			let value;
			if (suffix === 'h') {
				value = parseInt(digits, 16);
				j++;
			} else if (suffix === 'b') {
				value = parseInt(digits, 2);
				j++;
			} else if (suffix === 'o' || suffix === 'q') {
				value = parseInt(digits, 8);
				j++;
			} else {
				value = parseInt(digits, 10);
			}
			push('num', value, pos);
			i = j;
			continue;
		}

		if (isIdStart(char)) {
			let j = i + 1;
			while (j < length && isIdBody(source[j])) j++;
			const id = source.slice(i, j);
			push('id', id, pos);
			i = j;
			continue;
		}

		const two = source.slice(i, i + 2);
		if (twoCharOps.has(two)) {
			push('sym', two, pos);
			i += 2;
			continue;
		}

		const singleOps = '()+-*/%&|^~!,.:<>=';
		if (singleOps.includes(char)) {
			push('sym', char, pos);
			i++;
			continue;
		}

		throw new Error(`Unexpected token '${char}' in expression at position ${pos}`);
	}

	tokens.push({ type: 'eof', value: null, pos: source.length });
	return tokens;
}

const expressionPrecedence = {
	'||': 1,
	'&&': 2,
	'|': 3,
	'^': 4,
	'&': 5,
	'==': 6,
	'=': 6,
	'!=': 6,
	'<': 7,
	'>': 7,
	'<=': 7,
	'>=': 7,
	'<<': 8,
	'>>': 8,
	'+': 9,
	'-': 9,
	'*': 10,
	'/': 10,
	'%': 10,
};

function extractStringLiteral(token) {
	if (!token) {
		return null;
	}
	const trimmed = token.trim();
	if (trimmed.length < 2) {
		return null;
	}
	const first = trimmed[0];
	const last = trimmed[trimmed.length - 1];
	if ((first === '"' && last === '"') || (first === '\'' && last === '\'')) {
		return trimmed.slice(1, -1);
	}
	if (first === '<' && last === '>') {
		return trimmed.slice(1, -1);
	}
	return null;
}

const indexRegisterMnemonics = new Set(['LD', 'INC', 'DEC', 'ADD', 'ADC', 'SUB', 'SBC', 'AND', 'OR', 'XOR', 'CP']);

function canonicalizeIndexOperands(mnemonic, operands, lineNumber, line) {
	let requiredPrefix = null;
	const canonical = operands.map(op => {
		const trimmed = op != null ? op.trim() : '';
		const upper = trimmed.toUpperCase();
		if (Object.prototype.hasOwnProperty.call(indexRegisterInfo, upper)) {
			const info = indexRegisterInfo[upper];
			if (requiredPrefix !== null && requiredPrefix !== info.prefix) {
				throw new Error(`Line ${lineNumber}: Cannot mix IX* and IY* register halves in the same instruction\n"${line}"`);
			}
			requiredPrefix = info.prefix;
			return info.base;
		}
		return trimmed;
	});
	if (requiredPrefix !== null && !indexRegisterMnemonics.has(mnemonic)) {
		throw new Error(`Line ${lineNumber}: ${mnemonic} does not support IXH/IXL/IYH/IYL operands\n"${line}"`);
	}
	return { canonical, prefix: requiredPrefix };
}

function getMapperConfiguration(mapper) {
	const normalized = typeof mapper === 'string' ? mapper.toLowerCase() : DEFAULT_ROM_MAPPER;
	switch (normalized) {
		case 'linear':
			return { name: 'linear', type: 'linear', bankSize: null, defaultPageOrigin: 0x0000 };
		case 'ascii16':
		case 'ascii16k':
			return { name: normalized, type: 'banked', bankSize: 0x4000, defaultPageOrigin: 0x4000 };
		case 'konami8k':
		case 'konami4':
		case 'konami':
		case 'ascii8':
		case 'ascii8k':
		case 'scc':
		case 'scc+':
		case 'sccplus':
		case 'scc512':
			return { name: normalized, type: 'banked', bankSize: 0x2000, defaultPageOrigin: 0x4000 };
		default:
			return { name: normalized, type: 'banked', bankSize: 0x2000, defaultPageOrigin: 0x4000 };
	}
}

function parseExpressionTokens(tokens, startIndex = 0, minPrec = 0) {
	function parsePrimary(index) {
		const token = tokens[index];
		if (!token) {
			throw new Error('Unexpected end of expression');
		}
		if (token.type === 'num') {
			return { node: { type: 'num', value: token.value | 0 }, index: index + 1 };
		}
		if (token.type === 'id') {
			return { node: { type: 'sym', name: token.value }, index: index + 1 };
		}
		if (token.type === 'sym' && token.value === '(') {
			const inner = parseExpressionTokens(tokens, index + 1, 0);
			const nextToken = tokens[inner.index];
			if (!nextToken || nextToken.type !== 'sym' || nextToken.value !== ')') {
				throw new Error('Missing closing parenthesis in expression');
			}
			return { node: inner.node, index: inner.index + 1 };
		}
		if (token.type === 'sym' && ['+', '-', '~', '!'].includes(token.value)) {
			const operand = parsePrimary(index + 1);
			return { node: { type: 'un', op: token.value, a: operand.node }, index: operand.index };
		}
		throw new Error(`Unexpected token '${token.value}' in expression`);
	}

	let { node: left, index } = parsePrimary(startIndex);

	while (true) {
		const token = tokens[index];
		if (!token || token.type !== 'sym') {
			break;
		}
		const precedence = expressionPrecedence[token.value];
		if (precedence === undefined || precedence < minPrec) {
			break;
		}
		const op = token.value;
		const nextMinPrec = precedence + 1;
		const rightParsed = parseExpressionTokens(tokens, index + 1, nextMinPrec);
		left = { type: 'bin', op, a: left, b: rightParsed.node };
		index = rightParsed.index;
	}

	return { node: left, index };
}

function evaluateExpressionNode(node, symLookup) {
	switch (node.type) {
		case 'num':
			return node.value | 0;
		case 'sym': {
			const value = symLookup(node.name);
			if (value === undefined || value === null) {
				throw new Error(`Undefined symbol: ${node.name}`);
			}
			return value | 0;
		}
		case 'un': {
			const val = evaluateExpressionNode(node.a, symLookup);
			switch (node.op) {
				case '+':
					return +val;
				case '-':
					return (-val) | 0;
				case '~':
					return (~val) | 0;
				case '!':
					return val ? 0 : 1;
				default:
					throw new Error(`Unsupported unary operator ${node.op}`);
			}
		}
		case 'bin': {
			const left = evaluateExpressionNode(node.a, symLookup);
			const right = evaluateExpressionNode(node.b, symLookup);
			switch (node.op) {
				case '+':
					return (left + right) | 0;
				case '-':
					return (left - right) | 0;
				case '*':
					return (left * right) | 0;
				case '/':
					if (right === 0) {
						throw new Error('Division by zero');
					}
					return Math.trunc(left / right) | 0;
				case '%':
					if (right === 0) {
						throw new Error('Modulo by zero');
					}
					return (left % right) | 0;
				case '<<':
					return (left << (right & 31)) | 0;
				case '>>':
					return (left >> (right & 31)) | 0;
				case '&':
					return (left & right) | 0;
				case '^':
					return (left ^ right) | 0;
				case '|':
					return (left | right) | 0;
				case '&&':
					return (left && right) ? 1 : 0;
				case '||':
					return (left || right) ? 1 : 0;
				case '==':
				case '=':
					return left === right ? 1 : 0;
				case '!=':
					return left !== right ? 1 : 0;
				case '<':
					return left < right ? 1 : 0;
				case '>':
					return left > right ? 1 : 0;
				case '<=':
					return left <= right ? 1 : 0;
				case '>=':
					return left >= right ? 1 : 0;
				default:
					throw new Error(`Unsupported operator ${node.op}`);
			}
		}
		default:
			throw new Error('Invalid expression node');
	}
}

function evaluateExpression(expr, lineNumber, line, options) {
	if (!expr) {
		throw new Error('Empty expression in evaluateExpression');
	}
	const trimmedExpr = expr.trim();
	const simpleHex = trimmedExpr.match(/^([0-9A-Fa-f]+)[Hh]$/);
	if (simpleHex) {
		return parseInt(simpleHex[1], 16) | 0;
	}
	if (/^0x[0-9A-Fa-f]+$/i.test(trimmedExpr)) {
		return parseInt(trimmedExpr.slice(2), 16) | 0;
	}
	if (/^\$[0-9A-Fa-f]+$/i.test(trimmedExpr)) {
		return parseInt(trimmedExpr.slice(1), 16) | 0;
	}
	if (/^&H[0-9A-Fa-f]+$/i.test(trimmedExpr)) {
		return parseInt(trimmedExpr.slice(2), 16) | 0;
	}
	if (/^0b[01]+$/i.test(trimmedExpr)) {
		return parseInt(trimmedExpr.slice(2), 2) | 0;
	}
	if (/^%[01]+$/.test(trimmedExpr)) {
		return parseInt(trimmedExpr.slice(1), 2) | 0;
	}
	if (/^[0-9]+$/.test(trimmedExpr)) {
		return parseInt(trimmedExpr, 10) | 0;
	}

	const tokens = lexExpression(trimmedExpr);
	const { node, index } = parseExpressionTokens(tokens, 0, 0);
	const tail = tokens[index];
	if (!tail || tail.type !== 'eof') {
		throw new Error(`Line ${lineNumber}: Invalid expression: ${expr}\n"${line || ''}"`);
	}
	let lookupFn = null;
	let currentLocation;
	if (typeof options === 'function') {
		lookupFn = options;
	} else if (options && typeof options === 'object') {
		lookupFn = options.lookup || null;
		if (Object.prototype.hasOwnProperty.call(options, 'currentLocation')) {
			currentLocation = options.currentLocation;
		}
	}
	const symbolResolver = name => {
		if (lookupFn) {
			const result = lookupFn(name);
			if (result !== undefined) {
				return result;
			}
		}
		if (name === '$') {
			if (currentLocation !== undefined) {
				return currentLocation;
			}
			if (lookupFn) {
				const value = lookupFn('$');
				if (value !== undefined) {
					return value;
				}
			}
		}
		if (symbolTable[name] !== undefined) {
			return symbolTable[name];
		}
		if (persistentSymbols[name] !== undefined) {
			return persistentSymbols[name];
		}
		throw new Error(`Undefined symbol: ${name}`);
	};
	try {
		return evaluateExpressionNode(node, symbolResolver);
	} catch (error) {
		if (error && error.message) {
			if (/Undefined symbol/.test(error.message)) {
				throw new Error(`Line ${lineNumber}: ${error.message}\n"${line || ''}"`);
			}
			throw new Error(`Line ${lineNumber}: ${error.message}\n"${line || ''}"`);
		}
		throw error;
	}
}

function collectStructs(lines) {
	let index = 0;
	while (index < lines.length) {
		const rawLine = lines[index];
		if (!rawLine || !/^\s*STRUCT\b/i.test(rawLine)) {
			index++;
			continue;
		}

		const parts = rawLine.trim().split(/\s+/);
		const structName = parts[1];
		if (!structName) {
			throw new Error('STRUCT directive requires a name');
		}

		const startIndex = index;
		let offset = 0;
		setPersistentSymbol(structName, 0);
		lines[startIndex] = '';
		index++;

		while (index < lines.length && !/^\s*ENDS\b/i.test(lines[index])) {
			const currentRaw = lines[index] || '';
			const lineNumber = index + 1;
			const lineNoComment = currentRaw.split(';')[0].trim();
			lines[index] = '';
			index++;
			if (!lineNoComment) {
				continue;
			}

			const equMatch = lineNoComment.match(/^([A-Za-z_][A-Za-z0-9_\.]*?)(?::\s*|\s+)EQU\s+(.+)$/i);
			if (equMatch) {
				const field = equMatch[1];
				const expr = equMatch[2].trim();
				const value = evaluateExpression(expr, lineNumber, currentRaw, { currentLocation: offset });
				setPersistentSymbol(`${structName}.${field}`, value | 0);
				continue;
			}

			const fieldMatch = lineNoComment.match(/^([A-Za-z_][A-Za-z0-9_\.]*?)(?::\s*|\s+)(RS|RB|DB|DW|DS|RW|BYTE|WORD)\b\s*(.*)$/i);
			if (!fieldMatch) {
				continue;
			}

			const fieldName = fieldMatch[1];
			const directive = fieldMatch[2].toUpperCase();
			const operandText = (fieldMatch[3] || '').trim();

			setPersistentSymbol(`${structName}.${fieldName}`, offset | 0);

			let sizeIncrement = 0;
			if (directive === 'DB' || directive === 'DW' || directive === 'RW' || directive === 'BYTE' || directive === 'WORD') {
				if (!operandText) {
					sizeIncrement = (directive === 'DB' || directive === 'BYTE') ? 1 : 2;
				} else {
					const elements = splitArguments(operandText);
					if (directive === 'DB' || directive === 'BYTE') {
						sizeIncrement = elements.reduce((total, item) => {
							if (/^".*"$/.test(item)) {
								return total + item.slice(1, -1).length;
							}
							return total + 1;
						}, 0);
					} else {
						sizeIncrement = elements.length * 2;
					}
				}
			} else {
				const amount = operandText ? evaluateExpression(operandText, lineNumber, currentRaw, { currentLocation: offset }) : 0;
				sizeIncrement = amount | 0;
			}

			offset = (offset + sizeIncrement) | 0;
		}

		setPersistentSymbol(`${structName}.SIZE`, offset | 0);
		if (index >= lines.length) {
			throw new Error(`Missing ENDS for STRUCT ${structName}`);
		}
		lines[index] = '';
		index++;
	}
}

function processMacrosAndConditionals(lines, origins) {
	const macros = new Map();
	const outputLines = [];
	const outputOrigins = [];
	const conditionalStack = [];

	const getCurrentActive = () => conditionalStack.length > 0 ? conditionalStack[conditionalStack.length - 1].active : true;

	const lookupForCondition = name => {
		if (symbolTable[name] !== undefined) {
			return symbolTable[name];
		}
		if (persistentSymbols[name] !== undefined) {
			return persistentSymbols[name];
		}
		return 0;
	};

	let i = 0;
	while (i < lines.length) {
		const rawLine = lines[i];
		const origin = origins[i];
		const codePart = rawLine.split(';')[0];
		const trimmed = codePart.trim();
		const upperTrim = trimmed.toUpperCase();
		const currentActive = getCurrentActive();

		// Handle conditional assembly directives
		if (/^IFDEF\b/i.test(trimmed)) {
			const symbol = trimmed.replace(/^IFDEF\b/i, '').trim();
			const parentActive = getCurrentActive();
			const defined = (symbolTable[symbol] !== undefined) || (persistentSymbols[symbol] !== undefined);
			const cond = parentActive && defined;
			conditionalStack.push({ parentActive, active: cond, hasTrue: cond });
			i++;
			continue;
		}
		if (/^IFNDEF\b/i.test(trimmed)) {
			const symbol = trimmed.replace(/^IFNDEF\b/i, '').trim();
			const parentActive = getCurrentActive();
			const defined = (symbolTable[symbol] !== undefined) || (persistentSymbols[symbol] !== undefined);
			const cond = parentActive && !defined;
			conditionalStack.push({ parentActive, active: cond, hasTrue: cond });
			i++;
			continue;
		}
		if (/^IF\b/i.test(trimmed)) {
			const expr = trimmed.replace(/^IF\b/i, '').trim();
			const parentActive = getCurrentActive();
			let cond = false;
			if (parentActive && expr.length > 0) {
				try {
					cond = evaluateExpression(expr, origin.lineNumber, rawLine, lookupForCondition) !== 0;
				} catch (error) {
					cond = false;
				}
			}
			const activeBranch = parentActive && cond;
			conditionalStack.push({ parentActive, active: activeBranch, hasTrue: activeBranch });
			i++;
			continue;
		}
		if (/^ELSEIFDEF\b/i.test(upperTrim)) {
			if (conditionalStack.length === 0) {
				throw new Error('ELSEIFDEF without matching IF');
			}
			const symbol = trimmed.replace(/^ELSEIFDEF\b/i, '').trim();
			const frame = conditionalStack[conditionalStack.length - 1];
			if (!frame.parentActive || frame.hasTrue) {
				frame.active = false;
			} else {
				const defined = (symbolTable[symbol] !== undefined) || (persistentSymbols[symbol] !== undefined);
				frame.active = frame.parentActive && defined;
				if (frame.active) {
					frame.hasTrue = true;
				}
			}
			i++;
			continue;
		}
		if (/^ELSEIFNDEF\b/i.test(upperTrim)) {
			if (conditionalStack.length === 0) {
				throw new Error('ELSEIFNDEF without matching IF');
			}
			const symbol = trimmed.replace(/^ELSEIFNDEF\b/i, '').trim();
			const frame = conditionalStack[conditionalStack.length - 1];
			if (!frame.parentActive || frame.hasTrue) {
				frame.active = false;
			} else {
				const defined = (symbolTable[symbol] !== undefined) || (persistentSymbols[symbol] !== undefined);
				frame.active = frame.parentActive && !defined;
				if (frame.active) {
					frame.hasTrue = true;
				}
			}
			i++;
			continue;
		}
		if (/^ELSEIF\b/i.test(trimmed)) {
			if (conditionalStack.length === 0) {
				throw new Error('ELSEIF without matching IF');
			}
			const expr = trimmed.replace(/^ELSEIF\b/i, '').trim();
			const frame = conditionalStack[conditionalStack.length - 1];
			if (!frame.parentActive || frame.hasTrue) {
				frame.active = false;
			} else {
				let cond = false;
				if (expr.length > 0) {
					try {
						cond = evaluateExpression(expr, origin.lineNumber, rawLine, lookupForCondition) !== 0;
					} catch (error) {
						cond = false;
					}
				}
				frame.active = frame.parentActive && cond;
				if (frame.active) {
					frame.hasTrue = true;
				}
			}
			i++;
			continue;
		}
		if (/^ELSE\b/i.test(trimmed)) {
			if (conditionalStack.length === 0) {
				throw new Error('ELSE without matching IF');
			}
			const frame = conditionalStack[conditionalStack.length - 1];
			if (!frame.parentActive) {
				frame.active = false;
			} else {
				frame.active = frame.parentActive && !frame.hasTrue;
				if (frame.active) {
					frame.hasTrue = true;
				}
			}
			i++;
			continue;
		}
		if (/^ENDIF\b/i.test(trimmed)) {
			if (conditionalStack.length === 0) {
				throw new Error('ENDIF without matching IF');
			}
			conditionalStack.pop();
			i++;
			continue;
		}

		const macroMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_\.]*)\s+MACRO\b(.*)$/i);
		if (macroMatch) {
			const macroName = macroMatch[1].toUpperCase();
			const paramText = macroMatch[2] ? macroMatch[2].trim() : '';
			const params = splitArguments(paramText);
			const body = [];
			i++;
			while (i < lines.length) {
				const bodyLine = lines[i];
				const bodyTrim = bodyLine.split(';')[0].trim();
				if (/^ENDM\b/i.test(bodyTrim)) {
					break;
				}
				body.push(bodyLine);
				i++;
			}
			if (i >= lines.length) {
				throw new Error('Unterminated MACRO definition');
			}
			// Skip ENDM line
			i++;
			if (currentActive) {
				macros.set(macroName, { params, body });
			}
			continue;
		}

		if (!currentActive) {
			i++;
			continue;
		}

		// Track EQU symbols for conditionals/macros
		const equMatch = trimmed.match(/^([A-Za-z_][A-Za-z0-9_\.]*)?:?\s+EQU\b\s*(.+)$/i);
		if (equMatch) {
			const symbolName = (equMatch[1] || '').replace(/:$/, '') || null;
			const expr = equMatch[2] ? equMatch[2].trim() : '';
			if (symbolName && expr) {
				const value = evaluateExpression(expr, origin.lineNumber, rawLine, { currentLocation: 0 });
				setPersistentSymbol(symbolName, value | 0);
			}
		}

		// Macro invocation
		let labelPrefix = '';
		let afterLabel = trimmed;
		const labelMatch = afterLabel.match(/^([A-Za-z_][A-Za-z0-9_\.]*)\s*:/);
		if (labelMatch) {
			labelPrefix = labelMatch[0];
			afterLabel = afterLabel.slice(labelMatch[0].length).trim();
		}
		if (afterLabel.length > 0) {
			const parts = afterLabel.split(/\s+/);
			const potentialMacroName = parts[0].toUpperCase();
			if (macros.has(potentialMacroName)) {
				const macro = macros.get(potentialMacroName);
				const argText = afterLabel.slice(parts[0].length).trim();
				const args = splitArguments(argText);
				const expandedLines = [];
				for (let j = 0; j < macro.body.length; j++) {
					let expanded = macro.body[j];
					const commentSplit = expanded.split(';');
					let code = commentSplit.shift() || '';
					const comment = commentSplit.length > 0 ? ';' + commentSplit.join(';') : '';
					macro.params.forEach((param, idx) => {
						const value = args[idx] !== undefined ? args[idx] : '';
						const regex = new RegExp(`\\b${param}\\b`, 'gi');
						code = code.replace(regex, value);
					});
					code = code.replace(/\\([0-9]+)/g, (match, num) => {
						const idx = parseInt(num, 10) - 1;
						return idx >= 0 && idx < args.length ? args[idx] : '';
					});
					expandedLines.push(code + comment);
				}
				if (expandedLines.length > 0) {
					if (labelPrefix) {
						expandedLines[0] = `${labelPrefix} ${expandedLines[0].trimStart()}`.trimEnd();
					}
					for (const expandedLine of expandedLines) {
						outputLines.push(expandedLine);
						outputOrigins.push(origin);
					}
				}
				i++;
				continue;
			}
		}

		outputLines.push(rawLine);
		outputOrigins.push(origin);
		i++;
	}

	if (conditionalStack.length !== 0) {
		throw new Error('Unterminated IF block');
	}

	return { lines: outputLines, origins: outputOrigins };
}

function isIndexOperand(operand) {
	return /^\((IX|IY)/i.test(operand.trim());
}

function parseIndexDisp(op, lineNumber, line, currentLocation) {
	const trimmed = op.trim();
	let match = trimmed.match(/^\((IX|IY)\)$/i);
	if (match) {
		const prefix = match[1].toUpperCase() === 'IX' ? 0xDD : 0xFD;
		return { prefix, d: 0 };
	}
	match = trimmed.match(/^\((IX|IY)\s*([+\-].+)\)$/i);
	if (!match) {
		return null;
	}
	const prefix = match[1].toUpperCase() === 'IX' ? 0xDD : 0xFD;
	const displacement = evaluateExpression(match[2], lineNumber, line, { currentLocation });
	if (displacement < -128 || displacement > 127) {
		throw new Error(`Line ${lineNumber}: Index displacement out of range: ${displacement}\n"${line}"`);
	}
	return { prefix, d: displacement & 0xFF };
}

function parseImmediateLiteral(op) {
	const text = op.trim();
	if (/^[+\-]?\d+$/u.test(text)) {
		return parseInt(text, 10);
	}
	if (/^0x[0-9A-Fa-f]+$/u.test(text)) {
		return parseInt(text, 16);
	}
	if (/^\$[0-9A-Fa-f]+$/u.test(text)) {
		return parseInt(text.slice(1), 16);
	}
	if (/^#[0-9A-Fa-f]+$/u.test(text)) {
		return parseInt(text.slice(1), 16);
	}
	if (/^[0-9A-Fa-f]+[Hh]$/u.test(text)) {
		return parseInt(text.slice(0, -1), 16);
	}
	return null;
}

function sanitizeErrorMessage(rawMessage) {
	if (!rawMessage) {
		return 'Unknown error';
	}
	const withoutAnsi = String(rawMessage).replace(/\x1B\[[0-9;]*m/g, '').trim();
	const [firstLine, ...rest] = withoutAnsi.split('\n');
	let primary = firstLine.replace(/^Line \d+:\s*/i, '').trim();
	if (!primary && rest.length > 0) {
		primary = rest.shift().trim();
	}
	return primary || 'Unknown error';
}

function extractErrorDetail(rawMessage, lineContent) {
	if (!rawMessage) {
		return null;
	}
	const withoutAnsi = String(rawMessage).replace(/\x1B\[[0-9;]*m/g, '');
	const [, ...rest] = withoutAnsi.split('\n');
	const trimmedLine = lineContent ? lineContent.trim() : null;
	const detail = rest
		.map(line => line.trimEnd())
		.filter(content => {
			if (!content) {
				return false;
			}
			const normalized = content.replace(/^"|"$/g, '').trim();
			if (trimmedLine && (normalized === trimmedLine || content.trim() === trimmedLine)) {
				return false;
			}
			return true;
		})
		.join('\n');
	return detail || null;
}

function createErrorRecord(filePath, lineNumber, lineContent, error) {
	const rawMessage = error && error.message ? error.message : error;
	return {
		filePath,
		lineNumber,
		column: 1,
		message: sanitizeErrorMessage(rawMessage),
		detail: extractErrorDetail(rawMessage, lineContent || ''),
		lineContent
	};
}

function normalizeOperand(op, idx, instruction) {
	const upperOp = op.toUpperCase();

	if (upperOp === 'AF' || upperOp === "AF'") {
		return upperOp;
	}

	if (sixteenBitRegisters.includes(upperOp)) {
		return upperOp;
	} else if (eightBitRegisters.includes(upperOp)) {
		return upperOp;
	} else if (conditionCodes.includes(upperOp)) {
		return upperOp;
	} else if (op.startsWith('(') && op.endsWith(')')) {
		const inner = op.slice(1, -1);
		const upperInner = inner.toUpperCase();
		if (allRegisters.includes(upperInner)) {
			return `(${upperInner})`;
		} else {
			return '(addr)';
		}
	} else if (/^'.'$/s.test(op)) {
		if (['IM', 'RST'].includes(instruction.mnemonic)) {
			return op.toUpperCase();
		}
		return 'n';
	} else {
		const immediateValue = parseImmediateLiteral(op);
		if (immediateValue !== null) {
			if (['IM', 'RST'].includes(instruction.mnemonic)) {
				return op.toUpperCase();
			}
			if (instruction.mnemonic === 'LD') {
				const firstOperandRaw = instruction.operands[0] ? instruction.operands[0].trim() : '';
				const firstOperandNormalized = firstOperandRaw.replace(/^\((.*)\)$/u, '$1').toUpperCase();
				const destIsRegisterPair = firstOperandRaw && !firstOperandRaw.startsWith('(') && sixteenBitRegisters.includes(firstOperandNormalized);
				if (idx === 1 && destIsRegisterPair) {
					return 'nn';
				}
				if (idx === 1 && !destIsRegisterPair && immediateValue > 0xFF) {
				}
				if (idx === 1) {
					const placeholder = destIsRegisterPair ? 'nn' : 'n';
					return placeholder;
				}
			}
			if (['JP', 'CALL'].includes(instruction.mnemonic)) {
				return 'nn';
			}
			if (instruction.mnemonic === 'JR') {
				if (idx === 0 && conditionCodes.includes(upperOp)) {
					return upperOp;
				}
				return 'e';
			}
			if (instruction.mnemonic === 'DJNZ') {
				return 'e';
			}
			return 'n';
		}
		// Decide based on instruction and operand index
		if (['JP', 'CALL'].includes(instruction.mnemonic)) {
			return 'nn';
		} else if (instruction.mnemonic === 'JR') {
			if (idx === 0 && conditionCodes.includes(upperOp)) {
				return upperOp;
			} else {
				return 'e';
			}
		} else if (instruction.mnemonic === 'DJNZ') {
			return 'e';
		} else if (instruction.mnemonic === 'LD') {
			const firstOperandRaw = instruction.operands[0] ? instruction.operands[0].trim() : '';
			if (isIndexOperand(firstOperandRaw)) {
				return 'n';
			}
			const firstOperandNormalized = firstOperandRaw.replace(/^\((.*)\)$/u, '$1').toUpperCase();
			const destIsRegisterPair = firstOperandRaw && !firstOperandRaw.startsWith('(') && sixteenBitRegisters.includes(firstOperandNormalized);
			if (idx === 1 && destIsRegisterPair) {
				return 'nn';
			} else {
				return 'n';
			}
		} else {
			return 'n';
		}
	}
}

/**
 * Encodes an assembly instruction into its corresponding opcode bytes.
 *
 * @param {Object} instruction - The instruction object containing mnemonic, operands, and directive.
 * @param {string} instruction.mnemonic - The mnemonic of the instruction.
 * @param {Array<string>} instruction.operands - The operands of the instruction.
 * @param {string} instruction.directive - The directive of the instruction (e.g., 'DB', 'DW').
 * @param {number} locationCounter - The current location counter in the assembly code.
 * @param {number} lineNumber - The line number of the instruction in the source code.
 * @param {string} line - The full line of the instruction in the source code.
 * @returns {Array<number>} The encoded opcode bytes.
 * @throws {Error} If the instruction is invalid or contains undefined symbols.
 */
function encodeInstruction(instruction, locationCounter, lineNumber, line) {
	const { mnemonic, operands = [], directive } = instruction;
	let opcodeBytes = [];
	let key = mnemonic;

	if (directive === 'INCBIN') {
		const incbinInfo = instruction.incbin;
		if (!incbinInfo || !incbinInfo.path) {
			throw new Error(`Line ${lineNumber}: INCBIN metadata missing during encoding\n"${line}"`);
		}
		let buffer;
		try {
			buffer = fs.readFileSync(incbinInfo.path);
		} catch (error) {
			throw new Error(`Line ${lineNumber}: Unable to read INCBIN file ${incbinInfo.path}: ${error.message}\n"${line}"`);
		}
		const start = incbinInfo.offset || 0;
		const length = typeof incbinInfo.length === 'number' ? incbinInfo.length : (buffer.length - start);
		const end = Math.min(buffer.length, start + length);
		if (start > buffer.length) {
			throw new Error(`Line ${lineNumber}: INCBIN offset ${start} exceeds file size ${buffer.length}\n"${line}"`);
		}
		return Array.from(buffer.slice(start, end));
	}

	if (directive === 'DB' || directive === 'DW') {
		let opcodeBytes = [];
		for (let operandIndex = 0; operandIndex < operands.length; operandIndex++) {
			const operand = operands[operandIndex];
			// Handle strings (enclosed in double quotes)
			if (/^".*"$/.test(operand)) {
				let str = operand.slice(1, -1);
				for (let i = 0; i < str.length; i++) {
					opcodeBytes.push(str.charCodeAt(i));
				}
			} else {
				// Evaluate expression
				let value = evaluateExpression(operand, lineNumber, line, { currentLocation: locationCounter + opcodeBytes.length });
				if (directive === 'DB') {
					opcodeBytes.push(value & 0xFF);
				} else if (directive === 'DW') {
					opcodeBytes.push(value & 0xFF);
					opcodeBytes.push((value >> 8) & 0xFF);
				}
			}
		}
		return opcodeBytes;
	}
	if (directive === 'DS') {
		const lengthExpr = operands[0];
		if (!lengthExpr) {
			throw new Error(`Line ${lineNumber}: DS requires a length\n"${line}"`);
		}
		const length = evaluateExpression(lengthExpr, lineNumber, line, { currentLocation: locationCounter });
		if (length < 0) {
			throw new Error(`Line ${lineNumber}: DS length must be non-negative\n"${line}"`);
		}
		let fillValue = 0;
		if (operands.length > 1 && operands[1]) {
			fillValue = evaluateExpression(operands[1], lineNumber, line, { currentLocation: locationCounter }) & 0xFF;
		} else if (instruction.directiveOriginal === '#') {
			fillValue = 0;
		}
		const bytes = [];
		for (let i = 0; i < length; i++) {
			bytes.push(fillValue);
		}
		return bytes;
	}

	const originalOperands = operands;
	const { canonical: canonicalOperands, prefix: indexRegisterPrefix } = canonicalizeIndexOperands(mnemonic, originalOperands, lineNumber, line);
	const canonicalOperandsTrimmed = canonicalOperands.map(op => (op || '').trim());
	const canonicalUpperOperands = canonicalOperandsTrimmed.map(op => op.toUpperCase());
	const originalOperandsTrimmed = originalOperands.map(op => (op || '').trim());

	/**
	 * Normalizes the operands for assembly instructions.
	 *
	 * This function processes an array of operands and normalizes them based on the following rules:
	 * - If the operand is a 16-bit or 8-bit register, it converts it to uppercase.
	 * - If the operand is a memory address dereferenced by a register, it converts the register to uppercase and wraps it in parentheses.
	 * - If the operand is a character literal, it replaces it with 'n'.
	 * - If the operand is a numeric value, it replaces it with 'n'.
	 * - Otherwise, it returns the operand as is.
	 *
	 * @param {string[]} operands - The array of operands to normalize.
	 * @returns {string[]} The array of normalized operands.
	 */
	const normalizedOperands = canonicalOperandsTrimmed.map((op, idx) => normalizeOperand(op, idx, instruction));
	key += ' ' + normalizedOperands.join(',');

	// Replace known symbols in operands with their values
	/**
	 * Resolves the operands for an assembly instruction.
	 *
	 * This function processes each operand to determine its type and resolve its value.
	 * It handles various cases such as symbols referencing 16-bit addresses, register references,
	 * memory addresses, numeric literals, character literals, and condition codes.
	 *
	 * @param {Array<string>} operands - The list of operands to resolve.
	 * @returns {Array<string|number>} - The list of resolved operands.
	 * @throws {Error} - Throws an error if an undefined symbol is encountered.
	 */
	const resolvedOperands = canonicalOperandsTrimmed.map(op => {
		if (isIndexOperand(op)) {
			return op.trim();
		}
		if (op.startsWith('(') && op.endsWith(')')) {
			const addr = op.slice(1, -1);
			if (allRegisters.includes(addr.toUpperCase())) {
				return `(${addr.toUpperCase()})`;
			}
			const value = evaluateExpression(addr, lineNumber, line, { currentLocation: locationCounter });
			return `(${value})`;
		}
		const upper = op.toUpperCase();
		if (symbolTable[op] !== undefined) {
			return symbolTable[op];
		}
		if (persistentSymbols[op] !== undefined) {
			return persistentSymbols[op];
		}
		if (allRegisters.includes(upper)) {
			return upper;
		}
		if (conditionCodes.includes(upper)) {
			return upper;
		}
		return evaluateExpression(op, lineNumber, line, { currentLocation: locationCounter });
	});

	// Update the key with resolved operands
	key = mnemonic;
	if (resolvedOperands.length > 0) {
		const updatedOperands = resolvedOperands.map((op, idx) => {
			if (typeof op === 'number') {
				if (['IM', 'RST'].includes(mnemonic)) {
					return op.toString();
				}
				// Decide placeholder based on mnemonic
				// For example 'LD HL,nn', the second operand should be 'nn' instead of 'n' (16-bit register)
				if (mnemonic === 'LD' && idx === 1 && sixteenBitRegisters.includes(operands[0].toUpperCase())) {
					return 'nn';
				}
				// Also, 'LD (xx), name' should be 'n' (memory address) and we need to verify the first operand to be a register)
				else if (mnemonic === 'LD' && idx === 1 && operands[0].startsWith('(') && operands[0].endsWith(')')) {
					if (isIndexOperand(operands[0])) {
						return 'n';
					}
					const firstOperand = operands[0].slice(1, -1).toUpperCase();
					if (firstOperand === 'HL') {
						return 'n';
					}
					if (sixteenBitRegisters.includes(firstOperand)) {
						return 'nn';
					}
					if (eightBitRegisters.includes(firstOperand)) {
						return 'n';
					}
					throw new Error(`Line ${lineNumber}: Invalid instruction (only register indirect operands are allowed here): ${mnemonic} ${operands.join(',')}\n"${line}"`);
				}
				else if (['CALL', 'JP'].includes(mnemonic)) {
					return 'nn';
				} else if (mnemonic === 'JR') {
					return idx === 0 && ['NZ', 'Z', 'NC', 'C'].includes(operands[0]) ? operands[0] : 'e';
				} else if (mnemonic === 'DJNZ') {
					return 'e';
				} else if (['BIT', 'SET', 'RES'].includes(mnemonic)) {
					return idx === 0 ? 'b' : 'r';
				} else {
					return 'n';
				}
			} else if (typeof op === 'string' && op.startsWith('(') && op.endsWith(')')) {
				if (allRegisters.includes(op.slice(1, -1).toUpperCase())) {
					return op;
				}
				return '(addr)';
			}
			return op;
		});
		key += ' ' + updatedOperands.join(',');
	}

	// Handle special cases
	if (mnemonic === 'BIT' || mnemonic === 'SET' || mnemonic === 'RES') {
		const bitValue = evaluateExpression(operands[0], lineNumber, line, { currentLocation: locationCounter });
		if (typeof bitValue !== 'number') {
			throw new Error(`Line ${lineNumber}: Invalid bit value: ${operands[0]}\n"${line}"`);
		}
		if (bitValue < 0 || bitValue > 7) {
			throw new Error(`Line ${lineNumber}: Bit value out of range: ${bitValue}\n"${line}"`);
		}
		const targetOperand = operands[1] || operands[0];
		const indexedTarget = parseIndexDisp(targetOperand, lineNumber, line, locationCounter);
		if (indexedTarget) {
			const base = mnemonic === 'BIT' ? 0x40 : mnemonic === 'RES' ? 0x80 : 0xC0;
			opcodeBytes.push(indexedTarget.prefix, 0xCB, indexedTarget.d, base + ((bitValue & 0x07) << 3) + 6);
			return opcodeBytes;
		}

		const register = resolvedOperands[1];
		const registerCodes = {
			'B': 0,
			'C': 1,
			'D': 2,
			'E': 3,
			'H': 4,
			'L': 5,
			'(HL)': 6,
			'A': 7
		};
		const regCode = registerCodes[register];
		if (regCode === undefined) {
			throw new Error(`Line ${lineNumber}: Invalid register: ${register}\n"${line}"`);
		}
		const opcodePrefix = 0xCB;
		let opcode;
		if (mnemonic === 'BIT') {
			opcode = 0x40 + (bitValue << 3) + regCode;
		} else if (mnemonic === 'SET') {
			opcode = 0xC0 + (bitValue << 3) + regCode;
		} else {
			opcode = 0x80 + (bitValue << 3) + regCode;
		}
		opcodeBytes.push(opcodePrefix, opcode);
		return opcodeBytes;
	} else if (mnemonic === 'JR') {
		// Handle relative jumps
		let condition = '';
		let offsetOperandIndex = 0;
		if (operands.length > 1 && conditionCodes.includes(operands[0].toUpperCase())) {
			condition = operands[0].toUpperCase();
			offsetOperandIndex = 1;
		}
		const addr = resolvedOperands[offsetOperandIndex];
		if (typeof addr !== 'number') {
			throw new Error(`Line ${lineNumber}: Invalid address value: ${resolvedOperands[offsetOperandIndex]}\n"${line}"`);
		}
		const offset = addr - (locationCounter + 2);
		if (offset < -128 || offset > 127) {
			throw new Error(`Line ${lineNumber}: Jump offset out of range: ${offset}\n"${line}"`);
		}
		const opcode = conditionCodesMap[condition];
		opcodeBytes.push(opcode, offset & 0xFF);
		return opcodeBytes;
	}

	const indexedOperands = operands.map(op => parseIndexDisp(op, lineNumber, line, locationCounter));
	const indexedCount = indexedOperands.filter(info => info !== null).length;

	if (indexRegisterPrefix !== null) {
		for (const info of indexedOperands) {
			if (info && info.prefix !== indexRegisterPrefix) {
				throw new Error(`Line ${lineNumber}: Cannot mix IX* register halves with IY-based addressing in the same instruction\n"${line}"`);
			}
		}
	}

		if (indexedCount > 0) {
			if (indexedCount > 1 && mnemonic !== 'LD') {
				throw new Error(`Line ${lineNumber}: Unsupported indexed operand combination for ${mnemonic}\n"${line}"`);
			}
			if (mnemonic === 'LD') {
				if (indexedCount > 1) {
					throw new Error(`Line ${lineNumber}: Unsupported indexed operands for LD\n"${line}"`);
				}
				if (indexedOperands[0]) {
					const indexInfo = indexedOperands[0];
					const sourceOriginal = originalOperands[1];
					const sourceCanonicalUpper = canonicalUpperOperands[1] || '';
					if (sourceOriginal === undefined) {
						throw new Error(`Line ${lineNumber}: Missing source operand for LD\n"${line}"`);
					}
					if (eightBitRegisters.includes(sourceCanonicalUpper)) {
						const baseKey = `LD (HL),${sourceCanonicalUpper}`;
						const baseTemplate = opcodeMap[baseKey];
						if (!baseTemplate) {
							throw new Error(`Line ${lineNumber}: Unknown base instruction for indexed LD: ${baseKey}\n"${line}"`);
						}
						opcodeBytes.push(indexInfo.prefix, baseTemplate[0], indexInfo.d);
						return opcodeBytes;
					}
					const value = evaluateExpression(sourceOriginal, lineNumber, line, { currentLocation: locationCounter });
					if (typeof value !== 'number') {
						throw new Error(`Line ${lineNumber}: Invalid immediate value: ${sourceOriginal}\n"${line}"`);
					}
					const storeTemplate = opcodeMap['LD (HL),n'];
					if (!storeTemplate) {
						throw new Error(`Line ${lineNumber}: Missing base template for LD (HL),n\n"${line}"`);
					}
					opcodeBytes.push(indexInfo.prefix, storeTemplate[0], indexInfo.d, value & 0xFF);
					return opcodeBytes;
				}
				if (indexedOperands[1]) {
					const indexInfo = indexedOperands[1];
					const destCanonicalUpper = canonicalUpperOperands[0] || '';
					if (!eightBitRegisters.includes(destCanonicalUpper)) {
						throw new Error(`Line ${lineNumber}: Invalid destination register for indexed LD: ${originalOperands[0]}\n"${line}"`);
					}
					const baseKey = `LD ${destCanonicalUpper},(HL)`;
					const baseTemplate = opcodeMap[baseKey];
					if (!baseTemplate) {
						throw new Error(`Line ${lineNumber}: Unknown base instruction for indexed LD: ${baseKey}\n"${line}"`);
					}
					opcodeBytes.push(indexInfo.prefix, baseTemplate[0], indexInfo.d);
					return opcodeBytes;
				}
			}
		if (['INC', 'DEC'].includes(mnemonic) && indexedOperands[0]) {
			const indexInfo = indexedOperands[0];
			const baseKey = `${mnemonic} (HL)`;
			const baseTemplate = opcodeMap[baseKey];
			if (!baseTemplate) {
				throw new Error(`Line ${lineNumber}: Unknown base instruction for indexed ${mnemonic}: ${baseKey}\n"${line}"`);
			}
			opcodeBytes.push(indexInfo.prefix, baseTemplate[0], indexInfo.d);
			return opcodeBytes;
		}
		if (['ADD', 'ADC', 'SBC'].includes(mnemonic) && indexedOperands[1]) {
			if (operands[0].toUpperCase() !== 'A') {
				throw new Error(`Line ${lineNumber}: ${mnemonic} with indexed operand requires A as destination\n"${line}"`);
			}
			const indexInfo = indexedOperands[1];
			const baseKey = `${mnemonic} A,(HL)`;
			const baseTemplate = opcodeMap[baseKey];
			if (!baseTemplate) {
				throw new Error(`Line ${lineNumber}: Unknown base instruction for indexed ${mnemonic}: ${baseKey}\n"${line}"`);
			}
			opcodeBytes.push(indexInfo.prefix, baseTemplate[0], indexInfo.d);
			return opcodeBytes;
		}
		if (['SUB', 'AND', 'XOR', 'OR', 'CP'].includes(mnemonic) && indexedOperands[0]) {
			const indexInfo = indexedOperands[0];
			const baseKey = `${mnemonic} (HL)`;
			const baseTemplate = opcodeMap[baseKey];
			if (!baseTemplate) {
				throw new Error(`Line ${lineNumber}: Unknown base instruction for indexed ${mnemonic}: ${baseKey}\n"${line}"`);
			}
			opcodeBytes.push(indexInfo.prefix, baseTemplate[0], indexInfo.d);
			return opcodeBytes;
		}
		throw new Error(`Line ${lineNumber}: Unsupported indexed addressing for ${mnemonic}\n"${line}"`);
	}

	// Lookup the opcode template using the generated key
	const opcodeTemplate = opcodeMap[key];
	if (!opcodeTemplate) {
		throw new Error(`Line ${lineNumber}: Unknown instruction: ${key}\n"${line}"`);
	}

	// Generate the opcode bytes
	for (const byte of opcodeTemplate) {
		if (typeof byte === 'number') {
			opcodeBytes.push(byte);
		} else if (byte === 'addr_low' || byte === 'addr_high') {
			// Handle memory addresses
			if (resolvedOperands.length === 0) {
				throw new Error(`Line ${lineNumber}: Missing address value\n"${line}"`);
			}
			// Handle the `(` and `)` around the memory address
			const addr = resolvedOperands.find(op => typeof op === 'string' && op.startsWith('(') && op.endsWith(')'));
			if (!addr) {
				throw new Error(`Line ${lineNumber}: Invalid address value: ${addr}\n"${line}"`);
			}
			const value = addr.slice(1, -1);
			if (allRegisters.includes(value.toUpperCase())) {
				opcodeBytes.push(allRegisters.indexOf(value.toUpperCase()));
			} else {
				// Parse the address value as a number
				const addrValue = evaluateExpression(value, lineNumber, line, { currentLocation: locationCounter });
				if (typeof addrValue !== 'number') {
					throw new Error(`Line ${lineNumber}: Invalid address value: ${addrValue}\n"${line}"`);
				}
				if (byte === 'addr_low') {
					opcodeBytes.push(addrValue & 0xFF);
				} else {
					opcodeBytes.push((addrValue >> 8) & 0xFF);
				}
			}
		} else if (byte === 'nn_low' || byte === 'nn_high') {
			let value;
			if (['JP', 'CALL'].includes(mnemonic) && typeof resolvedOperands[0] === 'string' && conditionCodes.includes(resolvedOperands[0])) {
				value = resolvedOperands[1];
			} else if (mnemonic === 'LD' && operands.length === 2 && sixteenBitRegisters.includes(operands[0].toUpperCase())) {
				value = resolvedOperands[1];
			} else {
				value = resolvedOperands[resolvedOperands.length - 1];
			}
			if (typeof value !== 'number') {
				throw new Error(`Line ${lineNumber}: Invalid address value: ${value}\n"${line}"`);
			}
			opcodeBytes.push(byte === 'nn_low' ? (value & 0xFF) : ((value >> 8) & 0xFF));
		} else if (byte === 'n') {
			const value = resolvedOperands[operands.length - 1];
			if (typeof value !== 'number') {
				throw new Error(`Line ${lineNumber}: Invalid immediate value: ${resolvedOperands[operands.length - 1]}\n"${line}"`);
			}
			opcodeBytes.push(value & 0xFF);
		} else if (byte === 'e') {
			const addr = resolvedOperands[operands.length - 1];
			if (typeof addr !== 'number') {
				throw new Error(`Line ${lineNumber}: Invalid address value: ${resolvedOperands[operands.length - 1]}\n"${line}"`);
			}
			const offset = addr - (locationCounter + 2);
			if (offset < -128 || offset > 127) {
				throw new Error(`Line ${lineNumber}: Jump offset out of range: ${offset}\n"${line}"`);
			}
			opcodeBytes.push(offset & 0xFF);
		}
	}

	if (indexRegisterPrefix !== null) {
		if (opcodeBytes.length === 0) {
			opcodeBytes.push(indexRegisterPrefix);
		} else if (opcodeBytes[0] !== indexRegisterPrefix) {
			opcodeBytes.unshift(indexRegisterPrefix);
		}
	}

	return opcodeBytes;
}

/**
 * Assembles assembly code into machine code.
 *
 * This function takes a string of assembly code, parses it, and converts it into
 * machine code. It performs two passes over the code: the first pass builds a symbol
 * table and estimates instruction sizes, while the second pass encodes the instructions
 * into machine code.
 *
 * @param {string} assemblyCode - The assembly code to be assembled.
 * @returns {number[]} An array of bytes representing the machine code.
 *
 * @throws {Error} If an invalid instruction or operand is encountered during the first pass.
 */
function assemble(assemblyCode, options = {}) {
	const { filePath = 'input', lineOrigins = [], mapper = DEFAULT_ROM_MAPPER, defaultPageOrigin: defaultPageOriginOption = null } = options;
	const lines = assemblyCode.split('\n');
	const origins = lineOrigins.length === lines.length
		? lineOrigins
		: lines.map((line, idx) => ({ filePath, lineNumber: idx + 1, lineContent: line }));
	resetSymbolTableForAssembly();
	entryLabel = null;
	entryAddress = null;
	const mapperConfig = getMapperConfiguration(mapper);
	const defaultPageOrigin = (defaultPageOriginOption !== null && defaultPageOriginOption !== undefined)
		? (defaultPageOriginOption | 0)
		: mapperConfig.defaultPageOrigin;
	const state = {
		currentPage: 0,
		pageExplicitlySet: false,
		pageTable: new Map(),
		pageOrder: [],
		pageAddress: new Map(),
		mapStack: [],
		mapActive: false,
		mapAddress: 0,
		currentAddressSpace: 'rom',
		defaultPageOrigin,
		pendingSegmentReset: false
	};
	ensurePageInfo(state, 0);
	if (!state.pageAddress.has(0)) {
		state.pageAddress.set(0, defaultPageOrigin);
	}
	const pageZeroInfo = state.pageTable.get(0);
	if (pageZeroInfo && pageZeroInfo.origin === null) {
		pageZeroInfo.origin = defaultPageOrigin;
	}
	let locationCounter = defaultPageOrigin;
	let loadAddressStart = null;
	const instructions = [];
	const errors = [];

	// First pass: parse lines and build symbol table
	for (let i = 0; i < lines.length; i++) {
		const origin = origins[i];
		const lineNumber = origin.lineNumber;
		const line = lines[i];
		try {
			const tokens = tokenize(line);
			if (tokens.length === 0) {
				continue;
			}

			const instruction = parse(tokens);
			instruction.filePath = origin.filePath;

			const effectiveLocationCounter = resolveCurrentLocation(state, locationCounter);

			if (instruction.label) {
				symbolTable[instruction.label] = effectiveLocationCounter;
			}

			if (instruction.directive) {
			if (['DB', 'DW', 'DS', 'INCBIN'].includes(instruction.directive)) {
				let size = 0;
				if (instruction.directive === 'DS') {
					const lengthExpr = instruction.operands[0];
					if (!lengthExpr) {
						throw new Error(`Line ${lineNumber}: DS requires a length\n"${line}"`);
					}
					const length = evaluateExpression(lengthExpr, lineNumber, line, { currentLocation: effectiveLocationCounter });
					if (length < 0) {
						throw new Error(`Line ${lineNumber}: DS length must be non-negative\n"${line}"`);
					}
					size = length | 0;
				} else if (instruction.directive === 'INCBIN') {
					const args = instruction.operands || [];
					if (args.length === 0) {
						throw new Error(`Line ${lineNumber}: INCBIN requires a file path\n"${line}"`);
					}
					const literal = extractStringLiteral(args[0]);
					if (literal === null || literal.length === 0) {
						throw new Error(`Line ${lineNumber}: INCBIN expects the first argument to be a quoted file path\n"${line}"`);
					}
					const baseDir = instruction.filePath ? path.dirname(instruction.filePath) : process.cwd();
					const resolvedPath = path.isAbsolute(literal) ? literal : path.resolve(baseDir, literal);
					let offset = 0;
					if (args.length > 1 && args[1].trim().length > 0) {
						offset = evaluateExpression(args[1], lineNumber, line, { currentLocation: effectiveLocationCounter });
					}
					if (offset < 0) {
						throw new Error(`Line ${lineNumber}: INCBIN offset must be non-negative\n"${line}"`);
					}
					let lengthValue = null;
					if (args.length > 2 && args[2].trim().length > 0) {
						lengthValue = evaluateExpression(args[2], lineNumber, line, { currentLocation: effectiveLocationCounter });
						if (lengthValue < 0) {
							throw new Error(`Line ${lineNumber}: INCBIN length must be non-negative\n"${line}"`);
						}
					}
					let fileBuffer;
					try {
						fileBuffer = fs.readFileSync(resolvedPath);
					} catch (error) {
						throw new Error(`Line ${lineNumber}: Unable to read INCBIN file ${resolvedPath}: ${error.message}\n"${line}"`);
					}
					const fileLength = fileBuffer.length;
					if (offset > fileLength) {
						throw new Error(`Line ${lineNumber}: INCBIN offset ${offset} exceeds file size ${fileLength} for ${literal}\n"${line}"`);
					}
					const available = fileLength - offset;
					const resolvedLength = lengthValue === null ? available : Math.min(lengthValue, available);
					if (lengthValue !== null && lengthValue > available) {
						throw new Error(`Line ${lineNumber}: INCBIN requested ${lengthValue} byte(s) but only ${available} byte(s) available from offset in ${literal}\n"${line}"`);
					}
					size = resolvedLength;
					instruction.incbin = {
						path: resolvedPath,
						offset,
						length: resolvedLength
					};
				} else {
					for (let operand of instruction.operands) {
						if (/^".*"$/.test(operand)) {
							size += operand.length - 2;
						} else if (instruction.directive === 'DB') {
							size += 1;
						} else {
							size += 2;
						}
					}
				}
				instruction.size = size;
				const instructionAddressSpace = state.mapActive ? 'ram' : state.currentAddressSpace;
				instruction.addressSpace = instructionAddressSpace;
				instruction.page = state.currentPage;
				instruction.locationCounter = effectiveLocationCounter;
				if (instructionAddressSpace === 'rom') {
					instruction.segmentReset = !!state.pendingSegmentReset;
					state.pendingSegmentReset = false;
				}
				instructions.push({ ...instruction, locationCounter: instruction.locationCounter, lineNumber, line, filePath: origin.filePath, page: state.currentPage });
				if (instructionAddressSpace === 'ram') {
					state.mapAddress = (state.mapAddress + size) | 0;
				} else {
					if (size > 0) {
						if (loadAddressStart === null || instruction.locationCounter < loadAddressStart) {
							loadAddressStart = instruction.locationCounter;
						}
					}
					locationCounter = (instruction.locationCounter + size) | 0;
					state.pageAddress.set(state.currentPage, locationCounter);
				}
				} else {
					const updatedLocation = handleDirective(instruction, state, locationCounter, lineNumber, line);
					if (typeof updatedLocation === 'number' && Number.isFinite(updatedLocation)) {
						locationCounter = updatedLocation;
					}
					if (!state.mapActive) {
						state.pageAddress.set(state.currentPage, locationCounter);
					}
				}
			} else if (instruction.mnemonic) {
				let key = instruction.mnemonic;
				const operands = instruction.operands || [];
				const { canonical: canonicalOperandsFirstPass } = canonicalizeIndexOperands(instruction.mnemonic, operands, lineNumber, line);
				const normalizedOperands = canonicalOperandsFirstPass.map((op, idx) => normalizeOperand(op, idx, instruction));

				if (normalizedOperands.length > 0) {
					key += ' ' + normalizedOperands.join(',');
				}

				const hasIndexedOperand = operands.some(isIndexOperand);
				const indexedOperandCount = operands.filter(isIndexOperand).length;
				const indexOperandIndex = operands.findIndex(isIndexOperand);
				let opcodeTemplate = opcodeMap[key];
				if (!opcodeTemplate) {
					if (instruction.mnemonic === 'JR') {
						instruction.size = 2;
					} else if (['BIT', 'SET', 'RES'].includes(instruction.mnemonic)) {
						instruction.size = hasIndexedOperand ? 4 : 2;
					} else if (instruction.mnemonic === 'IM') {
						instruction.size = 2;
					} else if (hasIndexedOperand && instruction.mnemonic === 'LD') {
						if (indexedOperandCount > 1) {
							throw new Error(`Line ${lineNumber}: Unsupported indexed operands for LD\n"${line}"`);
						}
						if (indexOperandIndex === 0) {
							const sourceOperand = operands[1];
							if (sourceOperand === undefined) {
								throw new Error(`Line ${lineNumber}: Missing source operand for LD\n"${line}"`);
							}
							const isRegisterSource = eightBitRegisters.includes(sourceOperand.toUpperCase());
							instruction.size = isRegisterSource ? 3 : 4;
						} else {
							instruction.size = 3;
						}
					} else if (hasIndexedOperand && ['INC', 'DEC'].includes(instruction.mnemonic)) {
						instruction.size = 3;
					} else if (hasIndexedOperand && ['ADD', 'ADC', 'SBC'].includes(instruction.mnemonic)) {
						instruction.size = 3;
					} else if (hasIndexedOperand && ['SUB', 'AND', 'XOR', 'OR', 'CP'].includes(instruction.mnemonic)) {
						instruction.size = 3;
					} else {
						if (validMnemonic.includes(instruction.mnemonic)) {
							throw new Error(`Line ${lineNumber}: Invalid operand(s) for instruction: ${key}\n"${line}"`);
						} else {
							throw new Error(`Line ${lineNumber}: Unknown instruction during first pass: ${key}\n"${line}"`);
						}
					}
				} else {
					instruction.size = opcodeTemplate.length;
				}
				const instructionAddressSpace = state.mapActive ? 'ram' : state.currentAddressSpace;
				instruction.addressSpace = instructionAddressSpace;
				instruction.page = state.currentPage;
				instruction.locationCounter = effectiveLocationCounter;
				if (instructionAddressSpace === 'rom') {
					instruction.segmentReset = !!state.pendingSegmentReset;
					state.pendingSegmentReset = false;
				}
				instructions.push({ ...instruction, locationCounter: instruction.locationCounter, lineNumber, line, filePath: origin.filePath, page: state.currentPage });
				if (instructionAddressSpace === 'ram') {
					state.mapAddress = (state.mapAddress + instruction.size) | 0;
				} else {
					if (instruction.size > 0) {
						if (loadAddressStart === null || instruction.locationCounter < loadAddressStart) {
							loadAddressStart = instruction.locationCounter;
						}
					}
					locationCounter = (instruction.locationCounter + instruction.size) | 0;
					state.pageAddress.set(state.currentPage, locationCounter);
				}
			}
		} catch (error) {
			errors.push(createErrorRecord(origin.filePath, lineNumber, line, error));
		}
	}

	const machineCode = [];
	let segments = [];
	let currentSegment = null;
	for (const instr of instructions) {
		if ((instr.addressSpace || 'rom').toLowerCase() === 'ram') {
			continue;
		}
		try {
			const opcodeBytes = encodeInstruction(instr, instr.locationCounter, instr.lineNumber, instr.line);
			instr.bytes = opcodeBytes;
			machineCode.push(...opcodeBytes);
			if (opcodeBytes.length > 0) {
				const start = instr.locationCounter;
				const instrAddressSpace = instr.addressSpace || 'rom';
				const instrPage = typeof instr.page === 'number' ? instr.page : 0;
				const resetRequested = !!instr.segmentReset;
				const expectedNextAddress = currentSegment && currentSegment.addressSpace === instrAddressSpace && currentSegment.page === instrPage
					? currentSegment.start + currentSegment.bytes.length
					: null;
				if (!currentSegment || currentSegment.addressSpace !== instrAddressSpace || currentSegment.page !== instrPage || resetRequested || start !== expectedNextAddress) {
					currentSegment = { start, bytes: [], addressSpace: instrAddressSpace, page: instrPage };
					segments.push(currentSegment);
				}
				currentSegment.bytes.push(...opcodeBytes);
			}
		} catch (error) {
			errors.push(createErrorRecord(instr.filePath || filePath, instr.lineNumber, instr.line, error));
		}
	}

	if (segments.length > 0) {
		const firstSegmentStart = segments.reduce((min, seg) => Math.min(min, seg.start), segments[0].start);
		loadAddressStart = loadAddressStart === null ? firstSegmentStart : Math.min(loadAddressStart, firstSegmentStart);
	}

	let pages;
	if (state.pageExplicitlySet || mapperConfig.type !== 'banked' || !mapperConfig.bankSize) {
		pages = state.pageOrder
			.slice()
			.sort((a, b) => a - b)
			.map(pageNumber => {
				const info = state.pageTable.get(pageNumber) || { origin: null, size: null };
				return {
					page: pageNumber,
					origin: info.origin,
					size: info.size
				};
			});
	} else {
		const autoResult = autoAssignRomPages(segments, mapperConfig.bankSize);
		segments = autoResult.segments;
		pages = autoResult.pages;
	}

	return {
		machineCode: errors.length === 0 ? machineCode : [],
		errors,
		entryLabel,
		entryAddress,
		loadAddressStart,
		segments: errors.length === 0 ? segments : [],
		pages
	};
}

function getDataBytesPerLine(dataFormat) {
	switch (dataFormat) {
		case 'hex':
			return DATA_BYTES_PER_LINE_HEX;
		case 'dec':
			return DATA_BYTES_PER_LINE_DECIMAL;
		case 'b64':
			return DATA_BYTES_PER_LINE_BASE64;
		default:
			throw new Error(`Invalid data format for BASIC statements: ${dataFormat}`);
	}
}

/**
 * Generates data statements from machine code.
 *
 * @param {Uint8Array} machineCode - The machine code to be converted into data statements.
 * @returns {string[]} An array of data statements.
 *
 * @constant {number} DATA_LINE_NUMBER_START - The starting line number for the data statements.
 * @constant {number} DATA_LINE_NUMBER_INCREMENT - The increment for the line numbers.
 */
function generateDataStatements(segments, dataFormat) {
	segments = Array.isArray(segments) ? segments : [];
	let dataLines = [];
	let lineNumber = DATA_LINE_NUMBER_START;
	let dataBytesPerLine = getDataBytesPerLine(dataFormat);

	let totalLength = 0;
	for (const segment of segments) {
		if (!segment || !Array.isArray(segment.bytes) || segment.bytes.length === 0) {
			continue;
		}
		const segmentSpace = (segment.addressSpace || 'rom').toLowerCase();
		if (segmentSpace === 'ram') {
			continue;
		}
		const { start, bytes } = segment;
		if (start < 0 || start > 0xFFFF) {
			throw new Error(`Segment start address out of range: ${start}`);
		}
		if (bytes.length > 0xFFFF) {
			createErrorRecord(`Segment length ${bytes.length} exceeds maximum supported length of 65535 bytes for loader`);
		}
		totalLength += bytes.length;
		const startLow = start & 0xFF;
		const startHigh = (start >> 8) & 0xFF;
		const lengthLow = bytes.length & 0xFF;
		const lengthHigh = (bytes.length >> 8) & 0xFF;
		dataLines.push(`${lineNumber} DATA ${SEGMENT_START_MARKER},${startLow},${startHigh},${lengthLow},${lengthHigh}`);
		lineNumber += DATA_LINE_NUMBER_INCREMENT;
		for (let i = 0; i < bytes.length; i += dataBytesPerLine) {
			const chunk = bytes.slice(i, i + dataBytesPerLine);
			switch (dataFormat) {
				case 'hex': {
					const hexBytes = chunk.map(byte => `${byte.toString(16).toUpperCase().padStart(2, '0')}`).join('');
					dataLines.push(`${lineNumber} DATA "${hexBytes}"`);
					break;
				}
				case 'dec': {
					const decBytes = chunk.join(',');
					dataLines.push(`${lineNumber} DATA ${decBytes}`);
					break;
				}
				case 'b64': {
					const base64Bytes = Buffer.from(chunk).toString('base64');
					dataLines.push(`${lineNumber} DATA "${base64Bytes}"`);
					break;
				}
				default:
					throw new Error(`Invalid data format for BASIC statements: ${dataFormat}`);
			}
			lineNumber += DATA_LINE_NUMBER_INCREMENT;
		}
	}

	dataLines.push(`${lineNumber} DATA ${SEGMENT_END_MARKER}`);

	if (totalLength > 0xFFFF) {
		createErrorRecord(`Machine code (${totalLength} bytes) exceeds maximum supported length of 65535 bytes for loader`);
	}

	return dataLines;
}

function autoAssignRomPages(segments, bankSize) {
	if (!Array.isArray(segments) || !segments.length || !bankSize || bankSize <= 0) {
		return { segments, pages: [] };
	}
	const normalizedSegments = [];
	const pages = [];
	let currentPage = null;

	const fitsStart = (start, page) => {
		if (!page) {
			return false;
		}
		if (start < page.origin) {
			return false;
		}
		if ((start - page.origin) >= bankSize) {
			return false;
		}
		if (start < page.maxEnd) {
			return false;
		}
		return true;
	};

	const createPage = (startAddress) => {
		const page = {
			number: pages.length,
			origin: startAddress | 0,
			maxEnd: startAddress | 0
		};
		pages.push(page);
		return page;
	};

	for (const segment of segments) {
		if (!segment || !Array.isArray(segment.bytes) || segment.bytes.length === 0) {
			continue;
		}
		const space = (segment.addressSpace || 'rom').toLowerCase();
		if (space === 'ram') {
			continue;
		}
		let offset = 0;
		while (offset < segment.bytes.length) {
			const chunkStart = (segment.start | 0) + offset;
			if (!currentPage || !fitsStart(chunkStart, currentPage)) {
				currentPage = createPage(chunkStart);
			}
			const used = chunkStart - currentPage.origin;
			const spaceLeft = bankSize - used;
			if (spaceLeft <= 0) {
				currentPage = createPage(chunkStart);
			}
			const remaining = segment.bytes.length - offset;
			const chunkLength = Math.max(0, Math.min(spaceLeft, remaining));
			if (chunkLength <= 0) {
				// Avoid infinite loop in degenerate cases
				break;
			}
			const chunkBytes = segment.bytes.slice(offset, offset + chunkLength);
			normalizedSegments.push({
				start: chunkStart,
				bytes: chunkBytes,
				addressSpace: segment.addressSpace || 'rom',
				page: currentPage.number
			});
			offset += chunkLength;
			const chunkEnd = chunkStart + chunkLength;
			currentPage.maxEnd = Math.max(currentPage.maxEnd, chunkEnd);
		}
	}

	return {
		segments: normalizedSegments,
		pages: pages.map(page => ({
			page: page.number,
			origin: page.origin,
			size: bankSize
		}))
	};
}

function buildRomImage(segments, options = {}) {
	if (!Array.isArray(segments)) {
		throw new Error('Cannot build ROM image: no segments provided');
	}
	const mapper = (options.mapper || DEFAULT_ROM_MAPPER).toLowerCase();
	const mapperConfig = getMapperConfiguration(mapper);
	const fillerValue = (typeof options.filler === 'number' ? options.filler : ROM_DEFAULT_FILL_VALUE) & 0xFF;
	const romSegments = segments.filter(segment => {
		if (!segment || !Array.isArray(segment.bytes) || segment.bytes.length === 0) {
			return false;
		}
		const space = (segment.addressSpace || 'rom').toLowerCase();
		return space !== 'ram';
	});

	const buildLinearImage = () => {
		const romChunks = [];
		const layout = [];
		let previousEnd = null;
		for (const segment of romSegments) {
			const start = typeof segment.start === 'number' ? segment.start : 0;
			if (previousEnd !== null && start < previousEnd) {
				previousEnd = start;
			}
			if (previousEnd !== null && start > previousEnd) {
				const gap = start - previousEnd;
				romChunks.push(Buffer.alloc(gap, fillerValue));
				layout.push({ kind: 'gap', from: previousEnd, to: start, length: gap });
				previousEnd = start;
			}
			const dataBuffer = Buffer.from(segment.bytes);
			romChunks.push(dataBuffer);
			layout.push({ kind: 'segment', start, length: dataBuffer.length, page: segment.page ?? 0 });
			previousEnd = start + dataBuffer.length;
		}
		const buffer = romChunks.length > 0 ? Buffer.concat(romChunks) : Buffer.alloc(0);
		const bankSize = mapperConfig.bankSize || ROM_DEFAULT_BANK_SIZE;
		const bankCount = bankSize > 0 ? Math.ceil(buffer.length / bankSize) : null;
		return { buffer, bankSize, fillerValue, layout, bankCount };
	};

	const buildBankedImage = () => {
		const pageDefinitions = new Map();
		if (Array.isArray(options.pages)) {
			for (const entry of options.pages) {
				if (!entry || typeof entry.page !== 'number') {
					continue;
				}
				pageDefinitions.set(entry.page, {
					origin: entry.origin !== null && entry.origin !== undefined ? entry.origin | 0 : null,
					size: entry.size !== null && entry.size !== undefined ? entry.size | 0 : null
				});
			}
		}
		const banks = new Map();
		const layout = [];
		const ensureBank = (pageNumber) => {
			if (!banks.has(pageNumber)) {
				const def = pageDefinitions.get(pageNumber) || {};
				const bankLength = def.size != null ? def.size : mapperConfig.bankSize;
				if (!bankLength || bankLength <= 0) {
					throw new Error(`Invalid bank size for page ${pageNumber}`);
				}
				banks.set(pageNumber, Buffer.alloc(bankLength, fillerValue));
				if (!pageDefinitions.has(pageNumber)) {
					pageDefinitions.set(pageNumber, { origin: null, size: bankLength });
				} else if (pageDefinitions.get(pageNumber).size == null) {
					pageDefinitions.get(pageNumber).size = bankLength;
				}
			}
			return banks.get(pageNumber);
		};

		for (const segment of romSegments) {
			const pageNumber = typeof segment.page === 'number' ? segment.page : 0;
			const def = pageDefinitions.get(pageNumber) || {};
			const origin = def.origin != null ? def.origin : mapperConfig.defaultPageOrigin;
			const bankBuffer = ensureBank(pageNumber);
			const bankLength = bankBuffer.length;
			for (let offset = 0; offset < segment.bytes.length; offset++) {
				const absoluteAddress = (segment.start | 0) + offset;
				const bankOffset = absoluteAddress - origin;
				if (bankOffset < 0 || bankOffset >= bankLength) {
					throw new Error(`Segment at ${absoluteAddress.toString(16)}h does not fit in page ${pageNumber}`);
				}
				bankBuffer[bankOffset] = segment.bytes[offset];
			}
			layout.push({ kind: 'segment', page: pageNumber, start: segment.start | 0, length: segment.bytes.length });
		}

		const sortedPages = Array.from(banks.keys()).sort((a, b) => a - b);
		const buffer = sortedPages.length > 0 ? Buffer.concat(sortedPages.map(page => banks.get(page))) : Buffer.alloc(0);
		return { buffer, bankSize: mapperConfig.bankSize, fillerValue, layout, bankCount: sortedPages.length, pages: sortedPages };
	};

	if (mapperConfig.type === 'linear') {
		return buildLinearImage();
	}
	if (mapperConfig.type === 'banked') {
		return buildBankedImage();
	}

	throw new Error(`Unsupported ROM mapper: ${mapper}`);
}

/**
 * Generates a boilerplate code for loading and running a program in memory.
 *
 * @param {number} datalineCount - The number of data lines to be included in the boilerplate.
 * @returns {string} The generated boilerplate code as a string.
 */
function generateBoilerPlate(datalineCount, dataFormat, loadAddress, entryAddress, entryLabel) {
	let dataBytesPerLine = getDataBytesPerLine(dataFormat);
	const toDecBoilerPlate = [
		`1040 READ M:IF M=${SEGMENT_END_MARKER} THEN GOTO 2000`,
		`1050 IF M<>${SEGMENT_START_MARKER} THEN ?"DATA ERROR":STOP`,
		`1060 READ DL,DH,LL,LH`,
		`1070 D=DL+256*DH:L=LL+256*LH:T=L`,
		`1080 FOR I=1 TO L`,
		`1090  READ A:POKE D,A:D=D+1`,
		`1100  B=B+1:IF B MOD ${dataBytesPerLine}=0 THEN ?".";`,
		`1110 NEXT I`,
		`1120 IF T MOD ${dataBytesPerLine}<>0 THEN ?".";`,
		`1130 GOTO 1040`
	].join('\n');

	const toHexBoilerPlate = [
		`1040 READ M:IF M=${SEGMENT_END_MARKER} THEN GOTO 2000`,
		`1050 IF M<>${SEGMENT_START_MARKER} THEN ?"DATA ERROR":STOP`,
		`1060 READ DL,DH,LL,LH`,
		`1070 D=DL+256*DH:L=LL+256*LH:T=L`,
		`1080 IF L=0 THEN 1190`,
		`1090 READ A$:I=1`,
		`1100 IF I>LEN(A$) THEN 1090`,
		`1110 IF L=0 THEN 1190`,
		`1120 B$=MID$(A$,I,2)`,
		`1130 POKE D,VAL("&H"+B$)`,
		`1140 D=D+1:L=L-1:B=B+1:IF B MOD ${dataBytesPerLine}=0 THEN ?".";`,
		`1150 I=I+2`,
		`1160 IF I<=LEN(A$) THEN 1120`,
		`1170 GOTO 1080`,
		`1180 IF T MOD ${dataBytesPerLine}<>0 THEN ?".";`,
		`1190 GOTO 1040`
	].join('\n');

	const toBase64BoilerPlate = [
		`1040 DIM B$(63)`,
		`1041 B$="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"`,
		`1042 READ M:IF M=${SEGMENT_END_MARKER} THEN GOTO 2000`,
		`1043 IF M<>${SEGMENT_START_MARKER} THEN ?"DATA ERROR":STOP`,
		`1044 READ DL,DH,LL,LH`,
		`1045 D=DL+256*DH:L=LL+256*LH:T=L`,
		`1046 IF L=0 THEN 1105`,
		`1047 READ B64$:I=1`,
		`1048 IF LEN(B64$)=0 THEN 1047`,
		`1049 IF L=0 THEN 1105`,
		`1050 C1$=MID$(B64$,I,1)`,
		`1051 C2$=MID$(B64$,I+1,1)`,
		`1052 C3$=MID$(B64$,I+2,1)`,
		`1053 C4$=MID$(B64$,I+3,1)`,
		`1054 B1=INSTR(B$,C1$)-1`,
		`1055 B2=INSTR(B$,C2$)-1`,
		`1056 B3=INSTR(B$,C3$)-1`,
		`1057 B4=INSTR(B$,C4$)-1`,
		`1058 Y=(B1*4)+(B2\\16):GOSUB 1900`,
		`1059 IF L=0 THEN 1105`,
		`1060 IF C3$<>"=" THEN Y=((B2 AND 15)*16)+(B3\\4):GOSUB 1900`,
		`1061 IF L=0 THEN 1105`,
		`1062 IF C4$<>"=" THEN Y=((B3 AND 3)*64)+B4:GOSUB 1900`,
		`1063 I=I+4`,
		`1064 IF I<=LEN(B64$) THEN 1050`,
		`1065 GOTO 1047`,
		`1105 IF T MOD ${dataBytesPerLine}<>0 THEN ?".";`,
		`1110 GOTO 1042`,
		`1900 IF L<=0 THEN RETURN`,
		`1910 POKE D,Y:D=D+1:L=L-1:B=B+1:IF B MOD ${dataBytesPerLine}=0 THEN ?".";`,
		`1920 RETURN`
	].join('\n');

	let dataFormatSpecificBoilerPlate;
	switch (dataFormat) {
		case 'hex':
			dataFormatSpecificBoilerPlate = toHexBoilerPlate;
			break;
		case 'dec':
			dataFormatSpecificBoilerPlate = toDecBoilerPlate;
			break;
		case 'b64':
			dataFormatSpecificBoilerPlate = toBase64BoilerPlate;
			break;
		default:
			throw new Error(`Invalid data format for BASIC statements: ${dataFormat}`);
	}

	const formatHexWord = value => {
		const numeric = Number(value) >>> 0;
		return numeric.toString(16).toUpperCase().padStart(4, '0');
	};

	const loadAddressHex = formatHexWord(loadAddress ?? 0);
	const entryAddressHex = formatHexWord(entryAddress ?? loadAddress ?? 0);
	const entryComment = entryLabel ? ` (${entryLabel})` : '';

	return `1000 ' Put program to memory
1010 D=&H${loadAddressHex}
1015 B=0
1020 ?"Laderen:":?"[";:LOCATE${datalineCount + 1}:?"]";:LOCATE1
${dataFormatSpecificBoilerPlate}
1200 ?""
2000 ' Run da program!!
2010 ?"Ik heb de boel geladen, nu starten we de boel! Klaar?"
2020 DEFUSR=&H${entryAddressHex}' This defines USR() start address${entryComment}
2030 ?"KABOEMMMM!!!"
2040 X=USR(0)`
}

function formatFilePathForDisplay(filePath) {
	if (!filePath) {
		return 'unknown';
	}
	if (!path.isAbsolute(filePath)) {
		return filePath;
	}
	const relative = path.relative(process.cwd(), filePath);
	return relative && !relative.startsWith('..') ? relative : filePath;
}

function defaultOutputPath(sourcePath, extension) {
	const ext = extension.startsWith('.') ? extension : `.${extension}`;
	if (!sourcePath) {
		return `output${ext}`;
	}
	const parsed = path.parse(sourcePath);
	const dir = parsed.dir;
	const baseName = parsed.name || parsed.base || 'output';
	return path.join(dir || '.', `${baseName}${ext}`);
}

function printErrors(errors, errorOutputFilePath = null) {
	if (errors.length === 0) {
		return;
	}
	const outputFile = errorOutputFilePath ? fs.createWriteStream(errorOutputFilePath, { flags: 'w' }) : null;
	console.error(colors.red + `\nFound ${errors.length} error(s) during assembly:` + colors.reset);
	outputFile && outputFile.write(`Found ${errors.length} error(s) during assembly:\n`);
	for (const error of errors) {
		const file = formatFilePathForDisplay(error.filePath);
		const line = error.lineNumber ?? 0;
		const column = error.column ?? 1;
		const message = error.message || 'Unknown error';
		console.error(`${colors.red}${file}:${line}:${column}: error: ${message}${colors.reset}`);
		outputFile && outputFile.write(`${file}:${line}:${column}: error: ${message}\n`);
		if (error.lineContent) {
			console.error(`${colors.red}  ${error.lineContent.trimStart()}${colors.reset}`);
			outputFile && outputFile.write(`  ${error.lineContent.trimStart()}\n`);
		}
		if (error.detail) {
			for (const detailLine of error.detail.split('\n')) {
				console.error(`${colors.red}  ${detailLine}${colors.reset}`);
				outputFile && outputFile.write(`  ${detailLine}\n`);
			}
		}
	}
	outputFile && outputFile.end();
}

/**
 * Preprocesses INCLUDE directives recursively, returning flattened lines with origins.
 *
 * @param {string} entryFilePath - The starting file to preprocess.
 * @param {{ stack?: string[] }} ctx - Internal recursion context for cycle detection.
 * @returns {{ lines: string[], origins: { filePath: string, lineNumber: number, lineContent: string }[] }}
 */
function preprocessIncludes(entryFilePath, ctx = { stack: [] }) {
	const absEntry = path.resolve(entryFilePath);
	let text;
	try {
		text = fs.readFileSync(absEntry, 'utf8');
	} catch (err) {
		const error = new Error(`Cannot read source file: ${absEntry}\n${err.message}`);
		error.filePath = absEntry;
		error.lineNumber = 1;
		error.lineContent = null;
		throw error;
	}

	const lines = text.split('\n');
	const outLines = [];
	const origins = [];
	const includeRe = /^\s*(?:[A-Za-z_][A-Za-z0-9_]*:)?\s*INCLUDE\s+(?:"([^"]+)"|<([^>]+)>)/i;

	for (let i = 0; i < lines.length; i++) {
		const rawLine = lines[i];
		const codePart = rawLine.split(';')[0] || '';
		const match = includeRe.exec(codePart);
		if (match) {
			const incPath = (match[1] || match[2] || '').trim();
			const resolved = path.isAbsolute(incPath) ? incPath : path.resolve(path.dirname(absEntry), incPath);
			if (ctx.stack.includes(resolved)) {
				const error = new Error(`Recursive include detected: ${ctx.stack.concat([resolved]).join(' -> ')}`);
				error.filePath = absEntry;
				error.lineNumber = i + 1;
				error.lineContent = rawLine;
				throw error;
			}
			try {
				const child = preprocessIncludes(resolved, { stack: ctx.stack.concat([absEntry]) });
				for (let j = 0; j < child.lines.length; j++) {
					outLines.push(child.lines[j]);
					origins.push(child.origins[j]);
				}
			} catch (error) {
				if (!error.filePath) {
					error.filePath = absEntry;
					error.lineNumber = i + 1;
					error.lineContent = rawLine;
				}
				throw error;
			}
		} else {
			outLines.push(rawLine);
			origins.push({ filePath: absEntry, lineNumber: i + 1, lineContent: rawLine });
		}
	}

	return { lines: outLines, origins };
}

/**
 * Main entry point for the assembler script.
 * This function reads the assembly code from a file, assembles it into machine code,
 * and writes the machine code to an output file.
 * The input file path can be provided as a command line argument.
 * The output file path can be provided using the -o flag.
 * If no output file path is provided, the output file will be written to the same directory as the input file.
 * If no input file path is provided, the default assembly code file will be used.
 * @param {string[]} args - The command line arguments.
 * @returns {void}
 */
function main() {
	clearAllSymbolTables();
	const assemblyFilePath = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : path.join(__dirname, 'assemblycode.asm');
	let outputFilePathIndex = process.argv.indexOf('-o');
	let outputFilePath = null;
	let writeToFile = false;
	let outputPathDefaulted = false;

	if (outputFilePathIndex > 0) {
		if (outputFilePathIndex + 1 < process.argv.length && !process.argv[outputFilePathIndex + 1].startsWith('-')) {
			outputFilePath = process.argv[outputFilePathIndex + 1];
		} else {
			outputFilePath = defaultOutputPath(assemblyFilePath, '.bas');
			outputPathDefaulted = true;
		}
		writeToFile = true;
	}

	let dataFormatIndex = process.argv.indexOf('-f');
	let dataFormat = DEFAULT_DATA_FORMAT;

	if (dataFormatIndex > 0) {
		if (dataFormatIndex + 1 < process.argv.length && !process.argv[dataFormatIndex + 1].startsWith('-')) {
			dataFormat = process.argv[dataFormatIndex + 1];
		}
	}

	dataFormat = (dataFormat || '').toLowerCase();
	if (!SUPPORTED_DATA_FORMATS.has(dataFormat)) {
		const validList = Array.from(SUPPORTED_DATA_FORMATS).join(', ');
		console.error(colors.red + `Unsupported data format "${dataFormat}". Supported formats: ${validList}.` + colors.reset);
		process.exitCode = 1;
		return;
	}

	let romMapper = DEFAULT_ROM_MAPPER;
	if (dataFormat === 'rom') {
		const mapperOption = readOptionValue(process.argv, ['-m', '--mapper']);
		if (mapperOption) {
			romMapper = mapperOption.toLowerCase();
		}
		if (!SUPPORTED_ROM_MAPPERS.has(romMapper)) {
			const supported = Array.from(SUPPORTED_ROM_MAPPERS).join(', ');
			console.error(colors.red + `Unsupported ROM mapper "${romMapper}". Supported mappers: ${supported}.` + colors.reset);
			process.exitCode = 1;
			return;
		}
	}

	let errorOutputFilePathIndex = process.argv.indexOf('-errout');
	let errorOutputFilePath = null;

	if (errorOutputFilePathIndex > 0) {
		if (errorOutputFilePathIndex + 1 < process.argv.length && !process.argv[errorOutputFilePathIndex + 1].startsWith('-')) {
			errorOutputFilePath = process.argv[errorOutputFilePathIndex + 1];
		} else {
			errorOutputFilePath = assemblyFilePath.replace('.asm', '.errors.txt');
		}
	}

	if (dataFormat === 'rom' && outputPathDefaulted) {
		outputFilePath = defaultOutputPath(assemblyFilePath, '.rom');
	}

	let preprocessed;
	try {
		preprocessed = preprocessIncludes(assemblyFilePath);
	} catch (error) {
		const fp = error.filePath || assemblyFilePath;
		const ln = error.lineNumber || 1;
		const lc = error.lineContent || null;
		printErrors([createErrorRecord(fp, ln, lc, error)], errorOutputFilePath);
		process.exitCode = 1;
		return;
	}

	let expanded;
	try {
		expanded = processMacrosAndConditionals(preprocessed.lines, preprocessed.origins);
	} catch (error) {
		const fp = error.filePath || assemblyFilePath;
		const ln = error.lineNumber || 1;
		const lc = error.lineContent || null;
		printErrors([createErrorRecord(fp, ln, lc, error), ], errorOutputFilePath);
		process.exitCode = 1;
		return;
	}

	try {
		collectStructs(expanded.lines);
	} catch (error) {
		const fp = error.filePath || assemblyFilePath;
		const ln = error.lineNumber || 1;
		const lc = error.lineContent || null;
		printErrors([createErrorRecord(fp, ln, lc, error), ], errorOutputFilePath);
		process.exitCode = 1;
		return;
	}

	resetSymbolTableForAssembly();
	const assemblyCode = expanded.lines.join('\n');

	const {
		machineCode,
		errors,
		entryLabel: assembledEntryLabel,
		entryAddress: assembledEntryAddress,
		loadAddressStart,
		segments,
		pages
	} = assemble(assemblyCode, { filePath: assemblyFilePath, lineOrigins: expanded.origins, mapper: romMapper });

	if (errors.length > 0) {
		printErrors(errors, errorOutputFilePath);
		process.exitCode = 1;
		return;
	}

	const loadAddress = loadAddressStart ?? (segments && segments.length > 0 ? segments[0].start : 0);
	const entryPointAddress = assembledEntryAddress ?? loadAddress;

	if (dataFormat === 'rom') {
		try {
		const { buffer: romBuffer, bankCount, bankSize: resultBankSize, layout } = buildRomImage(segments, {
			filler: ROM_DEFAULT_FILL_VALUE,
			mapper: romMapper,
			pages
		});
			if (!romBuffer || romBuffer.length === 0) {
				throw new Error('Assembled ROM image is empty.');
			}
			const outputWasAutoselected = !writeToFile || !outputFilePath;
			if (outputWasAutoselected) {
				outputFilePath = defaultOutputPath(assemblyFilePath, '.rom');
				writeToFile = true;
			}
			fs.writeFileSync(outputFilePath, romBuffer);
			const romSize = romBuffer.length;
			const entryHex = `0x${(entryPointAddress >>> 0).toString(16).toUpperCase().padStart(4, '0')}`;
			const entryInfo = assembledEntryLabel ? `${entryHex} (${assembledEntryLabel})` : entryHex;
			const effectiveBankSize = resultBankSize || ROM_DEFAULT_BANK_SIZE;
			const bankInfo = bankCount ? `${bankCount} × ${(effectiveBankSize / 1024) | 0}KB` : `${(effectiveBankSize / 1024) | 0}KB slots`;
			if (outputWasAutoselected) {
				console.log(colors.yellow + `No -o specified; writing ROM to ${outputFilePath}` + colors.reset);
			}
			console.log(colors.green + `ROM image written to ${outputFilePath}` + colors.reset);
			console.log(colors.blue + `Size: ${romSize} bytes (${bankInfo}). Entry: ${entryInfo}.` + colors.reset);
			if (process.env.BMSX_ASSEMBLER_DEBUG_ROM === '1') {
				console.log(colors.cyan + 'ROM layout (segments ordered as emitted):' + colors.reset);
				layout.forEach((item, index) => {
					if (item.kind === 'segment') {
						const pageInfo = item.page !== undefined ? ` page=${item.page}` : item.pageIndex !== undefined ? ` page=${item.pageIndex}` : '';
						console.log(colors.cyan + `  [${index}] segment start=${item.start.toString(16)}h length=${item.length}${pageInfo}` + colors.reset);
					} else if (item.kind === 'gap') {
						console.log(colors.cyan + `  [${index}] gap from=${item.from.toString(16)}h to=${item.to.toString(16)}h length=${item.length}` + colors.reset);
					} else if (item.kind === 'skipped') {
						console.log(colors.cyan + `  [${index}] skipped ${item.addressSpace} segment start=${item.start.toString(16)}h length=${item.length}` + colors.reset);
					}
				});
			}
			const tailBytes = effectiveBankSize ? romSize % effectiveBankSize : 0;
			if (effectiveBankSize && tailBytes !== 0) {
				console.log(colors.yellow + `Warning: ROM size leaves ${tailBytes} byte(s) outside ${effectiveBankSize} byte bank boundaries.` + colors.reset);
			}
		} catch (error) {
			printErrors([createErrorRecord(assemblyFilePath, 1, null, error)], errorOutputFilePath);
			process.exitCode = 1;
		}
		return;
	}

	let dataStatements;
	try {
		dataStatements = generateDataStatements(segments, dataFormat);
	} catch (error) {
		printErrors([createErrorRecord(assemblyFilePath, 1, null, error)], errorOutputFilePath);
		process.exitCode = 1;
		return;
	}

	let boilerPlate;
	try {
		boilerPlate = generateBoilerPlate(
			dataStatements.length,
			dataFormat,
			loadAddress,
			entryPointAddress,
			assembledEntryLabel
		);
	} catch (error) {
		printErrors([createErrorRecord(assemblyFilePath, 1, null, error)], errorOutputFilePath);
		process.exitCode = 1;
		return;
	}

	console.log(colors.blue + boilerPlate + colors.reset);
	console.log(colors.green + dataStatements.join('\n') + colors.reset);
	const outputContent = boilerPlate + '\n' + dataStatements.join('\n');

	if (writeToFile && outputFilePath) {
		fs.writeFileSync(outputFilePath, outputContent, 'utf8');
		console.log(colors.yellow + `Assembly output written to ${outputFilePath}` + colors.reset);
	}
}

main();
