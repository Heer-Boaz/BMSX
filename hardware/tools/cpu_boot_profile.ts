// Bounded sampling of the actual headless runtime: successful reservations and
// selected frame boundaries. These are logical charges, not physical VM usage,
// a worst-case peak or compatibility proof.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { CpuSnapshotClosure, CpuSnapshotObjectKind, CpuSnapshotTable } from '../../machine/ts/machine/cpu/snapshot';
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
	// Instrument this profiling run only. Do not retain argument references:
	// those are temporary GC roots in the real reservation call.
	const heap = cpu.luaHeap;
	const reserve = heap.reserve;
	let profileFrame = 0, successfulReservations = 0;
	let peakReservationBytes = heap.usedBytes(), peakReservationFrame = 0, peakReservationCycles = 0;
	heap.reserve = function (bytes, tag0, scalar0, reference0, tag1, scalar1, reference1, tag2, scalar2, reference2) {
		reserve.call(heap, bytes, tag0, scalar0, reference0, tag1, scalar1, reference1, tag2, scalar2, reference2);
		successfulReservations += 1;
		const used = heap.usedBytes();
		if (used > peakReservationBytes) {
			peakReservationBytes = used;
			peakReservationFrame = profileFrame;
			peakReservationCycles = runtime.machine.scheduler.nowCycles;
		}
	};
	runtime.boot();
	let peakTracked = cpu.luaHeap.usedBytes(), peakActiveFrames = cpu.activeThread.frames.length;
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
		peakActiveFrames = Math.max(peakActiveFrames, cpu.activeThread.frames.length);
		peakActiveStackCapacity = Math.max(peakActiveStackCapacity, cpu.activeThread.stackRegisters.capacity());
		const newCart = firstCart < 0 && cpu.globalSlotCount > baselineGlobals;
		if (newCart) firstCart = frame;
		if (frame === 1 || frame === frameCount || newCart) {
			const state = cpu.captureRuntimeState();
			const objects = { tables: 0, closures: 0, upvalues: 0, threads: 0 };
			let arraySlots = 0, hashSlots = 0, canonicalClosures = 0, closureUpvalueSlots = 0;
			for (let id = 0; id < state.snapshot.objectCount; id += 1) {
				const offset = state.snapshot.objectWord(id);
				switch (state.snapshot.word(offset)) {
					case CpuSnapshotObjectKind.Table:
						objects.tables += 1;
						arraySlots += state.snapshot.word(offset + CpuSnapshotTable.ArrayCapacity);
						hashSlots += state.snapshot.word(offset + CpuSnapshotTable.HashSize);
						break;
					case CpuSnapshotObjectKind.Closure:
						objects.closures += 1;
						canonicalClosures += state.snapshot.word(offset + CpuSnapshotClosure.Canonical);
						closureUpvalueSlots += state.snapshot.word(offset + CpuSnapshotClosure.UpvalueCount);
						break;
					case CpuSnapshotObjectKind.Upvalue: objects.upvalues += 1; break;
					case CpuSnapshotObjectKind.Thread: objects.threads += 1; break;
				}
			}
			const interned = cpu.stringPool.captureState().entries;
			let trackedStrings = 0, trackedStringBytes = 0, allInternedStringBytes = 0;
			const encoder = new TextEncoder();
			for (const entry of interned) {
				const bytes = encoder.encode(entry.value).length;
				allInternedStringBytes += bytes;
				if (entry.tracked) { trackedStrings += 1; trackedStringBytes += bytes; }
			}
			snapshots.push({ frame, systemCycles: runtime.machine.scheduler.nowCycles,
				trackedHeapBytes: state.luaHeap.trackedBytes,
				ordinaryGlobals: state.globalSlots.length, systemGlobals: state.systemGlobals.length,
				lastExecutionDomainId: state.lastExecutionDomainId, activeExecutionDomainId: state.executionCartridgeSlot,
				executionResidencyMask: state.executionResidencyMask, hardHalted: state.hardHalted,
				threads: state.threads.length, totalFrames: state.threads.reduce((n, t) => n + t.frames.length, 0),
				totalReservedStackSlots: state.threads.reduce((n, t) => n + t.stackCapacity, 0),
				protectedCalls: state.threads.reduce((n, t) => n + t.protectedCalls.length, 0),
				objects, arraySlots, hashSlots, canonicalClosures, closureUpvalueSlots,
				internedStrings: interned.length, allInternedStringBytes, trackedStrings, trackedStringBytes });
		}
	}
	process.stdout.write(JSON.stringify({
		scope: 'Real TS runtime, bounded headless run with no controller input. Logical tracked bytes are observed after successful reserve calls and at frame boundaries; selected snapshots are taken at frame boundaries. restoreAllocate, adjustForRestore, other accounting updates and peaks during collection are not individually observed. These are not physical hardware bytes or full-game maxima.',
		bios: { path: biosPath, sha256: createHash('sha256').update(bios).digest('hex') },
		cartridge: { path: cartridgePath, sha256: createHash('sha256').update(cartridge).digest('hex') },
		frames: frameCount, firstFrameWithAdditionalOrdinaryGlobals: firstCart,
		successfulReservations, peakSuccessfulReservationTrackedBytes: peakReservationBytes,
		peakSuccessfulReservationFrame: peakReservationFrame, peakSuccessfulReservationCycles: peakReservationCycles,
		peakSampledTrackedHeapBytes: peakTracked, peakSampledActiveFrames: peakActiveFrames,
		peakSampledActiveStackCapacity: peakActiveStackCapacity, snapshots,
	}, null, 2) + '\n');
}
main();
