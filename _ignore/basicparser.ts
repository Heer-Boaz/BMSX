interface Token {
    type: string;
    value: string;
}

class Lexer {
    private input: string;
    private current: number;

    constructor(input: string) {
        this.input = input;
        this.current = 0;
    }

    public getNextToken(): Token | null {
        if (this.current >= this.input.length) {
            return null;
        }

        const char = this.input[this.current];

        if (char === " ") {
            this.current++;
            return this.getNextToken();
        }

        if (char === "\n") {
            this.current++;
            return { type: "EOL", value: "\n" };
        }

        if (char === ":") {
            this.current++;
            return { type: "COLON", value: ":" };
        }

        if (char === ",") {
            this.current++;
            return { type: "COMMA", value: "," };
        }

        if (char === '"') {
            return this.readString();
        }

        if (/^[0-9]/.test(char) && (this.current === 0 || this.input[this.current - 1] === "\n")) {
            return this.readToken(/^[0-9]/, "LINENUMBER");
        }

        if (/^[0-9]/.test(char)) {
            return this.readToken(/^[0-9]/, "NUMBER");
        }

        if (/[A-Za-z]/.test(char)) {
            return this.readIdentifierOrKeyword();
        }

        if (/^[\+\-\*\/\=\<\>]/.test(char)) {
            return this.readToken(/^[\+\-\*\/\=\<\>]/, "OPERATOR");
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

        return { type, value };
    }

    private readIdentifierOrKeyword(): Token {
        const keywords = ["REM", "LET", "IF", "THEN", "ELSE", "FOR", "TO", "STEP", "NEXT", "GOTO", "GOSUB", "RETURN", "END", "DIM", "DATA", "READ", "RESTORE", "ON", "STOP", "WAIT", "POKE", "PRINT", "INPUT", "GET", "CLS", "SCREEN", "COLOR", "PLOT", "DRAW", "CIRCLE", "LINE", "BOX", "PAINT", "PLAY", "BEEP", "LOAD", "SAVE", "MERGE", "VERIFY", "NEW", "RUN", "USR", "RND", "INT", "ABS", "SQR", "EXP", "LOG", "ATN", "TAN", "COS", "SIN", "PEEK", "LEN", "STR$", "VAL", "ASC", "CHR$", "LEFT$", "RIGHT$", "MID$"];

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

class Parser {
    private lexer: Lexer;
    private currentToken: Token | null;

    constructor(input: string) {
        this.lexer = new Lexer(input);
        this.currentToken = this.lexer.getNextToken();
    }

    public parse(): void {
        while (this.currentToken !== null) {
            console.log(this.currentToken);
            this.currentToken = this.lexer.getNextToken();
        }
    }
}

const input = "10 PRINT \"Hello, world 11!\"\n15 A=3\n20 END\n";
const parser = new Parser(input);
parser.parse();