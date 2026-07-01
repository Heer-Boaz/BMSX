import { type StackTraceFrame } from '../../lua/value';
import {
	BuiltinFunctionId,
	createBuiltinFunction,
	isNativeFunction,
	isNativeObject,
	Table,
	type Value,
} from '../cpu/cpu';
import { formatNumber } from '../common/number_format';
import {
	CART_ROM_BASE,
	CART_ROM_MAGIC_ADDR,
	CART_ROM_SIZE,
	GEO_SCRATCH_BASE,
	GEO_SCRATCH_SIZE,
	OVERLAY_ROM_BASE,
	RAM_SIZE,
	SYSTEM_ROM_BASE,
	VDP_STREAM_BUFFER_BASE,
	VDP_STREAM_CAPACITY_WORDS,
	VRAM_PRIMARY_SLOT_BASE,
	VRAM_PRIMARY_SLOT_SIZE,
	VRAM_SECONDARY_SLOT_BASE,
	VRAM_SECONDARY_SLOT_SIZE,
	VRAM_STAGING_BASE,
	VRAM_STAGING_SIZE,
	VRAM_SYSTEM_SLOT_BASE,
	VRAM_SYSTEM_SLOT_SIZE,
} from '../memory/map';
import { CART_ROM_MAGIC, type CartManifest, type MachineManifest } from '../../rompack/format';
import { MACHINE_REGION_NTSC_WORD, MACHINE_REGION_PAL_WORD, VDP_MODE_MSX1_WORD, VDP_MODE_MSX2_WORD, VDP_MODE_PSX_WORD } from '../model_registry';
import {
	GEO_CTRL_ABORT,
	GEO_FAULT_ABORTED_BY_HOST,
	GEO_FAULT_BAD_RECORD_ALIGNMENT,
	GEO_FAULT_BAD_RECORD_FLAGS,
	GEO_FAULT_BAD_VERTEX_COUNT,
	GEO_FAULT_CODE_MASK,
	GEO_FAULT_CODE_SHIFT,
	GEO_FAULT_DESCRIPTOR_KIND,
	GEO_FAULT_DST_RANGE,
	GEO_FAULT_NUMERIC_OVERFLOW_INTERNAL,
	GEO_FAULT_RECORD_INDEX_MASK,
	GEO_FAULT_RECORD_INDEX_NONE,
	GEO_FAULT_RESULT_CAPACITY,
	GEO_FAULT_REJECT_BAD_CMD,
	GEO_FAULT_REJECT_BAD_REGISTER_COMBO,
	GEO_FAULT_REJECT_BAD_STRIDE,
	GEO_FAULT_REJECT_DST_NOT_RAM,
	GEO_FAULT_REJECT_MISALIGNED_REGS,
	GEO_FAULT_REJECT_BUSY,
	GEO_FAULT_SRC_RANGE,
	GEO_INDEX_NONE,
	GEO_OVERLAP2D_BROADPHASE_LOCAL_BOUNDS_AABB,
	GEO_OVERLAP2D_BROADPHASE_NONE,
	GEO_OVERLAP2D_CONTACT_POLICY_CLIPPED_FEATURE,
	GEO_OVERLAP2D_MAX_CLIP_VERTICES,
	GEO_OVERLAP2D_MAX_POLY_VERTICES,
	GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS,
	GEO_OVERLAP2D_MODE_FULL_PASS,
	GEO_OVERLAP2D_OUTPUT_POLICY_STOP_ON_OVERFLOW,
	GEO_OVERLAP2D_AABB_DATA_COUNT,
	GEO_OVERLAP2D_AABB_SHAPE_BYTES,
	GEO_OVERLAP2D_INSTANCE_BYTES,
	GEO_OVERLAP2D_INSTANCE_LAYER_OFFSET,
	GEO_OVERLAP2D_INSTANCE_MASK_OFFSET,
	GEO_OVERLAP2D_INSTANCE_SHAPE_OFFSET,
	GEO_OVERLAP2D_INSTANCE_TX_OFFSET,
	GEO_OVERLAP2D_INSTANCE_TY_OFFSET,
	GEO_OVERLAP2D_PAIR_BYTES,
	GEO_OVERLAP2D_PAIR_INSTANCE_A_OFFSET,
	GEO_OVERLAP2D_PAIR_INSTANCE_B_OFFSET,
	GEO_OVERLAP2D_PAIR_META_OFFSET,
	GEO_OVERLAP2D_RESULT_BYTES,
	GEO_OVERLAP2D_RESULT_DEPTH_OFFSET,
	GEO_OVERLAP2D_RESULT_FEATURE_META_OFFSET,
	GEO_OVERLAP2D_RESULT_NX_OFFSET,
	GEO_OVERLAP2D_RESULT_NY_OFFSET,
	GEO_OVERLAP2D_RESULT_PAIR_META_OFFSET,
	GEO_OVERLAP2D_RESULT_PIECE_A_OFFSET,
	GEO_OVERLAP2D_RESULT_PIECE_B_OFFSET,
	GEO_OVERLAP2D_RESULT_PX_OFFSET,
	GEO_OVERLAP2D_RESULT_PY_OFFSET,
	GEO_OVERLAP2D_SHAPE_BOUNDS_BYTES,
	GEO_OVERLAP2D_SHAPE_BOUNDS_BOTTOM_OFFSET,
	GEO_OVERLAP2D_SHAPE_BOUNDS_LEFT_OFFSET,
	GEO_OVERLAP2D_SHAPE_BOUNDS_RIGHT_OFFSET,
	GEO_OVERLAP2D_SHAPE_BOUNDS_TOP_OFFSET,
	GEO_OVERLAP2D_SHAPE_BOUNDS_OFFSET_OFFSET,
	GEO_OVERLAP2D_SHAPE_DATA_COUNT_OFFSET,
	GEO_OVERLAP2D_SHAPE_DATA_OFFSET_OFFSET,
	GEO_OVERLAP2D_SHAPE_DESC_BYTES,
	GEO_OVERLAP2D_SHAPE_KIND_OFFSET,
	GEO_OVERLAP2D_SHAPE_KIND_COMPOUND,
	GEO_OVERLAP2D_SUMMARY_BROADPHASE_PAIR_COUNT_OFFSET,
	GEO_OVERLAP2D_SUMMARY_BYTES,
	GEO_OVERLAP2D_SUMMARY_EXACT_PAIR_COUNT_OFFSET,
	GEO_OVERLAP2D_SUMMARY_FLAGS_OFFSET,
	GEO_OVERLAP2D_SUMMARY_FLAG_OVERFLOW,
	GEO_OVERLAP2D_SUMMARY_RESULT_COUNT_OFFSET,
	GEO_OVERLAP2D_PAIR_META_INSTANCE_A_MASK,
	GEO_OVERLAP2D_PAIR_META_INSTANCE_A_SHIFT,
	GEO_OVERLAP2D_PAIR_META_INSTANCE_B_MASK,
	GEO_PRIMITIVE_AABB,
	GEO_PRIMITIVE_CONVEX_POLY,
	GEO_SAT_META_AXIS_MASK,
	GEO_SAT_META_SHAPE_AUX,
	GEO_SAT_META_SHAPE_SHIFT,
	GEO_SAT_META_SHAPE_SRC,
	GEO_SHAPE_CONVEX_POLY,
	GEO_VERTEX2_BYTES,
	GEO_VERTEX2_X_OFFSET,
	GEO_VERTEX2_Y_OFFSET,
	GEO_XFORM2_RECORD_BYTES,
	GEO_XFORM2_RECORD_FLAGS_OFFSET,
	GEO_XFORM2_RECORD_SRC_INDEX_OFFSET,
	GEO_XFORM2_RECORD_DST_INDEX_OFFSET,
	GEO_XFORM2_RECORD_AUX_INDEX_OFFSET,
	GEO_XFORM2_RECORD_VERTEX_COUNT_OFFSET,
	GEO_XFORM2_RECORD_DST1_INDEX_OFFSET,
	GEO_XFORM2_MATRIX_BYTES,
	GEO_XFORM2_MATRIX_M00_OFFSET,
	GEO_XFORM2_MATRIX_M01_OFFSET,
	GEO_XFORM2_MATRIX_TX_OFFSET,
	GEO_XFORM2_MATRIX_M10_OFFSET,
	GEO_XFORM2_MATRIX_M11_OFFSET,
	GEO_XFORM2_MATRIX_TY_OFFSET,
	GEO_XFORM2_AABB_BYTES,
	GEO_XFORM2_AABB_MIN_X_OFFSET,
	GEO_XFORM2_AABB_MIN_Y_OFFSET,
	GEO_XFORM2_AABB_MAX_X_OFFSET,
	GEO_XFORM2_AABB_MAX_Y_OFFSET,
	GEO_XFORM2_MAX_VERTICES,
	GEO_SAT2_PAIR_BYTES,
	GEO_SAT2_PAIR_FLAGS_OFFSET,
	GEO_SAT2_PAIR_SHAPE_A_INDEX_OFFSET,
	GEO_SAT2_PAIR_RESULT_INDEX_OFFSET,
	GEO_SAT2_PAIR_SHAPE_B_INDEX_OFFSET,
	GEO_SAT2_PAIR_FLAGS2_OFFSET,
	GEO_SAT2_DESC_BYTES,
	GEO_SAT2_DESC_FLAGS_OFFSET,
	GEO_SAT2_DESC_VERTEX_COUNT_OFFSET,
	GEO_SAT2_DESC_VERTEX_OFFSET_OFFSET,
	GEO_SAT2_DESC_RESERVED_OFFSET,
	GEO_SAT2_RESULT_BYTES,
	GEO_SAT2_RESULT_HIT_OFFSET,
	GEO_SAT2_RESULT_NX_OFFSET,
	GEO_SAT2_RESULT_NY_OFFSET,
	GEO_SAT2_RESULT_DEPTH_OFFSET,
	GEO_SAT2_RESULT_META_OFFSET,
	GEO_SAT2_MAX_POLY_VERTICES,
	GEO_STATUS_BUSY,
	GEO_STATUS_DONE,
	GEO_STATUS_ERROR,
	GEO_STATUS_REJECTED,
	IO_CMD_GEO_OVERLAP2D_PASS,
	IO_CMD_GEO_SAT2_BATCH,
	IO_CMD_GEO_XFORM2_BATCH,
} from '../devices/geometry/contracts';
import {
	APU_COMMAND_FIFO_CAPACITY,
	APU_GENERATOR_NONE,
	APU_GENERATOR_SQUARE,
	APU_GAIN_Q12_ONE,
	APU_OUTPUT_QUEUE_CAPACITY_FRAMES,
	APU_RATE_STEP_Q16_ONE,
	APU_SAMPLE_RATE_HZ,
	APU_CMD_PLAY,
	APU_CMD_SET_SLOT_GAIN,
	APU_CMD_STOP_SLOT,
	APU_EVENT_NONE,
	APU_EVENT_SLOT_ENDED,
	APU_FAULT_BAD_CMD,
	APU_FAULT_BAD_SLOT,
	APU_FAULT_CMD_FIFO_FULL,
	APU_FAULT_NONE,
	APU_FAULT_SOURCE_BIT_DEPTH,
	APU_FAULT_SOURCE_BYTES,
	APU_FAULT_SOURCE_CHANNELS,
	APU_FAULT_SOURCE_DATA_RANGE,
	APU_FAULT_SOURCE_FRAME_COUNT,
	APU_FAULT_SOURCE_RANGE,
	APU_FAULT_SOURCE_SAMPLE_RATE,
	APU_FAULT_OUTPUT_BLOCK,
	APU_FAULT_OUTPUT_DATA_RANGE,
	APU_FAULT_OUTPUT_METADATA,
	APU_FAULT_OUTPUT_PLAYBACK_RATE,
	APU_FAULT_UNSUPPORTED_FORMAT,
	APU_FILTER_ALLPASS,
	APU_FILTER_BANDPASS,
	APU_FILTER_HIGHPASS,
	APU_FILTER_HIGHSHELF,
	APU_FILTER_LOWPASS,
	APU_FILTER_LOWSHELF,
	APU_FILTER_NONE,
	APU_FILTER_NOTCH,
	APU_FILTER_PEAKING,
	APU_STATUS_BUSY,
	APU_STATUS_CMD_FIFO_EMPTY,
	APU_STATUS_CMD_FIFO_FULL,
	APU_STATUS_FAULT,
	APU_STATUS_OUTPUT_EMPTY,
	APU_STATUS_OUTPUT_FULL,
	APU_STATUS_SELECTED_SLOT_ACTIVE,
} from '../devices/audio/contracts';
import {
	INP_OUTPUT_CTRL_APPLY,
	INP_POINTER_BUTTON_AUX,
	INP_POINTER_BUTTON_BACK,
	INP_POINTER_BUTTON_FORWARD,
	INP_POINTER_BUTTON_PRIMARY,
	INP_POINTER_BUTTON_SECONDARY,
	INPUT_CONTROLLER_GAMEPAD_BUTTON_BIT_IDS,
	INPUT_CONTROLLER_OUTPUT_INTENSITY_Q16_ONE,
} from '../devices/input/contracts';
import {
	DMA_CTRL_START,
	DMA_CTRL_STRICT,
	DMA_STATUS_BUSY,
	DMA_STATUS_CLIPPED,
	DMA_STATUS_DONE,
	DMA_STATUS_ERROR,
	DMA_STATUS_REJECTED,
	IMG_CTRL_START,
	IMG_STATUS_BUSY,
	IMG_STATUS_CLIPPED,
	IMG_STATUS_DONE,
	IMG_STATUS_ERROR,
	IMG_STATUS_REJECTED,
	INP_CTRL_ARM,
	INP_CTRL_RESET,
	IO_ARG_STRIDE,
	IO_APU_CMD,
	IO_APU_CMD_CAPACITY,
	IO_APU_CMD_FREE,
	IO_APU_CMD_QUEUED,
	IO_APU_EVENT_KIND,
	IO_APU_EVENT_SEQ,
	IO_APU_EVENT_SLOT,
	IO_APU_EVENT_SOURCE_ADDR,
	IO_APU_ACTIVE_MASK,
	IO_APU_FADE_SAMPLES,
	IO_APU_FAULT_ACK,
	IO_APU_FAULT_CODE,
	IO_APU_FAULT_DETAIL,
	IO_APU_FILTER_FREQ_HZ,
	IO_APU_FILTER_GAIN_MILLIDB,
	IO_APU_FILTER_KIND,
	IO_APU_FILTER_Q_MILLI,
	IO_APU_GAIN_Q12,
	IO_APU_GENERATOR_DUTY_Q12,
	IO_APU_GENERATOR_KIND,
	IO_APU_OUTPUT_CAPACITY_FRAMES,
	IO_APU_OUTPUT_FREE_FRAMES,
	IO_APU_OUTPUT_QUEUED_FRAMES,
	IO_APU_RATE_STEP_Q16,
	IO_APU_SELECTED_SOURCE_ADDR,
	IO_APU_SELECTED_SLOT_REG0,
	IO_APU_SELECTED_SLOT_REG_COUNT,
	IO_APU_SLOT,
	IO_APU_START_SAMPLE,
	IO_APU_STATUS,
	IO_APU_SOURCE_ADDR,
	IO_APU_SOURCE_BITS_PER_SAMPLE,
	IO_APU_SOURCE_BYTES,
	IO_APU_SOURCE_CHANNELS,
	IO_APU_SOURCE_DATA_BYTES,
	IO_APU_SOURCE_DATA_OFFSET,
	IO_APU_SOURCE_FRAME_COUNT,
	IO_APU_SOURCE_LOOP_END_SAMPLE,
	IO_APU_SOURCE_LOOP_START_SAMPLE,
	IO_APU_SOURCE_SAMPLE_RATE_HZ,
	IO_DMA_CTRL,
	IO_DMA_DST,
	IO_DMA_LEN,
	IO_DMA_SRC,
	IO_DMA_STATUS,
	IO_DMA_WRITTEN,
	IO_GEO_CMD,
	IO_GEO_COUNT,
	IO_GEO_CTRL,
	IO_GEO_DST0,
	IO_GEO_DST1,
	IO_GEO_FAULT,
	IO_GEO_FAULT_ACK,
	IO_GEO_PARAM0,
	IO_GEO_PARAM1,
	IO_GEO_PROCESSED,
	IO_GEO_SRC0,
	IO_GEO_SRC1,
	IO_GEO_SRC2,
	IO_GEO_STATUS,
	IO_GEO_STRIDE0,
	IO_GEO_STRIDE1,
	IO_GEO_STRIDE2,
	IO_IMG_CAP,
	IO_IMG_CTRL,
	IO_IMG_DST,
	IO_IMG_LEN,
	IO_IMG_SRC,
	IO_IMG_STATUS,
	IO_IMG_WRITTEN,
	IO_INP_CTRL,
	IO_INP_KEYS,
	IO_INP_OUTPUT_CTRL,
	IO_INP_OUTPUT_DURATION_MS,
	IO_INP_OUTPUT_INTENSITY_Q16,
	IO_INP_OUTPUT_PORT,
	IO_INP_OUTPUT_STATUS,
	IO_INP_PAD_BUTTONS_OFFSET,
	IO_INP_PAD_COUNT,
	IO_INP_PAD_LT_OFFSET,
	IO_INP_PAD_LX_OFFSET,
	IO_INP_PAD_LY_OFFSET,
	IO_INP_PAD_RT_OFFSET,
	IO_INP_PAD_RX_OFFSET,
	IO_INP_PAD_RY_OFFSET,
	IO_INP_PAD_STRIDE,
	IO_INP_PADS,
	IO_INP_POINTER_BUTTONS,
	IO_INP_POINTER_WHEEL,
	IO_INP_POINTER_X,
	IO_INP_POINTER_Y,
	IO_INP_KEY_WORD_COUNT,
	IO_INP_STATUS,
	IO_SYS_BUS_FAULT_ACCESS,
	IO_SYS_BUS_FAULT_ACK,
	IO_SYS_BUS_FAULT_ADDR,
	IO_SYS_BUS_FAULT_CODE,
	IO_SYS_BOOT_CART,
	IO_SYS_HOST_FAULT_FLAGS,
	IO_SYS_HOST_FAULT_STAGE,
	IO_SYS_FRAME_MS,
	IO_SYS_PRINT_CHAR,
	IO_SYS_PRINT_FLUSH,
	IO_SYS_REGION,
	IO_SYS_TIME_MS,
	IO_VDP_DITHER,
	IO_VDP_FAULT_CODE,
	IO_VDP_FAULT_DETAIL,
	IO_VDP_FAULT_ACK,
	IO_VDP_SLOT_PRIMARY,
	IO_VDP_SLOT_SECONDARY,
	IO_VDP_FIFO,
	IO_VDP_FIFO_CTRL,
	IO_VDP_MODE,
	IO_VDP_RD_DATA,
	IO_VDP_RD_MODE,
	IO_VDP_RD_STATUS,
	IO_VDP_RD_SURFACE,
	IO_VDP_RD_X,
	IO_VDP_RD_Y,
	IO_VDP_SCREEN_WH,
	IO_VDP_STATUS,
} from '../bus/io';
import { VDP_PKT_END } from '../devices/vdp/registers';
import {
	VDP_RPU_PACKET_KIND,
	VDP_RPU_OP_EXEC_PASS_LIST,
	VDP_RPU_OP_SEAL_FRAME,
	VDP_RPU_EXEC_PASS_LIST_WORDS,
	VDP_RPU_SEAL_FRAME_WORDS,
	VDP_RPU_RESOURCE_NONE,
	VDP_RPU_SURFACE_FORMAT_RGBA8,
	VDP_RPU_SURFACE_FORMAT_DEPTH16,
	VDP_RPU_PASS_COLOR_CLEAR,
	VDP_RPU_PASS_DEPTH_CLEAR,
	VDP_RPU_PASS_COLOR_STORE,
	VDP_RPU_PASS_DEPTH_STORE,
	VDP_RPU_BLEND_NONE,
	VDP_RPU_BLEND_ALPHA,
	VDP_RPU_BLEND_ADD,
	VDP_RPU_DEPTH_NONE,
	VDP_RPU_DEPTH_LESS,
	VDP_RPU_DEPTH_LEQUAL,
	VDP_RPU_CULL_NONE,
	VDP_RPU_CULL_BACK,
	VDP_RPU_CULL_FRONT,
	VDP_RPU_PIPE_DEPTH_WRITE,
	VDP_RPU_PIPE_COLOR_WRITE_MASK,
	VDP_RPU_PRIM_TRIANGLES,
	VDP_RPU_PRIM_TRIANGLE_STRIP,
	VDP_RPU_PRIM_LINES,
	VDP_RPU_PRIM_POINTS,
	VDP_RPU_INDEX_NONE,
	VDP_RPU_INDEX_U16,
	VDP_RPU_INDEX_U32,
	VDP_RPU_LAYOUT_V2_C4,
	VDP_RPU_LAYOUT_V2_T2_C4,
	VDP_RPU_LAYOUT_V3_C4,
	VDP_RPU_LAYOUT_V3_T2_C4,
	VDP_RPU_LAYOUT_V3_N3_C4,
	VDP_RPU_LAYOUT_V3_N3_T2_C4,
	VDP_RPU_LAYOUT_V3_N3_T2_C4_J4_W4,
	VDP_RPU_LAYOUT_V3_DM3,
	VDP_RPU_SHADER_FLAG_MORPH,
	VDP_RPU_SHADER_FLAG_T1,
	VDP_RPU_LAYOUT_I_AFFINE2_TRECT_C4,
	VDP_RPU_LAYOUT_I_MAT4_C4,
	VDP_RPU_SHADER_V2_C4,
	VDP_RPU_SHADER_V2_T2_C4,
	VDP_RPU_SHADER_V3_C4_C0,
	VDP_RPU_SHADER_V3_T2_C4_C0,
	VDP_RPU_SHADER_V3_N3_T2_C4_C0_C1,
	VDP_RPU_SHADER_V3_N3_T2_C4_J4_W4_C0_C1,
	VDP_RPU_SHADER_V2_T2_C4_I_AFFINE2,
	VDP_RPU_SHADER_V3_C4_I_MAT4,
	VDP_RPU_CONSTANT_SOURCE_XF_Q16,
	VDP_RPU_CONSTANT_SOURCE_LPU_RAW,
	VDP_RPU_CONSTANT_SOURCE_MFU_Q16,
	VDP_RPU_CONSTANT_SOURCE_JTU_Q16,
} from '../devices/vdp/rpu';
import {
	RPU_SURFACE_DESC_SIZE,
	RPU_STREAM_DESC_SIZE,
	RPU_CONSTANT_DESC_SIZE,
	RPU_TEXTURE_DESC_SIZE,
	RPU_DRAW_DESC_SIZE,
	RPU_PASS_DESC_SIZE,
} from '../devices/vdp/rpu_desc';
import { VDP_XF_MATRIX_WORDS, VDP_XF_PACKET_KIND } from '../devices/vdp/xf';
import { VDP_JTU_PACKET_KIND } from '../devices/vdp/jtu';
import { VDP_MFU_PACKET_KIND } from '../devices/vdp/mfu';
import { VDP_LPU_PACKET_KIND } from '../devices/vdp/lpu';
import {
	VDP_JTU_MATRIX_WORDS,
	VDP_FIFO_CTRL_SEAL,
	VDP_FAULT_NONE,
	VDP_FAULT_MODE_UNSUPPORTED,
	VDP_FAULT_RD_OOB,
	VDP_FAULT_RD_SURFACE,
	VDP_FAULT_RD_UNSUPPORTED_MODE,
	VDP_FAULT_STREAM_BAD_PACKET,
	VDP_FAULT_SUBMIT_STATE,
	VDP_FAULT_CMD_BAD_DOORBELL,
	VDP_FAULT_SUBMIT_BUSY,
	VDP_FAULT_VRAM_SLOT_DIM,
	VDP_FAULT_VRAM_WRITE_OOB,
	VDP_FAULT_VRAM_WRITE_UNALIGNED,
	VDP_FAULT_VRAM_WRITE_UNINITIALIZED,
	VDP_FAULT_VRAM_WRITE_UNMAPPED,
	VDP_RD_MODE_RGBA8888,
	VDP_RD_SURFACE_SYSTEM,
	VDP_RD_SURFACE_PRIMARY,
	VDP_RD_SURFACE_SECONDARY,
	VDP_RD_STATUS_OVERFLOW,
	VDP_RD_STATUS_READY,
	VDP_SLOT_NONE,
	VDP_SLOT_PRIMARY,
	VDP_SLOT_SECONDARY,
	VDP_SLOT_SYSTEM,
	VDP_STATUS_FAULT,
	VDP_STATUS_SUBMIT_BUSY,
	VDP_STATUS_SUBMIT_REJECTED,
	VDP_STATUS_VBLANK,
} from '../devices/vdp/contracts';

import { buildLuaFrameRawLabel } from '../../lua/stack_frame_label';
import { asStringId, valueIsString } from '../cpu/cpu';
import type { StringPool } from '../cpu/string_pool';
import type { Runtime } from '../runtime/runtime';


// start repeated-sequence-acceptable -- Lua tostring semantics live in firmware; disassembler formatting is intentionally separate.
export function valueToString(value: Value, stringPool: StringPool): string {
	if (value === null) {
		return 'nil';
	}
	if (typeof value === 'boolean') {
		return value ? 'true' : 'false';
	}
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) {
			return Number.isNaN(value) ? 'nan' : (value < 0 ? '-inf' : 'inf');
		}
		// Parity with C++ runtime string output (Lua tostring semantics).
		// Slower than V8's native formatting; avoid tight-loop conversions.
		return formatNumber(value);
	}
	if (valueIsString(value)) {
		return stringPool.toString(asStringId(value));
	}
	if (value instanceof Table) {
		return 'table';
	}
	if (isNativeFunction(value)) {
		return 'function';
	}
	if (isNativeObject(value)) {
		return 'native';
	}
	return 'function';
}
// end repeated-sequence-acceptable

function buildMachineManifestTable(runtime: Runtime, manifest: MachineManifest): Table {
	const table = new Table(0, 2);
	if (manifest.namespace.length > 0) {
		table.set(runtime.internString('namespace'), runtime.internString(manifest.namespace));
	}
	table.set(runtime.internString('vdp_class'), runtime.internString(manifest.vdp_class));
	return table;
}

function buildCartManifestTable(runtime: Runtime, manifest: CartManifest, machine: MachineManifest, entryPath: string): Table {
	const table = new Table(0, 4);
	if (manifest.title !== undefined && manifest.title.length > 0) {
		table.set(runtime.internString('title'), runtime.internString(manifest.title));
	}
	if (manifest.short_name !== undefined && manifest.short_name.length > 0) {
		table.set(runtime.internString('short_name'), runtime.internString(manifest.short_name));
	}
	if (manifest.rom_name !== undefined && manifest.rom_name.length > 0) {
		table.set(runtime.internString('rom_name'), runtime.internString(manifest.rom_name));
	}
	table.set(runtime.internString('machine'), buildMachineManifestTable(runtime, machine));
	const lua = new Table(0, 1);
	lua.set(runtime.internString('entry_path'), runtime.internString(entryPath));
	table.set(runtime.internString('lua'), lua);
	return table;
}

function resolveLuaFunctionName(runtime: Runtime, protoIndex: number): string {
	if (!runtime.programMetadata) {
		return `proto:${protoIndex}`;
	}
	const protoId = runtime.programMetadata.protoIds[protoIndex];
	const slashIndex = protoId.lastIndexOf('/');
	const hint = slashIndex >= 0 ? protoId.slice(slashIndex + 1) : protoId;
	const colonIndex = hint.indexOf(':');
	if (colonIndex < 0) {
		return hint;
	}
	const kind = hint.slice(0, colonIndex);
	const name = hint.slice(colonIndex + 1);
	switch (kind) {
		case 'decl':
		case 'assign':
			return name;
		case 'local': {
			const hashIndex = name.indexOf('#');
			return hashIndex >= 0 ? name.slice(0, hashIndex) : name;
		}
		case 'anon':
			return 'anonymous';
		default:
			return hint;
	}
}

export function buildLuaStackFrames(runtime: Runtime): StackTraceFrame[] {
	const callStack = runtime.machine.cpu.getCallStack();
	const frames: StackTraceFrame[] = [];
	for (let index = callStack.length - 1; index >= 0; index -= 1) {
		const entry = callStack[index];
		const range = runtime.machine.cpu.getDebugRange(entry.pc);
		const source = range ? range.path : runtime.currentPath;
		const line = range ? range.start.line : 0;
		const column = range ? range.start.column : 0;
		const functionName = resolveLuaFunctionName(runtime, entry.protoIndex);
		frames.push({
			origin: 'lua',
			functionName,
			source,
			line,
			column,
			raw: buildLuaFrameRawLabel(functionName, source),
		});
	}
	return frames;
}

export function seedLuaGlobals(runtime: Runtime): void {
	const exposeObjects = (): void => {
		const cartManifest = runtime.cartManifest;
		runtime.setGlobal('cart_manifest', cartManifest === null ? null : buildCartManifestTable(runtime, cartManifest, runtime.activeMachineManifest, cartManifest.lua.entry_path));
		runtime.setGlobal('machine_manifest', buildMachineManifestTable(runtime, runtime.activeMachineManifest));
	};

	runtime.setGlobal('sys_boot_cart', IO_SYS_BOOT_CART);
	runtime.setGlobal('sys_bus_fault_code', IO_SYS_BUS_FAULT_CODE);
	runtime.setGlobal('sys_bus_fault_addr', IO_SYS_BUS_FAULT_ADDR);
	runtime.setGlobal('sys_bus_fault_access', IO_SYS_BUS_FAULT_ACCESS);
	runtime.setGlobal('sys_bus_fault_ack', IO_SYS_BUS_FAULT_ACK);
	runtime.setGlobal('sys_host_fault_flags', IO_SYS_HOST_FAULT_FLAGS);
	runtime.setGlobal('sys_host_fault_stage', IO_SYS_HOST_FAULT_STAGE);
	runtime.setGlobal('sys_time_ms', IO_SYS_TIME_MS);
	runtime.setGlobal('sys_frame_ms', IO_SYS_FRAME_MS);
	runtime.setGlobal('sys_region', IO_SYS_REGION);
	runtime.setGlobal('sys_region_pal', MACHINE_REGION_PAL_WORD);
	runtime.setGlobal('sys_region_ntsc', MACHINE_REGION_NTSC_WORD);
	runtime.setGlobal('sys_host_fault_message', null);
	runtime.setGlobal('sys_print_char', IO_SYS_PRINT_CHAR);
	runtime.setGlobal('sys_print_flush', IO_SYS_PRINT_FLUSH);
	runtime.setGlobal('sys_cart_magic_addr', CART_ROM_MAGIC_ADDR);
	runtime.setGlobal('sys_cart_magic', CART_ROM_MAGIC);
	runtime.setGlobal('sys_cart_rom_size', CART_ROM_SIZE);
	runtime.setGlobal('sys_ram_size', RAM_SIZE);
	runtime.setGlobal('sys_geo_scratch_base', GEO_SCRATCH_BASE);
	runtime.setGlobal('sys_geo_scratch_size', GEO_SCRATCH_SIZE);
	runtime.setGlobal('sys_max_cycles_per_frame', runtime.timing.cycleBudgetPerFrame);
	runtime.setGlobal('sys_vdp_dither', IO_VDP_DITHER);
	runtime.setGlobal('sys_vdp_slot_primary_atlas', IO_VDP_SLOT_PRIMARY);
	runtime.setGlobal('sys_vdp_slot_secondary_atlas', IO_VDP_SLOT_SECONDARY);
	runtime.setGlobal('sys_vdp_slot_none', VDP_SLOT_NONE);
	runtime.setGlobal('sys_vdp_stream_base', VDP_STREAM_BUFFER_BASE);
	runtime.setGlobal('sys_vdp_stream_capacity', VDP_STREAM_CAPACITY_WORDS);
	runtime.setGlobal('sys_vdp_fifo', IO_VDP_FIFO);
	runtime.setGlobal('sys_vdp_fifo_ctrl', IO_VDP_FIFO_CTRL);
	runtime.setGlobal('sys_vdp_fifo_ctrl_seal', VDP_FIFO_CTRL_SEAL);
	runtime.setGlobal('sys_vdp_mode', IO_VDP_MODE);
	runtime.setGlobal('sys_vdp_screen_wh', IO_VDP_SCREEN_WH);
	runtime.setGlobal('sys_vdp_mode_msx1', VDP_MODE_MSX1_WORD);
	runtime.setGlobal('sys_vdp_mode_msx2', VDP_MODE_MSX2_WORD);
	runtime.setGlobal('sys_vdp_mode_psx', VDP_MODE_PSX_WORD);
	runtime.setGlobal('sys_vdp_slot_primary', VDP_SLOT_PRIMARY);
	runtime.setGlobal('sys_vdp_slot_secondary', VDP_SLOT_SECONDARY);
	runtime.setGlobal('sys_vdp_slot_system', VDP_SLOT_SYSTEM);
	runtime.setGlobal('sys_vdp_slot_none', VDP_SLOT_NONE);
	runtime.setGlobal('sys_vdp_rd_surface', IO_VDP_RD_SURFACE);
	runtime.setGlobal('sys_vdp_rd_x', IO_VDP_RD_X);
	runtime.setGlobal('sys_vdp_rd_y', IO_VDP_RD_Y);
	runtime.setGlobal('sys_vdp_rd_mode', IO_VDP_RD_MODE);
	runtime.setGlobal('sys_vdp_rd_status', IO_VDP_RD_STATUS);
	runtime.setGlobal('sys_vdp_rd_data', IO_VDP_RD_DATA);
	runtime.setGlobal('sys_vdp_status', IO_VDP_STATUS);
	runtime.setGlobal('sys_vdp_fault_code', IO_VDP_FAULT_CODE);
	runtime.setGlobal('sys_vdp_fault_detail', IO_VDP_FAULT_DETAIL);
	runtime.setGlobal('sys_vdp_fault_ack', IO_VDP_FAULT_ACK);
	runtime.setGlobal('sys_vdp_rd_mode_rgba8888', VDP_RD_MODE_RGBA8888);
	runtime.setGlobal('sys_vdp_rd_status_ready', VDP_RD_STATUS_READY);
	runtime.setGlobal('sys_vdp_rd_status_overflow', VDP_RD_STATUS_OVERFLOW);
	runtime.setGlobal('sys_vdp_status_vblank', VDP_STATUS_VBLANK);
	runtime.setGlobal('sys_vdp_status_submit_busy', VDP_STATUS_SUBMIT_BUSY);
	runtime.setGlobal('sys_vdp_status_submit_rejected', VDP_STATUS_SUBMIT_REJECTED);
	runtime.setGlobal('sys_vdp_status_fault', VDP_STATUS_FAULT);
	runtime.setGlobal('sys_vdp_fault_none', VDP_FAULT_NONE);
	runtime.setGlobal('sys_vdp_fault_mode_unsupported', VDP_FAULT_MODE_UNSUPPORTED);
	runtime.setGlobal('sys_vdp_fault_rd_unsupported_mode', VDP_FAULT_RD_UNSUPPORTED_MODE);
	runtime.setGlobal('sys_vdp_fault_rd_surface', VDP_FAULT_RD_SURFACE);
	runtime.setGlobal('sys_vdp_fault_rd_oob', VDP_FAULT_RD_OOB);
	runtime.setGlobal('sys_vdp_fault_vram_write_unmapped', VDP_FAULT_VRAM_WRITE_UNMAPPED);
	runtime.setGlobal('sys_vdp_fault_vram_write_uninitialized', VDP_FAULT_VRAM_WRITE_UNINITIALIZED);
	runtime.setGlobal('sys_vdp_fault_vram_write_oob', VDP_FAULT_VRAM_WRITE_OOB);
	runtime.setGlobal('sys_vdp_fault_vram_write_unaligned', VDP_FAULT_VRAM_WRITE_UNALIGNED);
	runtime.setGlobal('sys_vdp_fault_vram_slot_dim', VDP_FAULT_VRAM_SLOT_DIM);
	runtime.setGlobal('sys_vdp_fault_stream_bad_packet', VDP_FAULT_STREAM_BAD_PACKET);
	runtime.setGlobal('sys_vdp_fault_submit_state', VDP_FAULT_SUBMIT_STATE);
	runtime.setGlobal('sys_vdp_fault_cmd_bad_doorbell', VDP_FAULT_CMD_BAD_DOORBELL);
	runtime.setGlobal('sys_vdp_fault_submit_busy', VDP_FAULT_SUBMIT_BUSY);

	runtime.setGlobal('sys_vdp_xf_packet_kind', VDP_XF_PACKET_KIND);
	runtime.setGlobal('sys_vdp_xf_matrix_words', VDP_XF_MATRIX_WORDS);
	runtime.setGlobal('sys_vdp_jtu_packet_kind', VDP_JTU_PACKET_KIND);
	runtime.setGlobal('sys_vdp_jtu_matrix_words', VDP_JTU_MATRIX_WORDS);
	runtime.setGlobal('sys_vdp_mfu_packet_kind', VDP_MFU_PACKET_KIND);
	runtime.setGlobal('sys_vdp_lpu_packet_kind', VDP_LPU_PACKET_KIND);

	runtime.setGlobal('sys_vdp_pkt_end', VDP_PKT_END);
	runtime.setGlobal('sys_rpu_packet_kind', VDP_RPU_PACKET_KIND);
	runtime.setGlobal('sys_rpu_op_exec_pass_list', VDP_RPU_OP_EXEC_PASS_LIST);
	runtime.setGlobal('sys_rpu_op_seal_frame', VDP_RPU_OP_SEAL_FRAME);
	runtime.setGlobal('sys_rpu_words_exec_pass_list', VDP_RPU_EXEC_PASS_LIST_WORDS);
	runtime.setGlobal('sys_rpu_words_seal_frame', VDP_RPU_SEAL_FRAME_WORDS);
	runtime.setGlobal('sys_rpu_resource_none', VDP_RPU_RESOURCE_NONE);
	runtime.setGlobal('sys_rpu_surface_format_rgba8', VDP_RPU_SURFACE_FORMAT_RGBA8);
	runtime.setGlobal('sys_rpu_surface_format_depth16', VDP_RPU_SURFACE_FORMAT_DEPTH16);
	runtime.setGlobal('sys_rpu_surface_desc_bytes', RPU_SURFACE_DESC_SIZE);
	runtime.setGlobal('sys_rpu_stream_desc_bytes', RPU_STREAM_DESC_SIZE);
	runtime.setGlobal('sys_rpu_constant_desc_bytes', RPU_CONSTANT_DESC_SIZE);
	runtime.setGlobal('sys_rpu_texture_desc_bytes', RPU_TEXTURE_DESC_SIZE);
	runtime.setGlobal('sys_rpu_draw_desc_bytes', RPU_DRAW_DESC_SIZE);
	runtime.setGlobal('sys_rpu_pass_desc_bytes', RPU_PASS_DESC_SIZE);
	runtime.setGlobal('sys_rpu_pass_color_clear', VDP_RPU_PASS_COLOR_CLEAR);
	runtime.setGlobal('sys_rpu_pass_depth_clear', VDP_RPU_PASS_DEPTH_CLEAR);
	runtime.setGlobal('sys_rpu_pass_color_store', VDP_RPU_PASS_COLOR_STORE);
	runtime.setGlobal('sys_rpu_pass_depth_store', VDP_RPU_PASS_DEPTH_STORE);
	runtime.setGlobal('sys_rpu_blend_none', VDP_RPU_BLEND_NONE);
	runtime.setGlobal('sys_rpu_blend_alpha', VDP_RPU_BLEND_ALPHA);
	runtime.setGlobal('sys_rpu_blend_add', VDP_RPU_BLEND_ADD);
	runtime.setGlobal('sys_rpu_depth_none', VDP_RPU_DEPTH_NONE);
	runtime.setGlobal('sys_rpu_depth_less', VDP_RPU_DEPTH_LESS);
	runtime.setGlobal('sys_rpu_depth_lequal', VDP_RPU_DEPTH_LEQUAL);
	runtime.setGlobal('sys_rpu_cull_none', VDP_RPU_CULL_NONE);
	runtime.setGlobal('sys_rpu_cull_back', VDP_RPU_CULL_BACK);
	runtime.setGlobal('sys_rpu_cull_front', VDP_RPU_CULL_FRONT);
	runtime.setGlobal('sys_rpu_pipe_depth_write', VDP_RPU_PIPE_DEPTH_WRITE);
	runtime.setGlobal('sys_rpu_pipe_color_write_rgba', VDP_RPU_PIPE_COLOR_WRITE_MASK);
	runtime.setGlobal('sys_rpu_prim_triangles', VDP_RPU_PRIM_TRIANGLES);
	runtime.setGlobal('sys_rpu_prim_triangle_strip', VDP_RPU_PRIM_TRIANGLE_STRIP);
	runtime.setGlobal('sys_rpu_prim_lines', VDP_RPU_PRIM_LINES);
	runtime.setGlobal('sys_rpu_prim_points', VDP_RPU_PRIM_POINTS);
	runtime.setGlobal('sys_rpu_index_none', VDP_RPU_INDEX_NONE);
	runtime.setGlobal('sys_rpu_index_u16', VDP_RPU_INDEX_U16);
	runtime.setGlobal('sys_rpu_index_u32', VDP_RPU_INDEX_U32);
	runtime.setGlobal('sys_rpu_layout_v2_c4', VDP_RPU_LAYOUT_V2_C4);
	runtime.setGlobal('sys_rpu_layout_v2_t2_c4', VDP_RPU_LAYOUT_V2_T2_C4);
	runtime.setGlobal('sys_rpu_layout_v3_c4', VDP_RPU_LAYOUT_V3_C4);
	runtime.setGlobal('sys_rpu_layout_v3_t2_c4', VDP_RPU_LAYOUT_V3_T2_C4);
	runtime.setGlobal('sys_rpu_layout_v3_n3_c4', VDP_RPU_LAYOUT_V3_N3_C4);
	runtime.setGlobal('sys_rpu_layout_v3_n3_t2_c4', VDP_RPU_LAYOUT_V3_N3_T2_C4);
	runtime.setGlobal('sys_rpu_layout_v3_n3_t2_c4_j4_w4', VDP_RPU_LAYOUT_V3_N3_T2_C4_J4_W4);
	runtime.setGlobal('sys_rpu_layout_v3_dm3', VDP_RPU_LAYOUT_V3_DM3);
	runtime.setGlobal('sys_rpu_shader_flag_morph', VDP_RPU_SHADER_FLAG_MORPH);
	runtime.setGlobal('sys_rpu_shader_flag_t1', VDP_RPU_SHADER_FLAG_T1);
	runtime.setGlobal('sys_rpu_layout_i_affine2_trect_c4', VDP_RPU_LAYOUT_I_AFFINE2_TRECT_C4);
	runtime.setGlobal('sys_rpu_layout_i_mat4_c4', VDP_RPU_LAYOUT_I_MAT4_C4);
	runtime.setGlobal('sys_rpu_shader_v2_c4', VDP_RPU_SHADER_V2_C4);
	runtime.setGlobal('sys_rpu_shader_v2_t2_c4', VDP_RPU_SHADER_V2_T2_C4);
	runtime.setGlobal('sys_rpu_shader_v3_c4_c0', VDP_RPU_SHADER_V3_C4_C0);
	runtime.setGlobal('sys_rpu_shader_v3_t2_c4_c0', VDP_RPU_SHADER_V3_T2_C4_C0);
	runtime.setGlobal('sys_rpu_shader_v3_n3_t2_c4_c0_c1', VDP_RPU_SHADER_V3_N3_T2_C4_C0_C1);
	runtime.setGlobal('sys_rpu_shader_v3_n3_t2_c4_j4_w4_c0_c1', VDP_RPU_SHADER_V3_N3_T2_C4_J4_W4_C0_C1);
	runtime.setGlobal('sys_rpu_shader_v2_t2_c4_i_affine2', VDP_RPU_SHADER_V2_T2_C4_I_AFFINE2);
	runtime.setGlobal('sys_rpu_shader_v3_c4_i_mat4', VDP_RPU_SHADER_V3_C4_I_MAT4);
	runtime.setGlobal('sys_rpu_constant_source_xf_q16', VDP_RPU_CONSTANT_SOURCE_XF_Q16);
	runtime.setGlobal('sys_rpu_constant_source_lpu_raw', VDP_RPU_CONSTANT_SOURCE_LPU_RAW);
	runtime.setGlobal('sys_rpu_constant_source_mfu_q16', VDP_RPU_CONSTANT_SOURCE_MFU_Q16);
	runtime.setGlobal('sys_rpu_constant_source_jtu_q16', VDP_RPU_CONSTANT_SOURCE_JTU_Q16);
	runtime.setGlobal('sys_rpu_surface_system', VDP_RD_SURFACE_SYSTEM);
	runtime.setGlobal('sys_rpu_surface_primary', VDP_RD_SURFACE_PRIMARY);
	runtime.setGlobal('sys_rpu_surface_secondary', VDP_RD_SURFACE_SECONDARY);
	runtime.setGlobal('sys_vdp_layer_world', 0);
	runtime.setGlobal('sys_vdp_layer_ui', 1);
	runtime.setGlobal('sys_vdp_layer_ide', 2);
	runtime.setGlobal('sys_vdp_arg_stride', IO_ARG_STRIDE);
	runtime.setGlobal('sys_dma_src', IO_DMA_SRC);
	runtime.setGlobal('sys_dma_dst', IO_DMA_DST);
	runtime.setGlobal('sys_dma_len', IO_DMA_LEN);
	runtime.setGlobal('sys_dma_ctrl', IO_DMA_CTRL);
	runtime.setGlobal('sys_dma_status', IO_DMA_STATUS);
	runtime.setGlobal('sys_dma_written', IO_DMA_WRITTEN);
	runtime.setGlobal('sys_geo_src0', IO_GEO_SRC0);
	runtime.setGlobal('sys_geo_src1', IO_GEO_SRC1);
	runtime.setGlobal('sys_geo_src2', IO_GEO_SRC2);
	runtime.setGlobal('sys_geo_dst0', IO_GEO_DST0);
	runtime.setGlobal('sys_geo_dst1', IO_GEO_DST1);
	runtime.setGlobal('sys_geo_count', IO_GEO_COUNT);
	runtime.setGlobal('sys_geo_cmd', IO_GEO_CMD);
	runtime.setGlobal('sys_geo_ctrl', IO_GEO_CTRL);
	runtime.setGlobal('sys_geo_status', IO_GEO_STATUS);
	runtime.setGlobal('sys_geo_param0', IO_GEO_PARAM0);
	runtime.setGlobal('sys_geo_param1', IO_GEO_PARAM1);
	runtime.setGlobal('sys_geo_stride0', IO_GEO_STRIDE0);
	runtime.setGlobal('sys_geo_stride1', IO_GEO_STRIDE1);
	runtime.setGlobal('sys_geo_stride2', IO_GEO_STRIDE2);
	runtime.setGlobal('sys_geo_processed', IO_GEO_PROCESSED);
	runtime.setGlobal('sys_geo_fault', IO_GEO_FAULT);
	runtime.setGlobal('sys_geo_fault_ack', IO_GEO_FAULT_ACK);
	runtime.setGlobal('sys_img_src', IO_IMG_SRC);
	runtime.setGlobal('sys_img_len', IO_IMG_LEN);
	runtime.setGlobal('sys_img_dst', IO_IMG_DST);
	runtime.setGlobal('sys_img_cap', IO_IMG_CAP);
	runtime.setGlobal('sys_img_ctrl', IO_IMG_CTRL);
	runtime.setGlobal('sys_img_status', IO_IMG_STATUS);
	runtime.setGlobal('sys_img_written', IO_IMG_WRITTEN);
	runtime.setGlobal('sys_inp_ctrl', IO_INP_CTRL);
	runtime.setGlobal('sys_inp_status', IO_INP_STATUS);
	runtime.setGlobal('sys_inp_keys', IO_INP_KEYS);
	runtime.setGlobal('sys_inp_pointer_buttons', IO_INP_POINTER_BUTTONS);
	runtime.setGlobal('sys_inp_pointer_x', IO_INP_POINTER_X);
	runtime.setGlobal('sys_inp_pointer_y', IO_INP_POINTER_Y);
	runtime.setGlobal('sys_inp_pointer_wheel', IO_INP_POINTER_WHEEL);
	runtime.setGlobal('sys_inp_pads', IO_INP_PADS);
	runtime.setGlobal('sys_inp_output_port', IO_INP_OUTPUT_PORT);
	runtime.setGlobal('sys_inp_output_intensity_q16', IO_INP_OUTPUT_INTENSITY_Q16);
	runtime.setGlobal('sys_inp_output_duration_ms', IO_INP_OUTPUT_DURATION_MS);
	runtime.setGlobal('sys_inp_output_status', IO_INP_OUTPUT_STATUS);
	runtime.setGlobal('sys_inp_output_ctrl', IO_INP_OUTPUT_CTRL);
	runtime.setGlobal('sys_apu_source_addr', IO_APU_SOURCE_ADDR);
	runtime.setGlobal('sys_apu_source_bytes', IO_APU_SOURCE_BYTES);
	runtime.setGlobal('sys_apu_source_sample_rate_hz', IO_APU_SOURCE_SAMPLE_RATE_HZ);
	runtime.setGlobal('sys_apu_source_channels', IO_APU_SOURCE_CHANNELS);
	runtime.setGlobal('sys_apu_source_bits_per_sample', IO_APU_SOURCE_BITS_PER_SAMPLE);
	runtime.setGlobal('sys_apu_source_frame_count', IO_APU_SOURCE_FRAME_COUNT);
	runtime.setGlobal('sys_apu_source_data_offset', IO_APU_SOURCE_DATA_OFFSET);
	runtime.setGlobal('sys_apu_source_data_bytes', IO_APU_SOURCE_DATA_BYTES);
	runtime.setGlobal('sys_apu_source_loop_start_sample', IO_APU_SOURCE_LOOP_START_SAMPLE);
	runtime.setGlobal('sys_apu_source_loop_end_sample', IO_APU_SOURCE_LOOP_END_SAMPLE);
	runtime.setGlobal('sys_apu_slot', IO_APU_SLOT);
	runtime.setGlobal('sys_apu_rate_step_q16', IO_APU_RATE_STEP_Q16);
	runtime.setGlobal('sys_apu_gain_q12', IO_APU_GAIN_Q12);
	runtime.setGlobal('sys_apu_start_sample', IO_APU_START_SAMPLE);
	runtime.setGlobal('sys_apu_filter_kind', IO_APU_FILTER_KIND);
	runtime.setGlobal('sys_apu_filter_freq_hz', IO_APU_FILTER_FREQ_HZ);
	runtime.setGlobal('sys_apu_filter_q_milli', IO_APU_FILTER_Q_MILLI);
	runtime.setGlobal('sys_apu_filter_gain_millidb', IO_APU_FILTER_GAIN_MILLIDB);
	runtime.setGlobal('sys_apu_fade_samples', IO_APU_FADE_SAMPLES);
	runtime.setGlobal('sys_apu_generator_kind', IO_APU_GENERATOR_KIND);
	runtime.setGlobal('sys_apu_generator_duty_q12', IO_APU_GENERATOR_DUTY_Q12);
	runtime.setGlobal('sys_apu_cmd', IO_APU_CMD);
	runtime.setGlobal('sys_apu_status', IO_APU_STATUS);
	runtime.setGlobal('sys_apu_fault_code', IO_APU_FAULT_CODE);
	runtime.setGlobal('sys_apu_fault_detail', IO_APU_FAULT_DETAIL);
	runtime.setGlobal('sys_apu_fault_ack', IO_APU_FAULT_ACK);
	runtime.setGlobal('sys_apu_event_kind', IO_APU_EVENT_KIND);
	runtime.setGlobal('sys_apu_event_slot', IO_APU_EVENT_SLOT);
	runtime.setGlobal('sys_apu_event_source_addr', IO_APU_EVENT_SOURCE_ADDR);
	runtime.setGlobal('sys_apu_event_seq', IO_APU_EVENT_SEQ);
	runtime.setGlobal('sys_apu_selected_source_addr', IO_APU_SELECTED_SOURCE_ADDR);
	runtime.setGlobal('sys_apu_active_mask', IO_APU_ACTIVE_MASK);
	runtime.setGlobal('sys_apu_selected_slot_regs', IO_APU_SELECTED_SLOT_REG0);
	runtime.setGlobal('sys_apu_selected_slot_reg_count', IO_APU_SELECTED_SLOT_REG_COUNT);
	runtime.setGlobal('sys_apu_output_queued_frames', IO_APU_OUTPUT_QUEUED_FRAMES);
	runtime.setGlobal('sys_apu_output_free_frames', IO_APU_OUTPUT_FREE_FRAMES);
	runtime.setGlobal('sys_apu_output_capacity_frames', IO_APU_OUTPUT_CAPACITY_FRAMES);
	runtime.setGlobal('sys_apu_cmd_queued', IO_APU_CMD_QUEUED);
	runtime.setGlobal('sys_apu_cmd_free', IO_APU_CMD_FREE);
	runtime.setGlobal('sys_apu_cmd_capacity', IO_APU_CMD_CAPACITY);
	runtime.setGlobal('apu_cmd_play', APU_CMD_PLAY);
	runtime.setGlobal('apu_cmd_stop_slot', APU_CMD_STOP_SLOT);
	runtime.setGlobal('apu_cmd_set_slot_gain', APU_CMD_SET_SLOT_GAIN);
	runtime.setGlobal('apu_sample_rate_hz', APU_SAMPLE_RATE_HZ);
	runtime.setGlobal('apu_rate_step_q16_one', APU_RATE_STEP_Q16_ONE);
	runtime.setGlobal('apu_gain_q12_one', APU_GAIN_Q12_ONE);
	runtime.setGlobal('apu_generator_none', APU_GENERATOR_NONE);
	runtime.setGlobal('apu_generator_square', APU_GENERATOR_SQUARE);
	runtime.setGlobal('apu_output_queue_capacity_frames', APU_OUTPUT_QUEUE_CAPACITY_FRAMES);
	runtime.setGlobal('apu_command_fifo_capacity', APU_COMMAND_FIFO_CAPACITY);
	runtime.setGlobal('apu_status_fault', APU_STATUS_FAULT);
	runtime.setGlobal('apu_status_selected_slot_active', APU_STATUS_SELECTED_SLOT_ACTIVE);
	runtime.setGlobal('apu_status_busy', APU_STATUS_BUSY);
	runtime.setGlobal('apu_status_output_empty', APU_STATUS_OUTPUT_EMPTY);
	runtime.setGlobal('apu_status_output_full', APU_STATUS_OUTPUT_FULL);
	runtime.setGlobal('apu_status_cmd_fifo_empty', APU_STATUS_CMD_FIFO_EMPTY);
	runtime.setGlobal('apu_status_cmd_fifo_full', APU_STATUS_CMD_FIFO_FULL);
	runtime.setGlobal('apu_fault_none', APU_FAULT_NONE);
	runtime.setGlobal('apu_fault_bad_cmd', APU_FAULT_BAD_CMD);
	runtime.setGlobal('apu_fault_bad_slot', APU_FAULT_BAD_SLOT);
	runtime.setGlobal('apu_fault_cmd_fifo_full', APU_FAULT_CMD_FIFO_FULL);
	runtime.setGlobal('apu_fault_source_bytes', APU_FAULT_SOURCE_BYTES);
	runtime.setGlobal('apu_fault_source_range', APU_FAULT_SOURCE_RANGE);
	runtime.setGlobal('apu_fault_source_sample_rate', APU_FAULT_SOURCE_SAMPLE_RATE);
	runtime.setGlobal('apu_fault_source_channels', APU_FAULT_SOURCE_CHANNELS);
	runtime.setGlobal('apu_fault_source_frame_count', APU_FAULT_SOURCE_FRAME_COUNT);
	runtime.setGlobal('apu_fault_source_data_range', APU_FAULT_SOURCE_DATA_RANGE);
	runtime.setGlobal('apu_fault_source_bit_depth', APU_FAULT_SOURCE_BIT_DEPTH);
	runtime.setGlobal('apu_fault_unsupported_format', APU_FAULT_UNSUPPORTED_FORMAT);
	runtime.setGlobal('apu_fault_output_metadata', APU_FAULT_OUTPUT_METADATA);
	runtime.setGlobal('apu_fault_output_data_range', APU_FAULT_OUTPUT_DATA_RANGE);
	runtime.setGlobal('apu_fault_output_playback_rate', APU_FAULT_OUTPUT_PLAYBACK_RATE);
	runtime.setGlobal('apu_fault_output_block', APU_FAULT_OUTPUT_BLOCK);
	runtime.setGlobal('apu_filter_none', APU_FILTER_NONE);
	runtime.setGlobal('apu_filter_lowpass', APU_FILTER_LOWPASS);
	runtime.setGlobal('apu_filter_highpass', APU_FILTER_HIGHPASS);
	runtime.setGlobal('apu_filter_bandpass', APU_FILTER_BANDPASS);
	runtime.setGlobal('apu_filter_notch', APU_FILTER_NOTCH);
	runtime.setGlobal('apu_filter_allpass', APU_FILTER_ALLPASS);
	runtime.setGlobal('apu_filter_peaking', APU_FILTER_PEAKING);
	runtime.setGlobal('apu_filter_lowshelf', APU_FILTER_LOWSHELF);
	runtime.setGlobal('apu_filter_highshelf', APU_FILTER_HIGHSHELF);
	runtime.setGlobal('apu_event_none', APU_EVENT_NONE);
	runtime.setGlobal('apu_event_slot_ended', APU_EVENT_SLOT_ENDED);
	runtime.setGlobal('inp_ctrl_arm', INP_CTRL_ARM);
	runtime.setGlobal('inp_ctrl_reset', INP_CTRL_RESET);
	runtime.setGlobal('inp_key_word_count', IO_INP_KEY_WORD_COUNT);
	runtime.setGlobal('inp_pad_count', IO_INP_PAD_COUNT);
	runtime.setGlobal('inp_pad_stride', IO_INP_PAD_STRIDE);
	runtime.setGlobal('inp_pad_buttons', IO_INP_PAD_BUTTONS_OFFSET);
	runtime.setGlobal('inp_pad_lx', IO_INP_PAD_LX_OFFSET);
	runtime.setGlobal('inp_pad_ly', IO_INP_PAD_LY_OFFSET);
	runtime.setGlobal('inp_pad_rx', IO_INP_PAD_RX_OFFSET);
	runtime.setGlobal('inp_pad_ry', IO_INP_PAD_RY_OFFSET);
	runtime.setGlobal('inp_pad_lt', IO_INP_PAD_LT_OFFSET);
	runtime.setGlobal('inp_pad_rt', IO_INP_PAD_RT_OFFSET);
	for (let bit = 0; bit < INPUT_CONTROLLER_GAMEPAD_BUTTON_BIT_IDS.length; bit += 1) {
		runtime.setGlobal(`inp_btn_${INPUT_CONTROLLER_GAMEPAD_BUTTON_BIT_IDS[bit]}`, bit);
	}
	runtime.setGlobal('inp_pointer_primary', INP_POINTER_BUTTON_PRIMARY);
	runtime.setGlobal('inp_pointer_aux', INP_POINTER_BUTTON_AUX);
	runtime.setGlobal('inp_pointer_secondary', INP_POINTER_BUTTON_SECONDARY);
	runtime.setGlobal('inp_pointer_back', INP_POINTER_BUTTON_BACK);
	runtime.setGlobal('inp_pointer_forward', INP_POINTER_BUTTON_FORWARD);
	runtime.setGlobal('inp_output_ctrl_apply', INP_OUTPUT_CTRL_APPLY);
	runtime.setGlobal('inp_output_intensity_q16_one', INPUT_CONTROLLER_OUTPUT_INTENSITY_Q16_ONE);
	runtime.setGlobal('sys_rom_system_base', SYSTEM_ROM_BASE);
	runtime.setGlobal('sys_rom_cart_base', CART_ROM_BASE);
	runtime.setGlobal('sys_rom_overlay_base', OVERLAY_ROM_BASE);
	runtime.setGlobal('sys_rom_overlay_size', runtime.machine.memory.getOverlayRomSize());
	runtime.setGlobal('sys_vram_system_slot_base', VRAM_SYSTEM_SLOT_BASE);
	runtime.setGlobal('sys_vram_primary_slot_base', VRAM_PRIMARY_SLOT_BASE);
	runtime.setGlobal('sys_vram_secondary_slot_base', VRAM_SECONDARY_SLOT_BASE);
	runtime.setGlobal('sys_vram_staging_base', VRAM_STAGING_BASE);
	runtime.setGlobal('sys_vram_system_slot_size', VRAM_SYSTEM_SLOT_SIZE);
	runtime.setGlobal('sys_vram_primary_slot_size', VRAM_PRIMARY_SLOT_SIZE);
	runtime.setGlobal('sys_vram_secondary_slot_size', VRAM_SECONDARY_SLOT_SIZE);
	runtime.setGlobal('sys_vram_staging_size', VRAM_STAGING_SIZE);
	runtime.setGlobal('sys_vram_size', runtime.vramTotalBytes());
	runtime.setGlobal('dma_ctrl_start', DMA_CTRL_START);
	runtime.setGlobal('dma_ctrl_strict', DMA_CTRL_STRICT);
	runtime.setGlobal('dma_status_busy', DMA_STATUS_BUSY);
	runtime.setGlobal('dma_status_done', DMA_STATUS_DONE);
	runtime.setGlobal('dma_status_error', DMA_STATUS_ERROR);
	runtime.setGlobal('dma_status_clipped', DMA_STATUS_CLIPPED);
	runtime.setGlobal('dma_status_rejected', DMA_STATUS_REJECTED);
	runtime.setGlobal('sys_geo_ctrl_abort', GEO_CTRL_ABORT);
	runtime.setGlobal('geo_status_busy', GEO_STATUS_BUSY);
	runtime.setGlobal('geo_status_done', GEO_STATUS_DONE);
	runtime.setGlobal('geo_status_error', GEO_STATUS_ERROR);
	runtime.setGlobal('geo_status_rejected', GEO_STATUS_REJECTED);
	runtime.setGlobal('sys_geo_cmd_xform2_batch', IO_CMD_GEO_XFORM2_BATCH);
	runtime.setGlobal('sys_geo_cmd_sat2_batch', IO_CMD_GEO_SAT2_BATCH);
	runtime.setGlobal('sys_geo_cmd_overlap2d_pass', IO_CMD_GEO_OVERLAP2D_PASS);
	runtime.setGlobal('sys_geo_index_none', GEO_INDEX_NONE);
	runtime.setGlobal('sys_geo_primitive_aabb', GEO_PRIMITIVE_AABB);
	runtime.setGlobal('sys_geo_primitive_convex_poly', GEO_PRIMITIVE_CONVEX_POLY);
	runtime.setGlobal('sys_geo_shape_convex_poly', GEO_SHAPE_CONVEX_POLY);
	runtime.setGlobal('sys_geo_vertex2_bytes', GEO_VERTEX2_BYTES);
	runtime.setGlobal('sys_geo_vertex2_x_offset', GEO_VERTEX2_X_OFFSET);
	runtime.setGlobal('sys_geo_vertex2_y_offset', GEO_VERTEX2_Y_OFFSET);
	runtime.setGlobal('sys_geo_xform2_record_bytes', GEO_XFORM2_RECORD_BYTES);
	runtime.setGlobal('sys_geo_xform2_record_flags_offset', GEO_XFORM2_RECORD_FLAGS_OFFSET);
	runtime.setGlobal('sys_geo_xform2_record_src_index_offset', GEO_XFORM2_RECORD_SRC_INDEX_OFFSET);
	runtime.setGlobal('sys_geo_xform2_record_dst_index_offset', GEO_XFORM2_RECORD_DST_INDEX_OFFSET);
	runtime.setGlobal('sys_geo_xform2_record_aux_index_offset', GEO_XFORM2_RECORD_AUX_INDEX_OFFSET);
	runtime.setGlobal('sys_geo_xform2_record_vertex_count_offset', GEO_XFORM2_RECORD_VERTEX_COUNT_OFFSET);
	runtime.setGlobal('sys_geo_xform2_record_dst1_index_offset', GEO_XFORM2_RECORD_DST1_INDEX_OFFSET);
	runtime.setGlobal('sys_geo_xform2_matrix_bytes', GEO_XFORM2_MATRIX_BYTES);
	runtime.setGlobal('sys_geo_xform2_matrix_m00_offset', GEO_XFORM2_MATRIX_M00_OFFSET);
	runtime.setGlobal('sys_geo_xform2_matrix_m01_offset', GEO_XFORM2_MATRIX_M01_OFFSET);
	runtime.setGlobal('sys_geo_xform2_matrix_tx_offset', GEO_XFORM2_MATRIX_TX_OFFSET);
	runtime.setGlobal('sys_geo_xform2_matrix_m10_offset', GEO_XFORM2_MATRIX_M10_OFFSET);
	runtime.setGlobal('sys_geo_xform2_matrix_m11_offset', GEO_XFORM2_MATRIX_M11_OFFSET);
	runtime.setGlobal('sys_geo_xform2_matrix_ty_offset', GEO_XFORM2_MATRIX_TY_OFFSET);
	runtime.setGlobal('sys_geo_xform2_aabb_bytes', GEO_XFORM2_AABB_BYTES);
	runtime.setGlobal('sys_geo_xform2_aabb_min_x_offset', GEO_XFORM2_AABB_MIN_X_OFFSET);
	runtime.setGlobal('sys_geo_xform2_aabb_min_y_offset', GEO_XFORM2_AABB_MIN_Y_OFFSET);
	runtime.setGlobal('sys_geo_xform2_aabb_max_x_offset', GEO_XFORM2_AABB_MAX_X_OFFSET);
	runtime.setGlobal('sys_geo_xform2_aabb_max_y_offset', GEO_XFORM2_AABB_MAX_Y_OFFSET);
	runtime.setGlobal('sys_geo_xform2_max_vertices', GEO_XFORM2_MAX_VERTICES);
	runtime.setGlobal('sys_geo_sat2_pair_bytes', GEO_SAT2_PAIR_BYTES);
	runtime.setGlobal('sys_geo_sat2_pair_flags_offset', GEO_SAT2_PAIR_FLAGS_OFFSET);
	runtime.setGlobal('sys_geo_sat2_pair_shape_a_index_offset', GEO_SAT2_PAIR_SHAPE_A_INDEX_OFFSET);
	runtime.setGlobal('sys_geo_sat2_pair_result_index_offset', GEO_SAT2_PAIR_RESULT_INDEX_OFFSET);
	runtime.setGlobal('sys_geo_sat2_pair_shape_b_index_offset', GEO_SAT2_PAIR_SHAPE_B_INDEX_OFFSET);
	runtime.setGlobal('sys_geo_sat2_pair_flags2_offset', GEO_SAT2_PAIR_FLAGS2_OFFSET);
	runtime.setGlobal('sys_geo_sat2_desc_bytes', GEO_SAT2_DESC_BYTES);
	runtime.setGlobal('sys_geo_sat2_desc_flags_offset', GEO_SAT2_DESC_FLAGS_OFFSET);
	runtime.setGlobal('sys_geo_sat2_desc_vertex_count_offset', GEO_SAT2_DESC_VERTEX_COUNT_OFFSET);
	runtime.setGlobal('sys_geo_sat2_desc_vertex_offset_offset', GEO_SAT2_DESC_VERTEX_OFFSET_OFFSET);
	runtime.setGlobal('sys_geo_sat2_desc_reserved_offset', GEO_SAT2_DESC_RESERVED_OFFSET);
	runtime.setGlobal('sys_geo_sat2_result_bytes', GEO_SAT2_RESULT_BYTES);
	runtime.setGlobal('sys_geo_sat2_result_hit_offset', GEO_SAT2_RESULT_HIT_OFFSET);
	runtime.setGlobal('sys_geo_sat2_result_nx_offset', GEO_SAT2_RESULT_NX_OFFSET);
	runtime.setGlobal('sys_geo_sat2_result_ny_offset', GEO_SAT2_RESULT_NY_OFFSET);
	runtime.setGlobal('sys_geo_sat2_result_depth_offset', GEO_SAT2_RESULT_DEPTH_OFFSET);
	runtime.setGlobal('sys_geo_sat2_result_meta_offset', GEO_SAT2_RESULT_META_OFFSET);
	runtime.setGlobal('sys_geo_sat2_max_poly_vertices', GEO_SAT2_MAX_POLY_VERTICES);
	runtime.setGlobal('sys_geo_overlap_mode_candidate_pairs', GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS);
	runtime.setGlobal('sys_geo_overlap_mode_full_pass', GEO_OVERLAP2D_MODE_FULL_PASS);
	runtime.setGlobal('sys_geo_overlap_broadphase_none', GEO_OVERLAP2D_BROADPHASE_NONE);
	runtime.setGlobal('sys_geo_overlap_broadphase_local_bounds_aabb', GEO_OVERLAP2D_BROADPHASE_LOCAL_BOUNDS_AABB);
	runtime.setGlobal('sys_geo_overlap_contact_clipped_feature', GEO_OVERLAP2D_CONTACT_POLICY_CLIPPED_FEATURE);
	runtime.setGlobal('sys_geo_overlap_output_stop_on_overflow', GEO_OVERLAP2D_OUTPUT_POLICY_STOP_ON_OVERFLOW);
	runtime.setGlobal('sys_geo_overlap_max_poly_vertices', GEO_OVERLAP2D_MAX_POLY_VERTICES);
	runtime.setGlobal('sys_geo_overlap_max_clip_vertices', GEO_OVERLAP2D_MAX_CLIP_VERTICES);
	runtime.setGlobal('sys_geo_overlap_instance_bytes', GEO_OVERLAP2D_INSTANCE_BYTES);
	runtime.setGlobal('sys_geo_overlap_instance_shape_offset', GEO_OVERLAP2D_INSTANCE_SHAPE_OFFSET);
	runtime.setGlobal('sys_geo_overlap_instance_tx_offset', GEO_OVERLAP2D_INSTANCE_TX_OFFSET);
	runtime.setGlobal('sys_geo_overlap_instance_ty_offset', GEO_OVERLAP2D_INSTANCE_TY_OFFSET);
	runtime.setGlobal('sys_geo_overlap_instance_layer_offset', GEO_OVERLAP2D_INSTANCE_LAYER_OFFSET);
	runtime.setGlobal('sys_geo_overlap_instance_mask_offset', GEO_OVERLAP2D_INSTANCE_MASK_OFFSET);
	runtime.setGlobal('sys_geo_overlap_pair_bytes', GEO_OVERLAP2D_PAIR_BYTES);
	runtime.setGlobal('sys_geo_overlap_pair_instance_a_offset', GEO_OVERLAP2D_PAIR_INSTANCE_A_OFFSET);
	runtime.setGlobal('sys_geo_overlap_pair_instance_b_offset', GEO_OVERLAP2D_PAIR_INSTANCE_B_OFFSET);
	runtime.setGlobal('sys_geo_overlap_pair_meta_offset', GEO_OVERLAP2D_PAIR_META_OFFSET);
	runtime.setGlobal('sys_geo_overlap_result_bytes', GEO_OVERLAP2D_RESULT_BYTES);
	runtime.setGlobal('sys_geo_overlap_result_nx_offset', GEO_OVERLAP2D_RESULT_NX_OFFSET);
	runtime.setGlobal('sys_geo_overlap_result_ny_offset', GEO_OVERLAP2D_RESULT_NY_OFFSET);
	runtime.setGlobal('sys_geo_overlap_result_depth_offset', GEO_OVERLAP2D_RESULT_DEPTH_OFFSET);
	runtime.setGlobal('sys_geo_overlap_result_px_offset', GEO_OVERLAP2D_RESULT_PX_OFFSET);
	runtime.setGlobal('sys_geo_overlap_result_py_offset', GEO_OVERLAP2D_RESULT_PY_OFFSET);
	runtime.setGlobal('sys_geo_overlap_result_piece_a_offset', GEO_OVERLAP2D_RESULT_PIECE_A_OFFSET);
	runtime.setGlobal('sys_geo_overlap_result_piece_b_offset', GEO_OVERLAP2D_RESULT_PIECE_B_OFFSET);
	runtime.setGlobal('sys_geo_overlap_result_feature_meta_offset', GEO_OVERLAP2D_RESULT_FEATURE_META_OFFSET);
	runtime.setGlobal('sys_geo_overlap_result_pair_meta_offset', GEO_OVERLAP2D_RESULT_PAIR_META_OFFSET);
	runtime.setGlobal('sys_geo_overlap_summary_bytes', GEO_OVERLAP2D_SUMMARY_BYTES);
	runtime.setGlobal('sys_geo_overlap_summary_result_count_offset', GEO_OVERLAP2D_SUMMARY_RESULT_COUNT_OFFSET);
	runtime.setGlobal('sys_geo_overlap_summary_exact_pair_count_offset', GEO_OVERLAP2D_SUMMARY_EXACT_PAIR_COUNT_OFFSET);
	runtime.setGlobal('sys_geo_overlap_summary_broadphase_pair_count_offset', GEO_OVERLAP2D_SUMMARY_BROADPHASE_PAIR_COUNT_OFFSET);
	runtime.setGlobal('sys_geo_overlap_summary_flags_offset', GEO_OVERLAP2D_SUMMARY_FLAGS_OFFSET);
	runtime.setGlobal('sys_geo_overlap_summary_flag_overflow', GEO_OVERLAP2D_SUMMARY_FLAG_OVERFLOW);
	runtime.setGlobal('sys_geo_overlap_shape_desc_bytes', GEO_OVERLAP2D_SHAPE_DESC_BYTES);
	runtime.setGlobal('sys_geo_overlap_shape_kind_offset', GEO_OVERLAP2D_SHAPE_KIND_OFFSET);
	runtime.setGlobal('sys_geo_overlap_shape_kind_compound', GEO_OVERLAP2D_SHAPE_KIND_COMPOUND);
	runtime.setGlobal('sys_geo_overlap_shape_data_count_offset', GEO_OVERLAP2D_SHAPE_DATA_COUNT_OFFSET);
	runtime.setGlobal('sys_geo_overlap_shape_data_offset_offset', GEO_OVERLAP2D_SHAPE_DATA_OFFSET_OFFSET);
	runtime.setGlobal('sys_geo_overlap_shape_bounds_offset_offset', GEO_OVERLAP2D_SHAPE_BOUNDS_OFFSET_OFFSET);
	runtime.setGlobal('sys_geo_overlap_shape_bounds_bytes', GEO_OVERLAP2D_SHAPE_BOUNDS_BYTES);
	runtime.setGlobal('sys_geo_overlap_shape_bounds_left_offset', GEO_OVERLAP2D_SHAPE_BOUNDS_LEFT_OFFSET);
	runtime.setGlobal('sys_geo_overlap_shape_bounds_top_offset', GEO_OVERLAP2D_SHAPE_BOUNDS_TOP_OFFSET);
	runtime.setGlobal('sys_geo_overlap_shape_bounds_right_offset', GEO_OVERLAP2D_SHAPE_BOUNDS_RIGHT_OFFSET);
	runtime.setGlobal('sys_geo_overlap_shape_bounds_bottom_offset', GEO_OVERLAP2D_SHAPE_BOUNDS_BOTTOM_OFFSET);
	runtime.setGlobal('sys_geo_overlap_aabb_data_count', GEO_OVERLAP2D_AABB_DATA_COUNT);
	runtime.setGlobal('sys_geo_overlap_aabb_shape_bytes', GEO_OVERLAP2D_AABB_SHAPE_BYTES);
	runtime.setGlobal('sys_geo_overlap_pair_meta_instance_a_shift', GEO_OVERLAP2D_PAIR_META_INSTANCE_A_SHIFT);
	runtime.setGlobal('sys_geo_overlap_pair_meta_instance_a_mask', GEO_OVERLAP2D_PAIR_META_INSTANCE_A_MASK);
	runtime.setGlobal('sys_geo_overlap_pair_meta_instance_b_mask', GEO_OVERLAP2D_PAIR_META_INSTANCE_B_MASK);
	runtime.setGlobal('sys_geo_sat_meta_axis_mask', GEO_SAT_META_AXIS_MASK);
	runtime.setGlobal('sys_geo_sat_meta_shape_shift', GEO_SAT_META_SHAPE_SHIFT);
	runtime.setGlobal('sys_geo_sat_meta_shape_src', GEO_SAT_META_SHAPE_SRC);
	runtime.setGlobal('sys_geo_sat_meta_shape_aux', GEO_SAT_META_SHAPE_AUX);
	runtime.setGlobal('sys_geo_fault_aborted_by_host', GEO_FAULT_ABORTED_BY_HOST);
	runtime.setGlobal('sys_geo_fault_bad_record_alignment', GEO_FAULT_BAD_RECORD_ALIGNMENT);
	runtime.setGlobal('sys_geo_fault_bad_vertex_count', GEO_FAULT_BAD_VERTEX_COUNT);
	runtime.setGlobal('sys_geo_fault_src_range', GEO_FAULT_SRC_RANGE);
	runtime.setGlobal('sys_geo_fault_dst_range', GEO_FAULT_DST_RANGE);
	runtime.setGlobal('sys_geo_fault_descriptor_kind', GEO_FAULT_DESCRIPTOR_KIND);
	runtime.setGlobal('sys_geo_fault_numeric_overflow_internal', GEO_FAULT_NUMERIC_OVERFLOW_INTERNAL);
	runtime.setGlobal('sys_geo_fault_bad_record_flags', GEO_FAULT_BAD_RECORD_FLAGS);
	runtime.setGlobal('sys_geo_fault_result_capacity', GEO_FAULT_RESULT_CAPACITY);
	runtime.setGlobal('sys_geo_fault_code_shift', GEO_FAULT_CODE_SHIFT);
	runtime.setGlobal('sys_geo_fault_code_mask', GEO_FAULT_CODE_MASK);
	runtime.setGlobal('sys_geo_fault_record_index_mask', GEO_FAULT_RECORD_INDEX_MASK);
	runtime.setGlobal('sys_geo_fault_record_index_none', GEO_FAULT_RECORD_INDEX_NONE);
	runtime.setGlobal('sys_geo_fault_reject_busy', GEO_FAULT_REJECT_BUSY);
	runtime.setGlobal('sys_geo_fault_reject_bad_cmd', GEO_FAULT_REJECT_BAD_CMD);
	runtime.setGlobal('sys_geo_fault_reject_bad_stride', GEO_FAULT_REJECT_BAD_STRIDE);
	runtime.setGlobal('sys_geo_fault_reject_dst_not_ram', GEO_FAULT_REJECT_DST_NOT_RAM);
	runtime.setGlobal('sys_geo_fault_reject_misaligned_regs', GEO_FAULT_REJECT_MISALIGNED_REGS);
	runtime.setGlobal('sys_geo_fault_reject_bad_register_combo', GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
	runtime.setGlobal('img_ctrl_start', IMG_CTRL_START);
	runtime.setGlobal('img_status_busy', IMG_STATUS_BUSY);
	runtime.setGlobal('img_status_done', IMG_STATUS_DONE);
	runtime.setGlobal('img_status_error', IMG_STATUS_ERROR);
	runtime.setGlobal('img_status_clipped', IMG_STATUS_CLIPPED);
	runtime.setGlobal('img_status_rejected', IMG_STATUS_REJECTED);
	runtime.setGlobal('__bmsx_next', createBuiltinFunction(BuiltinFunctionId.Next));
	runtime.setGlobal('__bmsx_type', createBuiltinFunction(BuiltinFunctionId.Type));
	runtime.setGlobal('__bmsx_setmetatable', createBuiltinFunction(BuiltinFunctionId.SetMetatable));
	runtime.setGlobal('__bmsx_getmetatable', createBuiltinFunction(BuiltinFunctionId.GetMetatable));
	runtime.setGlobal('__bmsx_rawget', createBuiltinFunction(BuiltinFunctionId.RawGet));
	runtime.setGlobal('__bmsx_rawset', createBuiltinFunction(BuiltinFunctionId.RawSet));
	runtime.setGlobal('__bmsx_select', createBuiltinFunction(BuiltinFunctionId.Select));
	runtime.setGlobal('__bmsx_string_byte', createBuiltinFunction(BuiltinFunctionId.StringByte));
	runtime.setGlobal('__bmsx_string_char', createBuiltinFunction(BuiltinFunctionId.StringChar));
	runtime.setGlobal('__bmsx_error', createBuiltinFunction(BuiltinFunctionId.Error));
	runtime.setGlobal('__bmsx_pcall', createBuiltinFunction(BuiltinFunctionId.PCall));
	runtime.setGlobal('__bmsx_xpcall', createBuiltinFunction(BuiltinFunctionId.XPCall));

	const stringTable = new Table(0, 0);
	runtime.machine.cpu.stringIndexTable = stringTable;
	runtime.setGlobal('string', stringTable);

	const tableLibrary = new Table(0, 0);
	runtime.setGlobal('table', tableLibrary);

	const osTable = new Table(0, 0);
	runtime.setGlobal('os', osTable);

	exposeObjects();
}
