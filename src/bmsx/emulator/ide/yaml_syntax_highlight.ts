import * as constants from './constants';
import type { HighlightLine } from './types';
import { DEFAULT_YAML_VALUE_KEYWORDS, parseYamlInlineTokens } from './yaml_syntax_parser';

const TAB_EXPANSION = ' '.repeat(constants.TAB_SPACES);

function buildYamlValueKeywordSet(extraValueKeywords?: ReadonlySet<string>): ReadonlySet<string> {
	if (!extraValueKeywords || extraValueKeywords.size === 0) {
		return DEFAULT_YAML_VALUE_KEYWORDS;
	}
	const merged = new Set<string>();
	for (const keyword of DEFAULT_YAML_VALUE_KEYWORDS) {
		merged.add(keyword);
	}
	for (const keyword of extraValueKeywords) {
		merged.add(keyword.toLowerCase());
	}
	return merged;
}

function buildUpperText(text: string, colors: number[]): string {
	let mutated = false;
	for (let index = 0; index < text.length; index += 1) {
		if (colors[index] === constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_STRING) {
			continue;
		}
		const ch = text.charAt(index);
		const upper = ch.toUpperCase();
		if (upper !== ch) {
			mutated = true;
			break;
		}
	}
	if (!mutated) {
		return text;
	}
	const buffer: string[] = new Array(text.length);
	for (let index = 0; index < text.length; index += 1) {
		const ch = text.charAt(index);
		buffer[index] = colors[index] === constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_STRING ? ch : ch.toUpperCase();
	}
	return buffer.join('');
}

function resolveYamlTokenColor(kind: ReturnType<typeof parseYamlInlineTokens>[number]['kind']): number {
	switch (kind) {
		case 'comment':
			return constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_COMMENT;
		case 'string':
			return constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_STRING;
		case 'anchor':
		case 'alias':
			return constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_LABEL;
		case 'number':
			return constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_NUMBER;
		case 'operator':
			return constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_OPERATOR;
		case 'key':
		case 'keyword':
			return constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_KEYWORD;
	}
}

export function highlightYamlTextLine(line: string, extraValueKeywords?: ReadonlySet<string>): HighlightLine {
	const length = line.length;
	const defaultColor = constants.COLOR_SYNTAX_HIGHLIGHTS.COLOR_CODE_TEXT;
	const columnColors: number[] = new Array(length);
	for (let index = 0; index < length; index += 1) {
		columnColors[index] = defaultColor;
	}

	const tokens = parseYamlInlineTokens(line, buildYamlValueKeywordSet(extraValueKeywords));
	for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
		const token = tokens[tokenIndex]!;
		const color = resolveYamlTokenColor(token.kind);
		for (let column = token.start; column < token.end; column += 1) {
			columnColors[column] = color;
		}
	}

	const colors: number[] = [];
	const columnToDisplay: number[] = [];
	const textParts: string[] = [];
	let displayIndex = 0;
	for (let column = 0; column < length; column += 1) {
		columnToDisplay.push(displayIndex);
		const ch = line.charAt(column);
		const color = columnColors[column];
		if (ch === '\t') {
			textParts.push(TAB_EXPANSION);
			for (let tab = 0; tab < constants.TAB_SPACES; tab += 1) {
				colors.push(color);
			}
			displayIndex += constants.TAB_SPACES;
			continue;
		}
		textParts.push(ch);
		colors.push(color);
		displayIndex += 1;
	}
	columnToDisplay.push(displayIndex);
	const text = textParts.join('');
	return {
		text,
		upperText: buildUpperText(text, colors),
		colors,
		columnToDisplay,
	};
}
