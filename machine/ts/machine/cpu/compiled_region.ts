import { valueFromNumber } from './value';
import type { ValueSlots } from './value_slots';
import type { CallFrame } from './call_state';
import type { Memory } from '../memory/memory';
import type { StringPool } from './string_pool';
import type { Blua32ExecutionImage, DecodedInstructionPage } from './execution_image';
import { planRegionRegisters } from './compiled_register_plan';
import { luaFloorDivide, luaModulo } from '../../spec/blua32/numeric';
import { luaPow } from '../../spec/blua32/pow';
import { CompiledBlockExit, emitJavaScriptBlock, finishJavaScriptBlock,
	type CompiledBlock, type CompiledBlockExitSite, type CompiledBlockSource } from './compiled_block';

export type CompiledRegionRunState = { remainingCycles: number; registerTop: number };
type RegionBody = (registers: ValueSlots, constants: Float64Array, page: DecodedInstructionPage,
	frame: CallFrame, entry: number, state: CompiledRegionRunState) => number;

/** One function and one source charge, with multiple externally addressable segments. */
export class CompiledRegion {
	public readonly entries: CompiledBlock[] = [];
	public constructor(public readonly execute: RegionBody, public readonly exits: readonly CompiledBlockExitSite[],
		public readonly sourceUnits: number) {}
}

export function compileJavaScriptRegion(page: DecodedInstructionPage, plans: readonly CompiledBlockSource[],
	image: Blua32ExecutionImage, memory: Memory, strings: StringPool, globalSlots: ValueSlots,
	systemGlobalSlots: ValueSlots, cop0Words: Uint32Array): CompiledRegion {
	const exits: CompiledBlockExitSite[] = [];
	const residents = planRegionRegisters(page, plans);
	const blocks = plans.map(plan => emitJavaScriptBlock(page, plan, image, memory, exits, residents));
	for (let index = blocks.length - 1; index >= 0; --index) {
		if (plans[index].fallthrough) {
			blocks[index].entryCycles = blocks[index].terminal.cycles + blocks[index + 1].entryCycles;
			blocks[index].sourceWords += blocks[index + 1].sourceWords;
		}
	}
	const entries = new Map(plans.map((plan, index) => [plan.pc, index]));
	const source = ['"use strict"; return function(r,k,p,frame,entry,state){',
		'let budget=state.remainingCycles,top=state.registerTop,exit;',
		...[...residents.keys()].map(register => `let rt${register}=r.getTag(${register}),rs${register}=r.getScalar(${register}),rv${register}=r.getReference(${register});`),
		'region:for(;;){switch(entry){'];
	const transfer = (block: typeof blocks[number], index: number): string => {
		const exit = exits[index];
		if (exit.exit === CompiledBlockExit.Continue) {
			const target = entries.get(exit.nextPc);
			if (target !== undefined) {
				const top = exit.resetsRegisterTop ? `top=Math.max(frame.top,${exit.registerTop});`
					: exit.registerTop === 0 ? '' : `if(top<${exit.registerTop})top=${exit.registerTop};`;
				return `if(budget-${exit.cycles}>=${blocks[target].entryCycles}){budget-=${exit.cycles};${top}entry=${target};continue region;}${block.registers.writeResidents()}exit=${index};break region;`;
			}
		}
		return `${block.registers.writeResidents()}exit=${index};break region;`;
	};
	for (let index = 0; index < blocks.length; ++index) {
		const block = blocks[index];
		if (plans[index].fallthrough) {
			const exit = block.terminal;
			const top = exit.resetsRegisterTop ? `top=Math.max(frame.top,${exit.registerTop});`
				: exit.registerTop === 0 ? '' : `if(top<${exit.registerTop})top=${exit.registerTop};`;
			// Entry admission already covers this entire linear span. A successful
			// helper fast path needs neither another budget test nor a switch jump.
			source.push(`case ${index}:{${block.body}\nbudget-=${exit.cycles};${top}}`);
		} else source.push(`case ${index}:{${block.body}\n${finishJavaScriptBlock(page, block, index => transfer(block, index))}}`);
	}
	source.push('}}const e=x[exit];state.remainingCycles=budget-e.cycles;',
		'state.registerTop=Math.max(e.resetsRegisterTop?frame.top:top,e.registerTop);return exit;}');
	const functionSource = source.join('\n');
	const cartridges = memory.cartridgeController;
	const execute = new Function('m', 'g', 's', 'c', 'c0', 'c1', 'f', 'q', 'kt', 'gl', 'sy', 'mod', 'floorDiv', 'pow', 'cp', 'x', functionSource)(
		memory.ramView, memory.ramWriteWatches().groupData(), memory.systemRomStorage(), cartridges,
		cartridges.romStorage(0), cartridges.romStorage(1), valueFromNumber, strings, image.constTags, globalSlots, systemGlobalSlots,
		luaModulo, luaFloorDivide, luaPow, cop0Words, exits) as RegionBody;
	const region = new CompiledRegion(execute, exits, functionSource.length);
	for (let entry = 0; entry < blocks.length; ++entry) {
		const block = blocks[entry];
		region.entries.push({ region, entry, page, firstWord: block.firstWord, entryCycles: block.entryCycles,
			terminal: block.terminal, exits: block.exits, sourceWords: block.sourceWords, incoming: null });
	}
	return region;
}
