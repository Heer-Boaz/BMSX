const fs = require('fs');
const path = require('path');

const TO_HEX = false;
const DATA_LINE_NUMBER_START = 10000;
const DATA_LINE_NUMBER_INCREMENT = 1;
const DATA_BYTES_PER_LINE = TO_HEX ? 64 : 16;

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
const sixteenBitRegisters = ['BC', 'DE', 'HL', 'SP', 'IX', 'IY'];

/**
 * An array containing all the registers, including both 8-bit and 16-bit registers.
 *
 * @constant {Array} allRegisters
 */
const allRegisters = [...eightBitRegisters, ...sixteenBitRegisters];

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
const conditionCodes = ['NZ', 'Z', 'NC', 'C'];

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
const regex = /([A-Za-z_][A-Za-z0-9_]*:)|([A-Za-z_][A-Za-z0-9_]*\b)|(\$?[#]?[0-9A-Fa-f]+[Hh]?|\'.\'|\".*?\"|\d+)|([,\(\)])|(\S)/g;
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
    // Data Transfer Instructions
    'LD A,n': [0x3E, 'n'],
    'LD B,n': [0x06, 'n'],
    'LD C,n': [0x0E, 'n'],
    'LD D,n': [0x16, 'n'],
    'LD E,n': [0x1E, 'n'],
    'LD H,n': [0x26, 'n'],
    'LD L,n': [0x2E, 'n'],
    'LD HL,nn': [0x21, 'nn_low', 'nn_high'],
    'LD DE,nn': [0x11, 'nn_low', 'nn_high'],
    'LD SP,nn': [0x31, 'nn_low', 'nn_high'],
    'LD BC,nn': [0x01, 'nn_low', 'nn_high'],
    'LD (addr),A': [0x32, 'addr_low', 'addr_high'],
    'LD A,(addr)': [0x3A, 'addr_low', 'addr_high'],
    'LD (addr),HL': [0x22, 'addr_low', 'addr_high'],
    'LD HL,(addr)': [0x2A, 'addr_low', 'addr_high'],
    'LD (HL),n': [0x36, 'n'],
    'LD A,(HL)': [0x7E],
    'LD (HL),A': [0x77],
    'LD H,A': [0x67],
    'LD L,A': [0x6F],
    'LD A,H': [0x7C],
    'LD A,L': [0x7D],
    'LD B,A': [0x47],
    'LD C,A': [0x4F],
    'LD D,A': [0x57],
    'LD E,A': [0x5F],
    'LD A,B': [0x78],
    'LD A,C': [0x79],
    'LD A,D': [0x7A],
    'LD A,E': [0x7B],
    'LD SP,HL': [0xF9],
    'LD C,0': [0x0E, 0x00],
    'LD B,0': [0x06, 0x00],
    // Arithmetic and Logical Instructions
    'INC A': [0x3C],
    'INC B': [0x04],
    'INC C': [0x0C],
    'INC D': [0x14],
    'INC E': [0x1C],
    'INC H': [0x24],
    'INC L': [0x2C],
    'INC HL': [0x23],
    'INC DE': [0x13],
    'DEC A': [0x3D],
    'DEC B': [0x05],
    'DEC C': [0x0D],
    'DEC D': [0x15],
    'DEC E': [0x1D],
    'DEC H': [0x25],
    'DEC L': [0x2D],
    'DEC HL': [0x2B],
    'DEC DE': [0x1B],
    'ADD A,n': [0xC6, 'n'],
    'SUB n': [0xD6, 'n'],
    'CP n': [0xFE, 'n'],
    'AND n': [0xE6, 'n'],
    'OR n': [0xF6, 'n'],
    'XOR A': [0xAF],
    'OR A': [0xB7],
    'CP 1': [0xFE, 0x01],
    'CP MAX_X': [0xFE, 'n'],
    'CP MAX_Y': [0xFE, 'n'],
    'CP 0': [0xFE, 0x00],
    // Bit Operations
    // These are handled specially in the encodeInstruction function
    // Jump and Call Instructions
    'CALL nn': [0xCD, 'nn_low', 'nn_high'],
    'JP nn': [0xC3, 'nn_low', 'nn_high'],
    'JP NZ,nn': [0xC2, 'nn_low', 'nn_high'],
    'JP Z,nn': [0xCA, 'nn_low', 'nn_high'],
    'JP NC,nn': [0xD2, 'nn_low', 'nn_high'],
    'JP C,nn': [0xDA, 'nn_low', 'nn_high'],
    'JR e': [0x18, 'e'],
    'JR NZ,e': [0x20, 'e'],
    'JR Z,e': [0x28, 'e'],
    'JR NC,e': [0x30, 'e'],
    'JR C,e': [0x38, 'e'],
    'RET': [0xC9],
    // CPU Control Instructions
    'EI': [0xFB],
    'DI': [0xF3],
    'HALT': [0x76],
    // Rotate and Shift Instructions
    'RLCA': [0x07],
    'RRCA': [0x0F],
    'RLA': [0x17],
    'RRA': [0x1F],
    'RLC A': [0xCB, 0x07],
    'RRC A': [0xCB, 0x0F],
    'RL A': [0xCB, 0x17],
    'RR A': [0xCB, 0x1F],
    // Miscellaneous Instructions
    'NOP': [0x00],
    'SCF': [0x37],
    'CCF': [0x3F],
    'CPL': [0x2F],
    'DAA': [0x27],
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
    // Stack Operations
    'PUSH AF': [0xF5],
    'POP AF': [0xF1],
    'PUSH BC': [0xC5],
    'POP BC': [0xC1],
    'PUSH DE': [0xD5],
    'POP DE': [0xD1],
    'PUSH HL': [0xE5],
    'POP HL': [0xE1],
    // Input/Output Instructions
};

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
        return `0x${p1}`;
    });
    expr = expr.replace(/\$([0-9A-Fa-f]+)/g, (match, p1) => {
        return `0x${p1}`;
    });
    expr = expr.replace(/#([0-9A-Fa-f]+)/g, (match, p1) => {
        return `0x${p1}`;
    });
    expr = expr.replace(/([0-9A-Fa-f]+)[Hh]/g, (match, p1) => {
        return `0x${p1}`;
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
    const normalizedOperands = operands.map(op => {
        // Check if the operand is a 16-bit register
        if (sixteenBitRegisters.includes(op.toUpperCase())) {
            return op.toUpperCase();
        } else if (eightBitRegisters.includes(op.toUpperCase())) {
            return op.toUpperCase();
        } else if (op.startsWith('(') && op.endsWith(')')) {
            // Check if the operand is a memory address that is dereferenced by a register
            const addr = op.slice(1, -1);
            if (allRegisters.includes(addr.toUpperCase())) {
                return `(${addr.toUpperCase()})`;
            } else {
                return '(addr)';
            }
        } else if (/^'.'$/s.test(op)) {
            // Character literal
            return 'n';
        } else if (!isNaN(parseInt(op))) {
            return 'n';
        } else {
            return op;
        }
    });
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
                // Decide placeholder based on mnemonic
                // For example 'LD HL,nn', the second operand should be 'nn' instead of 'n' (16-bit register)
                if (mnemonic === 'LD' && idx === 1 && sixteenBitRegisters.includes(operands[0].toUpperCase())) {
                    return 'nn';
                }
                // Also, 'LD (xx), name' should be 'n' (memory address) and we need to verify the first operand to be a 16-bit register)
                else if (mnemonic === 'LD' && idx === 1 && operands[0].startsWith('(') && operands[0].endsWith(')')) {
                    // Check if the first operand is a 16-bit register
                    const firstOperand = operands[0].slice(1, -1);
                    if (sixteenBitRegisters.includes(firstOperand)) {
                        return 'n';
                    }
                    // If not, it's an invalid instruction
                    throw new Error(`Line ${lineNumber}: Invalid instruction (only 16-bit registers are allowed as operands for memory addresses): ${mnemonic} ${operands.join(',')}\n"${line}"`);
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
        const bitNumber = resolvedOperands[0];
        const register = resolvedOperands[1];

        // Get register code
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
        let opcodePrefix = 0xCB;
        let opcode;
        if (mnemonic === 'BIT') {
            opcode = 0x40 + (bitNumber << 3) + regCode;
        } else if (mnemonic === 'SET') {
            opcode = 0xC0 + (bitNumber << 3) + regCode;
        } else if (mnemonic === 'RES') {
            opcode = 0x80 + (bitNumber << 3) + regCode;
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
            if (mnemonic === 'LD' && operands.length === 2 && sixteenBitRegisters.includes(operands[0].toUpperCase())) {
                value = resolvedOperands[1];
            } else {
                value = resolvedOperands[0];
            }
            if (typeof value !== 'number') {
                throw new Error(`Line ${lineNumber}: Invalid address value: ${value}\n"${line}"`);
            }
            if (byte === 'nn_low') {
                opcodeBytes.push(value & 0xFF);
            } else {
                opcodeBytes.push((value >> 8) & 0xFF);
            }
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
function assemble(assemblyCode) {
    const lines = assemblyCode.split('\n');
    let locationCounter = 0;
    const machineCode = [];
    const instructions = [];

    // First pass: parse lines and build symbol table
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const tokens = tokenize(line);
        if (tokens.length === 0) continue;

        const instruction = parse(tokens);

        if (instruction.label) {
            symbolTable[instruction.label] = locationCounter;
        }

        if (instruction.directive) {
            if (instruction.directive === 'DB' || instruction.directive === 'DW') {
                // Compute size of data
                let size = 0;
                for (let operand of instruction.operands) {
                    if (/^".*"$/.test(operand)) {
                        // String: each character is one byte
                        size += operand.length - 2; // Exclude quotes
                    } else {
                        if (instruction.directive === 'DB') {
                            size += 1;
                        } else if (instruction.directive === 'DW') {
                            size += 2;
                        }
                    }
                }
                instruction.size = size;
                instructions.push({ ...instruction, locationCounter, lineNumber: i + 1, line });
                locationCounter += size;
            } else {
                locationCounter = handleDirective(instruction, locationCounter, i + 1, line);
            }
        } else if (instruction.mnemonic) {
            // Estimate size based on opcode template
            let key = instruction.mnemonic;
            let operands = instruction.operands;
            // Updated operand normalization
            const normalizedOperands = operands.map((op, idx) => {
                const upperOp = op.toUpperCase();
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
                } else if (/^'.'$/s.test(op) || !isNaN(parseInt(op))) {
                    return 'n';
                } else {
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
                        if (idx === 1 && sixteenBitRegisters.includes(operands[0].toUpperCase())) {
                            return 'nn';
                        } else {
                            return 'n';
                        }
                    } else {
                        return 'n';
                    }
                }
            });
            if (normalizedOperands.length > 0) {
                key += ' ' + normalizedOperands.join(',');
            }

            let opcodeTemplate = opcodeMap[key];
            if (!opcodeTemplate) {
                // Handle special cases
                if (instruction.mnemonic === 'JR') {
                    instruction.size = 2;
                } else if (['BIT', 'SET', 'RES'].includes(instruction.mnemonic)) {
                    instruction.size = 2;
                } else {
                    // Check whether the assembly code contains an invalid instruction or whether it contains a valid instruction, but an invalid operand
                    if (validMnemonic.includes(instruction.mnemonic)) {
                        throw new Error(`Line ${instruction.lineNumber}: Invalid operand(s) for instruction: ${key}\n"${line}"`);
                    } else {
                        throw new Error(`Line ${instruction.lineNumber}: Unknown instruction during first pass: ${key}\n"${line}"`);
                    }
                }
            } else {
                instruction.size = opcodeTemplate.length;
            }
            instructions.push({ ...instruction, locationCounter, lineNumber: i + 1, line });
            locationCounter += instruction.size;
        }
    }

    // Second pass: encode instructions
    for (const instr of instructions) {
        const opcodeBytes = encodeInstruction(instr, instr.locationCounter, instr.lineNumber, instr.line);
        instr.bytes = opcodeBytes; // Store bytes for later use
        machineCode.push(...opcodeBytes);
    }

    return machineCode;
}

/**
 * Generates data statements from machine code.
 *
 * @param {Uint8Array} machineCode - The machine code to be converted into data statements.
 * @returns {string[]} An array of data statements.
 *
 * @constant {number} DATA_LINE_NUMBER_START - The starting line number for the data statements.
 * @constant {number} DATA_BYTES_PER_LINE - The number of bytes per line in the data statements.
 * @constant {boolean} TO_HEX - Flag indicating whether to format the data as hexadecimal.
 * @constant {number} DATA_LINE_NUMBER_INCREMENT - The increment for the line numbers.
 */
function generateDataStatements(machineCode) {
    let dataLines = [];
    let lineNumber = DATA_LINE_NUMBER_START;

    for (let i = 0; i < machineCode.length; i += DATA_BYTES_PER_LINE) {
        const bytes = machineCode.slice(i, i + DATA_BYTES_PER_LINE);
        if (TO_HEX) {
            // const hexBytes = bytes.map(byte => byte.toString(16).toUpperCase().padStart(2, '0')).join(', ');
            // dataLines.push(`${lineNumber} DATA ${hexBytes}`);
            const hexBytes = bytes.map(byte => `${byte.toString(16).toUpperCase().padStart(2, '0')}`).join('');
            dataLines.push(`${lineNumber} DATA "${hexBytes}"`);
        }
        else {
            const decBytes = bytes.join(', ');
            dataLines.push(`${lineNumber} DATA ${decBytes}`);
        }
        lineNumber += DATA_LINE_NUMBER_INCREMENT;
    }

    return dataLines;
}

/**
 * Generates a boilerplate code for loading and running a program in memory.
 *
 * @param {number} datalineCount - The number of data lines to be included in the boilerplate.
 * @returns {string} The generated boilerplate code as a string.
 */
function generateBoilerPlate(datalineCount) {
    // const toHexBoilerPlate = `1030 READ A$: POKE AD,VAL("&H"+A$):AD=AD+1: PRINT ".";: IF A$ <> "C9" THEN 1030`
    const toHexBoilerPlate = `1040 READ A$: FOR I = 1 TO LEN(A$) STEP 2: B$ = MID$(A$, I, 2): POKE AD, VAL("&H" + B$): AD = AD + 1: NEXT I: PRINT ".";: IF B$ <> "C9" THEN 1040`
    const toDecBoilerPlate = `1040 READ A: POKE AD, A: AD = AD + 1: IF AD MOD 16 = 0 THEN PRINT ".";
1050 IF A <> 201 THEN 1040 ELSE IF AD MOD 16 <> 0 THEN PRINT ".";`;
    return `1000 ' Put program to memory
1010 DEFINT A-Z:AD=&HD000
1020 PRINT "Laderen:"
1030 PRINT "[";: LOCATE ${datalineCount + 1}: PRINT "]";: LOCATE 1
${TO_HEX ? toHexBoilerPlate : toDecBoilerPlate}
1100 PRINT ""
2000 ' Run da program!!
2010 PRINT "Ik heb de boel geladen, nu starten we de boel! Klaar?"
2020 DEFUSR=&HD000 ' This defines USR() start address
2030 PRINT "KABOEMMMM!!!"
2040 X=USR(0)`
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
try {
    const assemblyFilePath = process.argv[2] || path.join(__dirname, 'assemblycode.asm');
    let outputFilePathIndex = process.argv.indexOf('-o') + 1;
    let outputFilePath;
    if (outputFilePathIndex >= process.argv.length) {
        throw new Error('Output file path not provided, while -o flag is used. I am very disappointed in you');
    }
    if (outputFilePathIndex === 0) {
        outputFilePath = assemblyFilePath.replace('.asm', '.bas');
    } else {
        outputFilePath = process.argv[outputFilePathIndex];
    }
    let assemblyCode;
    let machineCode;
    try {
        assemblyCode = fs.readFileSync(assemblyFilePath, 'utf8');
    }
    catch (error) {
        throw new Error(`Error reading assembly file: ${error.message}`);
    }
    try {
        machineCode = assemble(assemblyCode);
    } catch (error) {
        throw new Error(`Assembly error: ${error.message}`);
    }
    const dataStatements = generateDataStatements(machineCode);
    const boilerPlate = generateBoilerPlate(dataStatements.length);
    console.log(colors.blue + boilerPlate + colors.reset);
    console.log(colors.green + dataStatements.join('\n') + colors.reset);
    const outputContent = boilerPlate + '\n' + dataStatements.join('\n');
    fs.writeFileSync(outputFilePath, outputContent, 'utf8');
    console.log(colors.yellow + `Assembly output written to ${outputFilePath}` + colors.reset);
} catch (error) {
    console.error(colors.red + error.message + colors.reset);
}