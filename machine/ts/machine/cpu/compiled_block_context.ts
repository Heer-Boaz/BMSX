import { CLOSURE_CAPTURE_WORDS } from './closure';
import { GC_COLOR_OFFSET, GC_COLOR_MASK } from './gc_object';
import { UPVALUE_ADDRESS_MASK, UPVALUE_FLAGS, UPVALUE_OPEN, UPVALUE_NEXT, UPVALUE_OWNER, UPVALUE_VALUE_TAG, UPVALUE_VALUE_WORD } from './upvalue';
import { ThreadField } from './thread_record';
import { MAIN_RAM_SIZE, RAM_RECORD_WORD_MASK } from '../../spec/bmsx/memory_map';
import { ValueTag } from './value';
import { OpCode } from '../../spec/blua32/opcode';
import type { DecodedInstructionPage } from './execution_image';
import type { JavaScriptRegisterCache } from './compiled_block_registers';

type ContextOpCode = OpCode.GETGL | OpCode.SETGL | OpCode.GETSYS | OpCode.SETSYS | OpCode.GETUP | OpCode.SETUP
	| OpCode.VARARG | OpCode.LOADNIL | OpCode.LOADKR;

export function compiledContextSupports(op: number): op is ContextOpCode {
	return op === OpCode.GETGL || op === OpCode.SETGL || op === OpCode.GETSYS || op === OpCode.SETSYS
		|| op === OpCode.GETUP || op === OpCode.SETUP || op === OpCode.VARARG || op === OpCode.LOADNIL || op === OpCode.LOADKR;
}

export function emitContext(op: ContextOpCode, page: DecodedInstructionPage, word: number, registers: JavaScriptRegisterCache, exit: number): string {
	const a = page.a[word], b = page.b[word];
	switch (op) {
		case OpCode.LOADNIL:
			registers.discardRange(a, a + b);
			return b === 0 ? '' : `r.clear(${b},${a});${registers.reloadRange(a, a + b)}`;
		case OpCode.LOADKR: {
			const failure = registers.exit(exit);
			return `{const i=${registers.tagOperand(b)}===${ValueTag.Integer}?${registers.wordOperand(b)}:(${registers.tagOperand(b)}===${ValueTag.Float}?fw(${registers.wordOperand(b)}):null);if(i===null||i>=kt.length) ${failure} ${registers.writeEncoded(a, 'kt[i]', 'k[i]')}}`;
		}
		case OpCode.GETGL:
		case OpCode.GETSYS:
			return registers.copyFrom(a, op === OpCode.GETGL ? 'gl' : 'sy', `${page.bx[word]}`);
		case OpCode.SETGL:
		case OpCode.SETSYS: {
			const bank = op === OpCode.SETGL ? 'gl' : 'sy', slot = page.bx[word];
			return `{if(${bank}.writeWatched(${slot})) ${registers.exit(exit)}
				const t=${registers.tagOperand(a)},v=${registers.wordOperand(a)};
				${bank}.s(${slot},t,v);
				if(t>=${ValueTag.String}&&t<=${ValueTag.Thread}&&t!==${ValueTag.BuiltinFunction}) h.writeGlobalRoot(t,v);}`;
		}
		case OpCode.GETUP:
		case OpCode.SETUP: {
			const load = op === OpCode.GETUP;
			const failure = registers.exit(exit);
			const base = `const m=h.memory,cap=(F.closureAddress+${CLOSURE_CAPTURE_WORDS + b * 4})&${RAM_RECORD_WORD_MASK};
				const c=m.rd(cap)&${UPVALUE_ADDRESS_MASK};`;
			if (load) {
				const published = registers.writeBack(true);
				registers.discard(a);
				return `{${base}
					if(m.rb(c+${UPVALUE_FLAGS})&${UPVALUE_OPEN}){
						const owner=m.rd(c+${UPVALUE_OWNER}),slot=m.rd(c+${UPVALUE_VALUE_WORD});
						const blockPort=(owner+${ThreadField.StackBlock})&${RAM_RECORD_WORD_MASK};
						const capPort=(owner+${ThreadField.StackCapacity})&${RAM_RECORD_WORD_MASK};
						const block=m.rd(blockPort)&${RAM_RECORD_WORD_MASK},capacity=m.rd(capPort);
						const tag=(block+capacity*4+slot)&${MAIN_RAM_SIZE - 1},value=(block+slot*4)&${RAM_RECORD_WORD_MASK};
						${published}
						r.s(${a},m.rb(tag),m.rd(value));
					}else r.s(${a},m.rb(c+${UPVALUE_VALUE_TAG}),m.rd(c+${UPVALUE_VALUE_WORD}));}${registers.reloadRange(a, a + 1)}`;
			}
			const tag = registers.tagOperand(a), word = registers.wordOperand(a);
			return `{${base}
				const watches=m.ramWriteWatches();
				if((m.rb(c+${UPVALUE_FLAGS})&${UPVALUE_OPEN})||watches.anyWatched(c,8)) ${failure}
				const t=${tag};
				if(t>=${ValueTag.String}&&t<=${ValueTag.Thread}&&t!==${ValueTag.BuiltinFunction}){
					const flags=m.rb(c+${GC_COLOR_OFFSET});
					if((flags&${GC_COLOR_MASK})===3){
						if(watches.anyWatched(c+${UPVALUE_NEXT},4)||watches.anyWatched(h.changedHeadOffset(),4)) ${failure}
						h.writeBarrier(c,${UPVALUE_NEXT});
					}
				}
				m.wd(c+${UPVALUE_VALUE_WORD},${word});m.wb(c+${UPVALUE_VALUE_TAG},t);}`;
		}
		case OpCode.VARARG: {
			if (b === 1) return '';
			const failure = registers.exit(exit);
			let published = '';
			if (b === 0) published = registers.prepareDynamicOverwrite(a, 'n');
			else registers.discardRange(a, a + b - 1);
			return `{const n=${b === 0 ? 'F.varargCount' : b - 1};
				const copied=${b === 0 ? 'n' : 'Math.min(n,F.varargCount)'},v=F.varargBase;
				if(${b === 0 ? `(n>0 && ${a}+n>F.stackCapacity) || ` : ''}(copied>0 && v+copied>F.stackBase)) ${failure}
				${b === 0 ? 'B-=n;' : ''}${published}
				r.copyRangeFrom(F.thread.stackRegisters,${a},v,copied);
				r.clear(n-copied,${a}+copied);
				${b === 0 ? `F.top=${a}+n;` : ''}${registers.reloadRange(a, b === 0 ? Infinity : a + b - 1)}}`;
		}
	}
}
