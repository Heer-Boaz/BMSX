import type { GcHeap } from '../../machine/ts/machine/cpu/gc_heap';

type RecordLifetimes = { observed: Map<number, number>; nextId: number };
const byHeap = new WeakMap<GcHeap, RecordLifetimes>();

/** Tool-local lifetime tokens are assigned only to observed guest records. */
export function observedRecordLifetime(heap: GcHeap, address: number): number {
	let lifetimes = byHeap.get(heap);
	if (lifetimes === undefined) {
		const observed = new Map<number, number>();
		heap.onRecordRetirement = retired => {
			if (retired === null) observed.clear();
			else observed.delete(retired);
		};
		lifetimes = { observed, nextId: 1 };
		byHeap.set(heap, lifetimes);
	}
	const existing = lifetimes.observed.get(address);
	if (existing !== undefined) return existing;
	const id = lifetimes.nextId++;
	lifetimes.observed.set(address, id);
	return id;
}
