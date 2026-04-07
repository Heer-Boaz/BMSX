export type YamlInlineTokenKind =
	| 'comment'
	| 'string'
	| 'anchor'
	| 'alias'
	| 'number'
	| 'operator'
	| 'key'
	| 'keyword';

export type YamlInlineToken = {
	kind: YamlInlineTokenKind;
	start: number;
	end: number;
};

export type YamlBlankLineToken = {
	kind: 'blank';
	text: string;
};

export type YamlCommentLineToken = {
	kind: 'comment';
	text: string;
};

export type YamlMappingLineToken = {
	kind: 'mapping';
	text: string;
	key: string;
	keyLower: string;
	opensBlock: boolean;
};

export type YamlSequenceScalarLineToken = {
	kind: 'sequence-scalar';
	text: string;
};

export type YamlSequenceMappingLineToken = {
	kind: 'sequence-mapping';
	text: string;
	key: string;
	keyLower: string;
	opensBlock: boolean;
};

export type YamlLineToken =
	| YamlBlankLineToken
	| YamlCommentLineToken
	| YamlMappingLineToken
	| YamlSequenceScalarLineToken
	| YamlSequenceMappingLineToken;

export const DEFAULT_YAML_VALUE_KEYWORDS = new Set([
	'true',
	'false',
	'null',
	'yes',
	'no',
	'on',
	'off',
]);

export function isYamlWhitespace(ch: string): boolean {
	return ch === ' ' || ch === '\t';
}

export function isYamlIdentifierStart(ch: string): boolean {
	if (ch.length === 0) {
		return false;
	}
	const code = ch.charCodeAt(0);
	return (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || ch === '_';
}

export function isYamlIdentifierChar(ch: string): boolean {
	if (ch.length === 0) {
		return false;
	}
	const code = ch.charCodeAt(0);
	return (code >= 65 && code <= 90)
		|| (code >= 97 && code <= 122)
		|| (code >= 48 && code <= 57)
		|| ch === '_'
		|| ch === '.'
		|| ch === '-';
}

export function isYamlAnchorChar(ch: string): boolean {
	return isYamlIdentifierChar(ch) || ch === '/';
}

export function isYamlOperatorChar(ch: string): boolean {
	return ch === '{'
		|| ch === '}'
		|| ch === '['
		|| ch === ']'
		|| ch === ':'
		|| ch === ','
		|| ch === '-'
		|| ch === '?'
		|| ch === '|'
		|| ch === '>'
		|| ch === '!';
}

export function countLeadingYamlSpaces(line: string): number {
	let index = 0;
	while (index < line.length && line.charAt(index) === ' ') {
		index += 1;
	}
	return index;
}

export function stripYamlTrailingWhitespace(text: string): string {
	let end = text.length;
	while (end > 0) {
		const ch = text.charAt(end - 1);
		if (ch !== ' ' && ch !== '\t') {
			break;
		}
		end -= 1;
	}
	return end === text.length ? text : text.slice(0, end);
}

export function parseYamlMappingEntry(text: string): { key: string; keyLower: string; opensBlock: boolean } | null {
	const trimmed = stripYamlTrailingWhitespace(text);
	const colonIndex = trimmed.indexOf(':');
	if (colonIndex <= 0) {
		return null;
	}
	const key = trimmed.slice(0, colonIndex).trimEnd();
	if (key.length === 0 || key.startsWith('#')) {
		return null;
	}
	const valueText = trimmed.slice(colonIndex + 1).trim();
	return {
		key,
		keyLower: key.toLowerCase(),
		opensBlock: valueText.length === 0
			|| /^&[A-Za-z0-9_./-]+\s*(#.*)?$/.test(valueText)
			|| /^[>|][-+0-9 ]*(#.*)?$/.test(valueText),
	};
}

export function tokenizeYamlStructureLine(line: string): YamlLineToken {
	const content = line.slice(countLeadingYamlSpaces(line));
	if (content.trim().length === 0) {
		return { kind: 'blank', text: '' };
	}
	if (content.startsWith('#')) {
		return { kind: 'comment', text: content };
	}
	if (content.startsWith('-')) {
		const body = content.slice(1).trimStart();
		const mapping = parseYamlMappingEntry(body);
		if (mapping) {
			return {
				kind: 'sequence-mapping',
				text: content,
				key: mapping.key,
				keyLower: mapping.keyLower,
				opensBlock: mapping.opensBlock,
			};
		}
		return {
			kind: 'sequence-scalar',
			text: content,
		};
	}
	const mapping = parseYamlMappingEntry(content);
	if (mapping) {
		return {
			kind: 'mapping',
			text: content,
			key: mapping.key,
			keyLower: mapping.keyLower,
			opensBlock: mapping.opensBlock,
		};
	}
	return {
		kind: 'comment',
		text: content,
	};
}

function isYamlNumberStart(line: string, index: number): boolean {
	const ch = line.charAt(index);
	if (ch >= '0' && ch <= '9') {
		return true;
	}
	if (ch !== '-' && ch !== '+') {
		return false;
	}
	const next = line.charAt(index + 1);
	return next >= '0' && next <= '9';
}

function readYamlNumber(line: string, start: number): number {
	let index = start;
	if (line.charAt(index) === '-' || line.charAt(index) === '+') {
		index += 1;
	}
	while (index < line.length) {
		const ch = line.charAt(index);
		if ((ch >= '0' && ch <= '9') || ch === '_' || ch === '.' || ch === 'x' || ch === 'X' || ch === 'e' || ch === 'E' || ch === '+' || ch === '-') {
			index += 1;
			continue;
		}
		break;
	}
	return index;
}

function readYamlQuotedString(line: string, start: number, delimiter: string): number {
	let index = start + 1;
	while (index < line.length) {
		const ch = line.charAt(index);
		if (delimiter === '"' && ch === '\\' && index + 1 < line.length) {
			index += 2;
			continue;
		}
		if (delimiter === '\'' && ch === '\'' && line.charAt(index + 1) === '\'') {
			index += 2;
			continue;
		}
		if (ch === delimiter) {
			return index + 1;
		}
		index += 1;
	}
	return line.length;
}

export function parseYamlInlineTokens(line: string, valueKeywords: ReadonlySet<string>): YamlInlineToken[] {
	const tokens: YamlInlineToken[] = [];
	let index = 0;
	while (index < line.length) {
		const ch = line.charAt(index);
		if (ch === '#') {
			tokens.push({ kind: 'comment', start: index, end: line.length });
			break;
		}
		if (ch === '"' || ch === '\'') {
			const end = readYamlQuotedString(line, index, ch);
			tokens.push({ kind: 'string', start: index, end });
			index = end;
			continue;
		}
		if ((ch === '&' || ch === '*') && isYamlAnchorChar(line.charAt(index + 1))) {
			let end = index + 1;
			while (end < line.length && isYamlAnchorChar(line.charAt(end))) {
				end += 1;
			}
			tokens.push({ kind: ch === '&' ? 'anchor' : 'alias', start: index, end });
			index = end;
			continue;
		}
		if (isYamlNumberStart(line, index)) {
			const end = readYamlNumber(line, index);
			tokens.push({ kind: 'number', start: index, end });
			index = end;
			continue;
		}
		if (isYamlIdentifierStart(ch)) {
			let end = index + 1;
			while (end < line.length && isYamlIdentifierChar(line.charAt(end))) {
				end += 1;
			}
			let lookahead = end;
			while (lookahead < line.length && isYamlWhitespace(line.charAt(lookahead))) {
				lookahead += 1;
			}
			const token = line.slice(index, end).toLowerCase();
			if (lookahead < line.length && line.charAt(lookahead) === ':') {
				tokens.push({ kind: 'key', start: index, end });
			} else if (valueKeywords.has(token)) {
				tokens.push({ kind: 'keyword', start: index, end });
			}
			index = end;
			continue;
		}
		if (isYamlOperatorChar(ch)) {
			tokens.push({ kind: 'operator', start: index, end: index + 1 });
		}
		index += 1;
	}
	return tokens;
}
