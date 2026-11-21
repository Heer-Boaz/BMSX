import { OpCode } from '../../spec/blua32/opcode';
import { TableRecords, type TableLengthWork } from './table';
import { f32BitsToNumber, numberToF32Bits } from '../../common/float32';
import { luaFloatResultBits, luaFloatToInteger, luaFloatToWord, luaIntegerModulo, luaIntegerFloorDivide, luaFloatModuloBits, luaFloatFloorDivideBits, luaShiftLeft, luaShiftRight } from '../../spec/blua32/numeric';
import type { GcHeap } from './gc_heap';
import { ValueSlots } from './value_slots';
import type { CallFrame } from './call_state';
import { Memory } from '../memory/memory';
import type { StringId, StringPool } from './string_pool';
import type { Blua32ExecutionImage, DecodedInstructionPage } from './execution_image';
import { planRegionRegisters } from './compiled_register_plan';
import { CompiledExitWriteBacks } from './compiled_block_registers';
import { luaPow } from '../../spec/blua32/pow';
import { CompiledBlockExit, emitJavaScriptBlock, finishJavaScriptBlock,
	type CompiledBlock, type CompiledBlockExitSite, type CompiledBlockSource } from './compiled_block';

export type CompiledRegionRunState = { remainingCycles: number; registerTop: number; memoryAddress: number; lengthWork: TableLengthWork };
type RegionBody = (registers: ValueSlots, constants: Uint32Array, page: DecodedInstructionPage,
	frame: CallFrame, entry: number, state: CompiledRegionRunState) => number;

// Generated regions call host methods through one- and two-letter aliases of
// the same function objects. The shorter source parses faster and lets more
// regions fit the source budget; each call is the same call as before.
function aliasGeneratedMethods(prototype: object, aliases: Readonly<Record<string, string>>): void {
	for (const alias in aliases) Object.defineProperty(prototype, alias, { value: Reflect.get(prototype, aliases[alias]), writable: true, configurable: true });
}
aliasGeneratedMethods(ValueSlots.prototype, { t: 'getTag', p: 'getPayload', s: 'setEncoded' });
aliasGeneratedMethods(TableRecords.prototype, { li: 'loadIntegerArrayKey', si: 'storeIntegerArrayKey',
	lp: 'loadPredictedStringKey', sp: 'storePredictedStringKey' });
aliasGeneratedMethods(Memory.prototype, { rb: 'readRamRecordByte', rd: 'readRamRecordWord',
	wb: 'writeRamRecordByte', wd: 'writeRamRecordWord' });

// Generated names: B budget, T register top, X exit, N entry, F frame, S run
// state, R the region loop, yN/zN the tag/payload of resident register N and
// tN/wN block locals.

/** One function and one source charge, with multiple externally addressable segments. */
export class CompiledRegion {
	public readonly entries: CompiledBlock[] = [];
	public constructor(public readonly execute: RegionBody, public readonly exits: readonly CompiledBlockExitSite[],
		public readonly sourceUnits: number) {}
}

export function compileJavaScriptRegion(page: DecodedInstructionPage, plans: readonly CompiledBlockSource[],
	image: Blua32ExecutionImage, memory: Memory, strings: StringPool, globalSlots: ValueSlots,
	systemGlobalSlots: ValueSlots, cop0Words: Uint32Array, heap: GcHeap, newIndexKey: StringId): CompiledRegion {
	const exits: CompiledBlockExitSite[] = [];
	const registers = planRegionRegisters(page, plans), residents = registers.map(plan => plan.entry);
	const blocks: ReturnType<typeof emitJavaScriptBlock>[] = [];
	const writeBacks = new CompiledExitWriteBacks();
	for (let index = 0; index < plans.length; ++index) {
		// Helper-success spans inherit all actual definitions and no new admission.
		if (index !== 0 && plans[index - 1].fallthrough) residents[index] = blocks[index - 1].registers.residents;
		blocks.push(emitJavaScriptBlock(page, plans[index], memory, exits, residents[index], registers[index].outputs, writeBacks));
	}
	for (let index = blocks.length - 1; index >= 0; --index) {
		if (plans[index].fallthrough) {
			blocks[index].sourceWords += blocks[index + 1].sourceWords;
		}
	}
	const admissionCycles = blocks.map(block => block.admissionCycles);
	const admissionVarargs = blocks.map(block => block.admissionVarargs);
	for (let index = blocks.length - 1; index >= 0; --index) {
		if (plans[index].fallthrough) {
			admissionCycles[index] = blocks[index].terminal.cycles + blocks[index].formatCycles + admissionCycles[index + 1];
			admissionVarargs[index] = blocks[index].openVarargs + admissionVarargs[index + 1];
		}
	}
	const entries = new Map(plans.map((plan, index) => [plan.pc, index]));
	const bindings = new Set(blocks.flatMap(block => [...block.registers.residents.keys()]));
	// Block locals live at function scope so the shared exit epilogue can
	// store them. Each block assigns a local before any read of it.
	const locals = Math.max(0, ...blocks.map(block => block.registers.localCount));
	const source = ['"use strict";return function(r,k,p,F,N,S){',
		'let B=S.remainingCycles,T=S.registerTop,X;',
		...[...bindings].map(register => `let y${register},z${register};`),
		...Array.from({ length: locals }, (_, index) => `let t${index},w${index};`),
		'switch(N){'];
	// Entries with the same live-in registers share one load sequence.
	const prologues = new Map<string, number[]>();
	for (let index = 0; index < residents.length; ++index) {
		let load = '';
		for (const register of [...residents[index].keys()].sort((left, right) => left - right))
			load += `y${register}=r.t(${register});z${register}=r.p(${register});`;
		const group = prologues.get(load);
		if (group === undefined) prologues.set(load, [index]);
		else group.push(index);
	}
	for (const [load, group] of prologues) if (load !== '') source.push(`${group.map(index => `case ${index}:`).join('')}${load}break;`);
	source.push('}R:for(;;){switch(N){');
	const transfer = (block: typeof blocks[number], index: number, residentsPublished: boolean): string => {
		const exit = exits[index];
		if (exit.exit === CompiledBlockExit.Continue) {
			const target = entries.get(exit.nextPc);
			if (target !== undefined) {
				const top = exit.resetsRegisterTop ? `T=Math.max(F.top,${exit.registerTop});`
					: exit.registerTop === 0 ? '' : `if(T<${exit.registerTop})T=${exit.registerTop};`;
				const required = admissionVarargs[target] === 0 ? `${admissionCycles[target]}`
					: `${admissionCycles[target]}+${admissionVarargs[target]}*F.varargCount`;
				return `if(B-${exit.cycles}>${required}){B-=${exit.cycles};${top}${block.registers.transferResidents(residents[target], residentsPublished)}N=${target};continue R;}${block.registers.leaveResidents(index, residentsPublished)}`;
			}
		}
		return block.registers.leaveResidents(index, residentsPublished);
	};
	for (let index = 0; index < blocks.length; ++index) {
		const block = blocks[index];
		if (plans[index].fallthrough) {
			const exit = block.terminal;
			const top = exit.resetsRegisterTop ? `T=Math.max(F.top,${exit.registerTop});`
				: exit.registerTop === 0 ? '' : `if(T<${exit.registerTop})T=${exit.registerTop};`;
			// Variable table work and readiness-dependent memory charges are
			// settled before admitting the next fixed prefix.
			const required = admissionVarargs[index + 1] === 0 ? `${admissionCycles[index + 1]}`
				: `${admissionCycles[index + 1]}+${admissionVarargs[index + 1]}*F.varargCount`;
			const frontier = (page.ops[block.finalWord] === OpCode.LEN || block.formatCycles !== 0)
				? `if(B-${exit.cycles}<=${required}){${block.registers.leaveResidents(block.terminalIndex)}}` : '';
			source.push(`case ${index}:{${block.body}\n${frontier}B-=${exit.cycles};${top}}`);
		} else source.push(`case ${index}:{${block.body}\n${finishJavaScriptBlock(page, block, exits, (index, published) => transfer(block, index, published))}}`);
	}
	source.push('}}', writeBacks.epilogue(), 'const e=x[X];S.remainingCycles=B-e.cycles;',
		'S.registerTop=Math.max(e.resetsRegisterTop?F.top:T,e.registerTop);return X;}');
	// The only string literal in generated code is the directive, so template
	// indentation carries no meaning.
	const functionSource = source.join('\n').replace(/\n\s+/g, '\n');
	const cartridges = memory.cartridgeController;
	const execute = new Function('m', 'g', 's', 'c', 'c0', 'c1', 'q', 'kt', 'gl', 'sy',
		'bf', 'fb', 'fr', 'fi', 'fw', 'imod', 'idiv', 'fmod', 'fdiv', 'shl', 'shr', 'pow', 'cp', 'h', 'x', 'tb', 'ts', 'nk', functionSource)(
		memory.ramView, memory.ramWriteWatches().groupData(), memory.systemRomStorage(), cartridges,
		cartridges.romStorage(0), cartridges.romStorage(1), strings, image.constTags, globalSlots, systemGlobalSlots,
		f32BitsToNumber, numberToF32Bits, luaFloatResultBits, luaFloatToInteger, luaFloatToWord,
		luaIntegerModulo, luaIntegerFloorDivide, luaFloatModuloBits, luaFloatFloorDivideBits,
		luaShiftLeft, luaShiftRight, luaPow, cop0Words, heap, exits, heap.tables, page.tableCacheSlots, newIndexKey) as RegionBody;
	const region = new CompiledRegion(execute, exits, functionSource.length);
	for (let entry = 0; entry < blocks.length; ++entry) {
		const block = blocks[entry];
		region.entries.push({ region, entry, page, firstWord: block.firstWord,
			terminal: block.terminal, exits: block.exits, admissionCycles: admissionCycles[entry],
			admissionVarargs: admissionVarargs[entry], sourceWords: block.sourceWords, incoming: null });
	}
	return region;
}
