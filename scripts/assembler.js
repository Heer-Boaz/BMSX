const TO_HEX = false;
const DATA_LINE_NUMBER_START = 10000;
const DATA_LINE_NUMBER_INCREMENT = 1;
const DATA_BYTES_PER_LINE = TO_HEX ? 64 : 16;

const assemblyCode = `
ORG 0xD000				; Start address for our routine in RAM

KEYS:					EQU #FBE5	; Memory location for the input matrix
RETURN_VALUE:			EQU #F7F8	; Memory location to store the return value for BASIC
CLS:					EQU #00C3	; BIOS call to CLS
INITXT:					EQU #050E	; BIOS call to set text mode (screen 0)
INIT32:					EQU #006F	; BIOS call to set screen mode 32 (screen 1)
INIGRP:					EQU #05D2	; BIOS call to set graphics mode (screen 2)
INIMLT:					EQU #061F	; BIOS call to set multicolor mode (screen 3)
POSIT:					EQU #00C6	; BIOS call to set cursor position (LOCATE X, Y)
CHGMOD:    				EQU #005F	; BIOS call to change screen mode
CHPUT:					EQU #00A2	; BIOS call to print a character on screen
CHGCLR:					EQU #0062	; BIOS call to change screen colors
FORCLR:					EQU #F3E9	; Foreground colour memory location
ERAFNK:					EQU #00CC	; Erase function key display
CLIKSW:					EQU #F3DB	; Key Press Click Switch: 0=Off 1=On
COORD:					EQU #E001	; Memory address to store XY coordinates
MAX_X:					EQU 29		; Maximum X-coordinate (1-based, 40 columns for text mode)
MAX_Y:					EQU 24		; Maximum Y-coordinate (1-based)
MIN_X:					EQU 1		; Minimum X-coordinate
MIN_Y:					EQU 1		; Minimum Y-coordinate
PLAYER_CHAR:			EQU 175		; Character to represent the player on screen

START:
    ; Disable key click sound
    XOR A							; Faster than LD A, 0
    LD (CLIKSW), A					; 0 = Click sound off

    CALL ERAFNK						; Disable function key display

    XOR A                           ; Clear A register
    CALL INIT32						; Set screen mode 32 (SCREEN 1)

    ; Change colours
    LD HL,FORCLR					; Load the address of the foreground colour memory location
    LD (HL), 15						; Set the foreground colour to white
    INC HL							; Move to the background colour memory location
    LD (HL), 1						; Set the background colour to black
    INC HL							; Move to the border colour memory location
    LD (HL), 4						; Set the border colour to blue
    CALL CHGCLR						; Call the BIOS to change the screen colours

    LD A, MIN_X                     ; Set the initial X-coordinate
    LD (COORD), A                   ; Store the X-coordinate in memory
    LD A, MIN_Y                     ; Set the initial Y-coordinate
    LD (COORD+1), A                 ; Store the Y-coordinate in memory

GAME_LOOP:
    ; Read X and Y coordinates from BASIC
    LD A, (COORD)					; Load X-coordinate from memory location 0xE001
    LD H, A							; H = Column
    LD A, (COORD+1)					; Load Y-coordinate from memory location 0xE002
    LD L, A							; L = Row

    CALL POSIT						; Call BIOS to set the cursor position
    LD A, ' '						; Character to print at the cursor position
    CALL CHPUT

    ; Handle directional input
    LD C, 0
    LD A, (KEYS+8)					; Get the input matrix
    LD B, 0							; Clear register B to store direction

    BIT 6, A						; Check if Down key is pressed (row 8, bit 6)
    JR NZ, SKIP_DOWN				; If Down key is pressed, skip the next instruction
    INC L							; Move down (increase Y coordinate)
    SET 1, B						; Set bit 1 for Down direction
SKIP_DOWN:

    BIT 5, A						; Check if Up key is pressed (row 8, bit 5)
    JR NZ, SKIP_UP					; If Up key is pressed, skip the next instruction
    DEC L							; Move up (decrease Y coordinate)
    SET 0, B						; Set bit 0 for Up direction
SKIP_UP:

    BIT 4, A						; Check if Left key is pressed (row 8, bit 4)
    JR NZ, SKIP_LEFT				; If Left key is pressed, skip the next instruction
    DEC H							; Move left (decrease X coordinate)
    SET 2, B						; Set bit 2 for Left direction
SKIP_LEFT:

    BIT 7, A						; Check if Right key is pressed (row 8, bit 7)
    JR NZ, SKIP_RIGHT				; If Right key is pressed, skip the next instruction
    INC H							; Move right (increase X coordinate)
    SET 3, B						; Set bit 3 for Right direction
SKIP_RIGHT:

    BIT 0, A						; Check if Space key is pressed (row 8, bit 0)
    JR NZ, SKIP_SPACE				; If Space key is pressed, skip the next instruction
    SET 4, B						; Set bit 3 for Space
    LD C, 1
SKIP_SPACE:

    ; Ensure X and Y are within screen bounds
    LD A, H							; Store X-coordinate in A
    CP MAX_X						; Check if X >= MAX_X
    JR NC, SET_X_MAX				; If X is out of bounds, set to maximum
    CP 1							; Check if X < MIN_X
    JR C, SET_X_MIN					; If X is less than MIN_X, set to minimum
    JR CONTINUE_X					; If X is within bounds, continue

SET_X_MIN:
    LD H, 1							; Set X to minimum
    JR CONTINUE_X					; Continue to check Y
SET_X_MAX:
    LD H, MAX_X						; Set X to maximum
CONTINUE_X:
    LD A, L							; Store Y-coordinate in A
    CP MAX_Y						; Check if Y >= MAX_Y
    JR NC, SET_Y_MAX				; If Y is out of bounds, set to maximum
    CP 1							; Check if Y < MIN_Y
    JR C, SET_Y_MIN					; If Y is less than MIN_Y, set to minimum
    JR CONTINUE_Y					; If Y is within bounds, continue

SET_Y_MIN:
    LD L, 1							; Set Y to minimum
    JR CONTINUE_Y					; Continue to update coordinates
SET_Y_MAX:
    LD L, MAX_Y						; Set Y to maximum
CONTINUE_Y:

    ; Update coordinates in memory
    LD A, H							; Store updated X-coordinate
    LD (COORD), A					; Store the updated X-coordinate in memory
    LD A, L							; Store updated Y-coordinate
    LD (COORD+1), A					; Store the updated Y-coordinate in memory

    CALL POSIT						; Call BIOS to set the cursor position
    LD A, PLAYER_CHAR				; Character to print at the cursor position
    CALL CHPUT						; Print the player character

    LD A, C							; Store the return value in A
    CP 1							; Check if the Space key was pressed
    JR Z, GA_TERUG					; If the Space key was pressed, return to BASIC

    ; Wait for V-Sync
WAIT_VSYNC:
    EI								; Enable interrupts
    HALT							; Wait for VSync interrupt

    JP GAME_LOOP					; Loop back to the beginning of the game loop
GA_TERUG:
    ; Set return value for BASIC
    LD A, B							; Move the value from B to A to return the result
    LD (RETURN_VALUE), A			; Store the return value
    RET								; Return to BASIC

END START							; End of the program and define the entry point
`;

const eightBitRegisters = ['A', 'B', 'C', 'D', 'E', 'H', 'L'];
const sixteenBitRegisters = ['BC', 'DE', 'HL', 'SP', 'IX', 'IY'];
const allRegisters = [...eightBitRegisters, ...sixteenBitRegisters];
const conditionCodes = ['NZ', 'Z', 'NC', 'C']; // Not Zero, Zero, No Carry, Carry
const validMnemonic = ['LD', 'INC', 'DEC', 'ADD', 'SUB', 'CP', 'AND', 'OR', 'XOR', 'RLCA', 'RRCA', 'RLA', 'RRA', 'RLC', 'RRC', 'RL', 'RR', 'NOP', 'SCF', 'CCF', 'CPL', 'DAA', 'NEG', 'EI', 'DI', 'HALT', 'RET', 'JP', 'JR', 'CALL', 'SET', 'RES', 'BIT', 'PUSH', 'POP'];
const regex = /([A-Za-z_][A-Za-z0-9_]*:)|([A-Za-z_][A-Za-z0-9_]*\b)|(\$?[#]?[0-9A-Fa-f]+[Hh]?|\'.\'|\".*?\"|\d+)|([,\(\)])|(\S)/g;

// 1. Lexical Analysis: Tokenize Assembly Code
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

// 2. Parsing: Parse Tokens to Build Instruction Representation
function parse(tokens) {
    const instruction = {
        label: null,
        mnemonic: null,
        operands: [],
        directive: null,
        args: []
    };

    let index = 0;

    const directives = ['EQU', 'ORG', 'END', 'DB', 'DW'];
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

// 3. Symbol Table Management: Handle Labels and Constants
const symbolTable = {};

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

// 4. Instruction Encoding: Convert Assembly Instructions to Machine Code
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
    // Add more SET instructions as needed
    'BIT 0,A': [0xCB, 0x47],
    'BIT 1,A': [0xCB, 0x4F],
    'BIT 2,A': [0xCB, 0x57],
    'BIT 3,A': [0xCB, 0x5F],
    'BIT 4,A': [0xCB, 0x67],
    'BIT 5,A': [0xCB, 0x6F],
    'BIT 6,A': [0xCB, 0x77],
    'BIT 7,A': [0xCB, 0x7F],
    // Add more BIT instructions as needed
    // Stack Operations
    'PUSH AF': [0xF5],
    'POP AF': [0xF1],
    'PUSH BC': [0xC5],
    'POP BC': [0xC1],
    'PUSH DE': [0xD5],
    'POP DE': [0xD1],
    'PUSH HL': [0xE5],
    'POP HL': [0xE1],
    // Input/Output Instructions (Not used in your code but included for completeness)
    // ...
    // Add any other instructions required by your assembly code
};

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

    // Normalize the operands to form the correct key
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
        const conditionCodesMap = {
            '': 0x18,
            'NZ': 0x20,
            'Z': 0x28,
            'NC': 0x30,
            'C': 0x38
        };
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

// 5. Assembling the Entire Code: Assemble Function
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

// 6. Generating MSX BASIC DATA Statements
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

// Assemble the code
try {
    const machineCode = assemble(assemblyCode);
    const dataStatements = generateDataStatements(machineCode);
    const boilerPlate = generateBoilerPlate(dataStatements.length);
    console.log(colors.blue + boilerPlate + colors.reset);
    console.log(colors.green + dataStatements.join('\n') + colors.reset);
} catch (error) {

    console.error(colors.red + 'Assembly error:', error.message + colors.reset);
}