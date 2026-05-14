import { extractErrorMessage, type StackTraceFrame } from '../../lua/value';
import { clamp01 } from '../../common/clamp';
import {
	createNativeFunction,
	isTruthyValue,
	isNativeFunction,
	isNativeObject,
	Table,
	type Closure,
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
	VRAM_FRAMEBUFFER_BASE,
	VRAM_FRAMEBUFFER_SIZE,
	VRAM_PRIMARY_SLOT_BASE,
	VRAM_PRIMARY_SLOT_SIZE,
	VRAM_SECONDARY_SLOT_BASE,
	VRAM_SECONDARY_SLOT_SIZE,
	VRAM_STAGING_BASE,
	VRAM_STAGING_SIZE,
	VRAM_SYSTEM_SLOT_BASE,
	VRAM_SYSTEM_SLOT_SIZE,
} from '../memory/map';
import { CART_ROM_MAGIC, DEFAULT_GEO_WORK_UNITS_PER_SEC, DEFAULT_VDP_WORK_UNITS_PER_SEC, type CartManifest, type MachineManifest } from '../../rompack/format';
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
	GEO_PRIMITIVE_CIRCLE,
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
	GEO_STATUS_BUSY,
	GEO_STATUS_DONE,
	GEO_STATUS_ERROR,
	GEO_STATUS_REJECTED,
	IO_CMD_GEO_OVERLAP2D_PASS,
	IO_CMD_GEO_PROJECT3_BATCH,
	IO_CMD_GEO_SAT2_BATCH,
	IO_CMD_GEO_XFORM2_BATCH,
	IO_CMD_GEO_XFORM3_BATCH,
} from '../devices/geometry/contracts';
import {
	APU_COMMAND_FIFO_CAPACITY,
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
	BUS_FAULT_ACCESS_F32,
	BUS_FAULT_ACCESS_F64,
	BUS_FAULT_ACCESS_READ,
	BUS_FAULT_ACCESS_U8,
	BUS_FAULT_ACCESS_U16,
	BUS_FAULT_ACCESS_U32,
	BUS_FAULT_ACCESS_WORD,
	BUS_FAULT_ACCESS_WRITE,
	BUS_FAULT_NONE,
	BUS_FAULT_READ_ONLY,
	BUS_FAULT_UNALIGNED_IO,
	BUS_FAULT_UNMAPPED,
	BUS_FAULT_VRAM_RANGE,
	DMA_CTRL_START,
	DMA_CTRL_STRICT,
	DMA_STATUS_BUSY,
	DMA_STATUS_CLIPPED,
	DMA_STATUS_DONE,
	DMA_STATUS_ERROR,
	DMA_STATUS_REJECTED,
	HOST_FAULT_FLAG_ACTIVE,
	HOST_FAULT_FLAG_STARTUP_BLOCKING,
	HOST_FAULT_STAGE_NONE,
	HOST_FAULT_STAGE_STARTUP_AUDIO_REFRESH,
	IMG_CTRL_START,
	IMG_STATUS_BUSY,
	IMG_STATUS_CLIPPED,
	IMG_STATUS_DONE,
	IMG_STATUS_ERROR,
	IMG_STATUS_REJECTED,
	INP_CTRL_COMMIT,
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
	IO_INP_ACTION,
	IO_INP_BIND,
	IO_INP_CONSUME,
	IO_INP_CTRL,
	IO_INP_PLAYER,
	IO_INP_QUERY,
	IO_INP_STATUS,
	IO_INP_VALUE,
	IO_IRQ_ACK,
	IO_IRQ_FLAGS,
	IO_SYS_BUS_FAULT_ACCESS,
	IO_SYS_BUS_FAULT_ACK,
	IO_SYS_BUS_FAULT_ADDR,
	IO_SYS_BUS_FAULT_CODE,
	IO_SYS_BOOT_CART,
	IO_SYS_HOST_FAULT_FLAGS,
	IO_SYS_HOST_FAULT_STAGE,
	IO_VDP_DITHER,
	IO_VDP_FAULT_CODE,
	IO_VDP_FAULT_DETAIL,
	IO_VDP_FAULT_ACK,
	IO_VDP_SLOT_PRIMARY_ATLAS,
	IO_VDP_SLOT_SECONDARY_ATLAS,
	IO_VDP_CMD,
	IO_VDP_CMD_ARG_COUNT,
	IO_VDP_FIFO,
	IO_VDP_FIFO_CTRL,
	IO_VDP_PMU_BANK,
	IO_VDP_PMU_CTRL,
	IO_VDP_PMU_SCALE_X,
	IO_VDP_PMU_SCALE_Y,
	IO_VDP_PMU_X,
	IO_VDP_PMU_Y,
	IO_VDP_RD_DATA,
	IO_VDP_RD_MODE,
	IO_VDP_RD_STATUS,
	IO_VDP_RD_SURFACE,
	IO_VDP_RD_X,
	IO_VDP_RD_Y,
	IO_VDP_STATUS,
	IO_VDP_SBX_COMMIT,
	IO_VDP_SBX_CONTROL,
	IO_VDP_SBX_FACE0,
	IRQ_DMA_DONE,
	IRQ_DMA_ERROR,
	IRQ_APU,
	IRQ_GEO_DONE,
	IRQ_GEO_ERROR,
	IRQ_IMG_DONE,
	IRQ_IMG_ERROR,
	IRQ_NEWGAME,
	IRQ_REINIT,
	IRQ_VBLANK,
	VDP_FIFO_CTRL_SEAL,
	VDP_FAULT_NONE,
	VDP_FAULT_RD_OOB,
	VDP_FAULT_RD_SURFACE,
	VDP_FAULT_RD_UNSUPPORTED_MODE,
	VDP_FAULT_STREAM_BAD_PACKET,
	VDP_FAULT_SUBMIT_STATE,
	VDP_FAULT_CMD_BAD_DOORBELL,
	VDP_FAULT_SUBMIT_BUSY,
	VDP_FAULT_DEX_INVALID_LINE_WIDTH,
	VDP_FAULT_DEX_INVALID_SCALE,
	VDP_FAULT_DEX_SOURCE_OOB,
	VDP_FAULT_DEX_SOURCE_SLOT,
	VDP_FAULT_SBX_SOURCE_OOB,
	VDP_FAULT_BBU_OVERFLOW,
	VDP_FAULT_BBU_SOURCE_OOB,
	VDP_FAULT_BBU_ZERO_SIZE,
	VDP_FAULT_VRAM_SLOT_DIM,
	VDP_FAULT_VRAM_WRITE_OOB,
	VDP_FAULT_VRAM_WRITE_UNALIGNED,
	VDP_FAULT_VRAM_WRITE_UNINITIALIZED,
	VDP_FAULT_VRAM_WRITE_UNMAPPED,
	VDP_RD_MODE_RGBA8888,
	VDP_RD_STATUS_OVERFLOW,
	VDP_RD_STATUS_READY,
	VDP_SLOT_NONE,
	VDP_SLOT_ATLAS_NONE,
	VDP_SLOT_PRIMARY,
	VDP_SLOT_SECONDARY,
	VDP_SLOT_SYSTEM,
	VDP_STATUS_FAULT,
	VDP_STATUS_SUBMIT_BUSY,
	VDP_STATUS_SUBMIT_REJECTED,
	VDP_STATUS_VBLANK,
	VDP_SBX_COMMIT_WRITE,
} from '../bus/io';
import {
	buildMarshalContext,
	describeMarshalSegment,
	extendMarshalContext,
	getOrAssignTableId,
	getOrCreateNativeObject,
	nextNativeEntry,
	pushNativePairsIterator,
	toNativeValue,
	toRuntimeValue,
} from '../runtime/host/native_bridge';
import { buildLuaFrameRawLabel } from '../../lua/stack_frame_label';
import { asStringId, valueIsString, type StringValue } from '../cpu/cpu';
import type { StringPool } from '../cpu/string_pool';
import type { LuaMarshalContext } from '../runtime/contracts';
import type { Runtime } from '../runtime/runtime';
import * as luaPipeline from '../../ide/runtime/lua_pipeline';
import { callClosureInto } from '../program/executor';
import { compileLoadChunk } from '../program/load_compiler';
import { createRuntimeDevtoolsTable } from './devtools';


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
	const table = new Table(0, 5);
	if (manifest.namespace.length > 0) {
		table.set(runtime.internString('namespace'), runtime.internString(manifest.namespace));
	}
	if (manifest.ufps) {
		table.set(runtime.internString('ufps'), manifest.ufps);
	}
	if (manifest.render_size.width > 0 && manifest.render_size.height > 0) {
		const renderSize = new Table(0, 2);
		renderSize.set(runtime.internString('width'), manifest.render_size.width);
		renderSize.set(runtime.internString('height'), manifest.render_size.height);
		table.set(runtime.internString('render_size'), renderSize);
	}
	const specs = new Table(0, 5);
	const specCpu = manifest.specs.cpu;
	const cpu = new Table(0, 2);
	if (specCpu.cpu_freq_hz) {
		cpu.set(runtime.internString('cpu_freq_hz'), specCpu.cpu_freq_hz);
	}
	if (specCpu.imgdec_bytes_per_sec) {
		cpu.set(runtime.internString('imgdec_bytes_per_sec'), specCpu.imgdec_bytes_per_sec);
	}
	specs.set(runtime.internString('cpu'), cpu);
	const specDma = manifest.specs.dma;
	const dma = new Table(0, 2);
	if (specDma.dma_bytes_per_sec_iso) {
		dma.set(runtime.internString('dma_bytes_per_sec_iso'), specDma.dma_bytes_per_sec_iso);
	}
	if (specDma.dma_bytes_per_sec_bulk) {
		dma.set(runtime.internString('dma_bytes_per_sec_bulk'), specDma.dma_bytes_per_sec_bulk);
	}
	specs.set(runtime.internString('dma'), dma);
	const vdp = new Table(0, 1);
	vdp.set(runtime.internString('work_units_per_sec'), manifest.specs.vdp?.work_units_per_sec ?? DEFAULT_VDP_WORK_UNITS_PER_SEC);
	specs.set(runtime.internString('vdp'), vdp);
	const geo = new Table(0, 1);
	geo.set(runtime.internString('work_units_per_sec'), manifest.specs.geo?.work_units_per_sec ?? DEFAULT_GEO_WORK_UNITS_PER_SEC);
	specs.set(runtime.internString('geo'), geo);
	const ram = manifest.specs.ram;
	if (ram?.ram_bytes) {
		const ramTable = new Table(0, 1);
		ramTable.set(runtime.internString('ram_bytes'), ram.ram_bytes);
		specs.set(runtime.internString('ram'), ramTable);
	}
	const vram = manifest.specs.vram;
	if (vram && (vram.slot_bytes || vram.system_slot_bytes || vram.staging_bytes)) {
		const vramTable = new Table(0, 3);
		if (vram.slot_bytes) {
			vramTable.set(runtime.internString('slot_bytes'), vram.slot_bytes);
		}
		if (vram.system_slot_bytes) {
			vramTable.set(runtime.internString('system_slot_bytes'), vram.system_slot_bytes);
		}
		if (vram.staging_bytes) {
			vramTable.set(runtime.internString('staging_bytes'), vram.staging_bytes);
		}
		specs.set(runtime.internString('vram'), vramTable);
	}
	table.set(runtime.internString('specs'), specs);
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

class LuaThrownValueError extends Error {
	public readonly value: Value;

	public constructor(runtime: Runtime, value: Value) {
		super(valueToString(value, runtime.machine.cpu.stringPool));
		this.name = 'LuaThrownValueError';
		this.value = value;
	}
}

export function formatLuaString(runtime: Runtime, template: string, args: ReadonlyArray<Value>, argStart: number): string {
	let argumentIndex = argStart;
	let output = '';
	const stringPool = runtime.machine.cpu.stringPool;
	const formatStringArgument = (value: Value): string => value === null ? 'nil' : valueToString(value, stringPool);

	const takeArgument = (): Value => {
		const value = argumentIndex < args.length ? args[argumentIndex] : null;
		argumentIndex += 1;
		return value;
	};

	const readInteger = (startIndex: number): { found: boolean; value: number; nextIndex: number } => {
		let cursor = startIndex;
		while (cursor < template.length) {
			const code = template.charCodeAt(cursor);
			if (code < 48 || code > 57) {
				break;
			}
			cursor += 1;
		}
		if (cursor === startIndex) {
			return { found: false, value: 0, nextIndex: startIndex };
		}
		return { found: true, value: parseInt(template.slice(startIndex, cursor), 10), nextIndex: cursor };
	};

	for (let index = 0; index < template.length; index += 1) {
		const current = template.charAt(index);
		if (current !== '%') {
			output += current;
			continue;
		}
		if (index === template.length - 1) {
			throw runtime.createApiRuntimeError('string.format incomplete format specifier.');
		}
		if (template.charAt(index + 1) === '%') {
			output += '%';
			index += 1;
			continue;
		}

		let cursor = index + 1;
		const flags = { leftAlign: false, plus: false, space: false, zeroPad: false, alternate: false };
		while (true) {
			const flag = template.charAt(cursor);
			if (flag === '-') {
				flags.leftAlign = true;
				cursor += 1;
				continue;
			}
			if (flag === '+') {
				flags.plus = true;
				cursor += 1;
				continue;
			}
			if (flag === ' ') {
				flags.space = true;
				cursor += 1;
				continue;
			}
			if (flag === '0') {
				flags.zeroPad = true;
				cursor += 1;
				continue;
			}
			if (flag === '#') {
				flags.alternate = true;
				cursor += 1;
				continue;
			}
			break;
		}

		let width: number = null;
		if (template.charAt(cursor) === '*') {
			const widthArg = Math.trunc(takeArgument() as number);
			if (widthArg < 0) {
				flags.leftAlign = true;
				width = -widthArg;
			} else {
				width = widthArg;
			}
			cursor += 1;
		} else {
			const parsedWidth = readInteger(cursor);
			if (parsedWidth.found) {
				width = parsedWidth.value;
				cursor = parsedWidth.nextIndex;
			}
		}

		let precision: number = null;
		if (template.charAt(cursor) === '.') {
			cursor += 1;
			if (template.charAt(cursor) === '*') {
				const precisionArg = Math.trunc(takeArgument() as number);
				precision = precisionArg >= 0 ? precisionArg : null;
				cursor += 1;
			} else {
				const parsedPrecision = readInteger(cursor);
				precision = parsedPrecision.found ? parsedPrecision.value : 0;
				cursor = parsedPrecision.nextIndex;
			}
		}

		while (template.charAt(cursor) === 'l' || template.charAt(cursor) === 'L' || template.charAt(cursor) === 'h') {
			cursor += 1;
		}

		const specifier = template.charAt(cursor);
		if (specifier.length === 0) {
			throw runtime.createApiRuntimeError('string.format incomplete format specifier.');
		}
		const zeroPad = flags.zeroPad && !flags.leftAlign;

		const signPrefix = (value: number): string => {
			if (value < 0) {
				return '-';
			}
			if (flags.plus) {
				return '+';
			}
			if (flags.space) {
				return ' ';
			}
			return '';
		};

		const applyPadding = (content: string, sign: string, prefix: string, allowZeroPadding: boolean): string => {
			const totalLength = sign.length + prefix.length + content.length;
			if (width !== null && totalLength < width) {
				const paddingLength = width - totalLength;
				if (flags.leftAlign) {
					return `${sign}${prefix}${content}${' '.repeat(paddingLength)}`;
				}
				const padChar = allowZeroPadding ? '0' : ' ';
				if (padChar === '0') {
					return `${sign}${prefix}${'0'.repeat(paddingLength)}${content}`;
				}
				return `${' '.repeat(paddingLength)}${sign}${prefix}${content}`;
			}
			return `${sign}${prefix}${content}`;
		};

		switch (specifier) {
			case 's': {
				const value = takeArgument();
					let text = formatStringArgument(value);
				if (precision !== null) {
					text = text.substring(0, precision);
				}
				output += applyPadding(text, '', '', false);
				break;
			}
			case 'c': {
				const value = takeArgument() as number;
				const character = String.fromCharCode(Math.trunc(value));
				output += applyPadding(character, '', '', false);
				break;
			}
			case 'd':
			case 'i':
			case 'u':
			case 'o':
			case 'x':
			case 'X': {
				let number = takeArgument() as number;
				let integerValue = Math.trunc(number);
				let unsigned = false;
				switch (specifier) {
					case 'u':
					case 'o':
					case 'x':
					case 'X':
						unsigned = true;
						break;
				}
				if (unsigned) {
					integerValue = integerValue >>> 0;
				}
				const negative = !unsigned && integerValue < 0;
				let sign = negative ? '-' : '';
				switch (specifier) {
					case 'd':
					case 'i':
						sign = negative ? '-' : signPrefix(integerValue);
						break;
				}
				const magnitude = negative ? -integerValue : integerValue;
				let base = 10;
				switch (specifier) {
					case 'o':
						base = 8;
						break;
					case 'x':
					case 'X':
						base = 16;
						break;
				}
				let digits = Math.trunc(magnitude).toString(base);
				if (specifier === 'X') {
					digits = digits.toUpperCase();
				}
				if (precision !== null) {
					const required = Math.max(precision, 0);
					if (digits.length < required) {
						digits = '0'.repeat(required - digits.length) + digits;
					}
					if (precision === 0 && magnitude === 0) {
						digits = '';
					}
				}
				let prefix = '';
				if (flags.alternate) {
					if ((specifier === 'x' || specifier === 'X') && magnitude !== 0) {
						prefix = specifier === 'x' ? '0x' : '0X';
					}
					if (specifier === 'o') {
						if (digits.length === 0) {
							digits = '0';
						} else if (digits.charAt(0) !== '0') {
							digits = `0${digits}`;
						}
					}
				}
				const allowZeroPad = zeroPad && precision === null;
				output += applyPadding(digits, sign, prefix, allowZeroPad);
				break;
			}
			case 'f':
			case 'F': {
				const number = takeArgument() as number;
				const sign = signPrefix(number);
				const fractionDigits = precision !== null ? Math.max(0, precision) : 6;
				const text = Math.abs(number).toFixed(fractionDigits);
				const formatted = flags.alternate && fractionDigits === 0 && text.indexOf('.') === -1 ? `${text}.` : text;
				output += applyPadding(formatted, sign, '', zeroPad);
				break;
			}
			case 'e':
			case 'E': {
				const number = takeArgument() as number;
				const sign = signPrefix(number);
				const fractionDigits = precision !== null ? Math.max(0, precision) : 6;
				let text = Math.abs(number).toExponential(fractionDigits);
				if (specifier === 'E') {
					text = text.toUpperCase();
				}
				output += applyPadding(text, sign, '', zeroPad);
				break;
			}
			case 'g':
			case 'G': {
				const number = takeArgument() as number;
				const sign = signPrefix(number);
				const significant = precision === null ? 6 : precision === 0 ? 1 : precision;
				let text = Math.abs(number).toPrecision(significant);
				if (!flags.alternate) {
					if (text.indexOf('e') !== -1 || text.indexOf('E') !== -1) {
						const parts = text.split(/e/i);
						let mantissa = parts[0];
						const exponent = parts[1];
						if (mantissa.indexOf('.') !== -1) {
							while (mantissa.endsWith('0')) {
								mantissa = mantissa.slice(0, -1);
							}
							if (mantissa.endsWith('.')) {
								mantissa = mantissa.slice(0, -1);
							}
						}
						text = `${mantissa}e${exponent}`;
					} else if (text.indexOf('.') !== -1) {
						while (text.endsWith('0')) {
							text = text.slice(0, -1);
						}
						if (text.endsWith('.')) {
							text = text.slice(0, -1);
						}
					}
				}
				if (specifier === 'G') {
					text = text.toUpperCase();
				}
				output += applyPadding(text, sign, '', zeroPad);
				break;
			}
			case 'q': {
				const value = takeArgument();
				const raw = formatStringArgument(value);
				let escaped = '"';
				for (let charIndex = 0; charIndex < raw.length; charIndex += 1) {
					const code = raw.charCodeAt(charIndex);
					switch (code) {
						case 10:
							escaped += '\\n';
							break;
						case 13:
							escaped += '\\r';
							break;
						case 9:
							escaped += '\\t';
							break;
						case 92:
							escaped += '\\\\';
							break;
						case 34:
							escaped += '\\"';
							break;
						default:
							if (code < 32 || code === 127) {
								const decimal = code.toString(10);
								escaped += `\\${decimal.padStart(3, '0')}`;
							} else {
								escaped += raw.charAt(charIndex);
							}
							break;
					}
				}
				escaped += '"';
				output += applyPadding(escaped, '', '', false);
				break;
			}
			default:
				throw runtime.createApiRuntimeError(`string.format unsupported format specifier '%${specifier}'.`);
		}

		index = cursor;
	}

	return output;
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

function normalizeLuaIndex(valueNumber: number, length: number, zeroFallback: number): number {
	const integer = Math.floor(valueNumber);
	if (integer > 0) {
		return integer;
	}
	if (integer < 0) {
		return length + integer + 1;
	}
	return zeroFallback;
}

export function seedLuaGlobals(runtime: Runtime): void {
	const strings = runtime.machine.cpu.stringPool;
	const prependValue = (out: Value[], value: Value): void => {
		const length = out.length;
		out.length = length + 1;
		for (let index = length; index > 0; index -= 1) {
			out[index] = out[index - 1];
		}
		out[0] = value;
	};
	const callClosureValue = (callee: Value, args: Value[], out: Value[]): void => {
		if (isNativeFunction(callee)) {
			callee.invoke(args, out);
			return;
		}
		callClosureInto(runtime, callee as Closure, args, out);
	};
	const key = (name: string): StringValue => runtime.internString(name);
	const setKey = (table: Table, name: string, value: Value): void => {
		table.set(key(name), value);
	};
	const smoothstep01 = (value: number): number => {
		const x = clamp01(value);
		return x * x * (3 - (2 * x));
	};
	const pingpong01 = (value: number): number => {
		const p = ((value % 2) + 2) % 2;
		return p < 1 ? p : (2 - p);
	};
	const maxSafeInteger = 9007199254740991;
	const radToDeg = 180 / Math.PI;
	const degToRad = Math.PI / 180;

	const typeOfValue = (value: Value): StringValue => {
		if (value === null) {
			return runtime.internString('nil');
		}
		if (typeof value === 'boolean') {
			return runtime.internString('boolean');
		}
		if (typeof value === 'number') {
			return runtime.internString('number');
		}
		if (valueIsString(value)) {
			return runtime.internString('string');
		}
		if (value instanceof Table) {
			return runtime.internString('table');
		}
		if (isNativeFunction(value)) {
			return runtime.internString('function');
		}
		if (isNativeObject(value)) {
			return runtime.internString('native');
		}
		return runtime.internString('function');
	};

	const translateLuaPatternEscape = (token: string, inClass: boolean): string => {
		switch (token) {
			case 'a':
				return inClass ? 'A-Za-z' : '[A-Za-z]';
			case 'd':
				return inClass ? '0-9' : '\\d';
			case 'l':
				return inClass ? 'a-z' : '[a-z]';
			case 'u':
				return inClass ? 'A-Z' : '[A-Z]';
			case 'w':
				return inClass ? 'A-Za-z0-9_' : '[A-Za-z0-9_]';
			case 'x':
				return inClass ? 'A-Fa-f0-9' : '[A-Fa-f0-9]';
			case 'z':
				return '\\x00';
			case 'c':
				return inClass ? '\\x00-\\x1F\\x7F' : '[\\x00-\\x1F\\x7F]';
			case 'g':
				return inClass ? '\\x21-\\x7E' : '[\\x21-\\x7E]';
			case 's':
				return '\\s';
			case 'p': {
				const punctuation = '!\"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';
				const escaped = punctuation.replace(/[\\\-\]]/g, '\\$&');
				return inClass ? escaped : `[${escaped}]`;
			}
			case '%':
				return '%';
			default:
				return `\\${token}`;
		}
	};

	const buildLuaPatternRegexSource = (pattern: string): string => {
		let output = '';
		let inClass = false;
		for (let index = 0; index < pattern.length; index += 1) {
			const ch = pattern.charAt(index);
			if (inClass) {
				if (ch === ']') {
					inClass = false;
					output += ']';
					continue;
				}
				if (ch === '%') {
					index += 1;
					if (index >= pattern.length) {
						throw runtime.createApiRuntimeError('string.gmatch invalid pattern.');
					}
					output += translateLuaPatternEscape(pattern.charAt(index), true);
					continue;
				}
				if (ch === '\\') {
					output += '\\\\';
					continue;
				}
				output += ch;
				continue;
			}
			if (ch === '[') {
				inClass = true;
				output += '[';
				continue;
			}
			if (ch === '%') {
				index += 1;
				if (index >= pattern.length) {
					throw runtime.createApiRuntimeError('string.gmatch invalid pattern.');
				}
				output += translateLuaPatternEscape(pattern.charAt(index), false);
				continue;
			}
			if (ch === '-') {
				output += '*?';
				continue;
			}
			if (ch === '^') {
				output += index === 0 ? '^' : '\\^';
				continue;
			}
			if (ch === '$') {
				output += index === pattern.length - 1 ? '$' : '\\$';
				continue;
			}
			switch (ch) {
				case '(':
				case ')':
				case '.':
				case '+':
				case '*':
				case '?':
					output += ch;
					continue;
				case '|':
				case '{':
				case '}':
				case '\\':
					output += `\\${ch}`;
					continue;
			}
			output += ch;
		}
		if (inClass) {
			throw runtime.createApiRuntimeError('string.gmatch invalid pattern.');
		}
		return output;
	};

	const getLuaPatternRegex = (pattern: string): RegExp => {
		const cached = runtime.luaPatternRegexCache.get(pattern);
		if (cached) {
			return cached;
		}
		const source = buildLuaPatternRegexSource(pattern);
		const regex = new RegExp(source);
		runtime.luaPatternRegexCache.set(pattern, regex);
		return regex;
	};

	const createNativeArrayFromTable = (table: Table, context: LuaMarshalContext): unknown[] => {
		const tableId = getOrAssignTableId(runtime, table);
		const tableContext = extendMarshalContext(context, `table${tableId}`);
		const output: unknown[] = [];
		const visited = runtime.luaScratch.tableMarshal.acquire();
		try {
			table.forEachEntry((keyValue, value) => {
				if (typeof keyValue === 'number' && Number.isInteger(keyValue) && keyValue >= 1) {
					output[keyValue - 1] = toNativeValue(runtime, value, extendMarshalContext(tableContext, String(keyValue)), visited);
					return;
				}
				const segment = describeMarshalSegment(runtime, keyValue);
				const nextContext = segment ? extendMarshalContext(tableContext, segment) : tableContext;
				output.push(toNativeValue(runtime, value, nextContext, visited));
			});
			return output;
		} finally {
			runtime.luaScratch.tableMarshal.release(visited);
		}
	};

	const exposeObjects = (): void => {
		luaPipeline.registerGlobal(runtime, 'devtools', createRuntimeDevtoolsTable(runtime));
		const cartManifest = runtime.cartManifest;
		luaPipeline.registerGlobal(runtime, 'cart_manifest', cartManifest === null ? null : buildCartManifestTable(runtime, cartManifest, cartManifest.machine, cartManifest.lua.entry_path));
		luaPipeline.registerGlobal(runtime, 'machine_manifest', buildMachineManifestTable(runtime, runtime.activeMachineManifest));
		luaPipeline.registerGlobal(runtime, 'cart_project_root_path', runtime.cartProjectRootPath === null ? null : runtime.internString(runtime.cartProjectRootPath));
	};

	const mathTable = new Table(0, 0);
	setKey(mathTable, 'abs', createNativeFunction('math.abs', (args, out) => {
		const value = args[0] as number;
		out.push(Math.abs(value));
	}));
	setKey(mathTable, 'acos', createNativeFunction('math.acos', (args, out) => {
		out.push(Math.acos(args[0] as number));
	}));
	setKey(mathTable, 'asin', createNativeFunction('math.asin', (args, out) => {
		out.push(Math.asin(args[0] as number));
	}));
	setKey(mathTable, 'atan', createNativeFunction('math.atan', (args, out) => {
		const y = args[0] as number;
		if (args.length > 1) {
			out.push(Math.atan2(y, args[1] as number));
			return;
		}
		out.push(Math.atan(y));
	}));
	setKey(mathTable, 'ceil', createNativeFunction('math.ceil', (args, out) => {
		const value = args[0] as number;
		out.push(Math.ceil(value));
	}));
	setKey(mathTable, 'cos', createNativeFunction('math.cos', (args, out) => {
		out.push(Math.cos(args[0] as number));
	}));
	setKey(mathTable, 'deg', createNativeFunction('math.deg', (args, out) => {
		out.push((args[0] as number) * radToDeg);
	}));
	setKey(mathTable, 'exp', createNativeFunction('math.exp', (args, out) => {
		out.push(Math.exp(args[0] as number));
	}));
	setKey(mathTable, 'floor', createNativeFunction('math.floor', (args, out) => {
		const value = args[0] as number;
		out.push(Math.floor(value));
	}));
	setKey(mathTable, 'fmod', createNativeFunction('math.fmod', (args, out) => {
		out.push((args[0] as number) % (args[1] as number));
	}));
	setKey(mathTable, 'log', createNativeFunction('math.log', (args, out) => {
		const value = args[0] as number;
		if (args.length > 1) {
			const base = args[1] as number;
			out.push(Math.log(value) / Math.log(base));
			return;
		}
		out.push(Math.log(value));
	}));
	setKey(mathTable, 'max', createNativeFunction('math.max', (args, out) => {
		let result = args[0] as number;
		for (let index = 1; index < args.length; index += 1) {
			const value = args[index] as number;
			if (value > result) {
				result = value;
			}
		}
		out.push(result);
	}));
	setKey(mathTable, 'min', createNativeFunction('math.min', (args, out) => {
		let result = args[0] as number;
		for (let index = 1; index < args.length; index += 1) {
			const value = args[index] as number;
			if (value < result) {
				result = value;
			}
		}
		out.push(result);
	}));
	setKey(mathTable, 'modf', createNativeFunction('math.modf', (args, out) => {
		const value = args[0] as number;
		const intPart = Math.trunc(value);
		out.push(intPart, value - intPart);
	}));
	setKey(mathTable, 'rad', createNativeFunction('math.rad', (args, out) => {
		out.push((args[0] as number) * degToRad);
	}));
	setKey(mathTable, 'sin', createNativeFunction('math.sin', (args, out) => {
		out.push(Math.sin(args[0] as number));
	}));
	setKey(mathTable, 'sign', createNativeFunction('math.sign', (args, out) => {
		const value = args[0] as number;
		if (value < 0) {
			out.push(-1);
			return;
		}
		if (value > 0) {
			out.push(1);
			return;
		}
		out.push(0);
	}));
	setKey(mathTable, 'sqrt', createNativeFunction('math.sqrt', (args, out) => {
		const value = args[0] as number;
		out.push(Math.sqrt(value));
	}));
	setKey(mathTable, 'tan', createNativeFunction('math.tan', (args, out) => {
		out.push(Math.tan(args[0] as number));
	}));
	setKey(mathTable, 'tointeger', createNativeFunction('math.tointeger', (args, out) => {
		const value = args.length > 0 ? args[0] : null;
		if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
			out.push(null);
			return;
		}
		out.push(value);
	}));
	setKey(mathTable, 'type', createNativeFunction('math.type', (args, out) => {
		const value = args.length > 0 ? args[0] : null;
		if (typeof value !== 'number') {
			out.push(null);
			return;
		}
		if (Number.isInteger(value)) {
			out.push(runtime.internString('integer'));
			return;
		}
		out.push(runtime.internString('float'));
	}));
	setKey(mathTable, 'ult', createNativeFunction('math.ult', (args, out) => {
		const left = (args[0] as number) >>> 0;
		const right = (args[1] as number) >>> 0;
		out.push(left < right);
	}));
	setKey(mathTable, 'random', createNativeFunction('math.random', (args, out) => {
		const randomValue = luaPipeline.nextRandom(runtime);
		if (args.length === 0) {
			out.push(randomValue);
			return;
		}
		if (args.length === 1) {
			const upper = Math.floor(args[0] as number);
			if (upper < 1) {
				throw runtime.createApiRuntimeError('math.random upper bound must be positive.');
			}
			out.push(Math.floor(randomValue * upper) + 1);
			return;
		}
		const lower = Math.floor(args[0] as number);
		const upper = Math.floor(args[1] as number);
		if (upper < lower) {
			throw runtime.createApiRuntimeError('math.random upper bound must be greater than or equal to lower bound.');
		}
		const span = upper - lower + 1;
		out.push(lower + Math.floor(randomValue * span));
	}));
	setKey(mathTable, 'randomseed', createNativeFunction('math.randomseed', (args, out) => {
		const seedValue = args.length > 0 ? (args[0] as number) : runtime.clock.now();
		runtime.randomSeedValue = Math.floor(seedValue) >>> 0;
		out.length = 0;
	}));
	setKey(mathTable, 'huge', Number.POSITIVE_INFINITY);
	setKey(mathTable, 'maxinteger', maxSafeInteger);
	setKey(mathTable, 'mininteger', -maxSafeInteger);
	setKey(mathTable, 'pi', Math.PI);

	const easingTable = new Table(0, 0);
	setKey(easingTable, 'linear', createNativeFunction('easing.linear', (args, out) => {
		out.push(clamp01(args[0] as number));
	}));
	setKey(easingTable, 'ease_in_quad', createNativeFunction('easing.ease_in_quad', (args, out) => {
		const x = clamp01(args[0] as number);
		out.push(x * x);
	}));
	setKey(easingTable, 'ease_out_quad', createNativeFunction('easing.ease_out_quad', (args, out) => {
		const x = clamp01(1 - (args[0] as number));
		out.push(1 - (x * x));
	}));
	setKey(easingTable, 'ease_in_out_quad', createNativeFunction('easing.ease_in_out_quad', (args, out) => {
		const x = clamp01(args[0] as number);
		if (x < 0.5) {
			out.push(2 * x * x);
			return;
		}
		const y = (-2 * x) + 2;
		out.push(1 - ((y * y) / 2));
	}));
	setKey(easingTable, 'ease_out_back', createNativeFunction('easing.ease_out_back', (args, out) => {
		const x = clamp01(args[0] as number);
		const c1 = 1.70158;
		const c3 = c1 + 1;
		out.push(1 + (c3 * Math.pow(x - 1, 3)) + (c1 * Math.pow(x - 1, 2)));
	}));
	setKey(easingTable, 'smoothstep', createNativeFunction('easing.smoothstep', (args, out) => {
		out.push(smoothstep01(args[0] as number));
	}));
	setKey(easingTable, 'pingpong01', createNativeFunction('easing.pingpong01', (args, out) => {
		out.push(pingpong01(args[0] as number));
	}));
	setKey(easingTable, 'arc01', createNativeFunction('easing.arc01', (args, out) => {
		const value = args[0] as number;
		if (value <= 0.5) {
			out.push(smoothstep01(value * 2));
			return;
		}
		out.push(smoothstep01((1 - value) * 2));
	}));

	luaPipeline.registerGlobal(runtime, 'math', mathTable);
	luaPipeline.registerGlobal(runtime, 'easing', easingTable);
	luaPipeline.registerGlobal(runtime, 'sys_boot_cart', IO_SYS_BOOT_CART);
	luaPipeline.registerGlobal(runtime, 'sys_bus_fault_code', IO_SYS_BUS_FAULT_CODE);
	luaPipeline.registerGlobal(runtime, 'sys_bus_fault_addr', IO_SYS_BUS_FAULT_ADDR);
	luaPipeline.registerGlobal(runtime, 'sys_bus_fault_access', IO_SYS_BUS_FAULT_ACCESS);
	luaPipeline.registerGlobal(runtime, 'sys_bus_fault_ack', IO_SYS_BUS_FAULT_ACK);
	luaPipeline.registerGlobal(runtime, 'sys_bus_fault_none', BUS_FAULT_NONE);
	luaPipeline.registerGlobal(runtime, 'sys_bus_fault_unmapped', BUS_FAULT_UNMAPPED);
	luaPipeline.registerGlobal(runtime, 'sys_bus_fault_unaligned_io', BUS_FAULT_UNALIGNED_IO);
	luaPipeline.registerGlobal(runtime, 'sys_bus_fault_read_only', BUS_FAULT_READ_ONLY);
	luaPipeline.registerGlobal(runtime, 'sys_bus_fault_vram_range', BUS_FAULT_VRAM_RANGE);
	luaPipeline.registerGlobal(runtime, 'sys_bus_fault_access_read', BUS_FAULT_ACCESS_READ);
	luaPipeline.registerGlobal(runtime, 'sys_bus_fault_access_write', BUS_FAULT_ACCESS_WRITE);
	luaPipeline.registerGlobal(runtime, 'sys_bus_fault_access_u8', BUS_FAULT_ACCESS_U8);
	luaPipeline.registerGlobal(runtime, 'sys_bus_fault_access_u16', BUS_FAULT_ACCESS_U16);
	luaPipeline.registerGlobal(runtime, 'sys_bus_fault_access_u32', BUS_FAULT_ACCESS_U32);
	luaPipeline.registerGlobal(runtime, 'sys_bus_fault_access_word', BUS_FAULT_ACCESS_WORD);
	luaPipeline.registerGlobal(runtime, 'sys_bus_fault_access_f32', BUS_FAULT_ACCESS_F32);
	luaPipeline.registerGlobal(runtime, 'sys_bus_fault_access_f64', BUS_FAULT_ACCESS_F64);
	luaPipeline.registerGlobal(runtime, 'sys_host_fault_flags', IO_SYS_HOST_FAULT_FLAGS);
	luaPipeline.registerGlobal(runtime, 'sys_host_fault_stage', IO_SYS_HOST_FAULT_STAGE);
	luaPipeline.registerGlobal(runtime, 'sys_host_fault_flag_active', HOST_FAULT_FLAG_ACTIVE);
	luaPipeline.registerGlobal(runtime, 'sys_host_fault_flag_startup_blocking', HOST_FAULT_FLAG_STARTUP_BLOCKING);
	luaPipeline.registerGlobal(runtime, 'sys_host_fault_stage_none', HOST_FAULT_STAGE_NONE);
	luaPipeline.registerGlobal(runtime, 'sys_host_fault_stage_startup_refresh', HOST_FAULT_STAGE_STARTUP_AUDIO_REFRESH);
	luaPipeline.registerGlobal(runtime, 'sys_host_fault_message', createNativeFunction('sys_host_fault_message', (_args, out) => {
		const message = runtime.hostFault.getMessage();
		out.push(message === null ? null : runtime.internString(message));
	}));
	luaPipeline.registerGlobal(runtime, 'sys_cart_magic_addr', CART_ROM_MAGIC_ADDR);
	luaPipeline.registerGlobal(runtime, 'sys_cart_magic', CART_ROM_MAGIC);
	luaPipeline.registerGlobal(runtime, 'sys_cart_rom_size', CART_ROM_SIZE);
	luaPipeline.registerGlobal(runtime, 'sys_ram_size', RAM_SIZE);
	luaPipeline.registerGlobal(runtime, 'sys_geo_scratch_base', GEO_SCRATCH_BASE);
	luaPipeline.registerGlobal(runtime, 'sys_geo_scratch_size', GEO_SCRATCH_SIZE);
	luaPipeline.registerGlobal(runtime, 'sys_max_cycles_per_frame', runtime.timing.cycleBudgetPerFrame);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_dither', IO_VDP_DITHER);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_slot_primary_atlas', IO_VDP_SLOT_PRIMARY_ATLAS);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_slot_secondary_atlas', IO_VDP_SLOT_SECONDARY_ATLAS);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_atlas_none', VDP_SLOT_ATLAS_NONE);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_cmd', IO_VDP_CMD);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_cmd_arg_count', IO_VDP_CMD_ARG_COUNT);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_stream_base', VDP_STREAM_BUFFER_BASE);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_stream_capacity', VDP_STREAM_CAPACITY_WORDS);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_fifo', IO_VDP_FIFO);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_fifo_ctrl', IO_VDP_FIFO_CTRL);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_fifo_ctrl_seal', VDP_FIFO_CTRL_SEAL);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_pmu_bank', IO_VDP_PMU_BANK);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_pmu_x', IO_VDP_PMU_X);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_pmu_y', IO_VDP_PMU_Y);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_pmu_scale_x', IO_VDP_PMU_SCALE_X);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_pmu_scale_y', IO_VDP_PMU_SCALE_Y);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_pmu_ctrl', IO_VDP_PMU_CTRL);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_sbx_control', IO_VDP_SBX_CONTROL);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_sbx_faces', IO_VDP_SBX_FACE0);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_sbx_commit', IO_VDP_SBX_COMMIT);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_sbx_commit_write', VDP_SBX_COMMIT_WRITE);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_slot_primary', VDP_SLOT_PRIMARY);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_slot_secondary', VDP_SLOT_SECONDARY);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_slot_system', VDP_SLOT_SYSTEM);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_slot_none', VDP_SLOT_NONE);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_rd_surface', IO_VDP_RD_SURFACE);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_rd_x', IO_VDP_RD_X);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_rd_y', IO_VDP_RD_Y);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_rd_mode', IO_VDP_RD_MODE);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_rd_status', IO_VDP_RD_STATUS);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_rd_data', IO_VDP_RD_DATA);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_status', IO_VDP_STATUS);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_fault_code', IO_VDP_FAULT_CODE);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_fault_detail', IO_VDP_FAULT_DETAIL);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_fault_ack', IO_VDP_FAULT_ACK);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_rd_mode_rgba8888', VDP_RD_MODE_RGBA8888);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_rd_status_ready', VDP_RD_STATUS_READY);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_rd_status_overflow', VDP_RD_STATUS_OVERFLOW);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_status_vblank', VDP_STATUS_VBLANK);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_status_submit_busy', VDP_STATUS_SUBMIT_BUSY);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_status_submit_rejected', VDP_STATUS_SUBMIT_REJECTED);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_status_fault', VDP_STATUS_FAULT);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_fault_none', VDP_FAULT_NONE);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_fault_rd_unsupported_mode', VDP_FAULT_RD_UNSUPPORTED_MODE);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_fault_rd_surface', VDP_FAULT_RD_SURFACE);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_fault_rd_oob', VDP_FAULT_RD_OOB);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_fault_vram_write_unmapped', VDP_FAULT_VRAM_WRITE_UNMAPPED);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_fault_vram_write_uninitialized', VDP_FAULT_VRAM_WRITE_UNINITIALIZED);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_fault_vram_write_oob', VDP_FAULT_VRAM_WRITE_OOB);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_fault_vram_write_unaligned', VDP_FAULT_VRAM_WRITE_UNALIGNED);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_fault_vram_slot_dim', VDP_FAULT_VRAM_SLOT_DIM);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_fault_stream_bad_packet', VDP_FAULT_STREAM_BAD_PACKET);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_fault_submit_state', VDP_FAULT_SUBMIT_STATE);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_fault_cmd_bad_doorbell', VDP_FAULT_CMD_BAD_DOORBELL);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_fault_submit_busy', VDP_FAULT_SUBMIT_BUSY);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_fault_dex_invalid_scale', VDP_FAULT_DEX_INVALID_SCALE);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_fault_dex_invalid_line_width', VDP_FAULT_DEX_INVALID_LINE_WIDTH);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_fault_dex_source_slot', VDP_FAULT_DEX_SOURCE_SLOT);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_fault_dex_source_oob', VDP_FAULT_DEX_SOURCE_OOB);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_fault_sbx_source_oob', VDP_FAULT_SBX_SOURCE_OOB);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_fault_bbu_zero_size', VDP_FAULT_BBU_ZERO_SIZE);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_fault_bbu_overflow', VDP_FAULT_BBU_OVERFLOW);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_fault_bbu_source_oob', VDP_FAULT_BBU_SOURCE_OOB);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_layer_world', 0);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_layer_ui', 1);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_layer_ide', 2);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_arg_stride', IO_ARG_STRIDE);
	luaPipeline.registerGlobal(runtime, 'sys_irq_flags', IO_IRQ_FLAGS);
	luaPipeline.registerGlobal(runtime, 'sys_irq_ack', IO_IRQ_ACK);
	luaPipeline.registerGlobal(runtime, 'sys_dma_src', IO_DMA_SRC);
	luaPipeline.registerGlobal(runtime, 'sys_dma_dst', IO_DMA_DST);
	luaPipeline.registerGlobal(runtime, 'sys_dma_len', IO_DMA_LEN);
	luaPipeline.registerGlobal(runtime, 'sys_dma_ctrl', IO_DMA_CTRL);
	luaPipeline.registerGlobal(runtime, 'sys_dma_status', IO_DMA_STATUS);
	luaPipeline.registerGlobal(runtime, 'sys_dma_written', IO_DMA_WRITTEN);
	luaPipeline.registerGlobal(runtime, 'sys_geo_src0', IO_GEO_SRC0);
	luaPipeline.registerGlobal(runtime, 'sys_geo_src1', IO_GEO_SRC1);
	luaPipeline.registerGlobal(runtime, 'sys_geo_src2', IO_GEO_SRC2);
	luaPipeline.registerGlobal(runtime, 'sys_geo_dst0', IO_GEO_DST0);
	luaPipeline.registerGlobal(runtime, 'sys_geo_dst1', IO_GEO_DST1);
	luaPipeline.registerGlobal(runtime, 'sys_geo_count', IO_GEO_COUNT);
	luaPipeline.registerGlobal(runtime, 'sys_geo_cmd', IO_GEO_CMD);
	luaPipeline.registerGlobal(runtime, 'sys_geo_ctrl', IO_GEO_CTRL);
	luaPipeline.registerGlobal(runtime, 'sys_geo_status', IO_GEO_STATUS);
	luaPipeline.registerGlobal(runtime, 'sys_geo_param0', IO_GEO_PARAM0);
	luaPipeline.registerGlobal(runtime, 'sys_geo_param1', IO_GEO_PARAM1);
	luaPipeline.registerGlobal(runtime, 'sys_geo_stride0', IO_GEO_STRIDE0);
	luaPipeline.registerGlobal(runtime, 'sys_geo_stride1', IO_GEO_STRIDE1);
	luaPipeline.registerGlobal(runtime, 'sys_geo_stride2', IO_GEO_STRIDE2);
	luaPipeline.registerGlobal(runtime, 'sys_geo_processed', IO_GEO_PROCESSED);
	luaPipeline.registerGlobal(runtime, 'sys_geo_fault', IO_GEO_FAULT);
	luaPipeline.registerGlobal(runtime, 'sys_geo_fault_ack', IO_GEO_FAULT_ACK);
	luaPipeline.registerGlobal(runtime, 'sys_img_src', IO_IMG_SRC);
	luaPipeline.registerGlobal(runtime, 'sys_img_len', IO_IMG_LEN);
	luaPipeline.registerGlobal(runtime, 'sys_img_dst', IO_IMG_DST);
	luaPipeline.registerGlobal(runtime, 'sys_img_cap', IO_IMG_CAP);
	luaPipeline.registerGlobal(runtime, 'sys_img_ctrl', IO_IMG_CTRL);
	luaPipeline.registerGlobal(runtime, 'sys_img_status', IO_IMG_STATUS);
	luaPipeline.registerGlobal(runtime, 'sys_img_written', IO_IMG_WRITTEN);
	luaPipeline.registerGlobal(runtime, 'sys_inp_player', IO_INP_PLAYER);
	luaPipeline.registerGlobal(runtime, 'sys_inp_action', IO_INP_ACTION);
	luaPipeline.registerGlobal(runtime, 'sys_inp_bind', IO_INP_BIND);
	luaPipeline.registerGlobal(runtime, 'sys_inp_ctrl', IO_INP_CTRL);
	luaPipeline.registerGlobal(runtime, 'sys_inp_query', IO_INP_QUERY);
	luaPipeline.registerGlobal(runtime, 'sys_inp_status', IO_INP_STATUS);
	luaPipeline.registerGlobal(runtime, 'sys_inp_value', IO_INP_VALUE);
	luaPipeline.registerGlobal(runtime, 'sys_inp_consume', IO_INP_CONSUME);
	luaPipeline.registerGlobal(runtime, 'sys_apu_source_addr', IO_APU_SOURCE_ADDR);
	luaPipeline.registerGlobal(runtime, 'sys_apu_source_bytes', IO_APU_SOURCE_BYTES);
	luaPipeline.registerGlobal(runtime, 'sys_apu_source_sample_rate_hz', IO_APU_SOURCE_SAMPLE_RATE_HZ);
	luaPipeline.registerGlobal(runtime, 'sys_apu_source_channels', IO_APU_SOURCE_CHANNELS);
	luaPipeline.registerGlobal(runtime, 'sys_apu_source_bits_per_sample', IO_APU_SOURCE_BITS_PER_SAMPLE);
	luaPipeline.registerGlobal(runtime, 'sys_apu_source_frame_count', IO_APU_SOURCE_FRAME_COUNT);
	luaPipeline.registerGlobal(runtime, 'sys_apu_source_data_offset', IO_APU_SOURCE_DATA_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_apu_source_data_bytes', IO_APU_SOURCE_DATA_BYTES);
	luaPipeline.registerGlobal(runtime, 'sys_apu_source_loop_start_sample', IO_APU_SOURCE_LOOP_START_SAMPLE);
	luaPipeline.registerGlobal(runtime, 'sys_apu_source_loop_end_sample', IO_APU_SOURCE_LOOP_END_SAMPLE);
	luaPipeline.registerGlobal(runtime, 'sys_apu_slot', IO_APU_SLOT);
	luaPipeline.registerGlobal(runtime, 'sys_apu_rate_step_q16', IO_APU_RATE_STEP_Q16);
	luaPipeline.registerGlobal(runtime, 'sys_apu_gain_q12', IO_APU_GAIN_Q12);
	luaPipeline.registerGlobal(runtime, 'sys_apu_start_sample', IO_APU_START_SAMPLE);
	luaPipeline.registerGlobal(runtime, 'sys_apu_filter_kind', IO_APU_FILTER_KIND);
	luaPipeline.registerGlobal(runtime, 'sys_apu_filter_freq_hz', IO_APU_FILTER_FREQ_HZ);
	luaPipeline.registerGlobal(runtime, 'sys_apu_filter_q_milli', IO_APU_FILTER_Q_MILLI);
	luaPipeline.registerGlobal(runtime, 'sys_apu_filter_gain_millidb', IO_APU_FILTER_GAIN_MILLIDB);
	luaPipeline.registerGlobal(runtime, 'sys_apu_fade_samples', IO_APU_FADE_SAMPLES);
	luaPipeline.registerGlobal(runtime, 'sys_apu_cmd', IO_APU_CMD);
	luaPipeline.registerGlobal(runtime, 'sys_apu_status', IO_APU_STATUS);
	luaPipeline.registerGlobal(runtime, 'sys_apu_fault_code', IO_APU_FAULT_CODE);
	luaPipeline.registerGlobal(runtime, 'sys_apu_fault_detail', IO_APU_FAULT_DETAIL);
	luaPipeline.registerGlobal(runtime, 'sys_apu_fault_ack', IO_APU_FAULT_ACK);
	luaPipeline.registerGlobal(runtime, 'sys_apu_event_kind', IO_APU_EVENT_KIND);
	luaPipeline.registerGlobal(runtime, 'sys_apu_event_slot', IO_APU_EVENT_SLOT);
	luaPipeline.registerGlobal(runtime, 'sys_apu_event_source_addr', IO_APU_EVENT_SOURCE_ADDR);
	luaPipeline.registerGlobal(runtime, 'sys_apu_event_seq', IO_APU_EVENT_SEQ);
	luaPipeline.registerGlobal(runtime, 'sys_apu_selected_source_addr', IO_APU_SELECTED_SOURCE_ADDR);
	luaPipeline.registerGlobal(runtime, 'sys_apu_active_mask', IO_APU_ACTIVE_MASK);
	luaPipeline.registerGlobal(runtime, 'sys_apu_selected_slot_regs', IO_APU_SELECTED_SLOT_REG0);
	luaPipeline.registerGlobal(runtime, 'sys_apu_selected_slot_reg_count', IO_APU_SELECTED_SLOT_REG_COUNT);
	luaPipeline.registerGlobal(runtime, 'sys_apu_output_queued_frames', IO_APU_OUTPUT_QUEUED_FRAMES);
	luaPipeline.registerGlobal(runtime, 'sys_apu_output_free_frames', IO_APU_OUTPUT_FREE_FRAMES);
	luaPipeline.registerGlobal(runtime, 'sys_apu_output_capacity_frames', IO_APU_OUTPUT_CAPACITY_FRAMES);
	luaPipeline.registerGlobal(runtime, 'sys_apu_cmd_queued', IO_APU_CMD_QUEUED);
	luaPipeline.registerGlobal(runtime, 'sys_apu_cmd_free', IO_APU_CMD_FREE);
	luaPipeline.registerGlobal(runtime, 'sys_apu_cmd_capacity', IO_APU_CMD_CAPACITY);
	luaPipeline.registerGlobal(runtime, 'apu_cmd_play', APU_CMD_PLAY);
	luaPipeline.registerGlobal(runtime, 'apu_cmd_stop_slot', APU_CMD_STOP_SLOT);
	luaPipeline.registerGlobal(runtime, 'apu_cmd_set_slot_gain', APU_CMD_SET_SLOT_GAIN);
	luaPipeline.registerGlobal(runtime, 'apu_sample_rate_hz', APU_SAMPLE_RATE_HZ);
	luaPipeline.registerGlobal(runtime, 'apu_rate_step_q16_one', APU_RATE_STEP_Q16_ONE);
	luaPipeline.registerGlobal(runtime, 'apu_gain_q12_one', APU_GAIN_Q12_ONE);
	luaPipeline.registerGlobal(runtime, 'apu_output_queue_capacity_frames', APU_OUTPUT_QUEUE_CAPACITY_FRAMES);
	luaPipeline.registerGlobal(runtime, 'apu_command_fifo_capacity', APU_COMMAND_FIFO_CAPACITY);
	luaPipeline.registerGlobal(runtime, 'apu_status_fault', APU_STATUS_FAULT);
	luaPipeline.registerGlobal(runtime, 'apu_status_selected_slot_active', APU_STATUS_SELECTED_SLOT_ACTIVE);
	luaPipeline.registerGlobal(runtime, 'apu_status_busy', APU_STATUS_BUSY);
	luaPipeline.registerGlobal(runtime, 'apu_status_output_empty', APU_STATUS_OUTPUT_EMPTY);
	luaPipeline.registerGlobal(runtime, 'apu_status_output_full', APU_STATUS_OUTPUT_FULL);
	luaPipeline.registerGlobal(runtime, 'apu_status_cmd_fifo_empty', APU_STATUS_CMD_FIFO_EMPTY);
	luaPipeline.registerGlobal(runtime, 'apu_status_cmd_fifo_full', APU_STATUS_CMD_FIFO_FULL);
	luaPipeline.registerGlobal(runtime, 'apu_fault_none', APU_FAULT_NONE);
	luaPipeline.registerGlobal(runtime, 'apu_fault_bad_cmd', APU_FAULT_BAD_CMD);
	luaPipeline.registerGlobal(runtime, 'apu_fault_bad_slot', APU_FAULT_BAD_SLOT);
	luaPipeline.registerGlobal(runtime, 'apu_fault_cmd_fifo_full', APU_FAULT_CMD_FIFO_FULL);
	luaPipeline.registerGlobal(runtime, 'apu_fault_source_bytes', APU_FAULT_SOURCE_BYTES);
	luaPipeline.registerGlobal(runtime, 'apu_fault_source_range', APU_FAULT_SOURCE_RANGE);
	luaPipeline.registerGlobal(runtime, 'apu_fault_source_sample_rate', APU_FAULT_SOURCE_SAMPLE_RATE);
	luaPipeline.registerGlobal(runtime, 'apu_fault_source_channels', APU_FAULT_SOURCE_CHANNELS);
	luaPipeline.registerGlobal(runtime, 'apu_fault_source_frame_count', APU_FAULT_SOURCE_FRAME_COUNT);
	luaPipeline.registerGlobal(runtime, 'apu_fault_source_data_range', APU_FAULT_SOURCE_DATA_RANGE);
	luaPipeline.registerGlobal(runtime, 'apu_fault_source_bit_depth', APU_FAULT_SOURCE_BIT_DEPTH);
	luaPipeline.registerGlobal(runtime, 'apu_fault_unsupported_format', APU_FAULT_UNSUPPORTED_FORMAT);
	luaPipeline.registerGlobal(runtime, 'apu_fault_output_metadata', APU_FAULT_OUTPUT_METADATA);
	luaPipeline.registerGlobal(runtime, 'apu_fault_output_data_range', APU_FAULT_OUTPUT_DATA_RANGE);
	luaPipeline.registerGlobal(runtime, 'apu_fault_output_playback_rate', APU_FAULT_OUTPUT_PLAYBACK_RATE);
	luaPipeline.registerGlobal(runtime, 'apu_fault_output_block', APU_FAULT_OUTPUT_BLOCK);
	luaPipeline.registerGlobal(runtime, 'apu_filter_none', APU_FILTER_NONE);
	luaPipeline.registerGlobal(runtime, 'apu_filter_lowpass', APU_FILTER_LOWPASS);
	luaPipeline.registerGlobal(runtime, 'apu_filter_highpass', APU_FILTER_HIGHPASS);
	luaPipeline.registerGlobal(runtime, 'apu_filter_bandpass', APU_FILTER_BANDPASS);
	luaPipeline.registerGlobal(runtime, 'apu_filter_notch', APU_FILTER_NOTCH);
	luaPipeline.registerGlobal(runtime, 'apu_filter_allpass', APU_FILTER_ALLPASS);
	luaPipeline.registerGlobal(runtime, 'apu_filter_peaking', APU_FILTER_PEAKING);
	luaPipeline.registerGlobal(runtime, 'apu_filter_lowshelf', APU_FILTER_LOWSHELF);
	luaPipeline.registerGlobal(runtime, 'apu_filter_highshelf', APU_FILTER_HIGHSHELF);
	luaPipeline.registerGlobal(runtime, 'apu_event_none', APU_EVENT_NONE);
	luaPipeline.registerGlobal(runtime, 'apu_event_slot_ended', APU_EVENT_SLOT_ENDED);
	luaPipeline.registerGlobal(runtime, 'inp_ctrl_commit', INP_CTRL_COMMIT);
	luaPipeline.registerGlobal(runtime, 'inp_ctrl_arm', INP_CTRL_ARM);
	luaPipeline.registerGlobal(runtime, 'inp_ctrl_reset', INP_CTRL_RESET);
	luaPipeline.registerGlobal(runtime, 'sys_rom_system_base', SYSTEM_ROM_BASE);
	luaPipeline.registerGlobal(runtime, 'sys_rom_cart_base', CART_ROM_BASE);
	luaPipeline.registerGlobal(runtime, 'sys_rom_overlay_base', OVERLAY_ROM_BASE);
	luaPipeline.registerGlobal(runtime, 'sys_rom_overlay_size', runtime.machine.memory.getOverlayRomSize());
	luaPipeline.registerGlobal(runtime, 'sys_vram_system_slot_base', VRAM_SYSTEM_SLOT_BASE);
	luaPipeline.registerGlobal(runtime, 'sys_vram_primary_slot_base', VRAM_PRIMARY_SLOT_BASE);
	luaPipeline.registerGlobal(runtime, 'sys_vram_secondary_slot_base', VRAM_SECONDARY_SLOT_BASE);
	luaPipeline.registerGlobal(runtime, 'sys_vram_framebuffer_base', VRAM_FRAMEBUFFER_BASE);
	luaPipeline.registerGlobal(runtime, 'sys_vram_staging_base', VRAM_STAGING_BASE);
	luaPipeline.registerGlobal(runtime, 'sys_vram_system_slot_size', VRAM_SYSTEM_SLOT_SIZE);
	luaPipeline.registerGlobal(runtime, 'sys_vram_primary_slot_size', VRAM_PRIMARY_SLOT_SIZE);
	luaPipeline.registerGlobal(runtime, 'sys_vram_secondary_slot_size', VRAM_SECONDARY_SLOT_SIZE);
	luaPipeline.registerGlobal(runtime, 'sys_vram_framebuffer_size', VRAM_FRAMEBUFFER_SIZE);
	luaPipeline.registerGlobal(runtime, 'sys_vram_staging_size', VRAM_STAGING_SIZE);
	luaPipeline.registerGlobal(runtime, 'sys_vram_size', runtime.vramTotalBytes());
	luaPipeline.registerGlobal(runtime, 'irq_dma_done', IRQ_DMA_DONE);
	luaPipeline.registerGlobal(runtime, 'irq_dma_error', IRQ_DMA_ERROR);
	luaPipeline.registerGlobal(runtime, 'irq_geo_done', IRQ_GEO_DONE);
	luaPipeline.registerGlobal(runtime, 'irq_geo_error', IRQ_GEO_ERROR);
	luaPipeline.registerGlobal(runtime, 'irq_img_done', IRQ_IMG_DONE);
	luaPipeline.registerGlobal(runtime, 'irq_img_error', IRQ_IMG_ERROR);
	luaPipeline.registerGlobal(runtime, 'irq_vblank', IRQ_VBLANK);
	luaPipeline.registerGlobal(runtime, 'irq_reinit', IRQ_REINIT);
	luaPipeline.registerGlobal(runtime, 'irq_newgame', IRQ_NEWGAME);
	luaPipeline.registerGlobal(runtime, 'irq_apu', IRQ_APU);
	luaPipeline.registerGlobal(runtime, 'dma_ctrl_start', DMA_CTRL_START);
	luaPipeline.registerGlobal(runtime, 'dma_ctrl_strict', DMA_CTRL_STRICT);
	luaPipeline.registerGlobal(runtime, 'dma_status_busy', DMA_STATUS_BUSY);
	luaPipeline.registerGlobal(runtime, 'dma_status_done', DMA_STATUS_DONE);
	luaPipeline.registerGlobal(runtime, 'dma_status_error', DMA_STATUS_ERROR);
	luaPipeline.registerGlobal(runtime, 'dma_status_clipped', DMA_STATUS_CLIPPED);
	luaPipeline.registerGlobal(runtime, 'dma_status_rejected', DMA_STATUS_REJECTED);
	luaPipeline.registerGlobal(runtime, 'sys_geo_ctrl_abort', GEO_CTRL_ABORT);
	luaPipeline.registerGlobal(runtime, 'geo_status_busy', GEO_STATUS_BUSY);
	luaPipeline.registerGlobal(runtime, 'geo_status_done', GEO_STATUS_DONE);
	luaPipeline.registerGlobal(runtime, 'geo_status_error', GEO_STATUS_ERROR);
	luaPipeline.registerGlobal(runtime, 'geo_status_rejected', GEO_STATUS_REJECTED);
	luaPipeline.registerGlobal(runtime, 'sys_geo_cmd_xform2_batch', IO_CMD_GEO_XFORM2_BATCH);
	luaPipeline.registerGlobal(runtime, 'sys_geo_cmd_sat2_batch', IO_CMD_GEO_SAT2_BATCH);
	luaPipeline.registerGlobal(runtime, 'sys_geo_cmd_overlap2d_pass', IO_CMD_GEO_OVERLAP2D_PASS);
	luaPipeline.registerGlobal(runtime, 'sys_geo_cmd_xform3_batch', IO_CMD_GEO_XFORM3_BATCH);
	luaPipeline.registerGlobal(runtime, 'sys_geo_cmd_project3_batch', IO_CMD_GEO_PROJECT3_BATCH);
	luaPipeline.registerGlobal(runtime, 'sys_geo_index_none', GEO_INDEX_NONE);
	luaPipeline.registerGlobal(runtime, 'sys_geo_primitive_aabb', GEO_PRIMITIVE_AABB);
	luaPipeline.registerGlobal(runtime, 'sys_geo_primitive_circle', GEO_PRIMITIVE_CIRCLE);
	luaPipeline.registerGlobal(runtime, 'sys_geo_primitive_convex_poly', GEO_PRIMITIVE_CONVEX_POLY);
	luaPipeline.registerGlobal(runtime, 'sys_geo_shape_convex_poly', GEO_SHAPE_CONVEX_POLY);
	luaPipeline.registerGlobal(runtime, 'sys_geo_vertex2_bytes', GEO_VERTEX2_BYTES);
	luaPipeline.registerGlobal(runtime, 'sys_geo_vertex2_x_offset', GEO_VERTEX2_X_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_vertex2_y_offset', GEO_VERTEX2_Y_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_xform2_record_bytes', GEO_XFORM2_RECORD_BYTES);
	luaPipeline.registerGlobal(runtime, 'sys_geo_xform2_record_flags_offset', GEO_XFORM2_RECORD_FLAGS_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_xform2_record_src_index_offset', GEO_XFORM2_RECORD_SRC_INDEX_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_xform2_record_dst_index_offset', GEO_XFORM2_RECORD_DST_INDEX_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_xform2_record_aux_index_offset', GEO_XFORM2_RECORD_AUX_INDEX_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_xform2_record_vertex_count_offset', GEO_XFORM2_RECORD_VERTEX_COUNT_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_xform2_record_dst1_index_offset', GEO_XFORM2_RECORD_DST1_INDEX_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_xform2_matrix_bytes', GEO_XFORM2_MATRIX_BYTES);
	luaPipeline.registerGlobal(runtime, 'sys_geo_xform2_matrix_m00_offset', GEO_XFORM2_MATRIX_M00_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_xform2_matrix_m01_offset', GEO_XFORM2_MATRIX_M01_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_xform2_matrix_tx_offset', GEO_XFORM2_MATRIX_TX_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_xform2_matrix_m10_offset', GEO_XFORM2_MATRIX_M10_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_xform2_matrix_m11_offset', GEO_XFORM2_MATRIX_M11_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_xform2_matrix_ty_offset', GEO_XFORM2_MATRIX_TY_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_xform2_aabb_bytes', GEO_XFORM2_AABB_BYTES);
	luaPipeline.registerGlobal(runtime, 'sys_geo_xform2_aabb_min_x_offset', GEO_XFORM2_AABB_MIN_X_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_xform2_aabb_min_y_offset', GEO_XFORM2_AABB_MIN_Y_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_xform2_aabb_max_x_offset', GEO_XFORM2_AABB_MAX_X_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_xform2_aabb_max_y_offset', GEO_XFORM2_AABB_MAX_Y_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_sat2_pair_bytes', GEO_SAT2_PAIR_BYTES);
	luaPipeline.registerGlobal(runtime, 'sys_geo_sat2_pair_flags_offset', GEO_SAT2_PAIR_FLAGS_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_sat2_pair_shape_a_index_offset', GEO_SAT2_PAIR_SHAPE_A_INDEX_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_sat2_pair_result_index_offset', GEO_SAT2_PAIR_RESULT_INDEX_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_sat2_pair_shape_b_index_offset', GEO_SAT2_PAIR_SHAPE_B_INDEX_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_sat2_pair_flags2_offset', GEO_SAT2_PAIR_FLAGS2_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_sat2_desc_bytes', GEO_SAT2_DESC_BYTES);
	luaPipeline.registerGlobal(runtime, 'sys_geo_sat2_desc_flags_offset', GEO_SAT2_DESC_FLAGS_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_sat2_desc_vertex_count_offset', GEO_SAT2_DESC_VERTEX_COUNT_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_sat2_desc_vertex_offset_offset', GEO_SAT2_DESC_VERTEX_OFFSET_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_sat2_desc_reserved_offset', GEO_SAT2_DESC_RESERVED_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_sat2_result_bytes', GEO_SAT2_RESULT_BYTES);
	luaPipeline.registerGlobal(runtime, 'sys_geo_sat2_result_hit_offset', GEO_SAT2_RESULT_HIT_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_sat2_result_nx_offset', GEO_SAT2_RESULT_NX_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_sat2_result_ny_offset', GEO_SAT2_RESULT_NY_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_sat2_result_depth_offset', GEO_SAT2_RESULT_DEPTH_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_sat2_result_meta_offset', GEO_SAT2_RESULT_META_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_mode_candidate_pairs', GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_mode_full_pass', GEO_OVERLAP2D_MODE_FULL_PASS);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_broadphase_none', GEO_OVERLAP2D_BROADPHASE_NONE);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_broadphase_local_bounds_aabb', GEO_OVERLAP2D_BROADPHASE_LOCAL_BOUNDS_AABB);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_contact_clipped_feature', GEO_OVERLAP2D_CONTACT_POLICY_CLIPPED_FEATURE);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_output_stop_on_overflow', GEO_OVERLAP2D_OUTPUT_POLICY_STOP_ON_OVERFLOW);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_instance_bytes', GEO_OVERLAP2D_INSTANCE_BYTES);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_instance_shape_offset', GEO_OVERLAP2D_INSTANCE_SHAPE_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_instance_tx_offset', GEO_OVERLAP2D_INSTANCE_TX_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_instance_ty_offset', GEO_OVERLAP2D_INSTANCE_TY_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_instance_layer_offset', GEO_OVERLAP2D_INSTANCE_LAYER_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_instance_mask_offset', GEO_OVERLAP2D_INSTANCE_MASK_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_pair_bytes', GEO_OVERLAP2D_PAIR_BYTES);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_pair_instance_a_offset', GEO_OVERLAP2D_PAIR_INSTANCE_A_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_pair_instance_b_offset', GEO_OVERLAP2D_PAIR_INSTANCE_B_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_pair_meta_offset', GEO_OVERLAP2D_PAIR_META_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_result_bytes', GEO_OVERLAP2D_RESULT_BYTES);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_result_nx_offset', GEO_OVERLAP2D_RESULT_NX_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_result_ny_offset', GEO_OVERLAP2D_RESULT_NY_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_result_depth_offset', GEO_OVERLAP2D_RESULT_DEPTH_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_result_px_offset', GEO_OVERLAP2D_RESULT_PX_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_result_py_offset', GEO_OVERLAP2D_RESULT_PY_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_result_piece_a_offset', GEO_OVERLAP2D_RESULT_PIECE_A_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_result_piece_b_offset', GEO_OVERLAP2D_RESULT_PIECE_B_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_result_feature_meta_offset', GEO_OVERLAP2D_RESULT_FEATURE_META_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_result_pair_meta_offset', GEO_OVERLAP2D_RESULT_PAIR_META_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_summary_bytes', GEO_OVERLAP2D_SUMMARY_BYTES);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_summary_result_count_offset', GEO_OVERLAP2D_SUMMARY_RESULT_COUNT_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_summary_exact_pair_count_offset', GEO_OVERLAP2D_SUMMARY_EXACT_PAIR_COUNT_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_summary_broadphase_pair_count_offset', GEO_OVERLAP2D_SUMMARY_BROADPHASE_PAIR_COUNT_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_summary_flags_offset', GEO_OVERLAP2D_SUMMARY_FLAGS_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_summary_flag_overflow', GEO_OVERLAP2D_SUMMARY_FLAG_OVERFLOW);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_shape_desc_bytes', GEO_OVERLAP2D_SHAPE_DESC_BYTES);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_shape_kind_offset', GEO_OVERLAP2D_SHAPE_KIND_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_shape_kind_compound', GEO_OVERLAP2D_SHAPE_KIND_COMPOUND);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_shape_data_count_offset', GEO_OVERLAP2D_SHAPE_DATA_COUNT_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_shape_data_offset_offset', GEO_OVERLAP2D_SHAPE_DATA_OFFSET_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_shape_bounds_offset_offset', GEO_OVERLAP2D_SHAPE_BOUNDS_OFFSET_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_shape_bounds_bytes', GEO_OVERLAP2D_SHAPE_BOUNDS_BYTES);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_shape_bounds_left_offset', GEO_OVERLAP2D_SHAPE_BOUNDS_LEFT_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_shape_bounds_top_offset', GEO_OVERLAP2D_SHAPE_BOUNDS_TOP_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_shape_bounds_right_offset', GEO_OVERLAP2D_SHAPE_BOUNDS_RIGHT_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_shape_bounds_bottom_offset', GEO_OVERLAP2D_SHAPE_BOUNDS_BOTTOM_OFFSET);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_aabb_data_count', GEO_OVERLAP2D_AABB_DATA_COUNT);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_aabb_shape_bytes', GEO_OVERLAP2D_AABB_SHAPE_BYTES);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_pair_meta_instance_a_shift', GEO_OVERLAP2D_PAIR_META_INSTANCE_A_SHIFT);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_pair_meta_instance_a_mask', GEO_OVERLAP2D_PAIR_META_INSTANCE_A_MASK);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_pair_meta_instance_b_mask', GEO_OVERLAP2D_PAIR_META_INSTANCE_B_MASK);
	luaPipeline.registerGlobal(runtime, 'sys_geo_sat_meta_axis_mask', GEO_SAT_META_AXIS_MASK);
	luaPipeline.registerGlobal(runtime, 'sys_geo_sat_meta_shape_shift', GEO_SAT_META_SHAPE_SHIFT);
	luaPipeline.registerGlobal(runtime, 'sys_geo_sat_meta_shape_src', GEO_SAT_META_SHAPE_SRC);
	luaPipeline.registerGlobal(runtime, 'sys_geo_sat_meta_shape_aux', GEO_SAT_META_SHAPE_AUX);
	luaPipeline.registerGlobal(runtime, 'sys_geo_fault_aborted_by_host', GEO_FAULT_ABORTED_BY_HOST);
	luaPipeline.registerGlobal(runtime, 'sys_geo_fault_bad_record_alignment', GEO_FAULT_BAD_RECORD_ALIGNMENT);
	luaPipeline.registerGlobal(runtime, 'sys_geo_fault_bad_vertex_count', GEO_FAULT_BAD_VERTEX_COUNT);
	luaPipeline.registerGlobal(runtime, 'sys_geo_fault_src_range', GEO_FAULT_SRC_RANGE);
	luaPipeline.registerGlobal(runtime, 'sys_geo_fault_dst_range', GEO_FAULT_DST_RANGE);
	luaPipeline.registerGlobal(runtime, 'sys_geo_fault_descriptor_kind', GEO_FAULT_DESCRIPTOR_KIND);
	luaPipeline.registerGlobal(runtime, 'sys_geo_fault_numeric_overflow_internal', GEO_FAULT_NUMERIC_OVERFLOW_INTERNAL);
	luaPipeline.registerGlobal(runtime, 'sys_geo_fault_bad_record_flags', GEO_FAULT_BAD_RECORD_FLAGS);
	luaPipeline.registerGlobal(runtime, 'sys_geo_fault_result_capacity', GEO_FAULT_RESULT_CAPACITY);
	luaPipeline.registerGlobal(runtime, 'sys_geo_fault_code_shift', GEO_FAULT_CODE_SHIFT);
	luaPipeline.registerGlobal(runtime, 'sys_geo_fault_code_mask', GEO_FAULT_CODE_MASK);
	luaPipeline.registerGlobal(runtime, 'sys_geo_fault_record_index_mask', GEO_FAULT_RECORD_INDEX_MASK);
	luaPipeline.registerGlobal(runtime, 'sys_geo_fault_record_index_none', GEO_FAULT_RECORD_INDEX_NONE);
	luaPipeline.registerGlobal(runtime, 'sys_geo_fault_reject_busy', GEO_FAULT_REJECT_BUSY);
	luaPipeline.registerGlobal(runtime, 'sys_geo_fault_reject_bad_cmd', GEO_FAULT_REJECT_BAD_CMD);
	luaPipeline.registerGlobal(runtime, 'sys_geo_fault_reject_bad_stride', GEO_FAULT_REJECT_BAD_STRIDE);
	luaPipeline.registerGlobal(runtime, 'sys_geo_fault_reject_dst_not_ram', GEO_FAULT_REJECT_DST_NOT_RAM);
	luaPipeline.registerGlobal(runtime, 'sys_geo_fault_reject_misaligned_regs', GEO_FAULT_REJECT_MISALIGNED_REGS);
	luaPipeline.registerGlobal(runtime, 'sys_geo_fault_reject_bad_register_combo', GEO_FAULT_REJECT_BAD_REGISTER_COMBO);
	luaPipeline.registerGlobal(runtime, 'img_ctrl_start', IMG_CTRL_START);
	luaPipeline.registerGlobal(runtime, 'img_status_busy', IMG_STATUS_BUSY);
	luaPipeline.registerGlobal(runtime, 'img_status_done', IMG_STATUS_DONE);
	luaPipeline.registerGlobal(runtime, 'img_status_error', IMG_STATUS_ERROR);
	luaPipeline.registerGlobal(runtime, 'img_status_clipped', IMG_STATUS_CLIPPED);
	luaPipeline.registerGlobal(runtime, 'img_status_rejected', IMG_STATUS_REJECTED);
	const bitcastBuffer = new ArrayBuffer(8);
	const bitcastView = new DataView(bitcastBuffer);
	luaPipeline.registerGlobal(runtime, 'u32_to_f32', createNativeFunction('u32_to_f32', (args, out) => {
		const bits = (args[0] as number) >>> 0;
		bitcastView.setUint32(0, bits, true);
		out.push(bitcastView.getFloat32(0, true));
	}));
	luaPipeline.registerGlobal(runtime, 'u32_to_i32', createNativeFunction('u32_to_i32', (args, out) => {
		out.push(((args[0] as number) >>> 0) | 0);
	}));
	luaPipeline.registerGlobal(runtime, 'u64_to_f64', createNativeFunction('u64_to_f64', (args, out) => {
		const hi = (args[0] as number) >>> 0;
		const lo = (args[1] as number) >>> 0;
		bitcastView.setUint32(0, lo, true);
		bitcastView.setUint32(4, hi, true);
		out.push(bitcastView.getFloat64(0, true));
	}));
	luaPipeline.registerGlobal(runtime, 'clock_now', createNativeFunction('clock_now', (_args, out) => {
		out.push(runtime.clock.now());
	}));
	luaPipeline.registerGlobal(runtime, 'type', createNativeFunction('type', (args, out) => {
		const value = args.length > 0 ? args[0] : null;
		out.push(typeOfValue(value));
	}));
	luaPipeline.registerGlobal(runtime, 'tostring', createNativeFunction('tostring', (args, out) => {
		const value = args.length > 0 ? args[0] : null;
		out.push(runtime.internString(valueToString(value, runtime.machine.cpu.stringPool)));
	}));
	luaPipeline.registerGlobal(runtime, 'tonumber', createNativeFunction('tonumber', (args, out) => {
		if (args.length === 0) {
			out.push(null);
			return;
		}
		const value = args[0];
		if (typeof value === 'number') {
			out.push(value);
			return;
		}
		if (valueIsString(value)) {
			const text = strings.toString(asStringId(value));
			if (args.length >= 2) {
				const baseValue = Math.floor(args[1] as number);
				if (baseValue >= 2 && baseValue <= 36) {
					const parsed = parseInt(text.trim(), baseValue);
					out.push(Number.isFinite(parsed) ? parsed : null);
					return;
				}
			}
			const converted = Number(text);
			out.push(Number.isFinite(converted) ? converted : null);
			return;
		}
		out.push(null);
	}));
	luaPipeline.registerGlobal(runtime, 'assert', createNativeFunction('assert', (args, out) => {
		void out;
		const condition = args.length > 0 ? args[0] : null;
		if (!isTruthyValue(condition)) {
			const message = args.length > 1 ? args[1] : runtime.internString('assertion failed!');
			throw new LuaThrownValueError(runtime, message);
		}
		for (let index = 0; index < args.length; index += 1) {
			out.push(args[index]);
		}
	}));
	luaPipeline.registerGlobal(runtime, 'error', createNativeFunction('error', (args, out) => {
		void out;
		const message = args.length > 0 ? args[0] : runtime.internString('error');
		throw new LuaThrownValueError(runtime, message);
	}));
	luaPipeline.registerGlobal(runtime, 'setmetatable', createNativeFunction('setmetatable', (args, out) => {
		if (args.length === 0 || (!(args[0] instanceof Table) && !isNativeObject(args[0]))) {
			throw runtime.createApiRuntimeError('setmetatable expects a table or native value as the first argument.');
		}
		let metatable: Table | null = null;
		if (args.length > 1 && args[1] !== null) {
			if (!(args[1] instanceof Table)) {
				throw runtime.createApiRuntimeError('setmetatable expects a table or nil as the second argument.');
			}
			metatable = args[1] as Table;
		}
		const target = args[0];
		if (target instanceof Table) {
			target.metatable = metatable;
			out.push(target);
			return;
		}
		target.metatable = metatable;
		out.push(target);
	}));
	luaPipeline.registerGlobal(runtime, 'getmetatable', createNativeFunction('getmetatable', (args, out) => {
		if (args.length === 0 || (!(args[0] instanceof Table) && !isNativeObject(args[0]))) {
			throw runtime.createApiRuntimeError('getmetatable expects a table or native value as the first argument.');
		}
		const target = args[0];
		if (target instanceof Table) {
			out.push(target.metatable);
			return;
		}
		out.push(target.metatable);
	}));
	luaPipeline.registerGlobal(runtime, 'rawequal', createNativeFunction('rawequal', (args, out) => {
		out.push(args[0] === args[1]);
	}));
	luaPipeline.registerGlobal(runtime, 'rawget', createNativeFunction('rawget', (args, out) => {
		const target = args[0] as Table;
		const keyValue = args.length > 1 ? args[1] : null;
		out.push(target.get(keyValue));
	}));
	luaPipeline.registerGlobal(runtime, 'rawset', createNativeFunction('rawset', (args, out) => {
		const target = args[0] as Table;
		const keyValue = args[1];
		const value = args.length > 2 ? args[2] : null;
		target.set(keyValue, value);
		out.push(target);
	}));
	luaPipeline.registerGlobal(runtime, 'select', createNativeFunction('select', (args, out) => {
		const index = args[0];
		const count = args.length - 1;
		if (valueIsString(index) && strings.toString(asStringId(index)) === '#') {
			out.push(count);
			return;
		}
		const start = (index as number) >= 0
			? (index as number)
			: count + (index as number) + 1;
		for (let i = start; i <= count; i += 1) {
			out.push(args[i]);
		}
	}));
	luaPipeline.registerGlobal(runtime, 'pcall', createNativeFunction('pcall', (args, out) => {
		const fn = args[0];
		const callArgs = runtime.luaScratch.values.acquire();
		try {
			for (let index = 1; index < args.length; index += 1) {
				callArgs.push(args[index]);
			}
			callClosureValue(fn, callArgs, out);
			prependValue(out, true);
		} catch (error) {
			out.length = 0;
			out.push(
				false,
				error instanceof LuaThrownValueError
					? error.value
					: error instanceof Error
						? runtime.internString(extractErrorMessage(error))
						: error as Value,
			);
		} finally {
			runtime.luaScratch.values.release(callArgs);
		}
	}));
	luaPipeline.registerGlobal(runtime, 'xpcall', createNativeFunction('xpcall', (args, out) => {
		const fn = args[0];
		const handler = args[1];
		const callArgs = runtime.luaScratch.values.acquire();
		const handlerArgs = runtime.luaScratch.values.acquire();
		try {
			for (let index = 2; index < args.length; index += 1) {
				callArgs.push(args[index]);
			}
			callClosureValue(fn, callArgs, out);
			prependValue(out, true);
		} catch (error) {
			handlerArgs.push(error instanceof LuaThrownValueError
				? error.value
				: error instanceof Error
					? runtime.internString(extractErrorMessage(error))
					: error as Value);
			callClosureValue(handler, handlerArgs, out);
			prependValue(out, false);
		} finally {
			runtime.luaScratch.values.release(handlerArgs);
			runtime.luaScratch.values.release(callArgs);
		}
	}));
	luaPipeline.registerGlobal(runtime, 'loadstring', createNativeFunction('loadstring', (args, out) => {
		if (!valueIsString(args[0])) {
			throw runtime.createApiRuntimeError('loadstring(source [, chunkname]) requires a string source.');
		}
		if (args.length > 1 && args[1] !== null && !valueIsString(args[1])) {
			throw runtime.createApiRuntimeError('loadstring(source [, chunkname]) requires a string chunkname.');
		}
		const source = strings.toString(asStringId(args[0] as StringValue));
		const chunkName = args.length > 1 && args[1] !== null ? strings.toString(asStringId(args[1] as StringValue)) : 'loadstring';
		try {
			out.push(compileLoadChunk(runtime, source, chunkName));
		} catch (error) {
			out.push(null);
			out.push(runtime.internString(extractErrorMessage(error)));
		}
	}));
	luaPipeline.registerGlobal(runtime, 'load', createNativeFunction('load', (args, out) => {
		if (!valueIsString(args[0])) {
			throw runtime.createApiRuntimeError('load(source [, chunkname [, mode]]) requires a string source.');
		}
		if (args.length > 2 && args[2] !== null) {
			if (!valueIsString(args[2])) {
				throw runtime.createApiRuntimeError('load(source [, chunkname [, mode]]) requires mode to be a string.');
			}
			const mode = strings.toString(asStringId(args[2] as StringValue));
			if (mode !== 't' && mode !== 'bt') {
				throw runtime.createApiRuntimeError("load only supports text mode ('t' or 'bt').");
			}
		}
		if (args.length > 1 && args[1] !== null && !valueIsString(args[1])) {
			throw runtime.createApiRuntimeError('load(source [, chunkname [, mode]]) requires chunkname to be a string.');
		}
		if (args.length > 3 && args[3] !== null) {
			throw runtime.createApiRuntimeError('load does not support the environment argument.');
		}
		const source = strings.toString(asStringId(args[0] as StringValue));
		const chunkName = args.length > 1 && args[1] !== null ? strings.toString(asStringId(args[1] as StringValue)) : 'load';
		try {
			out.push(compileLoadChunk(runtime, source, chunkName));
		} catch (error) {
			out.push(null);
			out.push(runtime.internString(extractErrorMessage(error)));
		}
	}));
	luaPipeline.registerGlobal(runtime, 'require', createNativeFunction('require', (args, out) => {
		const moduleName = strings.toString(asStringId(args[0] as StringValue)).trim();
		out.push(luaPipeline.requireModule(runtime, moduleName));
	}));
	luaPipeline.registerGlobal(runtime, 'array', createNativeFunction('array', (args, out) => {
		const ctxBase = buildMarshalContext(runtime);
		let result: unknown[] = [];
		if (args.length === 1 && args[0] instanceof Table) {
			result = createNativeArrayFromTable(args[0], ctxBase);
		} else {
			result = new Array(args.length);
			const visited = runtime.luaScratch.tableMarshal.acquire();
			try {
				for (let index = 0; index < args.length; index += 1) {
					result[index] = toNativeValue(runtime, args[index], ctxBase, visited);
				}
			} finally {
				runtime.luaScratch.tableMarshal.release(visited);
			}
		}
		out.push(getOrCreateNativeObject(runtime, result));
	}));
	luaPipeline.registerGlobal(runtime, 'print', createNativeFunction('print', (args, out) => {
		const parts: string[] = [];
		for (let index = 0; index < args.length; index += 1) {
			parts.push(valueToString(args[index], runtime.machine.cpu.stringPool));
		}
		const text = parts.length === 0 ? '' : parts.join('\t');
		runtime.terminal.appendStdout(text);
		// eslint-disable-next-line no-console
		console.log(text);
		out.length = 0;
	}));

	const fontGlyphsKey = key('glyphs');
	const fontAdvanceKey = key('advance');
	const fontFallbackGlyphKey = key('?');
	const resolveFontGlyph = (glyphs: Table, char: string): Value => {
		const glyph = glyphs.get(runtime.internString(char));
		return glyph === null ? glyphs.get(fontFallbackGlyphKey) : glyph;
	};
	luaPipeline.registerGlobal(runtime, 'font_for_each_glyph', createNativeFunction('font_for_each_glyph', (args, out) => {
		const fontDescriptor = args[0] as Table;
		const line = strings.toString(asStringId(args[1] as StringValue));
		const callback = args[2];
		const glyphs = fontDescriptor.get(fontGlyphsKey) as Table;
		const callArgs = runtime.luaScratch.values.acquire();
		const callbackOut = runtime.luaScratch.values.acquire();
		try {
			callArgs.length = 1;
			for (const char of line) {
				callArgs[0] = resolveFontGlyph(glyphs, char);
				callbackOut.length = 0;
				callClosureValue(callback, callArgs, callbackOut);
			}
		} finally {
			runtime.luaScratch.values.release(callbackOut);
			runtime.luaScratch.values.release(callArgs);
		}
		out.length = 0;
	}));
	luaPipeline.registerGlobal(runtime, 'font_measure_line_width', createNativeFunction('font_measure_line_width', (args, out) => {
		const fontDescriptor = args[0] as Table;
		const line = strings.toString(asStringId(args[1] as StringValue));
		const glyphs = fontDescriptor.get(fontGlyphsKey) as Table;
		let width = 0;
		for (const char of line) {
			const glyph = resolveFontGlyph(glyphs, char) as Table;
			width += glyph.get(fontAdvanceKey) as number;
		}
		out.push(width);
	}));

	const utf8CodepointCount = (text: string): number => {
		let count = 0;
		for (const _char of text) {
			count += 1;
		}
		return count;
	};

	const utf8CodepointIndexToUnitIndex = (text: string, codepointIndex: number): number => {
		if (codepointIndex <= 1) {
			return 0;
		}
		let unitIndex = 0;
		let current = 1;
		for (const char of text) {
			if (current === codepointIndex) {
				return unitIndex;
			}
			unitIndex += char.length;
			current += 1;
		}
		return unitIndex;
	};

	const isWrapWhitespace = (char: string): boolean => char === ' ' || char === '\t';

	const wrapTextLines = (text: string, maxChars: number, firstPrefix: string = '', nextPrefix: string = firstPrefix): { lines: string[]; lineMap: number[] } => {
		const firstPrefixLength = utf8CodepointCount(firstPrefix);
		const nextPrefixLength = utf8CodepointCount(nextPrefix);
		const lines: string[] = [];
		const lineMap: number[] = [];
		if (text.length === 0) {
			return { lines, lineMap };
		}
		// disable-next-line newline_normalization_pattern -- firmware global text is packed into fixed-width logical display lines.
		const logicalLines = text.split('\n');
		let outputPrefix = firstPrefix;
		let outputPrefixLength = firstPrefixLength;
		for (let logicalLineIndex = 0; logicalLineIndex < logicalLines.length; logicalLineIndex += 1) {
			const codepoints = Array.from(logicalLines[logicalLineIndex]);
			if (codepoints.length === 0) {
				const available = maxChars - outputPrefixLength;
				if (available <= 0) {
					throw runtime.createApiRuntimeError('wrap_text_lines prefix exceeds max_chars.');
				}
				lines.push(outputPrefix);
				lineMap.push(logicalLineIndex + 1);
				outputPrefix = nextPrefix;
				outputPrefixLength = nextPrefixLength;
				continue;
			}
			let startIndex = 0;
			while (startIndex < codepoints.length) {
				const prefix = outputPrefix;
				const available = maxChars - outputPrefixLength;
				if (available <= 0) {
					throw runtime.createApiRuntimeError('wrap_text_lines prefix exceeds max_chars.');
				}
				if (codepoints.length - startIndex <= available) {
					lines.push(prefix + codepoints.slice(startIndex).join(''));
					lineMap.push(logicalLineIndex + 1);
					outputPrefix = nextPrefix;
					outputPrefixLength = nextPrefixLength;
					break;
				}
				let breakIndex = -1;
				const limit = startIndex + available;
				for (let index = startIndex; index < limit; index += 1) {
					if (isWrapWhitespace(codepoints[index])) {
						breakIndex = index;
					}
				}
				if (breakIndex > startIndex) {
					let endIndex = breakIndex;
					while (endIndex > startIndex && isWrapWhitespace(codepoints[endIndex - 1])) {
						endIndex -= 1;
					}
					lines.push(prefix + codepoints.slice(startIndex, endIndex).join(''));
					lineMap.push(logicalLineIndex + 1);
					outputPrefix = nextPrefix;
					outputPrefixLength = nextPrefixLength;
					startIndex = breakIndex + 1;
					while (startIndex < codepoints.length && isWrapWhitespace(codepoints[startIndex])) {
						startIndex += 1;
					}
					continue;
				}
				lines.push(prefix + codepoints.slice(startIndex, limit).join(''));
				lineMap.push(logicalLineIndex + 1);
				outputPrefix = nextPrefix;
				outputPrefixLength = nextPrefixLength;
				startIndex = limit;
			}
		}
		return { lines, lineMap };
	};

	const stringTable = new Table(0, 0);
	luaPipeline.registerGlobal(runtime, 'wrap_text_lines', createNativeFunction('wrap_text_lines', (args, out) => {
		const text = strings.toString(asStringId(args[0] as StringValue));
		const maxChars = Math.floor(args[1] as number);
		const firstPrefix = args.length > 2 && args[2] !== null ? strings.toString(asStringId(args[2] as StringValue)) : '';
		const nextPrefix = args.length > 3 && args[3] !== null ? strings.toString(asStringId(args[3] as StringValue)) : firstPrefix;
		const wrapped = wrapTextLines(text, maxChars, firstPrefix, nextPrefix);
		const linesTable = new Table(wrapped.lines.length, 0);
		const lineMapTable = new Table(wrapped.lineMap.length, 0);
		for (let index = 0; index < wrapped.lines.length; index += 1) {
			linesTable.set(index + 1, runtime.internString(wrapped.lines[index]));
			lineMapTable.set(index + 1, wrapped.lineMap[index]);
		}
		out.push(linesTable);
		out.push(lineMapTable);
	}));
	setKey(stringTable, 'len', createNativeFunction('string.len', (args, out) => {
		const value = args[0] as StringValue;
		out.push(strings.codepointCount(asStringId(value)));
	}));
	setKey(stringTable, 'upper', createNativeFunction('string.upper', (args, out) => {
		const text = strings.toString(asStringId(args[0] as StringValue));
		out.push(runtime.internString(text.toUpperCase()));
	}));
	setKey(stringTable, 'lower', createNativeFunction('string.lower', (args, out) => {
		const text = strings.toString(asStringId(args[0] as StringValue));
		out.push(runtime.internString(text.toLowerCase()));
	}));
	setKey(stringTable, 'rep', createNativeFunction('string.rep', (args, out) => {
		const text = strings.toString(asStringId(args[0] as StringValue));
		const count = Math.floor(args.length > 1 ? (args[1] as number) : 1);
		if (count <= 0) {
			out.push(runtime.internString(''));
			return;
		}
		const hasSeparator = args.length > 2 && args[2] !== null;
		const separator = hasSeparator ? strings.toString(asStringId(args[2] as StringValue)) : '';
		let output = '';
		if (hasSeparator) {
			for (let index = 0; index < count; index += 1) {
				if (index > 0) {
					output += separator;
				}
				output += text;
			}
		} else {
			for (let index = 0; index < count; index += 1) {
				output += text;
			}
		}
		out.push(runtime.internString(output));
	}));
	setKey(stringTable, 'sub', createNativeFunction('string.sub', (args, out) => {
		const value = args[0] as StringValue;
		const text = strings.toString(asStringId(value));
		const length = strings.codepointCount(asStringId(value));
		const startArg = args.length > 1 ? (args[1] as number) : 1;
		const endArg = args.length > 2 ? (args[2] as number) : length;
		let startIndex = normalizeLuaIndex(startArg, length, 1);
		let endIndex = normalizeLuaIndex(endArg, length, 1);
		if (startIndex < 1) {
			startIndex = 1;
		}
		if (endIndex > length) {
			endIndex = length;
		}
		if (endIndex < startIndex) {
			out.push(runtime.internString(''));
			return;
		}
		const startUnit = utf8CodepointIndexToUnitIndex(text, startIndex);
		const endUnit = utf8CodepointIndexToUnitIndex(text, endIndex + 1);
		out.push(runtime.internString(text.slice(startUnit, endUnit)));
	}));
	// start repeated-sequence-acceptable -- Lua string find/match keep argument decoding inline to avoid allocation in string-library calls.
	setKey(stringTable, 'find', createNativeFunction('string.find', (args, out) => {
		const sourceValue = args[0] as StringValue;
		const source = strings.toString(asStringId(sourceValue));
		const pattern = args.length > 1 ? strings.toString(asStringId(args[1] as StringValue)) : '';
		const length = strings.codepointCount(asStringId(sourceValue));
		const startIndex = args.length > 2 ? normalizeLuaIndex(args[2] as number, length, 1) : 1;
		if (startIndex > length) {
			out.push(null);
			return;
		}
		const startUnit = utf8CodepointIndexToUnitIndex(source, startIndex);
		const plain = args.length > 3 && isTruthyValue(args[3]);
		if (plain) {
			const position = source.indexOf(pattern, Math.max(0, startUnit));
			if (position === -1) {
				out.push(null);
				return;
			}
			const first = utf8CodepointCount(source.slice(0, position)) + 1;
			const last = utf8CodepointCount(source.slice(0, position + pattern.length));
			out.push(first, last);
			return;
		}
		const regex = getLuaPatternRegex(pattern);
		const slice = source.slice(Math.max(0, startUnit));
		const match = regex.exec(slice);
		if (!match) {
			out.push(null);
			return;
		}
		const matchStartUnit = startUnit + match.index;
		const matchEndUnit = matchStartUnit + match[0].length;
		const first = utf8CodepointCount(source.slice(0, matchStartUnit)) + 1;
		const last = utf8CodepointCount(source.slice(0, matchEndUnit));
		if (match.length > 1) {
			out.push(first, last);
			for (let index = 1; index < match.length; index += 1) {
				const value = match[index];
				out.push(value === undefined ? null : runtime.internString(value));
			}
			return;
		}
		out.push(first, last);
	}));
	setKey(stringTable, 'match', createNativeFunction('string.match', (args, out) => {
		const sourceValue = args[0] as StringValue;
		const source = strings.toString(asStringId(sourceValue));
		const pattern = args.length > 1 ? strings.toString(asStringId(args[1] as StringValue)) : '';
		const length = strings.codepointCount(asStringId(sourceValue));
		const startIndex = args.length > 2 ? normalizeLuaIndex(args[2] as number, length, 1) : 1;
		if (startIndex > length) {
			out.push(null);
			return;
		}
		const regex = getLuaPatternRegex(pattern);
		const startUnit = utf8CodepointIndexToUnitIndex(source, startIndex);
		const slice = source.slice(Math.max(0, startUnit));
		const match = regex.exec(slice);
		if (!match) {
			out.push(null);
			return;
		}
		if (match.length > 1) {
			for (let index = 1; index < match.length; index += 1) {
				const value = match[index];
				out.push(value === undefined ? null : runtime.internString(value));
			}
			return;
		}
		out.push(runtime.internString(match[0]));
	}));
	// end repeated-sequence-acceptable
	setKey(stringTable, 'gsub', createNativeFunction('string.gsub', (args, out) => {
		const source = strings.toString(asStringId(args[0] as StringValue));
		const pattern = args.length > 1 ? strings.toString(asStringId(args[1] as StringValue)) : '';
		const replacement = args.length > 2 ? args[2] : runtime.internString('');
		let maxReplacements = Number.POSITIVE_INFINITY;
		if (args.length > 3 && args[3] !== null) {
			maxReplacements = Math.floor(args[3] as number);
			if (maxReplacements < 0) {
				maxReplacements = 0;
			}
		}

		const regex = getLuaPatternRegex(pattern);

		let count = 0;
		let result = '';
		let searchIndex = 0;
		let lastIndex = 0;
		const fnArgs = runtime.luaScratch.values.acquire();
		const fnResults = runtime.luaScratch.values.acquire();
		try {
			const renderReplacement = (match: RegExpExecArray): string => {
				if (valueIsString(replacement) || typeof replacement === 'number') {
					const template = valueIsString(replacement) ? strings.toString(asStringId(replacement)) : String(replacement);
					return template.replace(/%([0-9%])/g, (_full, token) => {
						if (token === '%') {
							return '%';
						}
						const index = parseInt(token, 10);
						if (!Number.isFinite(index)) {
							return token;
						}
						if (index === 0) {
							return match[0];
						}
						const value = match[index];
						return value === undefined ? '' : value;
					});
				}
				if (replacement instanceof Table) {
					if (match.length > 1 && match[1] === undefined) {
						return match[0];
					}
					const keyValue = match.length > 1
						? runtime.internString(match[1])
						: runtime.internString(match[0]);
					const mapped = replacement.get(keyValue);
					return mapped === null ? match[0] : valueToString(mapped, runtime.machine.cpu.stringPool);
				}
				if (isNativeFunction(replacement) || (replacement !== null && typeof replacement === 'object' && 'protoIndex' in replacement)) {
					fnArgs.length = 0;
					fnResults.length = 0;
					if (match.length > 1) {
						for (let index = 1; index < match.length; index += 1) {
							const value = match[index];
							fnArgs.push(value === undefined ? null : runtime.internString(value));
						}
						if (fnArgs.length === 0) {
							fnArgs.push(runtime.internString(match[0]));
						}
					} else {
						fnArgs.push(runtime.internString(match[0]));
					}
					callClosureValue(replacement, fnArgs, fnResults);
					const value = fnResults.length > 0 ? fnResults[0] : null;
					if (value === null || value === false) {
						return match[0];
					}
					return valueToString(value, runtime.machine.cpu.stringPool);
				}
				throw runtime.createApiRuntimeError('string.gsub replacement must be a string, number, function, or table.');
			};

			while (count < maxReplacements) {
				if (searchIndex > source.length) {
					break;
				}
				const match = regex.exec(source.slice(searchIndex));
				if (!match) {
					break;
				}
				const start = searchIndex + match.index;
				const end = start + match[0].length;
				result += source.slice(lastIndex, start);
				result += renderReplacement(match);
				lastIndex = end;
				count += 1;
				if (match[0].length === 0) {
					searchIndex = end + 1;
				} else {
					searchIndex = end;
				}
			}

			result += source.slice(lastIndex);
			out.push(runtime.internString(result), count);
		} finally {
			runtime.luaScratch.values.release(fnResults);
			runtime.luaScratch.values.release(fnArgs);
		}
	}));
	setKey(stringTable, 'gmatch', createNativeFunction('string.gmatch', (args, out) => {
		const source = strings.toString(asStringId(args[0] as StringValue));
		const pattern = args.length > 1 ? strings.toString(asStringId(args[1] as StringValue)) : '';
		const regex = getLuaPatternRegex(pattern);
		const state = { index: 0 };
		const iterator = createNativeFunction('string.gmatch.iterator', (_args, iterOut) => {
			if (state.index > source.length) {
				iterOut.push(null);
				return;
			}
			const match = regex.exec(source.slice(state.index));
			if (!match) {
				iterOut.push(null);
				return;
			}
			const matchStart = state.index + match.index;
			const matchEnd = matchStart + match[0].length;
			if (match[0].length === 0) {
				state.index = matchEnd + 1;
			} else {
				state.index = matchEnd;
			}
			if (match.length > 1) {
				for (let index = 1; index < match.length; index += 1) {
					const value = match[index];
					iterOut.push(value === undefined ? null : runtime.internString(value));
				}
				return;
			}
			iterOut.push(runtime.internString(match[0]));
		});
		out.push(iterator);
	}));
	setKey(stringTable, 'byte', createNativeFunction('string.byte', (args, out) => {
		const source = strings.toString(asStringId(args[0] as StringValue));
		const positionArg = args.length > 1 ? (args[1] as number) : 1;
		const position = Math.floor(positionArg);
		if (position < 1) {
			out.push(null);
			return;
		}
		let current = 1;
		for (const char of source) {
			if (current === position) {
				out.push(char.codePointAt(0) as number);
				return;
			}
			current += 1;
		}
		out.push(null);
	}));
	setKey(stringTable, 'char', createNativeFunction('string.char', (args, out) => {
		if (args.length === 0) {
			out.push(runtime.internString(''));
			return;
		}
		let result = '';
		for (let index = 0; index < args.length; index += 1) {
			const code = args[index] as number;
			result += String.fromCodePoint(Math.floor(code));
		}
		out.push(runtime.internString(result));
	}));
	setKey(stringTable, 'format', createNativeFunction('string.format', (args, out) => {
		const template = strings.toString(asStringId(args[0] as StringValue));
		const formatted = formatLuaString(runtime, template, args, 1);
		out.push(runtime.internString(formatted));
	}));
	runtime.machine.cpu.stringIndexTable = stringTable;
	luaPipeline.registerGlobal(runtime, 'string', stringTable);

	const tableLibrary = new Table(0, 0);
	setKey(tableLibrary, 'insert', createNativeFunction('table.insert', (args, out) => {
		const target = args[0] as Table;
		let position: number;
		let value: Value;
		if (args.length === 2) {
			value = args[1];
			position = target.arrayLength + 1;
		} else {
			position = Math.floor(args[1] as number);
			value = args[2];
		}
		const length = target.arrayLength;
		for (let index = length; index >= position; index -= 1) {
			target.set(index + 1, target.get(index));
		}
		target.set(position, value);
		out.length = 0;
	}));
	setKey(tableLibrary, 'remove', createNativeFunction('table.remove', (args, out) => {
		const target = args[0] as Table;
		const position = args.length > 1 ? Math.floor(args[1] as number) : target.arrayLength;
		const length = target.arrayLength;
		const removed = target.get(position);
		for (let index = position; index < length; index += 1) {
			target.set(index, target.get(index + 1));
		}
		target.set(length, null);
		if (removed !== null) {
			out.push(removed);
		}
	}));
	setKey(tableLibrary, 'concat', createNativeFunction('table.concat', (args, out) => {
		const target = args[0] as Table;
		const separator = args.length > 1 ? strings.toString(asStringId(args[1] as StringValue)) : '';
		const length = target.arrayLength;
		const startIndex = args.length > 2 ? normalizeLuaIndex(args[2] as number, length, 1) : 1;
		const endIndex = args.length > 3 ? normalizeLuaIndex(args[3] as number, length, length) : length;
		if (endIndex < startIndex) {
			out.push(runtime.internString(''));
			return;
		}
		const parts = runtime.luaScratch.strings.acquire();
		try {
			for (let index = startIndex; index <= endIndex; index += 1) {
				const value = target.get(index);
				parts.push(value === null ? '' : valueToString(value, runtime.machine.cpu.stringPool));
			}
			out.push(runtime.internString(parts.join(separator)));
		} finally {
			runtime.luaScratch.strings.release(parts);
		}
	}));
	setKey(tableLibrary, 'pack', createNativeFunction('table.pack', (args, out) => {
		const target = new Table(args.length, 1);
		for (let index = 0; index < args.length; index += 1) {
			target.set(index + 1, args[index]);
		}
		target.set(key('n'), args.length);
		out.push(target);
	}));
	setKey(tableLibrary, 'unpack', createNativeFunction('table.unpack', (args, out) => {
		const target = args[0] as Table;
		const length = target.arrayLength;
		const startIndex = args.length > 1 ? normalizeLuaIndex(args[1] as number, length, 1) : 1;
		const endIndex = args.length > 2 ? normalizeLuaIndex(args[2] as number, length, length) : length;
		if (endIndex < startIndex) {
			return;
		}
		for (let index = startIndex; index <= endIndex; index += 1) {
			out.push(target.get(index));
		}
	}));
	setKey(tableLibrary, 'sort', createNativeFunction('table.sort', (args, out) => {
		const target = args[0] as Table;
		const comparator = args.length > 1 ? args[1] : null;
		const length = target.arrayLength;
		const values = runtime.luaScratch.values.acquire();
		const comparatorArgs = runtime.luaScratch.values.acquire();
		const comparatorResults = runtime.luaScratch.values.acquire();
		try {
			values.length = length;
			for (let index = 1; index <= length; index += 1) {
				values[index - 1] = target.get(index);
			}
			comparatorArgs.length = 2;
			comparatorArgs[0] = null;
			comparatorArgs[1] = null;
			values.sort((left, right) => {
				if (comparator !== null) {
					comparatorArgs[0] = left;
					comparatorArgs[1] = right;
					comparatorResults.length = 0;
					callClosureValue(comparator, comparatorArgs, comparatorResults);
					return comparatorResults.length > 0 && isTruthyValue(comparatorResults[0]!) ? -1 : 1;
				}
				if (typeof left === 'number' && typeof right === 'number') {
					return left - right;
				}
				if (valueIsString(left) && valueIsString(right)) {
					if (left === right) {
						return 0;
					}
					return strings.toString(asStringId(left)) < strings.toString(asStringId(right)) ? -1 : 1;
				}
				throw runtime.createApiRuntimeError('table.sort comparison expects numbers or strings.');
			});
			for (let index = 1; index <= length; index += 1) {
				target.set(index, values[index - 1]);
			}
			out.push(target);
		} finally {
			runtime.luaScratch.values.release(comparatorResults);
			runtime.luaScratch.values.release(comparatorArgs);
			runtime.luaScratch.values.release(values);
		}
	}));
	luaPipeline.registerGlobal(runtime, 'table', tableLibrary);

	const osTable = new Table(0, 0);
	const formatOsDate = (format: string, date: Date): string => {
		const pad = (value: number, size: number): string => {
			let text = Math.floor(value).toString();
			while (text.length < size) {
				text = `0${text}`;
			}
			return text;
		};
		const weekdaysShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
		const weekdaysLong = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
		const monthsShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
		const monthsLong = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
		const year = date.getFullYear();
		const month = date.getMonth() + 1;
		const day = date.getDate();
		const hour = date.getHours();
		const min = date.getMinutes();
		const sec = date.getSeconds();
		const ydayStart = new Date(year, 0, 1);
		const yday = Math.floor((date.getTime() - ydayStart.getTime()) / 86400000) + 1;
		const wday = date.getDay();
		const hour12 = hour % 12 === 0 ? 12 : hour % 12;
		const ampm = hour < 12 ? 'AM' : 'PM';
		let output = '';
		for (let index = 0; index < format.length; index += 1) {
			const ch = format.charAt(index);
			if (ch !== '%') {
				output += ch;
				continue;
			}
			index += 1;
			const code = format.charAt(index);
			switch (code) {
				case 'Y':
					output += pad(year, 4);
					break;
				case 'y':
					output += pad(year % 100, 2);
					break;
				case 'm':
					output += pad(month, 2);
					break;
				case 'd':
					output += pad(day, 2);
					break;
				case 'H':
					output += pad(hour, 2);
					break;
				case 'M':
					output += pad(min, 2);
					break;
				case 'S':
					output += pad(sec, 2);
					break;
				case 'I':
					output += pad(hour12, 2);
					break;
				case 'p':
					output += ampm;
					break;
				case 'a':
					output += weekdaysShort[wday];
					break;
				case 'A':
					output += weekdaysLong[wday];
					break;
				case 'b':
					output += monthsShort[month - 1];
					break;
				case 'B':
					output += monthsLong[month - 1];
					break;
				case 'j':
					output += pad(yday, 3);
					break;
				case 'w':
					output += wday.toString();
					break;
				case 'c':
					output += date.toLocaleString();
					break;
				case 'x':
					output += date.toLocaleDateString();
					break;
				case 'X':
					output += date.toLocaleTimeString();
					break;
				case 'Z': {
					const tz = date.toTimeString();
					const start = tz.indexOf('(');
					const end = tz.lastIndexOf(')');
					if (start !== -1 && end !== -1 && end > start) {
						output += tz.slice(start + 1, end);
					} else {
						output += 'UTC';
					}
					break;
				}
				case '%':
					output += '%';
					break;
				default:
					output += `%${code}`;
					break;
			}
		}
		return output;
	};
	const buildOsDateTable = (date: Date): Table => {
		const year = date.getFullYear();
		const ydayStart = new Date(year, 0, 1);
		const yday = Math.floor((date.getTime() - ydayStart.getTime()) / 86400000) + 1;
		const jan = new Date(year, 0, 1);
		const jul = new Date(year, 6, 1);
		const isDst = date.getTimezoneOffset() < Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
		const table = new Table(0, 9);
		setKey(table, 'year', year);
		setKey(table, 'month', date.getMonth() + 1);
		setKey(table, 'day', date.getDate());
		setKey(table, 'hour', date.getHours());
		setKey(table, 'min', date.getMinutes());
		setKey(table, 'sec', date.getSeconds());
		setKey(table, 'wday', date.getDay() + 1);
		setKey(table, 'yday', yday);
		setKey(table, 'isdst', isDst);
		return table;
	};
	setKey(osTable, 'clock', createNativeFunction('os.clock', (_args, out) => {
		out.push(runtime.clock.now() / 1000);
	}));
	setKey(osTable, 'time', createNativeFunction('os.time', (args, out) => {
		if (args.length > 0 && args[0] !== null) {
			const table = args[0] as Table;
			const year = table.get(key('year')) as number;
			const month = table.get(key('month')) as number;
			const day = table.get(key('day')) as number;
			const hour = table.get(key('hour')) as number;
			const min = table.get(key('min')) as number;
			const sec = table.get(key('sec')) as number;
			const date = new Date(year, month - 1, day, hour, min, sec);
			out.push(Math.floor(date.getTime() / 1000));
			return;
		}
		out.push(Math.floor(Date.now() / 1000));
	}));
	setKey(osTable, 'difftime', createNativeFunction('os.difftime', (args, out) => {
		const t2 = args[0] as number;
		const t1 = args[1] as number;
		out.push(t2 - t1);
	}));
	setKey(osTable, 'date', createNativeFunction('os.date', (args, out) => {
		const format = args.length > 0 && args[0] !== null ? strings.toString(asStringId(args[0] as StringValue)) : '%c';
		const timeValue = args.length > 1 && args[1] !== null ? (args[1] as number) * 1000 : Date.now();
		const date = new Date(timeValue);
		if (format === '*t') {
			out.push(buildOsDateTable(date));
			return;
		}
		out.push(runtime.internString(formatOsDate(format, date)));
	}));
	luaPipeline.registerGlobal(runtime, 'os', osTable);

	const nextFn = createNativeFunction('next', (args, out) => {
		const target = args[0];
		const keyValue = args.length > 1 ? args[1] : null;
		if (target instanceof Table) {
			const entry = target.nextEntry(keyValue);
			if (entry === null) {
				out.push(null);
				return;
			}
			out.push(entry[0], entry[1]);
			return;
		}
		if (isNativeObject(target)) {
			const entry = nextNativeEntry(runtime, target, keyValue);
			if (entry === null) {
				out.push(null);
				return;
			}
			out.push(entry[0], entry[1]);
			return;
		}
		throw runtime.createApiRuntimeError('next expects a table or native object.');
	});
	const pairsIterator = createNativeFunction('pairs.iterator', (args, out) => {
		const state = args[0] as Table;
		const target = state.get(1) as Table;
		const arrayCursor = state.get(2) as number;
		const hashCursor = state.get(3) as number;
		const previousHashKey = state.get(4);
		const entry = target.nextEntryFromCursor(arrayCursor, hashCursor, previousHashKey);
		if (entry === null) {
			out.push(null);
			return;
		}
		state.set(2, entry[0]);
		state.set(3, entry[1]);
		state.set(4, entry[1] === 0 ? null : entry[2]);
		out.push(entry[2], entry[3]);
	});
	const ipairsIterator = createNativeFunction('ipairs.iterator', (args, out) => {
		const target = args[0];
		const index = args[1] as number;
		const nextIndex = Math.floor(index) + 1;
		if (target instanceof Table) {
			const value = target.get(nextIndex);
			if (value === null) {
				out.push(null);
				return;
			}
			out.push(nextIndex, value);
			return;
		}
		if (isNativeObject(target)) {
			const raw = target.raw as object;
			if (Array.isArray(raw)) {
				const value = (raw as unknown[])[nextIndex - 1];
				if (value === undefined || value === null) {
					out.push(null);
					return;
				}
				out.push(nextIndex, toRuntimeValue(runtime, value));
				return;
			}
			const value = (raw as Record<string, unknown>)[String(nextIndex)];
			if (value === undefined || value === null) {
				out.push(null);
				return;
			}
			out.push(nextIndex, toRuntimeValue(runtime, value));
			return;
		}
		throw runtime.createApiRuntimeError('ipairs expects a table or native object.');
	});
	runtime.pairsIterator = pairsIterator;
	runtime.ipairsIterator = ipairsIterator;
	luaPipeline.registerGlobal(runtime, 'next', nextFn);
	luaPipeline.registerGlobal(runtime, 'pairs', createNativeFunction('pairs', (args, out) => {
		const target = args[0];
		if (target instanceof Table) {
			const state = new Table(4, 0);
			state.set(1, target);
			state.set(2, 0);
			state.set(3, 0);
			state.set(4, null);
			out.push(pairsIterator, state, null);
			return;
		}
		if (!isNativeObject(target)) {
			const stack = buildLuaStackFrames(runtime)
				.map(frame => `${frame.source ?? '<unknown>'}:${frame.line ?? '?'}:${frame.column ?? '?'}`)
				.join(' <- ');
			throw runtime.createApiRuntimeError(`pairs expects a table or native object (got ${valueToString(target, runtime.machine.cpu.stringPool)}). stack=${stack}`);
		}
		pushNativePairsIterator(runtime, target, out);
	}));
	luaPipeline.registerGlobal(runtime, 'ipairs', createNativeFunction('ipairs', (args, out) => {
		const target = args[0];
		if (!(target instanceof Table) && !isNativeObject(target)) {
			throw runtime.createApiRuntimeError('ipairs expects a table or native object.');
		}
		out.push(ipairsIterator, target, 0);
	}));


	exposeObjects();
}
