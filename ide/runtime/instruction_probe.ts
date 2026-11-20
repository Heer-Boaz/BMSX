import type { OpCode } from '../../machine/ts/spec/blua32/opcode';
import { decodeBlua32InstructionAtPc, indexBlua32FunctionInstructions, type DecodedInstruction } from '../../toolchain/ts/rompack/disassembler';
import type { Blua32ToolingImage } from '../../toolchain/ts/rompack/blua32_media';
import { blua32InlineCallSitesAtPc, type Blua32SymbolsImage } from '../../toolchain/ts/rompack/blua32_symbols';
import { toLuaModulePath } from '../../toolchain/ts/lua/module_path';

// Ownership of every instruction is fixed for an image. Index it once instead
// of decoding the whole image for each bound function.
const ownedInstructions = new WeakMap<Blua32ToolingImage, ReadonlyMap<string, readonly number[]>>();

function instructionsByOwner(image: Blua32ToolingImage, symbols: Blua32SymbolsImage): ReadonlyMap<string, readonly number[]> {
	const indexed = ownedInstructions.get(image);
	if (indexed !== undefined) return indexed;
	const owners = new Map<string, number[]>(), metadata = symbols.metadata, textAddress = image.layout.header.textAddress;
	for (let fn = 0; fn < image.layout.functions.length; fn++) {
		for (const pc of indexBlua32FunctionInstructions(image.layout, fn)) {
			// Some words carry no inline-site record; they belong to their own function.
			const chain = blua32InlineCallSitesAtPc(symbols, textAddress, decodeBlua32InstructionAtPc(image.layout.textBytes, textAddress, pc).pc);
			const owner = chain === undefined || chain.length === 0 ? metadata.functionIds[fn] : chain[chain.length - 1].calleeFunctionId;
			let pcs = owners.get(owner);
			if (pcs === undefined) owners.set(owner, pcs = []);
			pcs.push(pc);
		}
	}
	ownedInstructions.set(image, owners);
	return owners;
}

/** Bind physical operations, not statement points pretending to be function entries.
 * Operands belong to the decoded instruction, independently of debug-local liveness. */
export function bindFunctionInstructions(image: Blua32ToolingImage, modulePath: string, name: string,
	opcodes: ReadonlySet<OpCode>): ReadonlyMap<number, DecodedInstruction> | undefined {
	const symbols = image.symbols;
	if (symbols === null) return;
	const metadata = symbols.metadata;
	const definitions = metadata.functionDefinitions;
	const matches: number[] = [];
	for (let index = 0; index < definitions.length; index++) {
		const definition = definitions[index];
		if (definition !== null && toLuaModulePath(definition.path) === modulePath && metadata.functionDisplayNames[index] === name) matches.push(index);
	}
	if (matches.length === 0) return;
	if (matches.length !== 1) throw new Error(`Instruction owner '${modulePath}:${name}' is not uniquely available.`);
	const result = new Map<number, DecodedInstruction>();
	for (const pc of instructionsByOwner(image, symbols).get(metadata.functionIds[matches[0]]) ?? []) {
		const instruction = decodeBlua32InstructionAtPc(image.layout.textBytes, image.layout.header.textAddress, pc);
		if (opcodes.has(instruction.op)) result.set(pc, instruction);
	}
	if (result.size === 0) throw new Error(`Instruction owner '${modulePath}:${name}' has no matching operations.`);
	return result;
}
