import { OpCode } from '../../spec/blua32/opcode';
import { ValueTag } from './value';
import type { DecodedInstructionPage } from './execution_image';
import type { JavaScriptRegisterCache } from './compiled_block_registers';

export function compiledArithmeticSupports(op: number): boolean {
	return op === OpCode.ADD || op === OpCode.SUB || op === OpCode.MUL || op === OpCode.DIV
		|| op === OpCode.MOD || op === OpCode.FLOORDIV || op === OpCode.POW || op === OpCode.UNM
		|| op === OpCode.BAND || op === OpCode.BOR || op === OpCode.BXOR || op === OpCode.BNOT
		|| op === OpCode.SHL || op === OpCode.SHR;
}

/** Operand faults leave the destination untouched and take a charged VM exit. */
export function emitArithmetic(page: DecodedInstructionPage, word: number, r: JavaScriptRegisterCache, fault: string): string {
	const op = page.ops[word], a = page.a[word], b = page.b[word], c = page.c[word];
	const unary = op === OpCode.UNM || op === OpCode.BNOT;
	const tags = `const lt=${r.tagOperand(b)}${unary ? '' : `,rt=${r.tagOperand(c)}`};`;
	const guard = `if((lt!==${ValueTag.Integer}&&lt!==${ValueTag.Float})${unary ? '' : `||(rt!==${ValueTag.Integer}&&rt!==${ValueTag.Float})`}) ${fault}`;
	const operands = `const lw=${r.wordOperand(b)}${unary ? '' : `,rw=${r.wordOperand(c)}`};`;
	let body: string;
	if (op === OpCode.UNM) {
		body = r.writeEncoded(a, 'lt', `(lt===${ValueTag.Integer}?(-lw)>>>0:(lw^0x80000000)>>>0)`);
	} else if (op === OpCode.BNOT || op === OpCode.BAND || op === OpCode.BOR || op === OpCode.BXOR || op === OpCode.SHL || op === OpCode.SHR) {
		const ints = `const li=lt===${ValueTag.Integer}?lw|0:fi(lw)${unary ? '' : `,ri=rt===${ValueTag.Integer}?rw|0:fi(rw)`};if(li===null${unary ? '' : '||ri===null'}) ${fault}`;
		const expression = op === OpCode.BNOT ? '~li' : op === OpCode.BAND ? 'li&ri' : op === OpCode.BOR ? 'li|ri'
			: op === OpCode.BXOR ? 'li^ri' : op === OpCode.SHL ? 'shl(li,ri)' : 'shr(li,ri)';
		body = ints + r.writeInteger(a, expression);
	} else {
		// Integer operands round before mixed floating arithmetic, not before
		// comparison. A binary32 result canonicalizes NaN after every operation.
		const floats = `const lf=lt===${ValueTag.Integer}?Math.fround(lw|0):bf(lw),rf=rt===${ValueTag.Integer}?Math.fround(rw|0):bf(rw);`;
		const integerPair = `lt===${ValueTag.Integer}&&rt===${ValueTag.Integer}`;
		let integer: string, floating: string;
		switch (op) {
			case OpCode.ADD: integer='(lw+rw)>>>0';floating='fr(lf+rf)';break;
			case OpCode.SUB: integer='(lw-rw)>>>0';floating='fr(lf-rf)';break;
			case OpCode.MUL: integer='Math.imul(lw,rw)>>>0';floating='fr(lf*rf)';break;
			case OpCode.MOD: integer='imod(lw|0,rw|0)>>>0';floating='fmod(fb(lf),fb(rf))';break;
			case OpCode.FLOORDIV: integer='idiv(lw|0,rw|0)>>>0';floating='fdiv(fb(lf),fb(rf))';break;
			case OpCode.DIV: integer='';floating='fr(lf/rf)';break;
			default: integer='';floating='fr(pow(lf,rf))';break;
		}
		if (integer === '') body = floats + r.writeFloatBits(a, floating);
		else {
			const zero = op === OpCode.MOD || op === OpCode.FLOORDIV ? `if(${integerPair}&&rw===0) ${fault}` : '';
			body = zero + `let nt,nw;if(${integerPair}){nt=${ValueTag.Integer};nw=${integer};}else{${floats}nt=${ValueTag.Float};nw=${floating};}`
				+ r.writeEncoded(a, 'nt', 'nw');
		}
	}
	return `{${tags}${guard}${operands}${body}}`;
}
