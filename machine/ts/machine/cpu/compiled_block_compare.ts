import { OpCode } from '../../spec/blua32/opcode';
import type { JavaScriptRegisterCache } from './compiled_block_registers';
import type { DecodedInstructionPage } from './execution_image';
import { ValueTag } from './value';

/** A comparison has two control successors and never writes operand A. */
export function emitComparison(page: DecodedInstructionPage, word: number, registers: JavaScriptRegisterCache,
	yes: number, no: number): string {
	const left = page.b[word], right = page.c[word];
	let source = `{const l=${registers.tagOperand(left)},r0=${registers.tagOperand(right)};let matched=false;`;
	if (page.ops[word] === OpCode.EQ) {
		source += `if(l===r0){
if(l===${ValueTag.Nil}||l===${ValueTag.False}||l===${ValueTag.True}) matched=true;
else if(l===${ValueTag.Number}||l===${ValueTag.String}||l===${ValueTag.BuiltinFunction}) matched=${registers.scalarOperand(left)}===${registers.scalarOperand(right)};
else if(l===${ValueTag.Table}||l===${ValueTag.Closure}||l===${ValueTag.Thread}) matched=${registers.referenceOperand(left)}===${registers.referenceOperand(right)};}`;
	} else {
		const operator = page.ops[word] === OpCode.LT ? '<' : '<=';
		source += `if(l===${ValueTag.Number}&&r0===${ValueTag.Number}) matched=${registers.scalarOperand(left)}${operator}${registers.scalarOperand(right)};
else if(l===${ValueTag.String}&&r0===${ValueTag.String}) matched=q.compare(${registers.scalarOperand(left)},${registers.scalarOperand(right)})${operator}0;`;
	}
	return `${source}return matched?${yes}:${no};}`;
}
