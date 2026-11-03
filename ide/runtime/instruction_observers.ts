import type { CPU, InstructionObserverBinding } from '../../machine/ts/machine/cpu/cpu';
import type { ValueSlots } from '../../machine/ts/machine/cpu/value_slots';
import type { ExecutionDomainId } from '../../machine/ts/spec/blua32/execution_domain';

/** One CPU observation lane, shared by independent tooling consumers. Dispatch
 * is bound when subscriptions change, never searched or allocated per instruction. */
export class RuntimeInstructionObservers implements InstructionObserverBinding {
	public readonly points = [new Set<number>(), new Set<number>(), new Set<number>()] as const;
	private readonly locations = [new Map<number, InstructionObserverBinding[]>(), new Map<number, InstructionObserverBinding[]>(), new Map<number, InstructionObserverBinding[]>()];
	private readonly bindings = new Set<InstructionObserverBinding>();
	public constructor(private readonly cpu: CPU) {}
	public add(binding: InstructionObserverBinding): () => void {
		this.bindings.add(binding); this.bind();
		return () => { this.bindings.delete(binding); this.bind(); };
	}
	private bind(): void {
		for (let domain = 0; domain < 3; domain++) {
			const points = this.points[domain], locations = this.locations[domain];
			points.clear(); locations.clear();
			for (const binding of this.bindings) for (const pc of binding.points[domain]) {
				points.add(pc);
				const observers = locations.get(pc);
				if (observers === undefined) locations.set(pc, [binding]); else observers.push(binding);
			}
		}
		this.cpu.setInstructionObserver(this.bindings.size === 0 ? null : this);
	}
	public observe(domain: ExecutionDomainId, pc: number, values: ValueSlots): void {
		for (const binding of this.locations[domain + 1].get(pc)!) binding.observe(domain, pc, values);
	}
	public dispose(): void { this.bindings.clear(); this.bind(); }
}
