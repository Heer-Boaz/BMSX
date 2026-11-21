import { OpCode } from '../../spec/blua32/opcode';
import type { JavaScriptRegisterCache } from './compiled_block_registers';
import type { DecodedInstructionPage } from './execution_image';
import { ValueTag } from './value';

/** A comparison has two control successors and never writes operand A. */
export function emitComparison(page: DecodedInstructionPage, word: number, registers: JavaScriptRegisterCache,
	transfer: (matched: boolean, residentsPublished: boolean) => string): string {
	const branch = (published: boolean) => `if(M){${transfer(true, published)}}else{${transfer(false, published)}}`;
	const ordinaryBranch = branch(false);
	const left = page.b[word], right = page.c[word];
	let source = `{const l=${registers.tagOperand(left)},r0=${registers.tagOperand(right)};let M=false;`;
	const numeric = `(l===${ValueTag.Integer}||l===${ValueTag.Float})&&(r0===${ValueTag.Integer}||r0===${ValueTag.Float})`;
	if (page.ops[word] === OpCode.EQ) {
		source += `if(${numeric})M=${registers.numberOperand(left)}===${registers.numberOperand(right)};
else if(l===r0)M=l<=${ValueTag.True}||${registers.wordOperand(left)}===${registers.wordOperand(right)};`;
	} else {
		const operator = page.ops[word] === OpCode.LT ? '<' : '<=';
		// Non-resident locals are already published by the block body. String
		// records can overlap resident slots; only this arm needs them in RAM.
		// Its edges keep the bindings but must not publish the same slots again.
		const publish = registers.writeResidents();
		source += `if(${numeric}) M=${registers.numberOperand(left)}${operator}${registers.numberOperand(right)};
else if(l===${ValueTag.String}&&r0===${ValueTag.String}) {const leftId=${registers.wordOperand(left)},rightId=${registers.wordOperand(right)};${publish}B-=Math.min(q.byteLength(leftId),q.byteLength(rightId));M=q.compare(leftId,rightId)${operator}0;${publish === '' ? '' : branch(true)}}`;
	}
	return `${source}${ordinaryBranch}}`;
}
