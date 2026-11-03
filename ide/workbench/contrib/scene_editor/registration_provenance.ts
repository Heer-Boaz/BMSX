import type { CPU, InstructionObserverBinding } from '../../../../machine/ts/machine/cpu/cpu';
import type { ValueSlots } from '../../../../machine/ts/machine/cpu/value_slots';
import { signExtend } from '../../../../machine/ts/spec/blua32/instruction_format';
import { OpCode } from '../../../../machine/ts/spec/blua32/opcode';
import type { ExecutionDomainId } from '../../../../machine/ts/spec/blua32/execution_domain';
import type { Blua32ToolingImage } from '../../../../toolchain/ts/rompack/blua32_media';
import { blua32InlineCallSitesAtPc, blua32SourceRangeAtPc } from '../../../../toolchain/ts/rompack/blua32_symbols';
import type { SourceRange } from '../../../../toolchain/ts/lua/source_range';
import { bindFunctionInstructions } from '../../../runtime/instruction_probe';
import type { DecodedInstruction } from '../../../../toolchain/ts/rompack/disassembler';

export type ScenePlanRegistration = {
	readonly planHashId: number;
	/** Innermost first, including optimized inline callsites and real callers. */
	readonly calls: readonly SourceRange[];
};

const PLAN_STORES = new Set([OpCode.SETT, OpCode.SETFIELD, OpCode.SETI]);

/** Same-build cartlib registration observation. No guest roots, rewritten Lua,
 * function-entry guesses or registration-name identity survive this boundary. */
export class SceneRegistrationProvenance implements InstructionObserverBinding {
	private readonly stores: ReadonlyMap<number, DecodedInstruction> | undefined;
	public readonly points = [new Set<number>(), new Set<number>(), new Set<number>()] as const;
	public readonly plans = new Map<number, ScenePlanRegistration>();
	public constructor(private readonly cpu: CPU, private readonly image: Blua32ToolingImage, private readonly domain: ExecutionDomainId) {
		this.stores = bindFunctionInstructions(image, 'cartlib/world/scene_library', 'scene_library.register', PLAN_STORES);
		if (this.stores !== undefined) for (const pc of this.stores.keys()) this.points[domain + 1].add(pc);
	}
	public observe(_domain: ExecutionDomainId, pc: number, registers: ValueSlots): void {
		const instruction = this.stores!.get(pc)!;
		const plan = registers.getTable(signExtend(instruction.c, instruction.rkBitsC));
		const calls: SourceRange[] = [];
		let callPc = pc;
		for (let frame = this.cpu.getFrameDepth() - 1; frame >= 0; frame--) {
			if (this.cpu.readFrameExecutionDomain(frame) !== this.domain) break;
			const symbols = this.image.symbols!, text = this.image.layout.header.textAddress;
			const chain = blua32InlineCallSitesAtPc(symbols, text, callPc);
			for (let index = chain.length - 1; index >= 0; index--) calls.push(chain[index].callRange);
			if (frame === 0) break;
			callPc = this.cpu.readFrameCallSitePc(frame);
			const range = blua32SourceRangeAtPc(symbols, text, callPc);
			if (range !== null) calls.push(range);
		}
		this.plans.set(plan.hashId, { planHashId: plan.hashId, calls });
	}
}
