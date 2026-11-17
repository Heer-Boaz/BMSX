import { OpCode } from '../../spec/blua32/opcode';
import type { JavaScriptRegisterCache } from './compiled_block_registers';
import type { DecodedInstructionPage } from './execution_image';
import { ValueTag } from './value';

/** A comparison has two control successors and never writes operand A. */
export function emitComparison(page: DecodedInstructionPage, word: number, registers: JavaScriptRegisterCache,
	yes: string, no: string): string {
	const left = page.b[word], right = page.c[word];
	let source = `{const l=${registers.tagOperand(left)},r0=${registers.tagOperand(right)};let matched=false;`;
	const numeric = `(l===${ValueTag.Integer}||l===${ValueTag.Float})&&(r0===${ValueTag.Integer}||r0===${ValueTag.Float})`;
	if (page.ops[word] === OpCode.EQ) {
		source += `if(${numeric})matched=${registers.numberOperand(left)}===${registers.numberOperand(right)};
else if(l===r0)matched=l<=${ValueTag.True}||${registers.wordOperand(left)}===${registers.wordOperand(right)};`;
	} else {
		const operator = page.ops[word] === OpCode.LT ? '<' : '<=';
		source += `if(${numeric}) matched=${registers.numberOperand(left)}${operator}${registers.numberOperand(right)};
else if(l===${ValueTag.String}&&r0===${ValueTag.String}) {const leftId=${registers.wordOperand(left)},rightId=${registers.wordOperand(right)};budget-=Math.min(q.codepointCount(leftId),q.codepointCount(rightId));matched=q.compare(leftId,rightId)${operator}0;}`;
	}
	return `${source}if(matched){${yes}}else{${no}}}`;
}
