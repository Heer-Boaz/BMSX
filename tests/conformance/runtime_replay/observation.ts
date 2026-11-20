import type { Runtime } from '../../../machine/ts/machine/runtime/runtime';
import { IO_APU_ACTIVE_MASK, IO_APU_SAMPLE_SEQUENCE, IO_INP_PADS, IO_INP_STATUS } from '../../../machine/ts/spec/bmsx/io';
import { GX_GPU_PCRTC_BGCOLOR_LOW, gxGpuPcrtcRegisterAddress } from '../../../machine/ts/spec/gx/pcrtc';

// Replay parity is a small machine-bus observation, not a second state codec.
export function observeReplay(runtime: Runtime) {
	const { scheduler, cpu, memory } = runtime.machine;
	return {
		cycles: scheduler.currentNowCycles(),
		tick: runtime.frameScheduler.lastTickSequence,
		domain: cpu.activeCartridgeSlot(),
		background: memory.readIoU32(gxGpuPcrtcRegisterAddress(GX_GPU_PCRTC_BGCOLOR_LOW)),
		inputSequence: memory.readIoU32(IO_INP_STATUS),
		buttons: memory.readIoU32(IO_INP_PADS),
		sampleSequence: memory.readIoU32(IO_APU_SAMPLE_SEQUENCE),
		voices: memory.readIoU32(IO_APU_ACTIVE_MASK),
	};
}
