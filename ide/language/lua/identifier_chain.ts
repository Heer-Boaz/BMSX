import { isLuaIdentifier } from '../../../toolchain/ts/lua/syntax/identifier';

export function parseLuaIdentifierChain(expression: string): string[] {
	if (!expression) {
		return null;
	}
	const parts: string[] = [];
	let segmentStart = 0;
	for (let index = 0; index < expression.length; index += 1) {
		const ch = expression.charAt(index);
		if (ch !== '.' && ch !== ':') {
			continue;
		}
		const segment = expression.slice(segmentStart, index);
		if (!isLuaIdentifier(segment)) {
			return null;
		}
		parts.push(segment);
		segmentStart = index + 1;
	}
	const tailSegment = expression.slice(segmentStart);
	if (!isLuaIdentifier(tailSegment)) {
		return null;
	}
	parts.push(tailSegment);
	return parts;
}

export function resolveLuaIdentifierChainRoot(expression: string): string {
	const parts = parseLuaIdentifierChain(expression);
	if (!parts || parts.length === 0) {
		return null;
	}
	return parts[0];
}
