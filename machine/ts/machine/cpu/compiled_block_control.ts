import { OpCode } from '../../spec/blua32/opcode';
import { COP0_EPC, COP0_EXEC, COP0_STATUS, CPU_STATUS_USER_MODE_CURRENT, cop0FieldImplemented } from '../../spec/blua32/cop0';
import { ValueTag } from './value';
import type { DecodedInstructionPage } from './execution_image';
import type { JavaScriptRegisterCache } from './compiled_block_registers';

export function compiledControlSupports(op: number): op is OpCode.MFC0 | OpCode.MTC0 {
	return op === OpCode.MFC0 || op === OpCode.MTC0;
}

export function emitControl(op: OpCode.MFC0 | OpCode.MTC0, page: DecodedInstructionPage, word: number,
	r: JavaScriptRegisterCache, exit: number | null, guardPrivilege: boolean, numericFault: string): string {
	const field = page.b[word], fault = exit === null ? '' : r.exit(exit);
	const mode = guardPrivilege ? `if((cp[${COP0_STATUS}]&${CPU_STATUS_USER_MODE_CURRENT})!==0) ${fault}` : '';
	if (op === OpCode.MFC0) return mode + (cop0FieldImplemented(field)
		? r.writeInteger(page.a[word], field === COP0_EXEC ? '0' : `cp[${field}]`) : fault);
	// EXEC performs conversion in its semantic exit; all other selectors must
	// admit the word even when the register ignores writes.
	if (field === COP0_EXEC) return mode;
	const a = page.a[word];
	const conversion = `const cw=${r.tagOperand(a)}===${ValueTag.Integer}?${r.wordOperand(a)}:(${r.tagOperand(a)}===${ValueTag.Float}?fw(${r.wordOperand(a)}):null);if(cw===null) ${numericFault}`;
	return `${mode}{${conversion}${!cop0FieldImplemented(field) ? fault
		: field === COP0_STATUS || field === COP0_EPC ? `cp[${field}]=cw;` : ''}}`;
}
