import { Closure, CLOSURE_BINDING_FLAGS, CLOSURE_CANONICAL, UPVALUE_RECORD_KIND } from '../../machine/ts/machine/cpu/closure';
// Bounded sampling of guest RAM allocations and selected frame boundaries
// in the headless runtime, not a whole-game peak or host RSS measurement.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { TableHeader } from '../../machine/ts/machine/cpu/table';
import { THREAD_RECORD_KIND } from '../../machine/ts/machine/cpu/thread';
import { ValueTag } from '../../machine/ts/machine/cpu/value';
import { BLUA32_STRING_RECORD_KIND } from '../../machine/ts/spec/blua32/image_format';
import type { InputControllerSnapshot } from '../../machine/ts/machine/devices/input/contracts';
import { Runtime } from '../../machine/ts/machine/runtime/runtime';
import { parseSystemRomImage } from '../../machine/ts/rompack/image';
import { cartridgeMediaFromImages } from '../../hosts/common/cartridge_media';
import { HeadlessGPUBackend } from '../../machine/ts/render/headless/backend';
import { PSX_MACHINE_SPEC } from '../../machine/ts/spec/bmsx/model';

function main(): void {
	const [biosPath, cartridgePath, frameCountArg] = process.argv.slice(2);
	const frameCount = Number(frameCountArg);
	const [bios, cartridge] = [readFileSync(biosPath), readFileSync(cartridgePath)];
	const runtime = new Runtime({ systemRomBytes: parseSystemRomImage(bios).bytes,
		cartridgeSlots: cartridgeMediaFromImages([cartridge, null]), machineModel: PSX_MACHINE_SPEC }, {
		sampleInputControllerSnapshot(snapshot: InputControllerSnapshot) { snapshot.keyWords.fill(0); },
		supervisorRequestLineHigh: () => false,
		applyInputControllerVibrationEffect() {},
	});
	const gpu = runtime.machine.gxGpu;
	const backend = new HeadlessGPUBackend(256, 212, PSX_MACHINE_SPEC.gxGpuVramBytes);
	const cpu = runtime.machine.cpu;
	// Instrument the physical producer in this process only. Include temporary
	// blocks present while a record is resized or a multi-block request runs.
	const arena = cpu.heapAllocator;
	const allocate = arena.allocate;
	let profileFrame = 0, successfulAllocations = 0;
	let peakAllocationBytes = arena.occupiedBytes(), peakAllocationFrame = 0, peakAllocationCycles = 0;
	arena.allocate = function (bytes, owned) {
		const address = allocate.call(arena, bytes, owned);
		if (address !== 0) {
			++successfulAllocations;
			const used = arena.occupiedBytes();
			if (used > peakAllocationBytes) {
				peakAllocationBytes = used;
				peakAllocationFrame = profileFrame;
				peakAllocationCycles = runtime.machine.scheduler.nowCycles;
			}
		}
		return address;
	};
	runtime.boot();
	let peakTracked = cpu.luaHeap.usedBytes(), peakActiveFrames = cpu.activeThread.frameDepth;
	let peakActiveStackCapacity = cpu.activeThread.stackRegisters.capacity(), firstCart = -1;
	const baselineGlobals = cpu.globalSlotCount;
	const snapshots = [];
	for (let frame = 1; frame <= frameCount; frame += 1) {
		profileFrame = frame;
		let completed = false;
		for (let attempt = 0; (!completed || gpu.backendServicePending()) && attempt < 32; attempt += 1) {
			if (gpu.backendServicePending()) {
				if (gpu.backendCommandDrainPending()) backend.executeGxGpuCommandDrain(gpu);
				else backend.executeGxGpuReadback(gpu);
			}
			if (!completed) completed = runtime.frameScheduler.runToNextLogicalTick();
		}
		if (!completed) throw new Error(`Logical tick did not complete at frame ${frame}`);
		backend.executeGxGpuCommandDrain(gpu);
		gpu.retirePresentedCommands();
		runtime.machine.audioController.synchronizeOutput().clear();
		peakTracked = Math.max(peakTracked, cpu.luaHeap.usedBytes());
		peakActiveFrames = Math.max(peakActiveFrames, cpu.activeThread.frameDepth);
		peakActiveStackCapacity = Math.max(peakActiveStackCapacity, cpu.activeThread.stackRegisters.capacity());
		const newCart = firstCart < 0 && cpu.globalSlotCount > baselineGlobals;
		if (newCart) firstCart = frame;
		if (frame === 1 || frame === frameCount || newCart) {
			const state = cpu.captureRuntimeState();
			const objects = { tables: 0, closures: 0, upvalues: 0, threads: 0, ramStrings: 0 };
			let arraySlots = 0, hashSlots = 0, canonicalClosures = 0, closureUpvalueSlots = 0, ramStringBytes = 0;
			let totalFrames = 0, totalReservedStackSlots = 0, protectedCalls = 0;
			arena.visitObjectRecords(cpu, (cpu, record) => {
				const memory = cpu.memory;
				switch (memory.readRamRecordByte(record)) {
					case ValueTag.Table:
						++objects.tables;
						arraySlots += memory.readRamRecordWord(record + TableHeader.Array);
						hashSlots += memory.readRamRecordWord(record + TableHeader.Hash);
						break;
					case ValueTag.Closure:
						++objects.closures;
						if ((memory.readRamRecordByte(record + CLOSURE_BINDING_FLAGS) & CLOSURE_CANONICAL) !== 0) ++canonicalClosures;
						closureUpvalueSlots += Closure.captureCount(memory, record);
						break;
					case UPVALUE_RECORD_KIND:
						++objects.upvalues;
						break;
					case THREAD_RECORD_KIND: {
						++objects.threads;
						const thread = cpu.gc.threadAt(record)!;
						totalFrames += thread.frameDepth;
						totalReservedStackSlots += thread.stackRegisters.capacity();
						protectedCalls += thread.protectedDepth;
						break;
					}
					case BLUA32_STRING_RECORD_KIND:
						++objects.ramStrings;
						ramStringBytes += cpu.stringPool.byteLength(record);
						break;
				}
				return 1;
			});
			snapshots.push({ frame, systemCycles: runtime.machine.scheduler.nowCycles,
				occupiedHeapBytes: arena.occupiedBytes(),
				ordinaryGlobals: state.globals.count, systemGlobals: state.systemGlobals.count,
				lastExecutionDomainId: state.lastExecutionDomainId, activeExecutionDomainId: state.executionCartridgeSlot,
				executionResidencyMask: state.executionResidencyMask, hardHalted: state.hardHalted,
				totalFrames, totalReservedStackSlots, protectedCalls,
				objects, arraySlots, hashSlots, canonicalClosures, closureUpvalueSlots, ramStringBytes });
		}
	}
	process.stdout.write(JSON.stringify({
		scope: 'Real TS runtime, bounded headless run with no controller input. Guest heap occupancy is observed after successful allocator calls and at frame boundaries, before any subsequent releases. These are not host RSS or full-game maxima.',
		bios: { path: biosPath, sha256: createHash('sha256').update(bios).digest('hex') },
		cartridge: { path: cartridgePath, sha256: createHash('sha256').update(cartridge).digest('hex') },
		frames: frameCount, firstFrameWithAdditionalOrdinaryGlobals: firstCart,
		successfulAllocations, peakAllocationBytes, peakAllocationFrame, peakAllocationCycles,
		peakSampledOccupiedHeapBytes: peakTracked, peakSampledActiveFrames: peakActiveFrames,
		peakSampledActiveStackCapacity: peakActiveStackCapacity, snapshots,
	}, null, 2) + '\n');
}
main();
