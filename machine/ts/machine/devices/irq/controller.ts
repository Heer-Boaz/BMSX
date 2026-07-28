import { IO_IRQ_ACK, IO_IRQ_FLAGS, IO_IRQ_MASK } from '../../../spec/bmsx/io';
import type { Value } from '../../cpu/value';
import { Memory } from '../../memory/memory';
import type { IrqControllerState } from './save_state';

export class IrqController {
	private pendingFlags = 0;
	private mask = 0;
	private userPendingFlags = 0;
	private userMask = 0;
	private supervisorContextActive = false;

	public constructor(private readonly memory: Memory) {
		this.memory.mapIoRead(IO_IRQ_FLAGS, this, IrqController.onFlagsReadThunk);
		this.memory.mapIoWrite(IO_IRQ_ACK, this, IrqController.onAckWriteThunk);
		this.memory.mapIoRead(IO_IRQ_MASK, this, IrqController.onMaskReadThunk);
		this.memory.mapIoWrite(IO_IRQ_MASK, this, IrqController.onMaskWriteThunk);
	}

	public reset(): void {
		this.pendingFlags = 0;
		this.mask = 0;
		this.userPendingFlags = 0;
		this.userMask = 0;
		this.supervisorContextActive = false;
		this.memory.writeIoValue(IO_IRQ_ACK, 0);
		this.memory.writeIoValue(IO_IRQ_MASK, 0);
	}

	public postLoad(): void {
		const clearAck = 0;
		this.memory.writeIoValue(IO_IRQ_ACK, clearAck);
		this.memory.writeIoValue(IO_IRQ_MASK, this.mask);
	}

	public captureState(): IrqControllerState {
		return {
			mask: this.mask,
			pendingFlags: this.pendingFlags,
			userMask: this.userMask,
			userPendingFlags: this.userPendingFlags,
			supervisorContextActive: this.supervisorContextActive,
		};
	}

	public restoreState(state: IrqControllerState): void {
		this.mask = state.mask >>> 0;
		this.pendingFlags = state.pendingFlags >>> 0;
		this.userMask = state.userMask >>> 0;
		this.userPendingFlags = state.userPendingFlags >>> 0;
		this.supervisorContextActive = state.supervisorContextActive;
		this.postLoad();
	}

	public enterSupervisorContext(): void {
		this.userPendingFlags = this.pendingFlags;
		this.userMask = this.mask;
		this.supervisorContextActive = true;
		this.pendingFlags = 0;
		this.mask = 0;
		this.postLoad();
	}

	public enterSupervisorFaultContext(): void {
		this.userPendingFlags = 0;
		this.userMask = 0;
		this.supervisorContextActive = true;
		this.pendingFlags = 0;
		this.mask = 0;
		this.postLoad();
	}

	public leaveSupervisorContext(): void {
		this.pendingFlags = this.userPendingFlags;
		this.mask = this.userMask;
		this.userPendingFlags = 0;
		this.userMask = 0;
		this.supervisorContextActive = false;
		this.postLoad();
	}

	public hasAssertedMaskableInterruptLine(): boolean {
		return (this.pendingFlags & this.mask) !== 0;
	}

	public raise(mask: number): void {
		const next = (this.pendingFlags | (mask >>> 0)) >>> 0;
		if (next !== this.pendingFlags) {
			this.pendingFlags = next;
		}
	}

	public raiseUser(mask: number): void {
		if (!this.supervisorContextActive) {
			this.raise(mask);
			return;
		}
		this.userPendingFlags = (this.userPendingFlags | (mask >>> 0)) >>> 0;
	}

	public acknowledge(mask: number): void {
		const ack = mask >>> 0;
		if (ack !== 0) {
			const next = (this.pendingFlags & ~ack) >>> 0;
			if (next !== this.pendingFlags) {
				this.pendingFlags = next;
			}
		}
		this.memory.writeIoValue(IO_IRQ_ACK, 0);
	}

	private static onFlagsReadThunk(context: IrqController, addr: number): Value {
		void addr;
		return context.pendingFlags;
	}

	private static onAckWriteThunk(context: IrqController, addr: number, value: Value): void {
		void addr;
		const ack = (value as number) >>> 0;
		if (ack !== 0) {
			const next = (context.pendingFlags & ~ack) >>> 0;
			if (next !== context.pendingFlags) {
				context.pendingFlags = next;
			}
		}
		context.memory.writeIoValue(IO_IRQ_ACK, 0);
	}

	private static onMaskReadThunk(context: IrqController, addr: number): Value {
		void addr;
		return context.mask;
	}

	private static onMaskWriteThunk(context: IrqController, addr: number, value: Value): void {
		void addr;
		context.mask = (value as number) >>> 0;
	}
}
