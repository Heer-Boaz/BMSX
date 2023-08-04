interface Token {
    type: string;
    value: string | number;
}

interface Statement {
    type: string;
    // Add any additional properties needed for each statement type
    expression?: Expression;
    variable?: string;
    condition?: Expression;
    lineNumber: number;
    trueBranch?: Statement;
    value?: Expression;
}

interface Expression {
    type: string;
    // Add any additional properties needed for each expression type
    left?: Expression;
    right?: Expression;
    value?: any;
    operator?: string;
}

interface Program {
    statements: Statement[];
}

const OPERATOR_REGEX = /^[\+\-\*\/\=\<\>\^\\:|\bAND\b|\bOR\b|\bNOT\b|\bXOR\b|\bMOD\b|\bIMP\b|\bEQV\b]/;
class Lexer {
    private input: string;
    private current: number;

    constructor() {
        this.current = 0;
    }

    public setInput(input: string): void {
        this.input = input;
        this.current = 0;
    }

    public getNextToken(): Token | null {
        if (this.current >= this.input.length) {
            return null;
        }

        const char = this.input[this.current];
        switch (char) {
            case ' ':
                this.current++;
                return this.getNextToken();
            case '\n':
                this.current++;
                return { type: "EOL", value: "\n" };
            case ':':
                this.current++;
                return { type: "COLON", value: ":" };
            case ',':
                this.current++;
                return { type: "COMMA", value: "," };
            case '"':
                return this.readString();
        }

        if (/^[0-9]/.test(char) && (this.current === 0 || this.input[this.current - 1] === "\n")) {
            return this.readToken(/^[0-9]/, "LINENUMBER");
        }

        if (/^[0-9]/.test(char)) {
            return this.readToken(/^[0-9\.xXoObB]/, "NUMBER");
        }

        if (/[A-Za-z]/.test(char)) {
            return this.readIdentifierOrKeyword();
        }

        if (OPERATOR_REGEX.test(char)) {
            return this.readToken(OPERATOR_REGEX, "OPERATOR");
        }

        throw new Error(`Invalid character: ${char}`);
    }

    private readString(): Token {
        let value = "";
        let char = "";

        this.current++;

        while (this.current < this.input.length) {
            char = this.input[this.current];

            if (char === '"') {
                this.current++;
                return { type: "STRING", value };
            }

            value += char;
            this.current++;
        }

        throw new Error("Unterminated string");
    }

    private readToken(regex: RegExp, type: string): Token {
        let value = "";
        let char = "";

        while (this.current < this.input.length) {
            char = this.input[this.current];

            if (!regex.test(char)) {
                break;
            }

            value += char;
            this.current++;
        }

        switch (type) {
            case 'NUMBER':
                if (value.includes('.')) {
                    return { type: 'FLOAT', value: parseFloat(value) };
                } else if (value.startsWith('0x')) {
                    return { type: 'HEX', value: parseInt(value, 16) };
                } else if (value.startsWith('0o')) {
                    return { type: 'OCT', value: parseInt(value, 8) };
                } else if (value.startsWith('0b')) {
                    return { type: 'BIN', value: parseInt(value.slice(2), 2) };
                } else {
                    return { type: 'INTEGER', value: parseInt(value) };
                }
            case 'LINENUMBER':
                return { type: 'LINENUMBER', value: parseInt(value) };
            default:
                return { type, value };
        }
    }

    private readIdentifierOrKeyword(): Token {
        const keywords = [
            "FOR", "NEXT", "GOSUB", "GOTO", "RETURN", "CALL", "PAUSE", "GET", "DATE", "TIME", "INTERVAL", "ON", "IF", "THEN", "ELSE", "NOT", "ASC", "BIN$", "CDBL", "CHR$", "CINT", "CSNG", "HEX$", "OCT$", "STR$", "VAL", "BLOAD", "BSAVE", "CLOAD", "CLOAD?", "CLOSE", "CSAVE", "EOF", "LOAD", "MAXFILES", "MERGE", "MOTOR", "OPEN", "RUN", "SAVE", "VARPTR", "CONT", "FRE", "TROFF", "TRON", "COPY", "SCREEN", "SET", "VIDEO", "CIRCLE", "CLS", "COLOR", "COLOR=", "COPY", "CSRLIN", "DRAW", "LINE", "LOCATE", "PAINT", "POINT", "POS", "PRESET", "PRINT", "PSET", "PUT", "KANJI", "ADJUST", "PAGE", "SCROLL", "SPC", "TAB", "WIDTH", "ERL", "ERR", "ERROR", "RESUME", "INP", "OUT", "WAIT", "ADJUST", "INKEY$", "INPUT", "INPUT$", "KEY", "LINE", "ON", "STOP", "STRIG", "OPEN", "PAD", "PDL", "STICK", "ABS", "EXP", "FIX", "FN", "INT", "LOG", "RND", "SGN", "SQR", "DEF", "USR", "LLIST", "LPOS", "LPRINT", "AUTO", "DELETE", "LIST", "NEW", "REM", "RENUM", "SET", "PASSWORD", "PROMPT", "TITLE", "PEEK", "POKE", "BEEP", "PCMPLAY", "PCMREC", "PLAY", "SOUND", "SPRITE", "SPRITE$", "PUT", "INSTR", "LEFT$", "LEN", "MID$", "RIGHT$", "SPACE$", "STRING$", "ATN", "COS", "SIN", "TAN", "CLEAR", "DATA", "DEFDBL", "DEFINT", "DEFSNG", "DEFSTR", "DIM", "ERASE", "LET", "READ", "RESTORE", "SWAP", "BASE", "VDP", "VPEEK", "VPOKE", "END",
        ];

        let value = "";
        let char = "";

        while (this.current < this.input.length) {
            char = this.input[this.current];

            if (!/[A-Za-z0-9$]/.test(char)) {
                break;
            }

            value += char;
            this.current++;
        }

        return keywords.includes(value.toUpperCase()) ? { type: value.toUpperCase(), value } : { type: "IDENTIFIER", value };
    }
}

export class Parser {
    private lexer: Lexer;
    private currentToken: Token | null;
    private currentLineNumber: number;

    constructor() {
        this.lexer = new Lexer();
        this.currentToken = null;
        this.currentLineNumber = 0;
    }

    public parse(input: string): Program {
        this.lexer.setInput(input);
        this.currentToken = this.lexer.getNextToken();
        const program: Program = { statements: [] };
        while (this.currentToken !== null) {
            // console.log(this.currentToken);
            const statement = this.parseStatement();
            if (statement) program.statements.push(statement);
            // this.currentToken = this.lexer.getNextToken();
        }

        for (const statement of program.statements) {
            console.log(statement);
        }
        return program;
    }

    private parseStatement(): Statement | null {
        const token = this.currentToken;
        let statement: Statement = null;
        let lineNumber = this.currentLineNumber;
        switch (token.type) {
            case 'LINENUMBER':
                this.currentLineNumber = token.value as number;
                break;
            case 'EOL':
            case 'COLON':
                break;
            case 'PRINT':
                this.currentToken = this.lexer.getNextToken();
                const expression = this.parseExpression();
                statement = { type: 'PRINT', lineNumber, expression };
                break;
            case 'LET':
                statement = this.parseLetStatement();
                break;
            case 'IDENTIFIER':
                statement = this.parseLetStatement(true);
                break;
            case 'IF':
                this.currentToken = this.lexer.getNextToken();
                const condition = this.parseExpression();
                if ((this.currentToken.value as string).toUpperCase() !== 'THEN') {
                    throw new Error('Expected "THEN"');
                }
                this.currentToken = this.lexer.getNextToken();
                const trueBranch = this.parseStatement();
                statement = { type: 'IF', lineNumber, condition, trueBranch };
                break;
            case 'GOTO':
                this.currentToken = this.lexer.getNextToken();
                const value = this.currentToken.value as number;
                statement = { type: 'GOTO', lineNumber, value: { type: 'NUMBER', value } };
                break;
            case 'END':
                statement = { type: 'END', lineNumber };
                break;
            default:
                throw new Error(`Unexpected token of type ${token.type} "${token.value}"`);
        }
        this.currentToken = this.lexer.getNextToken();
        return statement;
    }

    private parseLetStatement(skipLet: boolean = false): Statement {
        if (!skipLet) this.currentToken = this.lexer.getNextToken();
        const variable = this.currentToken.value;
        if (this.currentToken.type !== 'IDENTIFIER') {
            throw new Error(`Expected IDENTIFIER, got ${this.currentToken.type}`);
        }
        this.currentToken = this.lexer.getNextToken();
        if (this.currentToken.type !== 'OPERATOR' && this.currentToken.value !== '=') {
            throw new Error(`Expected OPERATOR with value "=", got ${this.currentToken.type} with value "${this.currentToken.value}" instead.`);
        }
        this.currentToken = this.lexer.getNextToken();
        const expression = this.parseExpression();
        return { type: 'LET', lineNumber: this.currentLineNumber, variable: variable as string, expression };
    }

    private parseExpression(): Expression {
        let left = this.parseTerm();
        while (this.currentToken.type === 'PLUS' || this.currentToken.type === 'MINUS') {
            const operator = this.currentToken.value as string;
            this.currentToken = this.lexer.getNextToken();
            const right = this.parseTerm();
            left = { type: 'BINARY', operator, left, right };
        }
        return left.type === 'STRING' ? { type: 'STRING_LITERAL', value: left.value } : left;
    }

    private parseTerm(): Expression {
        let left = this.parseFactor();
        while (this.currentToken.type === 'MULTIPLY' || this.currentToken.type === 'DIVIDE') {
            const operator = this.currentToken.value as string;
            this.currentToken = this.lexer.getNextToken();
            const right = this.parseFactor();
            left = { type: 'BINARY', operator, left, right };
        }
        return left.type === 'STRING' ? { type: 'STRING_LITERAL', value: left.value } : left;
    }

    private parseFactor(): Expression {
        const token = this.currentToken;
        switch (token.type) {
            case 'INTEGER':
                this.currentToken = this.lexer.getNextToken();
                return { type: 'INTEGER', value: token.value };
            case 'STRING':
                this.currentToken = this.lexer.getNextToken();
                return { type: 'STRING', value: token.value };
            case 'IDENTIFIER':
                this.currentToken = this.lexer.getNextToken();
                return { type: 'VARIABLE', value: token.value };
            case 'LPAREN':
                this.currentToken = this.lexer.getNextToken();
                const expression = this.parseExpression();
                if (this.currentToken.type !== 'RPAREN') {
                    throw new Error('Expected RPAREN');
                }
                this.currentToken = this.lexer.getNextToken();
                // return expression;
                return { type: 'EXPRESSION', value: expression };
            default:
                throw new Error(`Unexpected token of type ${token.type} "${token.value}"`);
        }
    }

    private evaluateExpression(expression: Expression): any {
        switch (expression.type) {
            case 'NUMBER':
            case 'INTEGER':
            case 'FLOAT':
            case 'STRING_LITERAL':
            case 'VARIABLE':
                return expression.value;
            case 'EXPRESSION':
                return this.evaluateExpression(expression.value);
            case 'BINARY':
                const left = this.evaluateExpression(expression.left);
                const right = this.evaluateExpression(expression.right);
                switch (expression.operator) {
                    case '+':
                        return left + right;
                    case '-':
                        return left - right;
                    case '*':
                        return left * right;
                    case '/':
                        return left / right;
                    default:
                        throw new Error(`Unexpected operator ${expression.operator}`);
                }
            default:
                throw new Error(`Unexpected expression type ${expression.type}`);
        }
    }
}

const input = `
10 PRINT \"Hello, world 11!\"
15 A=3:PRINT\"BLADIEBLAP\"
20 END
`;
const parser = new Parser();
const program = parser.parse(input);