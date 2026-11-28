import { nativeHeapReference } from './native_heap/reference';
import type { CPU } from '../../machine/ts/machine/cpu/cpu';
import { GC_STEP_WORDS } from './native_heap/lua_heap';
import { valueNil } from '../../machine/ts/machine/cpu/value';
import { GC_LAST_EPOCH_WORK, GcPhase } from './native_heap/gc_heap';
import { HEAP_GC_CONTROL_OFFSET } from './firmware_heap_layout';

const GC_PHYSICAL_OCCUPIED_AT_TICK = GC_LAST_EPOCH_WORK + 4;
const GC_PHYSICAL_ASSIST = GC_PHYSICAL_OCCUPIED_AT_TICK + 4;

// Frozen TS admission reference for kernel/gc_vblank.lua.
export function assistPhysicalPressureAtTickReference(cpu: CPU, rebuilding = 0): void {
	const { memory } = cpu, { gc, heapAllocator: arena } = nativeHeapReference(cpu);
	const control = arena.managementOffset() + HEAP_GC_CONTROL_OFFSET;
	if (rebuilding) return;
	if (gc.fullEpochs()) return;
	const occupied = arena.occupiedBytes();
	const previousOccupied = memory.readRamRecordWord(control + GC_PHYSICAL_OCCUPIED_AT_TICK);
	if (occupied !== previousOccupied) memory.writeRamRecordWord(control + GC_PHYSICAL_OCCUPIED_AT_TICK, occupied);
	const current = gc.phase();
	if (current === GcPhase.Atomic) return;
	if (memory.readRamRecordWord(control + GC_PHYSICAL_ASSIST) === 0) {
		if (occupied <= previousOccupied) return;
		const demand = occupied - previousOccupied;
		const completed = gc.epochWork();
		const previous = memory.readRamRecordWord(control + GC_LAST_EPOCH_WORK);
		const remaining = Math.max(previous, completed) - completed;
		// Atomic entry and exit can end a pulse early. Leave room for the next interval's growth.
		const quanta = (((remaining + GC_STEP_WORDS - 1) / GC_STEP_WORDS) >>> 0) + 3;
		if (arena.unoccupiedBytes() > demand * quanta) return;
		memory.writeRamRecordWord(control + GC_PHYSICAL_ASSIST, 1);
	}
	const idleMark = (current === GcPhase.Mark || current === GcPhase.MarkAgain) && cpu.isHaltedUntilIrq();
	gc.step(valueNil(), valueNil(), valueNil(), 0, false, idleMark ? 4 * GC_STEP_WORDS : GC_STEP_WORDS);
}
