// node --expose-gc --import tsx scripts/analysis/profile_lua_lexical_lifetime.ts
import { setImmediate } from 'node:timers/promises';
import { LuaLexer } from '../../toolchain/ts/lua/syntax/lexer';
import type { LuaToken } from '../../toolchain/ts/lua/syntax/token';

const generations = 24;
const commentWidth = 1024 * 1024;

// Keep source strings and scanners off the measurement frame's stack. Only one
// small token survives from each otherwise released, independently created file.
function retainTokens(count: number): LuaToken[] {
	const tokens: LuaToken[] = [];
	for (let generation = 0; generation < count; generation++) {
		const source = `retained_identifier_of_generation_${generation} = 1 --` + 'x'.repeat(commentWidth);
		tokens.push(new LuaLexer(source, 'retention.lua').scanTokens().get(0));
	}
	return tokens;
}

async function main(): Promise<void> {
	retainTokens(2);
	await setImmediate();
	globalThis.gc();
	const initial = process.memoryUsage().heapUsed;
	let tokens: LuaToken[] | null = retainTokens(generations);
	await setImmediate();
	globalThis.gc();
	const retained = process.memoryUsage().heapUsed;
	const spellings = tokens.map(token => token.lexeme);
	tokens = null;
	await setImmediate();
	globalThis.gc();
	const spellingsOnly = process.memoryUsage().heapUsed;
	console.log(JSON.stringify({
		node: process.version, generations, commentWidth,
		retainedTokenHeapMiB: (retained - initial) / (1024 * 1024),
		retainedSpellingHeapMiB: (spellingsOnly - initial) / (1024 * 1024),
		lastSpelling: spellings.at(-1),
		note: 'After-GC heap, not allocation count or browser evidence. Tiny retained lexical spellings must not pin historical whole-source backing strings.',
	}, null, 2));
}

void main();
