import {
	GX_GPU_DISPLAY_MODE_50HZ_BIT,
	GX_GPU_GP1_ACK_INTERRUPT,
	GX_GPU_GP1_DISPLAY_DISABLE,
	GX_GPU_GP1_DISPLAY_DISABLED,
	GX_GPU_GP1_DISPLAY_ENABLED,
	GX_GPU_GP1_DISPLAY_START,
	GX_GPU_GP1_DMA_DIRECTION,
	GX_GPU_GP1_RESET,
	GX_GPU_GP1_VERTICAL_DISPLAY_RANGE,
	GX_GPU_GP1_VRAM_Y_ADDRESS_EXTENSION,
	GX_GPU_GP1_VRAM_Y_ADDRESS_EXTENSION_ENABLED,
	GX_GPU_VERTICAL_DISPLAY_RANGE_END_SHIFT,
	GX_GPU_VERTICAL_DISPLAY_RANGE_START_MASK,
	gxGpuGp1CommandWord,
} from '../../../machine/ts/spec/gx/gp1';
import { GX_GPU_DMA_DIRECTION_CPU_TO_GP0 } from '../../../machine/ts/spec/gx/gp0';
import {
	GX_GPU_PCRTC_PMODE_EN1,
	GX_GPU_PCRTC_PMODE_EN2,
} from '../../../machine/ts/spec/gx/pcrtc';

export const GX_REGISTER_MODULE_SOURCE = [
	'module<const>',
	'',
	'return {',
	`\tgp1_reset_command = ${gxGpuGp1CommandWord(GX_GPU_GP1_RESET, 0)},`,
	`\tgp1_ack_interrupt_command = ${gxGpuGp1CommandWord(GX_GPU_GP1_ACK_INTERRUPT, 0)},`,
	`\tgp1_display_enable_command = ${gxGpuGp1CommandWord(GX_GPU_GP1_DISPLAY_DISABLE, GX_GPU_GP1_DISPLAY_ENABLED)},`,
	`\tgp1_display_disable_command = ${gxGpuGp1CommandWord(GX_GPU_GP1_DISPLAY_DISABLE, GX_GPU_GP1_DISPLAY_DISABLED)},`,
	`\tgp1_display_mode_50hz_bit = ${GX_GPU_DISPLAY_MODE_50HZ_BIT},`,
	`\tgp1_dma_cpu_to_gp0_command = ${gxGpuGp1CommandWord(GX_GPU_GP1_DMA_DIRECTION, GX_GPU_DMA_DIRECTION_CPU_TO_GP0)},`,
	`\tgp1_display_start_command = ${gxGpuGp1CommandWord(GX_GPU_GP1_DISPLAY_START, 0)},`,
	`\tgp1_vertical_display_range_command = ${gxGpuGp1CommandWord(GX_GPU_GP1_VERTICAL_DISPLAY_RANGE, 0)},`,
	`\tgp1_vertical_display_range_start_mask = ${GX_GPU_VERTICAL_DISPLAY_RANGE_START_MASK},`,
	`\tgp1_vertical_display_range_end_shift = ${GX_GPU_VERTICAL_DISPLAY_RANGE_END_SHIFT},`,
	`\tgp1_vram_y_address_extension_command = ${gxGpuGp1CommandWord(GX_GPU_GP1_VRAM_Y_ADDRESS_EXTENSION, GX_GPU_GP1_VRAM_Y_ADDRESS_EXTENSION_ENABLED)},`,
	`\tpcrtc_pmode_circuit1_enable_word = ${GX_GPU_PCRTC_PMODE_EN1},`,
	`\tpcrtc_pmode_circuit2_enable_word = ${GX_GPU_PCRTC_PMODE_EN2},`,
	'}',
	'',
].join('\n');
