import type { Memory } from '../memory/memory';

export type DeviceStatusRegisters = {
	statusAddr: number;
	codeAddr: number;
	detailAddr: number;
	ackAddr: number;
	faultMask: number;
	noneCode: number;
};

export class DeviceStatusLatch {
	public status = 0;
	public code: number;
	public detail = 0;

	public constructor(
		private readonly memory: Memory,
		private readonly registers: DeviceStatusRegisters,
	) {
		this.code = registers.noneCode;
		this.detail = 0;
	}

	public resetStatus(): void {
		this.status = 0;
		this.code = this.registers.noneCode;
		this.detail = 0;
		this.writeRegisterState();
	}

	public restore(status: number, code: number, detail: number): void {
		this.status = status >>> 0;
		this.code = code >>> 0;
		this.detail = detail >>> 0;
		this.writeRegisterState();
	}

	private writeRegisterState(): void {
		this.memory.writeIoValue(this.registers.statusAddr, this.status);
		this.memory.writeIoValue(this.registers.codeAddr, this.code);
		this.memory.writeIoValue(this.registers.detailAddr, this.detail);
		this.memory.writeIoValue(this.registers.ackAddr, 0);
	}

	public clear(): void {
		this.code = this.registers.noneCode;
		this.detail = 0;
		this.memory.writeIoValue(this.registers.codeAddr, this.code);
		this.memory.writeIoValue(this.registers.detailAddr, this.detail);
		this.setStatusFlag(this.registers.faultMask, false);
	}

	public acknowledge(): void {
		if (this.memory.readIoU32(this.registers.ackAddr) === 0) {
			return;
		}
		this.clear();
		this.memory.writeIoValue(this.registers.ackAddr, 0);
	}

	public setStatusFlag(mask: number, active: boolean): void {
		const nextStatus = active ? (this.status | mask) : (this.status & ~mask);
		if (nextStatus === this.status) {
			return;
		}
		this.status = nextStatus >>> 0;
		this.memory.writeIoValue(this.registers.statusAddr, this.status);
	}

	public raise(code: number, detail: number): void {
		if ((this.status & this.registers.faultMask) !== 0) {
			return;
		}
		this.code = code >>> 0;
		this.detail = detail >>> 0;
		this.memory.writeIoValue(this.registers.codeAddr, this.code);
		this.memory.writeIoValue(this.registers.detailAddr, this.detail);
		this.setStatusFlag(this.registers.faultMask, true);
	}
}
