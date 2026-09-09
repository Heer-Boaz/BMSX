/** Cartlib state-path grammar, not a filesystem path or an XState target. */
export type FsmStatePath = {
	readonly kind: 'path';
	readonly absolute: boolean;
	readonly segments: readonly string[];
} | {
	readonly kind: 'invalid';
	readonly reason: 'empty-path' | 'unterminated-quoted-segment';
};

/**
 * Tokenize the grammar owned by cartlib/fsm/fsm.lua:compile_definition_path_plan.
 * Keep dots and parent segments: binding must visit a descent before a later '..'.
 * Invalid authored paths remain diagnostics, never a normalized valid path.
 */
export function parseFsmStatePath(path: string): FsmStatePath {
	if (path.length === 0) return { kind: 'invalid', reason: 'empty-path' };
	const segments: string[] = [];
	let index = 0;
	while (index < path.length) {
		if (path[index] === '/') { index += 1; continue; }
		if (path[index] === '[' && path[index + 1] === "'") {
			index += 2;
			let segment = '';
			let closed = false;
			while (index < path.length) {
				const character = path[index++];
				if (character === '\\') {
					if (index < path.length) segment += path[index++];
				} else if (character === "'") {
					if (path[index] !== ']') return { kind: 'invalid', reason: 'unterminated-quoted-segment' };
					index += 1;
					closed = true;
					break;
				} else segment += character;
			}
			if (!closed) return { kind: 'invalid', reason: 'unterminated-quoted-segment' };
			segments.push(segment);
		} else {
			const start = index;
			while (index < path.length && path[index] !== '/') index += 1;
			segments.push(path.slice(start, index));
		}
	}
	return { kind: 'path', absolute: path[0] === '/', segments };
}
