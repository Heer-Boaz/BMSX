import { IO_SYS_BOOT_CART } from '../bus/io';
import { Runtime } from './runtime';

export class CartBootState {
	private pending = false;

	constructor(private readonly runtime: Runtime) {
	}

	public reset(): void {
		this.pending = false;
	}

	public processPending(): boolean {
		const runtime = this.runtime;
		this.pollSystemBootRequest();
		if (!this.pending) {
			return false;
		}
		if (!runtime.luaGate.ready) {
			return false;
		}
		const frameLoop = runtime.frameLoop;
		const hasPendingCall = runtime.pendingCall !== null;
		if (frameLoop.frameActive || hasPendingCall) {
			frameLoop.resetFrameState();
		}
		if (hasPendingCall) {
			runtime.pendingCall = null;
		}
		runtime.frameScheduler.clearQueuedTime();
		this.pending = false;
		runtime.startCartProgram();
		return true;
	}

	private request(): void {
		this.pending = true;
	}

	private pollSystemBootRequest(): void {
		const runtime = this.runtime;
		if (runtime.cartProgramStarted) {
			return;
		}
		if (runtime.machine.memory.readIoU32(IO_SYS_BOOT_CART) === 0) {
			return;
		}
		runtime.machine.memory.writeValue(IO_SYS_BOOT_CART, 0);
		runtime.frameScheduler.clearQueuedTime();
		this.request();
	}
}
