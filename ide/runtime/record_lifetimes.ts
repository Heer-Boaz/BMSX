import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import { RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';

type RecordLifetimes = { observed: Map<number, number>; nextId: number };
const byCpu = new WeakMap<CPU, RecordLifetimes>();

/** Tool-local lifetime tokens are assigned only to observed guest records. */
export function observedRecordLifetime(cpu: CPU, address: number): number {
	const { memory } = cpu;
	let lifetimes = byCpu.get(cpu);
	if (lifetimes === undefined) {
		const observed = new Map<number, number>();
		memory.onRamWrite(offset => {
			if (memory.readRamRecordByte(offset) === 0 && observed.delete(offset)) memory.unwatchRamByte(offset);
		});
		cpu.onStateReplaced(() => retireObservedRecordLifetimes(cpu));
		lifetimes = { observed, nextId: 1 };
		byCpu.set(cpu, lifetimes);
	}
	const offset = address - RAM_BASE;
	const existing = lifetimes.observed.get(offset);
	if (existing !== undefined) return existing;
	const id = lifetimes.nextId++;
	lifetimes.observed.set(offset, id);
	memory.watchRamByte(offset);
	return id;
}

/** A replacement ends all observations but must not recycle their tokens. */
export function retireObservedRecordLifetimes(cpu: CPU): void {
	const lifetimes = byCpu.get(cpu);
	if (lifetimes === undefined) return;
	for (const offset of lifetimes.observed.keys()) cpu.memory.unwatchRamByte(offset);
	lifetimes.observed.clear();
}
