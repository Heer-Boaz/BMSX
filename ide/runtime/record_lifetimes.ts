import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import { ValueTag } from '../../machine/ts/machine/cpu/value';
import { RAM_BASE } from '../../machine/ts/spec/bmsx/memory_map';

type ReferenceTag = ValueTag.Table | ValueTag.Closure | ValueTag.Thread | ValueTag.ResidentFunction;
type RecordLifetimes = { ram: Map<number, number>; rom?: Map<number, number>; nextId: number };
const byCpu = new WeakMap<CPU, RecordLifetimes>();

/** Tool-local lifetime tokens are assigned only to observed guest records. */
export function observedRecordLifetime(cpu: CPU, tag: ReferenceTag, address: number): number {
	const { memory } = cpu;
	let lifetimes = byCpu.get(cpu);
	if (lifetimes === undefined) {
		const ram = new Map<number, number>();
		memory.onRamWrite(offset => {
			if (memory.readRamRecordByte(offset) === 0 && ram.delete(offset)) memory.unwatchRamByte(offset);
		});
		cpu.onStateReplaced(() => retireObservedRecordLifetimes(cpu));
		lifetimes = { ram, nextId: 1 };
		byCpu.set(cpu, lifetimes);
	}
	// The linked System function is an immutable ROM reference. Replacing
	// the observed state ends its token without arming any physical RAM.
	const rom = tag === ValueTag.ResidentFunction;
	const observed = rom ? lifetimes.rom ??= new Map() : lifetimes.ram;
	const offset = rom ? address : address - RAM_BASE;
	const existing = observed.get(offset);
	if (existing !== undefined) return existing;
	const id = lifetimes.nextId++;
	observed.set(offset, id);
	if (!rom) memory.watchRamByte(offset);
	return id;
}

/** A replacement ends all observations but must not recycle their tokens. */
export function retireObservedRecordLifetimes(cpu: CPU): void {
	const lifetimes = byCpu.get(cpu);
	if (lifetimes === undefined) return;
	for (const offset of lifetimes.ram.keys()) cpu.memory.unwatchRamByte(offset);
	lifetimes.ram.clear();
	lifetimes.rom?.clear();
}
