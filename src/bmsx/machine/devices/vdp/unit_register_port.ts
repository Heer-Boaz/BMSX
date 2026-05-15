import type { DeviceStatusLatch } from '../device_status';
import {
	VDP_FAULT_MDU_BAD_JOINT_RANGE,
	VDP_FAULT_MDU_BAD_MORPH_RANGE,
	VDP_FAULT_STREAM_BAD_PACKET,
} from './contracts';
import { VDP_JTU_PACKET_KIND, type VdpJtuUnit } from './jtu';
import { VDP_LPU_PACKET_KIND, VDP_LPU_REGISTER_WORDS, type VdpLpuUnit } from './lpu';
import { VDP_MFU_PACKET_KIND, type VdpMfuUnit } from './mfu';
import { VDP_XF_PACKET_KIND, VDP_XF_REGISTER_WORDS, type VdpXfUnit } from './xf';

export class VdpUnitRegisterPort {
	public constructor(
		private readonly fault: DeviceStatusLatch,
		private readonly xf: VdpXfUnit,
		private readonly lpu: VdpLpuUnit,
		private readonly mfu: VdpMfuUnit,
		private readonly jtu: VdpJtuUnit,
	) {}

	public acceptRange(packetKind: number, firstRegister: number, registerCount: number): boolean {
		switch (packetKind) {
			case VDP_XF_PACKET_KIND:
				if (firstRegister >= VDP_XF_REGISTER_WORDS || registerCount > VDP_XF_REGISTER_WORDS - firstRegister) {
					this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, firstRegister);
					return false;
				}
				return true;
			case VDP_LPU_PACKET_KIND:
				if (firstRegister >= VDP_LPU_REGISTER_WORDS || registerCount > VDP_LPU_REGISTER_WORDS - firstRegister) {
					this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, firstRegister);
					return false;
				}
				return true;
			case VDP_MFU_PACKET_KIND:
				if (firstRegister >= this.mfu.weightWords.length || registerCount > this.mfu.weightWords.length - firstRegister) {
					this.fault.raise(VDP_FAULT_MDU_BAD_MORPH_RANGE, firstRegister);
					return false;
				}
				return true;
			case VDP_JTU_PACKET_KIND:
				if (firstRegister >= this.jtu.matrixWords.length || registerCount > this.jtu.matrixWords.length - firstRegister) {
					this.fault.raise(VDP_FAULT_MDU_BAD_JOINT_RANGE, firstRegister);
					return false;
				}
				return true;
		}
		this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, packetKind);
		return false;
	}

	public writeWord(packetKind: number, registerIndex: number, value: number): boolean {
		switch (packetKind) {
			case VDP_XF_PACKET_KIND:
				if (!this.xf.writeRegister(registerIndex, value)) {
					this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, value);
					return false;
				}
				return true;
			case VDP_LPU_PACKET_KIND:
				this.lpu.registerWords[registerIndex] = value >>> 0;
				return true;
			case VDP_MFU_PACKET_KIND:
				this.mfu.weightWords[registerIndex] = value >>> 0;
				return true;
			case VDP_JTU_PACKET_KIND:
				this.jtu.matrixWords[registerIndex] = value >>> 0;
				return true;
		}
		this.fault.raise(VDP_FAULT_STREAM_BAD_PACKET, packetKind);
		return false;
	}
}
