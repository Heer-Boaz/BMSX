import type { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { captureRuntimeSaveState, applyRuntimeSaveState } from '../../../machine/ts/machine/runtime/save_state';
import type { WebGPUBackend } from '../../../machine/ts/render/backend/webgpu/backend';
import { GX_GPU_GP0_VRAM_TO_CPU_FIRST } from '../../../machine/ts/spec/gx/gp0';
import { GX_GPU_GP1_CLEAR_FIFO } from '../../../machine/ts/spec/gx/gp1';

function require(condition: boolean, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

/** Real WebGPU mapAsync jobs, with controlled callback completion (not a fake renderer). */
export async function testWebGpuReadbackLifetime(runtime: Runtime, backend: WebGPUBackend): Promise<void> {
	const gpu = runtime.machine.gxGpu;
	await backend.captureGxGpuVramSnapshot(gpu);
	const saved = captureRuntimeSaveState(runtime);
	const serial = gpu.readVramSnapshotSerial();
	const gx = backend.gxGpuState;
	const complete = gx.gpureadCompletionCallback;
	let releaseFirst!: () => void;
	let releaseSecond!: () => void;
	let secondMapped!: () => void;
	const firstGate = new Promise<void>(resolve => { releaseFirst = resolve; });
	const secondGate = new Promise<void>(resolve => { releaseSecond = resolve; });
	const secondMapping = new Promise<void>(resolve => { secondMapped = resolve; });
	let completions = 0;
	gx.gpureadCompletionCallback = async () => {
		completions += 1;
		if (completions === 1) await firstGate;
		else { secondMapped(); await secondGate; }
		complete();
	};
	// GP1 FIFO reset cancels the first emulated request while its host mapping
	// is still pending. The second request must use the deferred readback path.
	for (let request = 0; request < 2; request += 1) {
		if (request === 1) gpu.writeGp1(GX_GPU_GP1_CLEAR_FIFO << 24);
		gpu.writeGp0(GX_GPU_GP0_VRAM_TO_CPU_FIRST << 24);
		gpu.writeGp0(0);
		gpu.writeGp0((1 << 16) | 1);
		runtime.machine.scheduler.advanceTo(runtime.machine.scheduler.currentNowCycles() + 1024);
		gpu.onService(runtime.machine.scheduler.currentNowCycles());
		require(gpu.backendServicePending(), 'guest GPUREAD must reach its backend fence');
		backend.executeGxGpuReadback(gpu);
	}
	require(gx.gpureadDeferredGpu === gpu, 'second actual GPUREAD is deferred behind the mapped buffer');
	let finished = false;
	const finishing = backend.finishGxGpuReadbacks().then(() => { finished = true; });
	releaseFirst();
	await secondMapping;
	await Promise.resolve();
	require(!finished, 'finishing only the first mapping must not release the replacement boundary');
	releaseSecond();
	await finishing;
	require(completions === 2 && gx.gpureadCompletion === null && gx.gpureadDeferredGpu === null, 'every old callback must have completed');
	require(gpu.readVramSnapshotSerial() === serial, 'callback synchronization neither downloads nor republishes VRAM');
	gx.gpureadCompletionCallback = complete;
	applyRuntimeSaveState(runtime, saved);
	await backend.device.queue.onSubmittedWorkDone();
	await backend.captureGxGpuVramSnapshot(gpu);
	require(gpu.readVramSnapshotBytes().every((byte, index) => byte === saved.machineState.machine.gxGpu.vramBytes[index]), 'old callbacks and old GPU work cannot overwrite the restored pixels');
}
