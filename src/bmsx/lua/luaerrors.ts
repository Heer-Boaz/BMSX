export class LuaError extends Error {
	public readonly chunkName: string;
	public readonly line: number;
	public readonly column: number;

	constructor(message: string, chunkName: string, line: number, column: number) {
		super(message);
		this.name = 'LuaError';
		this.chunkName = chunkName;
		this.line = line;
		this.column = column;
	}
}

export class LuaSyntaxError extends LuaError {
	constructor(message: string, chunkName: string, line: number, column: number) {
		super(message, chunkName, line, column);
		this.name = 'Syntax Error';
	}
}

export class LuaRuntimeError extends LuaError {
	constructor(message: string, chunkName: string, line: number, column: number) {
		super(message, chunkName, line, column);
		this.name = 'Run Error';
	}
}
