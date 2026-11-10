import { OpCode } from '../../spec/blua32/opcode';
import { COP0_EPC, COP0_EXEC, COP0_STATUS, CPU_STATUS_USER_MODE_CURRENT, cop0FieldImplemented } from '../../spec/blua32/cop0';
import type { DecodedInstructionPage } from './execution_image';
import type { JavaScriptRegisterCache } from './compiled_block_registers';

export function compiledControlSupports(op: number): op is OpCode.MFC0 | OpCode.MTC0 {
	return op === OpCode.MFC0 || op === OpCode.MTC0;
}

export function emitControl(op: OpCode.MFC0 | OpCode.MTC0, page: DecodedInstructionPage, word: number,
	r: JavaScriptRegisterCache, exit: number | null, guardPrivilege: boolean): string {
	const field = page.b[word], fault = exit === null ? '' : r.exit(exit);
	// Once guarded, privilege stays fixed until a Status/EXEC boundary. An
	// implemented selector then has no remaining fault edge to materialize.
	const mode = guardPrivilege ? `if((cp[${COP0_STATUS}]&${CPU_STATUS_USER_MODE_CURRENT})!==0) ${fault}` : '';
	if (op === OpCode.MFC0) {
		return mode + (cop0FieldImplemented(field)
			? r.writeNumber(page.a[word], field === COP0_EXEC ? '0' : `cp[${field}]`) : fault);
	}
	// EXEC converts after returning. Status returns for IRQ arbitration;
	// EPC and ignored writes can feed the remainder of this body.
	if (field === COP0_EXEC) return mode;
	const value = `(${r.numberOperand(page.a[word])})>>>0`;
	return mode + (!cop0FieldImplemented(field) ? `${value};${fault}`
		: field === COP0_STATUS || field === COP0_EPC ? `cp[${field}]=${value};` : `${value};`);
}
