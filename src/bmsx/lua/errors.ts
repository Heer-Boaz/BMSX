export class LuaError extends Error {
	public readonly path: string;
	public readonly line: number;
	public readonly column: number;

	constructor(message: string, path: string, line: number, column: number) {
		super(message);
		this.name = 'LuaError';
		this.path = path;
		this.line = line;
		this.column = column;
	}
}

export class LuaSyntaxError extends LuaError {
	constructor(message: string, path: string, line: number, column: number) {
		super(message, path, line, column);
		this.name = 'Syntax Error';
	}
}

export class LuaRuntimeError extends LuaError {
	constructor(message: string, path: string, line: number, column: number) {
		super(message, path, line, column);
		this.name = 'Run Error';
	}
}
