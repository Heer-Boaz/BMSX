const fs = require('fs');
const path = require('path');

const DATA_LINE_NUMBER_START = 10000;
const DATA_LINE_NUMBER_INCREMENT = 1;
const DATA_BYTES_PER_LINE_DECIMAL = 32;
const DATA_BYTES_PER_LINE_HEX = 64;
const DATA_BYTES_PER_LINE_BASE64 = 32;
const DEFAULT_DATA_FORMAT = 'dec';
const SEGMENT_START_MARKER = 256;
const SEGMENT_END_MARKER = 257;

/**
 * An array of 8-bit register names used in the assembler.
 *
 * @type {string[]}
 * @constant
 */
const eightBitRegisters = ['A', 'B', 'C', 'D', 'E', 'H', 'L'];

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
const directives = ['EQU', 'ORG', 'END', 'DB', 'DW'];

/**
 * An array of valid mnemonics for the assembler.
 * These mnemonics represent various assembly instructions.
 *
 * @constant {string[]}
 * @default
 */
const validMnemonic = ['LD', 'INC', 'DEC', 'ADD', 'SUB', 'CP', 'AND', 'OR', 'XOR', 'RLCA', 'RRCA', 'RLA', 'RRA', 'RLC', 'RRC', 'RL', 'RR', 'NOP', 'SCF', 'CCF', 'CPL', 'DAA', 'NEG', 'EI', 'DI', 'HALT', 'RET', 'JP', 'JR', 'CALL', 'SET', 'RES', 'BIT', 'PUSH', 'POP'];

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
const regex = /([A-Za-z_][A-Za-z0-9_]*:)|([A-Za-z_][A-Za-z0-9_]*)|((?:0x|&H|#|\$)[0-9A-Fa-f]+|[0-9A-Fa-f]+[Hh]|%[01]+|[01]+[Bb]|\d+)|(\".*?\"|'.')|([,\(\)\+\-\*/])|(\S)/g;
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
		args: []
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
		instruction.directive = tokens[index].toUpperCase();
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
function handleDirective(instruction, locationCounter, lineNumber, line) {
	const { directive, operands } = instruction;
	if (directive === 'EQU') {
		const symbol = instruction.label;
		const value = operands[0];
		if (symbol && value) {
			symbolTable[symbol] = evaluateExpression(value, lineNumber, line);
		} else {
			throw new Error(`Line ${lineNumber}: Missing value for EQU directive\n"${line}"`);
		}
	} else if (directive === 'ORG') {
		const [value] = operands;
		if (value) {
			const newLocationCounter = evaluateExpression(value, lineNumber, line);
			return newLocationCounter;
		} else {
			throw new Error(`Line ${lineNumber}: Missing value for ORG directive\n"${line}"`);
		}
	} else if (directive === 'END') {
		if (operands && operands.length > 0 && operands[0]) {
			entryLabel = operands[0];
			entryAddress = evaluateExpression(operands[0], lineNumber, line);
		}
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
function evaluateExpression(expr, lineNumber, line) {
	if (!expr) {
		throw new Error('Empty expression in evaluateExpression');
	}

	// Handle character literals
	expr = expr.replace(/'(\\.|[^'])'/g, (match, p1) => {
		if (p1.length === 1) {
			//console.debug(`Character: "${p1.charCodeAt(0)}"`);
			return p1.charCodeAt(0);
		} else if (p1.startsWith('\\')) {
			// Handle escape sequences
			const escapeChars = {
				'n': '\n',
				'r': '\r',
				't': '\t',
				'\\': '\\',
				"'": "'",
				'"': '"',
				'0': '\0',
			};
			const unescapedChar = escapeChars[p1[1]] || p1[1];
			//console.debug(`Character: "${unescapedChar.charCodeAt(0)}"`);
			return unescapedChar.charCodeAt(0);
		} else {
			throw new Error(`Line ${lineNumber}: Invalid character literal: ${match}\n"${line}"`);
		}
	});

	// Remove spaces
	expr = expr.replace(/\s+/g, '');

	// Handle hexadecimal numbers starting with '#' or ending with 'H'/'h' or starting with '$' or starting with '0x'
	expr = expr.replace(/0x([0-9A-Fa-f]+)/g, (match, p1) => {
		// Return decimal evaluation of hexidecimal number
		return parseInt(p1, 16);

		return `0x${p1}`;
	});
	expr = expr.replace(/\$([0-9A-Fa-f]+)/g, (match, p1) => {
		return parseInt(p1, 16);
		return `0x${p1}`;
	});
	expr = expr.replace(/#([0-9A-Fa-f]+)/g, (match, p1) => {
		return parseInt(p1, 16);
		return `0x${p1}`;
	});
	expr = expr.replace(/([0-9A-Fa-f]+)[Hh]/g, (match, p1) => {
		return parseInt(p1, 16);
		return `0x${p1}`;
	});
	expr = expr.replace(/%([01]+)/g, (match, p1) => {
		return parseInt(p1, 2);
	});
	expr = expr.replace(/([01]+)[Bb]/g, (match, p1) => {
		return parseInt(p1, 2);
	});

	// Recognize registers and replace them with their values
	if (allRegisters.includes(expr)) {
		// console.debug(`Register: ${expr}`);
		return expr;
	};

	// Replace symbols with their values
	expr = expr.replace(/\b[A-Za-z_][A-Za-z0-9_]*\b/g, match => { // Match valid symbol names as whole words
		if (symbolTable[match] !== undefined) { // Check if the symbol is defined in the symbol table already
			// console.debug(`Symbol: ${expr} = ${symbolTable[match]}`);
			return symbolTable[match]; // Return the symbol's value
		} else {
			throw new Error(`Line ${lineNumber}: Undefined symbol: ${match}\n"${line}"`);
		}
	});

	try {
		// Evaluate the expression
		// console.debug(`Expression: ${expr} = "${eval(expr)}"`);
		return eval(expr);
	} catch (e) {
		throw new Error(`Line ${lineNumber}: Invalid expression: ${expr}\n"${line}"`);
	}
}

function isIndexOperand(operand) {
	return /^\((IX|IY)/i.test(operand.trim());
}

function parseIndexDisp(op, lineNumber, line) {
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
	const displacement = evaluateExpression(match[2], lineNumber, line);
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
		} else if (instruction.mnemonic === 'LD') {
			const firstOperandRaw = instruction.operands[0] ? instruction.operands[0].trim() : '';
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
	const { mnemonic, operands, directive } = instruction;
	let opcodeBytes = [];
	let key = mnemonic;

	if (directive === 'DB' || directive === 'DW') {
		let opcodeBytes = [];
		for (let operand of operands) {
			// Handle strings (enclosed in double quotes)
			if (/^".*"$/.test(operand)) {
				let str = operand.slice(1, -1);
				for (let i = 0; i < str.length; i++) {
					opcodeBytes.push(str.charCodeAt(i));
				}
			} else {
				// Evaluate expression
				let value = evaluateExpression(operand, lineNumber, line);
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
	const normalizedOperands = operands.map((op, idx) => normalizeOperand(op, idx, instruction));
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
	const resolvedOperands = operands.map(op => {
		if (isIndexOperand(op)) {
			return op.trim();
		}
		// Check if the operand is a symbol that references a 16-bit address
		if (op.startsWith('(') && op.endsWith(')')) {
			const addr = op.slice(1, -1);
			// Check if the operand is an address reference via a register (e.g., (HL))
			if (allRegisters.includes(addr.toUpperCase())) {
				return `(${addr.toUpperCase()})`;
			}
			// Check if the operand is a symbol that references a memory address
			const value = evaluateExpression(addr, lineNumber, line);
			return `(${value})`;
		}
		else if (symbolTable[op] !== undefined) {
			return symbolTable[op];
		} else if (!isNaN(parseInt(op))) {
			return parseInt(op);
		} else if (/^'.'$/s.test(op)) {
			// Evaluate character literal
			return evaluateExpression(op, lineNumber, line);
		} else if (allRegisters.includes(op.toUpperCase())) {
			return op.toUpperCase();
		} else if (conditionCodes.includes(op.toUpperCase())) {
			return op.toUpperCase();
		} else {
			throw new Error(`Line ${lineNumber}: Undefined symbol: ${op}\n"${line}"`);
		}
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
		const bitValue = evaluateExpression(operands[0], lineNumber, line);
		if (typeof bitValue !== 'number') {
			throw new Error(`Line ${lineNumber}: Invalid bit value: ${operands[0]}\n"${line}"`);
		}
		if (bitValue < 0 || bitValue > 7) {
			throw new Error(`Line ${lineNumber}: Bit value out of range: ${bitValue}\n"${line}"`);
		}
		const targetOperand = operands[1] || operands[0];
		const indexedTarget = parseIndexDisp(targetOperand, lineNumber, line);
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
		if (conditionCodes.includes(operands[0])) {
			condition = operands[0];
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

	const indexedOperands = operands.map(op => parseIndexDisp(op, lineNumber, line));
	const indexedCount = indexedOperands.filter(info => info !== null).length;

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
				const source = operands[1];
				if (source === undefined) {
					throw new Error(`Line ${lineNumber}: Missing source operand for LD\n"${line}"`);
				}
				const upperSource = source.toUpperCase();
				if (eightBitRegisters.includes(upperSource)) {
					const baseKey = `LD (HL),${upperSource}`;
					const baseTemplate = opcodeMap[baseKey];
					if (!baseTemplate) {
						throw new Error(`Line ${lineNumber}: Unknown base instruction for indexed LD: ${baseKey}\n"${line}"`);
					}
					opcodeBytes.push(indexInfo.prefix, baseTemplate[0], indexInfo.d);
					return opcodeBytes;
				}
				const value = evaluateExpression(source, lineNumber, line);
				if (typeof value !== 'number') {
					throw new Error(`Line ${lineNumber}: Invalid immediate value: ${source}\n"${line}"`);
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
				const dest = operands[0].toUpperCase();
				if (!eightBitRegisters.includes(dest)) {
					throw new Error(`Line ${lineNumber}: Invalid destination register for indexed LD: ${operands[0]}\n"${line}"`);
				}
				const baseKey = `LD ${dest},(HL)`;
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
				const addrValue = evaluateExpression(value, lineNumber, line);
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
	const { filePath = 'input' } = options;
	const lines = assemblyCode.split('\n');
	entryLabel = null;
	entryAddress = null;
	let locationCounter = 0;
	let loadAddressStart = null;
	const instructions = [];
	const errors = [];

	// First pass: parse lines and build symbol table
	for (let i = 0; i < lines.length; i++) {
		const lineNumber = i + 1;
		const line = lines[i];
		try {
			const tokens = tokenize(line);
			if (tokens.length === 0) {
				continue;
			}

			const instruction = parse(tokens);

			if (instruction.label) {
				symbolTable[instruction.label] = locationCounter;
			}

			if (instruction.directive) {
				if (instruction.directive === 'DB' || instruction.directive === 'DW') {
					let size = 0;
					for (let operand of instruction.operands) {
						if (/^".*"$/.test(operand)) {
							size += operand.length - 2;
						} else if (instruction.directive === 'DB') {
							size += 1;
						} else {
							size += 2;
						}
					}
					instruction.size = size;
					if (size > 0) {
						if (loadAddressStart === null || locationCounter < loadAddressStart) {
							loadAddressStart = locationCounter;
						}
					}
					instructions.push({ ...instruction, locationCounter, lineNumber, line });
					locationCounter += size;
				} else {
					locationCounter = handleDirective(instruction, locationCounter, lineNumber, line);
				}
			} else if (instruction.mnemonic) {
				let key = instruction.mnemonic;
				let operands = instruction.operands;
				const normalizedOperands = operands.map((op, idx) => normalizeOperand(op, idx, instruction));

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
				if (instruction.size > 0) {
					if (loadAddressStart === null || locationCounter < loadAddressStart) {
						loadAddressStart = locationCounter;
					}
				}
				instructions.push({ ...instruction, locationCounter, lineNumber, line });
				locationCounter += instruction.size;
			}
		} catch (error) {
			errors.push(createErrorRecord(filePath, lineNumber, line, error));
		}
	}

	const machineCode = [];
	const segments = [];
	let currentSegment = null;
	for (const instr of instructions) {
		try {
			const opcodeBytes = encodeInstruction(instr, instr.locationCounter, instr.lineNumber, instr.line);
			instr.bytes = opcodeBytes;
			machineCode.push(...opcodeBytes);
			if (opcodeBytes.length > 0) {
				const start = instr.locationCounter;
				const expectedNextAddress = currentSegment ? currentSegment.start + currentSegment.bytes.length : null;
				if (!currentSegment || start !== expectedNextAddress) {
					currentSegment = { start, bytes: [] };
					segments.push(currentSegment);
				}
				currentSegment.bytes.push(...opcodeBytes);
			}
		} catch (error) {
			errors.push(createErrorRecord(filePath, instr.lineNumber, instr.line, error));
		}
	}

	if (segments.length > 0) {
		const firstSegmentStart = segments.reduce((min, seg) => Math.min(min, seg.start), segments[0].start);
		loadAddressStart = loadAddressStart === null ? firstSegmentStart : Math.min(loadAddressStart, firstSegmentStart);
	}

	return {
		machineCode: errors.length === 0 ? machineCode : [],
		errors,
		entryLabel,
		entryAddress,
		loadAddressStart,
		segments: errors.length === 0 ? segments : []
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
		const { start, bytes } = segment;
		if (start < 0 || start > 0xFFFF) {
			throw new Error(`Segment start address out of range: ${start}`);
		}
		if (bytes.length > 0xFFFF) {
			throw new Error('Segment length exceeds maximum supported length of 65535 bytes for loader');
		}
		totalLength += bytes.length;
		dataLines.push(`${lineNumber} DATA ${SEGMENT_START_MARKER},${start},${bytes.length}`);
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
		throw new Error('Machine code exceeds maximum supported length of 65535 bytes for loader');
	}

	return dataLines;
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
		`1040 READ M:IF M=${SEGMENT_END_MARKER} THEN RETURN`,
		`1050 IF M<>${SEGMENT_START_MARKER} THEN ?"DATA ERROR":STOP`,
		`1060 READ D,L:T=L`,
		`1070 FOR I=1 TO L`,
		`1080  READ A:POKE D,A:D=D+1`,
		`1090  B=B+1:IF B MOD ${dataBytesPerLine}=0 THEN ?".";`,
		`1100 NEXT I`,
		`1110 IF T MOD ${dataBytesPerLine}<>0 THEN ?".";`,
		`1120 GOTO 1040`
	].join('\n');

	const toHexBoilerPlate = [
		`1040 READ M:IF M=${SEGMENT_END_MARKER} THEN RETURN`,
		`1050 IF M<>${SEGMENT_START_MARKER} THEN ?"DATA ERROR":STOP`,
		`1060 READ D,L:T=L`,
		`1070 IF L=0 THEN 1180`,
		`1080 READ A$:I=1`,
		`1090 IF I>LEN(A$) THEN 1080`,
		`1100 IF L=0 THEN 1180`,
		`1110 B$=MID$(A$,I,2)`,
		`1120 POKE D,VAL("&H"+B$)`,
		`1130 D=D+1:L=L-1:B=B+1:IF B MOD ${dataBytesPerLine}=0 THEN ?".";`,
		`1140 I=I+2`,
		`1150 IF I<=LEN(A$) THEN 1100`,
		`1160 GOTO 1070`,
		`1180 IF T MOD ${dataBytesPerLine}<>0 THEN ?".";`,
		`1190 GOTO 1040`
	].join('\n');

	const toBase64BoilerPlate = [
		`1040 DIM B$(63)`,
		`1041 B$="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"`,
		`1042 READ M:IF M=${SEGMENT_END_MARKER} THEN RETURN`,
		`1043 IF M<>${SEGMENT_START_MARKER} THEN ?"DATA ERROR":STOP`,
		`1044 READ D,L:T=L`,
		`1045 IF L=0 THEN 1085`,
		`1046 READ B64$:I=1`,
		`1047 IF LEN(B64$)=0 THEN 1046`,
		`1048 IF L=0 THEN 1085`,
		`1049 C1$=MID$(B64$,I,1)`,
		`1050 C2$=MID$(B64$,I+1,1)`,
		`1051 C3$=MID$(B64$,I+2,1)`,
		`1052 C4$=MID$(B64$,I+3,1)`,
		`1053 B1=INSTR(B$,C1$)-1`,
		`1054 B2=INSTR(B$,C2$)-1`,
		`1055 B3=INSTR(B$,C3$)-1`,
		`1056 B4=INSTR(B$,C4$)-1`,
		`1057 Y=(B1*4)+(B2\\16):GOSUB 1900`,
		`1058 IF L=0 THEN 1085`,
		`1059 IF C3$<>"=" THEN Y=((B2 AND 15)*16)+(B3\\4):GOSUB 1900`,
		`1060 IF L=0 THEN 1085`,
		`1061 IF C4$<>"=" THEN Y=((B3 AND 3)*64)+B4:GOSUB 1900`,
		`1062 I=I+4`,
		`1063 IF I<=LEN(B64$) THEN 1048`,
		`1064 GOTO 1045`,
		`1085 IF T MOD ${dataBytesPerLine}<>0 THEN ?".";`,
		`1090 GOTO 1042`,
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
1010 DEFINTA-Z:D=&H${loadAddressHex}
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

function printErrors(errors) {
	if (errors.length === 0) {
		return;
	}
	console.error(colors.red + `\nFound ${errors.length} error(s) during assembly:` + colors.reset);
	for (const error of errors) {
		const file = formatFilePathForDisplay(error.filePath);
		const line = error.lineNumber ?? 0;
		const column = error.column ?? 1;
		const message = error.message || 'Unknown error';
		console.error(`${colors.red}${file}:${line}:${column}: error: ${message}${colors.reset}`);
		if (error.lineContent) {
			console.error(`${colors.red}  ${error.lineContent.trimStart()}${colors.reset}`);
		}
		if (error.detail) {
			for (const detailLine of error.detail.split('\n')) {
				console.error(`${colors.red}  ${detailLine}${colors.reset}`);
			}
		}
	}
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
	const assemblyFilePath = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : path.join(__dirname, 'assemblycode.asm');
	let outputFilePathIndex = process.argv.indexOf('-o');
	let outputFilePath = null;
	let writeToFile = false;

	if (outputFilePathIndex > 0) {
		if (outputFilePathIndex + 1 < process.argv.length && !process.argv[outputFilePathIndex + 1].startsWith('-')) {
			outputFilePath = process.argv[outputFilePathIndex + 1];
		} else {
			outputFilePath = assemblyFilePath.replace('.asm', '.bas');
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

	let assemblyCode;
	try {
		assemblyCode = fs.readFileSync(assemblyFilePath, 'utf8');
	} catch (error) {
		printErrors([createErrorRecord(assemblyFilePath, 1, null, error)]);
		process.exitCode = 1;
		return;
	}

	const {
		machineCode,
		errors,
		entryLabel: assembledEntryLabel,
		entryAddress: assembledEntryAddress,
		loadAddressStart,
		segments
	} = assemble(assemblyCode, { filePath: assemblyFilePath });

	if (errors.length > 0) {
		printErrors(errors);
		process.exitCode = 1;
		return;
	}

	let dataStatements;
	try {
		dataStatements = generateDataStatements(segments, dataFormat);
	} catch (error) {
		printErrors([createErrorRecord(assemblyFilePath, 1, null, error)]);
		process.exitCode = 1;
		return;
	}

	const loadAddress = loadAddressStart ?? (segments && segments.length > 0 ? segments[0].start : 0);
	const entryPointAddress = assembledEntryAddress ?? loadAddress;

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
		printErrors([createErrorRecord(assemblyFilePath, 1, null, error)]);
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
