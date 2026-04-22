import { type CppToken } from '../../../../../src/bmsx/language/cpp/syntax/tokens';
import { isCppCallIdentifier } from './ast';

export function normalizedBodyFingerprint(tokens: readonly CppToken[], start: number, end: number): string {
	let text = '';
	for (let index = start; index < end; index += 1) {
		const token = tokens[index];
		if (token.kind === 'id') {
			if (isCppCallIdentifier(tokens, index)) {
				text += `Call:${token.text}|`;
			} else {
				text += 'Identifier|';
			}
		} else if (token.kind === 'string' || token.kind === 'char') {
			text += 'StringLiteral|';
		} else if (token.kind === 'number') {
			text += 'NumericLiteral|';
		} else {
			text += token.text;
			text += '|';
		}
	}
	return text;
}
