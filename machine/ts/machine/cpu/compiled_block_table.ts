import { OpCode, TABLE_LENGTH_PROBE_CYCLES } from '../../spec/blua32/opcode';
import { ValueTag } from './value';
import { TABLE_STORE_REQUIRES_GROWTH } from './table';
import type { DecodedInstructionPage } from './execution_image';
import type { JavaScriptRegisterCache } from './compiled_block_registers';

type TableOpCode = OpCode.GETT | OpCode.SETT | OpCode.GETI | OpCode.SETI | OpCode.GETFIELD | OpCode.SETFIELD | OpCode.SELF | OpCode.LEN;

export function compiledTableSupports(op: number): op is TableOpCode {
	return op === OpCode.GETT || op === OpCode.SETT || op === OpCode.GETI || op === OpCode.SETI
		|| op === OpCode.GETFIELD || op === OpCode.SETFIELD || op === OpCode.SELF || op === OpCode.LEN;
}

export function emitTableOperation(op: TableOpCode, page: DecodedInstructionPage, word: number,
	r: JavaScriptRegisterCache, exit: number): string {
	const a = page.a[word], b = page.b[word], c = page.c[word];
	if (op === OpCode.LEN) {
		const tag = `l${word}`, failure = r.exit(exit);
		const value = `v${word}`;
		return `const ${tag}=${r.tagOperand(b)};if(${tag}!==${ValueTag.Table}&&${tag}!==${ValueTag.String}) ${failure}
			let ${value};if(${tag}===${ValueTag.Table}){${value}=h.object(${r.wordOperand(b)}).length(state.lengthWork);
			budget-=state.lengthWork.probes*${TABLE_LENGTH_PROBE_CYCLES};}else{${value}=q.codepointCount(${r.wordOperand(b)});}
			${r.writeInteger(a, value)}`;
	}
	const load = op === OpCode.GETT || op === OpCode.GETI || op === OpCode.GETFIELD || op === OpCode.SELF;
	const base = load ? b : a;
	const key = load ? c : b;
	const receiver = op === OpCode.SELF ? r.copy(a + 1, b) : '';
	const failure = r.exit(exit);
	const value = load ? '' : `${r.tagOperand(c)},${r.wordOperand(c)}`;
	const target = load ? `r,${a}` : value;
	let access: string;
	if (op === OpCode.GETI || op === OpCode.SETI) {
		access = `if(!t.${load ? 'load' : 'store'}IntegerArrayKey(${key},${target})) ${failure}`;
	} else if (op === OpCode.GETFIELD || op === OpCode.SETFIELD || op === OpCode.SELF) {
		access = `if(!t.${load ? 'load' : 'store'}PredictedStringKey(k[${key}],p.tableCacheSlots[${word}],${target})) ${load
			? failure
			: `{const slot=t.storeStringKeyWithoutGrowth(k[${key}],${target});
				if(slot===${TABLE_STORE_REQUIRES_GROWTH}) ${failure} p.tableCacheSlots[${word}]=slot;}`}`;
	} else {
		access = `const tag=${r.tagOperand(key)},key=${r.wordOperand(key)};
			if(tag===${ValueTag.Integer}||tag===${ValueTag.Float}){const i=tag===${ValueTag.Integer}?key|0:fi(key);if(i===null||!t.${load ? 'load' : 'store'}IntegerArrayKey(i,${target})) ${failure}}
			else if(tag!==${ValueTag.String}) ${failure}
			else if(!t.${load ? 'load' : 'store'}PredictedStringKey(key,p.tableCacheSlots[${word}],${target})) ${load
				? failure
				: `{const slot=t.storeStringKeyWithoutGrowth(key,${target});
					if(slot===${TABLE_STORE_REQUIRES_GROWTH}) ${failure} p.tableCacheSlots[${word}]=slot;}`}`;
	}
	const source = `${receiver}if(${r.tagOperand(base)}!==${ValueTag.Table}) ${failure}{const t=h.object(${r.wordOperand(base)});${access}}`;
	if (load) {
		r.discard(a);
		return source + r.reloadRange(a, a + 1);
	}
	return source;
}
