import { type Token } from '../../../../../src/bmsx/language/cpp/syntax/tokens';
import { isCallIdentifier } from './ast';

export function normalizedBodyFingerprint(tokens: readonly Token[], start: number, end: number): string {
	let text = '';
	for (let index = start; index < end; index += 1) {
		const token = tokens[index];
		if (token.kind === 'id') {
			if (isCallIdentifier(tokens, index)) {
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
