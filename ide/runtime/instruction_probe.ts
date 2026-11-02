import type { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { decodeBlua32InstructionAtPc, indexBlua32FunctionInstructions, type DecodedInstruction } from '../../toolchain/ts/rompack/disassembler';
import type { Blua32ToolingImage } from '../../toolchain/ts/rompack/blua32_media';
import { blua32InlineCallSitesAtPc } from '../../toolchain/ts/rompack/blua32_symbols';
import { toLuaModulePath } from '../../toolchain/ts/lua/module_path';

/** Bind physical operations, not statement points pretending to be function entries.
 * Operands belong to the decoded instruction, independently of debug-local liveness. */
export function bindFunctionInstructions(image: Blua32ToolingImage, modulePath: string, name: string,
	opcodes: ReadonlySet<OpCode>): ReadonlyMap<number, DecodedInstruction> {
	const symbols = image.symbols;
	if (symbols === null) throw new Error('Instruction observation requires debug symbols.');
	const metadata = symbols.metadata;
	const definitions = metadata.functionDefinitions;
	const matches: number[] = [];
	for (let index = 0; index < definitions.length; index++) {
		const definition = definitions[index];
		if (definition !== null && toLuaModulePath(definition.path) === modulePath && metadata.functionDisplayNames[index] === name) matches.push(index);
	}
	if (matches.length !== 1) throw new Error(`Instruction owner '${modulePath}:${name}' is not uniquely available.`);
	const functionId = metadata.functionIds[matches[0]], result = new Map<number, DecodedInstruction>();
	for (let fn = 0; fn < image.layout.functions.length; fn++) {
		for (const pc of indexBlua32FunctionInstructions(image.layout, fn)) {
			const instruction = decodeBlua32InstructionAtPc(image.layout.textBytes, image.layout.header.textAddress, pc);
			if (!opcodes.has(instruction.op)) continue;
			const chain = blua32InlineCallSitesAtPc(symbols, image.layout.header.textAddress, instruction.pc);
			const owner = chain.length === 0 ? metadata.functionIds[fn] : chain[chain.length - 1].calleeFunctionId;
			if (owner === functionId) result.set(pc, instruction);
		}
	}
	if (result.size === 0) throw new Error(`Instruction owner '${modulePath}:${name}' has no matching operations.`);
	return result;
}
