import { TableRecords } from './table';
import { f32BitsToNumber, numberToF32Bits } from '../../common/float32';
import { luaFloatResultBits, luaFloatToInteger, luaFloatToWord, luaIntegerModulo, luaIntegerFloorDivide, luaFloatModuloBits, luaFloatFloorDivideBits, luaShiftLeft, luaShiftRight } from '../../spec/blua32/numeric';
import { ValueSlots } from './value_slots';
import type { CallFrame } from './call_state';
import { Memory } from '../memory/memory';
import type { StringPool } from './string_pool';
import type { Blua32ExecutionImage, DecodedInstructionPage } from './execution_image';
import { planRegionRegisters } from './compiled_register_plan';
import { CompiledExitWriteBacks } from './compiled_block_registers';
import { luaPow } from '../../spec/blua32/pow';
import { CPU_RESET_BANK_ADDRESS, RAM_BASE, THREAD_STACK_SLOT_BYTES } from '../../spec/bmsx/memory_map';
import { VALUE_MEMORY_TAG_OFFSET } from '../../spec/blua32/memory_access_kind';
import { CompiledBlockExit, emitJavaScriptBlock, finishJavaScriptBlock,
	type CompiledBlock, type CompiledBlockExitSite, type CompiledBlockSource } from './compiled_block';

export type CompiledRegionRunState = { remainingCycles: number; registerTop: number; effectiveAddress: number };
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
		public readonly sourceUnits: number, public readonly requiredSlots: number, public readonly requiredCaptures: number) {}
}

export function compileJavaScriptRegion(plans: readonly CompiledBlockSource[],
	image: Blua32ExecutionImage, memory: Memory, strings: StringPool, globalSlots: ValueSlots,
	systemGlobalSlots: ValueSlots, cop0Words: Uint32Array, tables: TableRecords): CompiledRegion {
	const exits: CompiledBlockExitSite[] = [];
	const { requiredSlots, requiredCaptures, blocks: registers } = planRegionRegisters(plans), residents = registers.map(plan => plan.entry);
	const tableCaches = new Map<DecodedInstructionPage, string>();
	const blocks: ReturnType<typeof emitJavaScriptBlock>[] = [];
	const writeBacks = new CompiledExitWriteBacks();
	for (let index = 0; index < plans.length; ++index) {
		// Helper-success spans inherit all actual definitions and no new admission.
		if (index !== 0 && plans[index - 1].fallthrough) residents[index] = blocks[index - 1].registers.residents;
		const plan = plans[index];
		let tableCache = tableCaches.get(plan.page);
		if (tableCache === undefined) {
			tableCache = tableCaches.size === 0 ? 'ts' : `ts${tableCaches.size}`;
			tableCaches.set(plan.page, tableCache);
		}
		blocks.push(emitJavaScriptBlock(plan, tableCache, memory, exits, residents[index], registers[index].outputs, writeBacks, image));
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
		'let B=S.remainingCycles,T=S.registerTop,X;'];
	if (blocks.some(block => block.valueMemory)) {
		// Cached register Values and the current control frontier are not
		// visible to direct RAM accesses until this region writes them back.
		source.push(`const A=F.thread,ca=A.address!==${CPU_RESET_BANK_ADDRESS};let vs,vl,fs,fl,cs;
if(ca){const V=A.stackRegisters;vs=V.ramOffset();vl=V.capacity()*${THREAD_STACK_SLOT_BYTES}+${VALUE_MEMORY_TAG_OFFSET};
fs=A.frameBackingOffset;fl=A.frameBackingBytes+${VALUE_MEMORY_TAG_OFFSET};cs=A.address-${RAM_BASE};}`);
	}
	source.push(
		...[...bindings].map(register => `let y${register},z${register};`),
		...Array.from({ length: locals }, (_, index) => `let t${index},w${index};`),
		'switch(N){');
	// Entries with the same live-in registers share one load sequence.
	const prologues = new Map<string, number[]>();
	for (let index = 0; index < residents.length; ++index) {
		let load = '';
		const registers = blocks[index].registers;
		for (const register of [...residents[index].keys()].sort((left, right) => left - right))
			load += `y${register}=${registers.frameTag(register)};z${register}=${registers.framePayload(register)};`;
		const group = prologues.get(load);
		if (group === undefined) prologues.set(load, [index]);
		else group.push(index);
	}
	for (const [load, group] of prologues) if (load !== '') source.push(`${group.map(index => `case ${index}:`).join('')}${load}break;`);
	source.push('}R:for(;;){switch(N){');
	const transfer = (block: typeof blocks[number], index: number): string => {
		const exit = exits[index];
		if (exit.exit === CompiledBlockExit.Continue) {
			const target = entries.get(exit.nextPc);
			if (target !== undefined) {
				const top = exit.resetsRegisterTop ? `T=Math.max(F.top,${exit.registerTop});`
					: exit.registerTop === 0 ? '' : `if(T<${exit.registerTop})T=${exit.registerTop};`;
				const required = admissionVarargs[target] === 0 ? `${admissionCycles[target]}`
					: `${admissionCycles[target]}+${admissionVarargs[target]}*F.varargCount`;
				return `if(B-${exit.cycles}>${required}){B-=${exit.cycles};${top}${block.registers.transferResidents(residents[target])}N=${target};continue R;}${block.registers.leaveResidents(index)}`;
			}
		}
		return block.registers.leaveResidents(index);
	};
	for (let index = 0; index < blocks.length; ++index) {
		const block = blocks[index];
		if (plans[index].fallthrough) {
			const exit = block.terminal;
			const top = exit.resetsRegisterTop ? `T=Math.max(F.top,${exit.registerTop});`
				: exit.registerTop === 0 ? '' : `if(T<${exit.registerTop})T=${exit.registerTop};`;
			// Settle memory-format charges before the next fixed prefix.
			const required = admissionVarargs[index + 1] === 0 ? `${admissionCycles[index + 1]}`
				: `${admissionCycles[index + 1]}+${admissionVarargs[index + 1]}*F.varargCount`;
			const frontier = block.formatCycles !== 0
				? `if(B-${exit.cycles}<=${required}){${block.registers.leaveResidents(block.terminalIndex)}}` : '';
			source.push(`case ${index}:{${block.body}\n${frontier}B-=${exit.cycles};${top}}`);
		} else source.push(`case ${index}:{${block.body}\n${finishJavaScriptBlock(plans[index].page, block, index => transfer(block, index))}}`);
	}
	source.push('}}', writeBacks.epilogue(), 'const e=x[X];S.remainingCycles=B-e.cycles;',
		'S.registerTop=Math.max(e.resetsRegisterTop?F.top:T,e.registerTop);return X;}');
	// The admitted frame has one contiguous view per lane. Keep those
	// same views through the region; normal exits still publish via r.s.
	if (blocks.some(block => block.registers.readsTagPlane)) source[1] += 'const RT=r.tagPlane,TB=r.tagRamOffset();';
	if (blocks.some(block => block.registers.readsPayloadPlane)) source[1] += 'const RW=r.payloadPlane,WB=r.ramOffset()>>>2;';
	// The only string literal in generated code is the directive, so template
	// indentation carries no meaning.
	const functionSource = source.join('\n').replace(/\n\s+/g, '\n');
	const cartridges = memory.cartridgeController;
	const execute = new Function('m', 'g', 's', 'c', 'c0', 'c1', 'q', 'kt', 'gl', 'sy',
		'bf', 'fb', 'fr', 'fi', 'fw', 'imod', 'idiv', 'fmod', 'fdiv', 'shl', 'shr', 'pow', 'cp', 'h', 'x', 'tb', ...tableCaches.values(), functionSource)(
		memory.ramView, memory.ramWriteWatches().groupData(), memory.systemRomStorage(), cartridges,
		cartridges.romStorage(0), cartridges.romStorage(1), strings, image.constTags, globalSlots, systemGlobalSlots,
		f32BitsToNumber, numberToF32Bits, luaFloatResultBits, luaFloatToInteger, luaFloatToWord,
		luaIntegerModulo, luaIntegerFloorDivide, luaFloatModuloBits, luaFloatFloorDivideBits,
		luaShiftLeft, luaShiftRight, luaPow, cop0Words, memory, exits, tables,
		...[...tableCaches.keys()].map(page => page.tableCacheSlots)) as RegionBody;
	const region = new CompiledRegion(execute, exits, functionSource.length, requiredSlots, requiredCaptures);
	for (let entry = 0; entry < blocks.length; ++entry) {
		const block = blocks[entry];
		region.entries.push({ region, entry, page: plans[entry].page, firstWord: block.firstWord,
			terminal: block.terminal, exits: block.exits, admissionCycles: admissionCycles[entry],
			admissionVarargs: admissionVarargs[entry], sourceWords: block.sourceWords, incoming: null });
	}
	return region;
}
