/** Cartlib state-path grammar, not a filesystem path or an XState target. */
export type FsmStatePath = {
	readonly kind: 'path';
	readonly text: string;
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
	return { kind: 'path', text: path, absolute: path[0] === '/', segments };
}

const quotedSegmentNeeded = /['\\/]/;
const quotedSegmentEscapes = /['\\]/g;

/** Exact child keys, not runtime _/# aliases. Undefined means no such path spelling exists. */
export function createFsmStatePath(absolute: boolean, up: number, keys: readonly string[]): Extract<FsmStatePath, { kind: 'path' }> | undefined {
	if (!absolute && up === 0 && keys.length === 0) return undefined;
	let text = (absolute ? '/' : '') + '../'.repeat(up);
	const segments: string[] = [];
	for (let index = 0; index < up; index += 1) segments.push('..');
	for (let index = 0; index < keys.length; index += 1) {
		const key = keys[index];
		// Quoting does not protect these keys from the runtime's navigation operators.
		if (key === '' || key === '.' || key === '..') return undefined;
		segments.push(key);
		if (index !== 0) text += '/';
		// no_op is intercepted by transition dispatch before path parsing.
		text += key === 'no_op' || quotedSegmentNeeded.test(key)
			? "['" + key.replace(quotedSegmentEscapes, '\\$&') + "']" : key;
	}
	return { kind: 'path', text, absolute, segments };
}
