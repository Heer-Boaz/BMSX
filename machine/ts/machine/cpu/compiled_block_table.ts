import { OpCode, TABLE_LENGTH_PROBE_CYCLES } from '../../spec/blua32/opcode';
import { ValueTag } from './value';
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
		// The record traversal can observe any physical lane reached by the
		// table or String. Publish the prefix but retain cached bindings.
		const publish = r.publishRange(0, Infinity);
		const tag = `l${word}`, value = `v${word}`, failure = r.exit(exit);
		return `${publish}const ${tag}=${r.tagOperand(b)},A=${r.wordOperand(b)};
			let ${value};if(${tag}===${ValueTag.Table}){
			if(tb.metatableAddress(A)!==0) ${failure}
			${value}=tb.length(A,S.lengthWork);B-=S.lengthWork.probes*${TABLE_LENGTH_PROBE_CYCLES};}
			else if(${tag}===${ValueTag.String}){${value}=q.byteLength(A);}
			else ${failure}
			${r.writeInteger(a, value)}`;
	}
	const load = op === OpCode.GETT || op === OpCode.GETI || op === OpCode.GETFIELD || op === OpCode.SELF;
	const base = load ? b : a;
	const key = load ? c : b;
	const receiver = op === OpCode.SELF ? r.copy(a + 1, b) : '';
	const failure = r.exit(exit);
	const value = load ? '' : `${r.tagOperand(c)},${r.wordOperand(c)}`;
	const target = load ? `r,${a}` : value;
	const arrayTarget = load ? target : `${target},nk`;
	const stack = !load || r.hasPendingWrites() ? ',F.thread' : ',F';
	const stringOperation = load ? 'lp' : 'sp';
	const arrayOperation = load ? 'li' : 'si';
	let access: string;
	if (op === OpCode.GETI || op === OpCode.SETI) {
		access = `if(!tb.${arrayOperation}(A,${key},${arrayTarget}${stack})) ${failure}`;
	} else if (op === OpCode.GETFIELD || op === OpCode.SETFIELD || op === OpCode.SELF) {
		access = `if(!tb.${stringOperation}(A,k[${key}],ts[${word}],${target}${stack})) ${failure}`;
	} else {
		access = `const tag=${r.tagOperand(key)},key=${r.wordOperand(key)};
			if(tag===${ValueTag.Integer}||tag===${ValueTag.Float}){const i=tag===${ValueTag.Integer}?key|0:fi(key);if(i===null||!tb.${arrayOperation}(A,i,${arrayTarget}${stack})) ${failure}}
			else if(tag!==${ValueTag.String}) ${failure}
			else if(!tb.${stringOperation}(A,key,ts[${word}],${target}${stack})) ${failure}`;
	}
	const source = `${receiver}if(${r.tagOperand(base)}!==${ValueTag.Table}) ${failure}{const A=${r.wordOperand(base)};${access}}`;
	if (load) {
		r.discard(a);
		return source + r.reloadRange(a, a + 1);
	}
	return source;
}
