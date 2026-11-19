import { GC_COLOR_OFFSET } from './gc_object';
import { UPVALUE_ADDRESS_MASK, UPVALUE_FLAGS, UPVALUE_OPEN, UPVALUE_NEXT, UPVALUE_OWNER, UPVALUE_VALUE_TAG, UPVALUE_VALUE_WORD } from './upvalue';
import { ThreadField } from './thread_record';
import { RAM_RECORD_WORD_MASK } from '../../spec/bmsx/memory_map';
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
			return `if(${bank}.writeWatched(${slot})) ${registers.exit(exit)} ${bank}.s(${slot},${registers.tagOperand(a)},${registers.wordOperand(a)});`;
		}
		case OpCode.GETUP: {
			const published = registers.writeBack(true);
			registers.discard(a);
			return `{const m=h.memory,c=F.captureAddress(${b})&${UPVALUE_ADDRESS_MASK};
				if(m.rb(c+${UPVALUE_FLAGS})&${UPVALUE_OPEN}){
					${published}
					const owner=m.rd(c+${UPVALUE_OWNER}),slot=m.rd(c+${UPVALUE_VALUE_WORD});
					const block=m.rd(owner+${ThreadField.StackBlock})&${RAM_RECORD_WORD_MASK};
					const capacity=m.rd(owner+${ThreadField.StackCapacity});
					r.s(${a},m.rb(block+capacity*4+slot),m.rd(block+slot*4));
				}else r.s(${a},m.rb(c+${UPVALUE_VALUE_TAG}),m.rd(c+${UPVALUE_VALUE_WORD}));}${registers.reloadRange(a, a + 1)}`;
		}
		case OpCode.SETUP: {
			const tag = registers.tagOperand(a), word = registers.wordOperand(a);
			return `{const m=h.memory,c=F.captureAddress(${b})&${UPVALUE_ADDRESS_MASK};
				const watches=m.ramWriteWatches();
				if((m.rb(c+${UPVALUE_FLAGS})&${UPVALUE_OPEN})||watches.anyWatched(c,8)) ${registers.exit(exit)}
				if(m.rb(c+${GC_COLOR_OFFSET})===3){
					if(watches.anyWatched(c+${UPVALUE_NEXT},4)||watches.anyWatched(h.changedHeadOffset(),4)) ${registers.exit(exit)}
					h.writeBarrier(c,${UPVALUE_NEXT});
				}
				m.wd(c+${UPVALUE_VALUE_WORD},${word});m.wb(c+${UPVALUE_VALUE_TAG},${tag});}`;
		}
		case OpCode.VARARG: {
			if (b === 1) return '';
			const failure = registers.exit(exit);
			let published = '';
			if (b === 0) published = registers.prepareDynamicOverwrite(a, 'n');
			else registers.discardRange(a, a + b - 1);
			return `{const n=${b === 0 ? 'F.varargCount' : b - 1};
				const copied=${b === 0 ? 'n' : 'Math.min(n,F.varargCount)'},v=F.varargBase;
				if((n>0 && ${a}+n>F.stackCapacity) || (copied>0 && v+copied>F.stackBase)) ${failure}
				${b === 0 ? 'B-=n;' : ''}${published}
				r.copyRangeFrom(F.thread.stackRegisters,${a},v,copied);
				r.clear(n-copied,${a}+copied);
				${b === 0 ? `F.top=${a}+n;` : ''}${registers.reloadRange(a, b === 0 ? Infinity : a + b - 1)}}`;
		}
	}
}
