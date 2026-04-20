export type CppTokenKind = 'id' | 'number' | 'string' | 'char' | 'op' | 'punct';

export type CppToken = {
	kind: CppTokenKind;
	text: string;
	line: number;
	column: number;
};

export function isCppIdentifierStart(ch: string): boolean {
	const code = ch.charCodeAt(0);
	return code === 95 || code >= 65 && code <= 90 || code >= 97 && code <= 122;
}

export function isCppIdentifierPart(ch: string): boolean {
	const code = ch.charCodeAt(0);
	return code === 95 || code >= 48 && code <= 57 || code >= 65 && code <= 90 || code >= 97 && code <= 122;
}

function isDigit(ch: string): boolean {
	const code = ch.charCodeAt(0);
	return code >= 48 && code <= 57;
}

export function tokenizeCpp(source: string): CppToken[] {
	const tokens: CppToken[] = [];
	let index = 0;
	let line = 1;
	let column = 1;
	const push = (kind: CppTokenKind, text: string, tokenLine: number, tokenColumn: number): void => {
		tokens.push({ kind, text, line: tokenLine, column: tokenColumn });
	};
	const advance = (count: number): string => {
		const text = source.slice(index, index + count);
		for (let i = 0; i < text.length; i += 1) {
			if (text[i] === '\n') {
				line += 1;
				column = 1;
			} else {
				column += 1;
			}
		}
		index += count;
		return text;
	};
	while (index < source.length) {
		const ch = source[index];
		if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
			advance(1);
			continue;
		}
		if (ch === '/' && source[index + 1] === '/') {
			while (index < source.length && source[index] !== '\n') {
				advance(1);
			}
			continue;
		}
		if (ch === '/' && source[index + 1] === '*') {
			advance(2);
			while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) {
				advance(1);
			}
			if (index < source.length) {
				advance(2);
			}
			continue;
		}
		if (isCppIdentifierStart(ch)) {
			const tokenLine = line;
			const tokenColumn = column;
			let end = index + 1;
			while (end < source.length && isCppIdentifierPart(source[end])) {
				end += 1;
			}
			push('id', advance(end - index), tokenLine, tokenColumn);
			continue;
		}
		if (isDigit(ch)) {
			const tokenLine = line;
			const tokenColumn = column;
			let end = index + 1;
			while (end < source.length && (isCppIdentifierPart(source[end]) || source[end] === '.')) {
				end += 1;
			}
			push('number', advance(end - index), tokenLine, tokenColumn);
			continue;
		}
		if (ch === '"' || ch === "'") {
			const tokenLine = line;
			const tokenColumn = column;
			const quote = ch;
			let text = advance(1);
			while (index < source.length) {
				const current = source[index];
				text += advance(1);
				if (current === '\\' && index < source.length) {
					text += advance(1);
					continue;
				}
				if (current === quote) {
					break;
				}
			}
			push(quote === '"' ? 'string' : 'char', text, tokenLine, tokenColumn);
			continue;
		}
		const tokenLine = line;
		const tokenColumn = column;
		const three = source.slice(index, index + 3);
		if (three === '...' || three === '>>=' || three === '<<=') {
			push('op', advance(3), tokenLine, tokenColumn);
			continue;
		}
		const two = source.slice(index, index + 2);
		if (
			two === '::' || two === '->' || two === '==' || two === '!=' || two === '<=' || two === '>=' ||
			two === '&&' || two === '||' || two === '+=' || two === '-=' || two === '*=' || two === '/=' ||
			two === '%=' || two === '++' || two === '--' || two === '<<' || two === '>>'
		) {
			push('op', advance(2), tokenLine, tokenColumn);
			continue;
		}
		const kind: CppTokenKind = '{}()[];,?:'.includes(ch) ? 'punct' : 'op';
		push(kind, advance(1), tokenLine, tokenColumn);
	}
	return tokens;
}

export function buildCppPairMap(tokens: readonly CppToken[]): number[] {
	const pairs = new Array<number>(tokens.length).fill(-1);
	const stack: number[] = [];
	for (let index = 0; index < tokens.length; index += 1) {
		const text = tokens[index].text;
		if (text === '(' || text === '[' || text === '{') {
			stack.push(index);
			continue;
		}
		if (text !== ')' && text !== ']' && text !== '}') {
			continue;
		}
		const open = text === ')' ? '(' : text === ']' ? '[' : '{';
		for (let stackIndex = stack.length - 1; stackIndex >= 0; stackIndex -= 1) {
			if (tokens[stack[stackIndex]].text !== open) {
				continue;
			}
			const start = stack[stackIndex];
			stack.splice(stackIndex, 1);
			pairs[start] = index;
			pairs[index] = start;
			break;
		}
	}
	return pairs;
}

export function cppTokenText(tokens: readonly CppToken[], start: number, end: number): string {
	let text = '';
	for (let index = start; index < end; index += 1) {
		const current = tokens[index].text;
		if (index > start && needsTokenSpace(tokens[index - 1].text, current)) {
			text += ' ';
		}
		text += current;
	}
	return text;
}

function needsTokenSpace(left: string, right: string): boolean {
	return isCppIdentifierPart(left[left.length - 1]) && isCppIdentifierPart(right[0]);
}

export function normalizedCppTokenText(tokens: readonly CppToken[], start: number, end: number): string {
	return cppTokenText(tokens, start, end).replace(/\s+/g, ' ').trim();
}
