import { IO_SYS_BOOT_CART } from '../bus/io';
import * as luaPipeline from '../../ide/runtime/lua_pipeline';
import { Runtime } from './runtime';

export class CartBootState {
	public pending = false;

	constructor(private readonly runtime: Runtime) {
	}

	public reset(): void {
		this.pending = false;
	}

	public processPending(): void {
		const runtime = this.runtime;
		this.pollSystemBootRequest();
		if (!this.pending) {
			return;
		}
		if (!runtime.luaGate.ready) {
			return;
		}
		const frameLoop = runtime.frameLoop;
		const hasPendingCall = runtime.pendingCall !== null;
		if (frameLoop.currentFrameState !== null || hasPendingCall) {
			luaPipeline.resetFrameState(runtime);
		}
		if (hasPendingCall) {
			runtime.pendingCall = null;
			runtime.cpuExecution.clearHaltUntilIrq();
		}
		runtime.frameScheduler.clearQueuedTime();
		this.pending = false;
		if (!luaPipeline.startCartProgram(runtime)) {
			throw new Error('cannot start cart: no cart entry point is installed.');
		}
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
