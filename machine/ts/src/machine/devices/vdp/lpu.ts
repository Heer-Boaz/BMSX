export const VDP_LPU_PACKET_KIND = 0x17000000;

export const VDP_LPU_CONTROL_ENABLE = 1;

// LPU register layout (all words stored as IEEE 754 float bits):
// Ambient block (4 words):  r, g, b, intensity
// Dir light N  (8 words):   dir.x, dir.y, dir.z, pad,  color.r, color.g, color.b, intensity
// Point light N (8 words):  pos.x, pos.y, pos.z, range, color.r, color.g, color.b, intensity
export const VDP_LPU_AMBIENT_REGISTER_BASE = 0;
export const VDP_LPU_AMBIENT_REGISTER_WORDS = 4;
export const VDP_LPU_DIRECTIONAL_LIGHT_LIMIT = 4;
export const VDP_LPU_DIRECTIONAL_REGISTER_BASE = VDP_LPU_AMBIENT_REGISTER_BASE + VDP_LPU_AMBIENT_REGISTER_WORDS;
export const VDP_LPU_DIRECTIONAL_REGISTER_WORDS = 8;
export const VDP_LPU_POINT_LIGHT_LIMIT = 4;
export const VDP_LPU_POINT_REGISTER_BASE = VDP_LPU_DIRECTIONAL_REGISTER_BASE + VDP_LPU_DIRECTIONAL_LIGHT_LIMIT * VDP_LPU_DIRECTIONAL_REGISTER_WORDS;
export const VDP_LPU_POINT_REGISTER_WORDS = 8;
export const VDP_LPU_REGISTER_WORDS = VDP_LPU_POINT_REGISTER_BASE + VDP_LPU_POINT_LIGHT_LIMIT * VDP_LPU_POINT_REGISTER_WORDS;


export class VdpLpuUnit {
	public readonly registerWords = new Uint32Array(VDP_LPU_REGISTER_WORDS);

	public reset(): void {
		const words = this.registerWords;
		for (let index = 0; index < words.length; index += 1) {
			words[index] = 0;
		}
	}
}
