import { VDP_JTU_PACKET_KIND, type VdpJtuUnit } from './jtu';
import { VDP_LPU_PACKET_KIND, type VdpLpuUnit } from './lpu';
import { VDP_MFU_PACKET_KIND, type VdpMfuUnit } from './mfu';
import { VDP_XF_PACKET_KIND, type VdpXfUnit } from './xf';

export class VdpUnitRegisterPort {
	public constructor(
		private readonly xf: VdpXfUnit,
		private readonly lpu: VdpLpuUnit,
		private readonly mfu: VdpMfuUnit,
		private readonly jtu: VdpJtuUnit,
	) {}

	public writeWord(packetKind: number, registerIndex: number, value: number): void {
		switch (packetKind) {
			case VDP_XF_PACKET_KIND:
				this.xf.writeRegister(registerIndex, value);
				return;
			case VDP_LPU_PACKET_KIND:
				this.lpu.registerWords[registerIndex] = value >>> 0;
				return;
			case VDP_MFU_PACKET_KIND:
				this.mfu.weightWords[registerIndex] = value >>> 0;
				return;
			case VDP_JTU_PACKET_KIND:
				this.jtu.matrixWords[registerIndex] = value >>> 0;
				return;
		}
	}
}
