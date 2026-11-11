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
			const index = registers.numberOperand(b), failure = registers.exit(exit);
			return `{const i=(${index})>>>0;if(i>=kt.length) ${failure} ${registers.writeEncoded(a, 'kt[i]', 'k[i]', 'null')}}`;
		}
		case OpCode.GETGL:
		case OpCode.GETSYS:
			return registers.copyFrom(a, op === OpCode.GETGL ? 'gl' : 'sy', `${page.bx[word]}`);
		case OpCode.SETGL:
		case OpCode.SETSYS:
			return `${op === OpCode.SETGL ? 'gl' : 'sy'}.setEncoded(${page.bx[word]},${registers.tagOperand(a)},${registers.scalarOperand(a)},${registers.referenceOperand(a)});`;
		case OpCode.GETUP: {
			const published = registers.writeBack(true);
			registers.discard(a);
			return `{const u=frame.closure.upvalues[${b}];if(u.open){
				${published === '' ? '' : `if(u.frame===frame){${published}}`}
				${registers.copyFrom(a, 'u.frame.registers', 'u.index')}
			}else{${registers.writeEncoded(a, 'u.valueTag', 'u.valueScalar', 'u.valueReference')}}}`;
		}
		case OpCode.SETUP: {
			const tag = registers.tagOperand(a), scalar = registers.scalarOperand(a), reference = registers.referenceOperand(a);
			return `{const u=frame.closure.upvalues[${b}];if(u.open){if(u.frame===frame) ${registers.exit(exit)}
				u.frame.registers.setEncoded(u.index,${tag},${scalar},${reference});}
				else{u.valueTag=${tag};u.valueScalar=${scalar};u.valueReference=${reference};}}`;
		}
		case OpCode.VARARG: {
			if (b === 1) return '';
			const failure = registers.exit(exit);
			let published = '';
			if (b === 0) published = registers.prepareDynamicOverwrite(a, 'n');
			else registers.discardRange(a, a + b - 1);
			return `{const n=${b === 0 ? 'frame.varargCount' : b - 1};
				if(n>0 && ${a}+n>frame.stackCapacity) ${failure}
				${published}
				const copied=Math.min(n,frame.varargCount);
				r.copyRangeFrom(frame.thread.stackRegisters,${a},frame.varargBase,copied);
				r.clear(n-copied,${a}+copied);
				${b === 0 ? `frame.top=${a}+n;` : ''}${registers.reloadRange(a, b === 0 ? Infinity : a + b - 1)}}`;
		}
	}
}
