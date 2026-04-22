import { $ } from '../../core/engine';
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
import { ASSET_TABLE_ENTRY_SIZE, ASSET_TABLE_HEADER_SIZE } from '../memory/memory';
import {
	ASSET_TABLE_SIZE,
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
	VDP_STREAM_PACKET_HEADER_WORDS,
	VRAM_FRAMEBUFFER_BASE,
	VRAM_FRAMEBUFFER_SIZE,
	VRAM_PRIMARY_ATLAS_BASE,
	VRAM_PRIMARY_ATLAS_SIZE,
	VRAM_SECONDARY_ATLAS_BASE,
	VRAM_SECONDARY_ATLAS_SIZE,
	VRAM_STAGING_BASE,
	VRAM_STAGING_SIZE,
	VRAM_SYSTEM_ATLAS_BASE,
	VRAM_SYSTEM_ATLAS_SIZE,
} from '../memory/map';
import { CART_ROM_MAGIC, DEFAULT_GEO_WORK_UNITS_PER_SEC, DEFAULT_VDP_WORK_UNITS_PER_SEC, type CartManifest, type MachineManifest } from '../../rompack/format';
import { BmsxColors } from '../devices/vdp/vdp';
import {
	APU_GAIN_Q12_ONE,
	APU_RATE_STEP_Q16_ONE,
	APU_SAMPLE_RATE_HZ,
	APU_CHANNEL_MUSIC,
	APU_CHANNEL_SFX,
	APU_CHANNEL_UI,
	APU_CMD_PLAY,
	APU_CMD_QUEUE_PLAY,
	APU_CMD_STOP_CHANNEL,
	APU_EVENT_NONE,
	APU_EVENT_VOICE_ENDED,
	APU_FILTER_ALLPASS,
	APU_FILTER_BANDPASS,
	APU_FILTER_HIGHPASS,
	APU_FILTER_HIGHSHELF,
	APU_FILTER_LOWPASS,
	APU_FILTER_LOWSHELF,
	APU_FILTER_NONE,
	APU_FILTER_NOTCH,
	APU_FILTER_PEAKING,
	APU_PRIORITY_AUTO,
	DMA_CTRL_START,
	DMA_CTRL_STRICT,
	DMA_STATUS_BUSY,
	DMA_STATUS_CLIPPED,
	DMA_STATUS_DONE,
	DMA_STATUS_ERROR,
	DMA_STATUS_REJECTED,
	GEO_CTRL_ABORT,
	GEO_CTRL_START,
	GEO_STATUS_BUSY,
	GEO_STATUS_DONE,
	GEO_STATUS_ERROR,
	GEO_STATUS_REJECTED,
	HOST_FAULT_FLAG_ACTIVE,
	HOST_FAULT_FLAG_STARTUP_BLOCKING,
	HOST_FAULT_STAGE_NONE,
	HOST_FAULT_STAGE_STARTUP_AUDIO_REFRESH,
	GEO_FAULT_ABORTED_BY_HOST,
	GEO_FAULT_BAD_RECORD_ALIGNMENT,
	GEO_FAULT_BAD_RECORD_FLAGS,
	GEO_FAULT_BAD_VERTEX_COUNT,
	GEO_FAULT_DESCRIPTOR_KIND,
	GEO_FAULT_DST_RANGE,
	GEO_FAULT_NUMERIC_OVERFLOW_INTERNAL,
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
	GEO_PRIMITIVE_AABB,
	GEO_PRIMITIVE_CIRCLE,
	GEO_PRIMITIVE_CONVEX_POLY,
	GEO_SAT_META_AXIS_MASK,
	GEO_SAT_META_SHAPE_AUX,
	GEO_SAT_META_SHAPE_SHIFT,
	GEO_SAT_META_SHAPE_SRC,
	GEO_SHAPE_CONVEX_POLY,
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
	IO_APU_CHANNEL,
	IO_APU_CMD,
	IO_APU_CROSSFADE_SAMPLES,
	IO_APU_EVENT_CHANNEL,
	IO_APU_EVENT_HANDLE,
	IO_APU_EVENT_KIND,
	IO_APU_EVENT_SEQ,
	IO_APU_EVENT_VOICE,
	IO_APU_FADE_SAMPLES,
	IO_APU_FILTER_FREQ_HZ,
	IO_APU_FILTER_GAIN_MILLIDB,
	IO_APU_FILTER_KIND,
	IO_APU_FILTER_Q_MILLI,
	IO_APU_GAIN_Q12,
	IO_APU_HANDLE,
	IO_APU_PRIORITY,
	IO_APU_RATE_STEP_Q16,
	IO_APU_START_SAMPLE,
	IO_APU_START_AT_LOOP,
	IO_APU_START_FRESH,
	IO_APU_STATUS,
	IO_APU_SYNC_LOOP,
	IO_CMD_VDP_BLIT,
	IO_CMD_VDP_CLEAR,
	IO_CMD_VDP_DRAW_LINE,
	IO_CMD_VDP_FILL_RECT,
	IO_CMD_VDP_GLYPH_RUN,
	IO_CMD_VDP_TILE_RUN,
	IO_CMD_GEO_OVERLAP2D_PASS,
	IO_CMD_GEO_PROJECT3_BATCH,
	IO_CMD_GEO_SAT2_BATCH,
	IO_CMD_GEO_XFORM2_BATCH,
	IO_CMD_GEO_XFORM3_BATCH,
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
	IO_SYS_BOOT_CART,
	IO_SYS_CART_BOOTREADY,
	IO_SYS_HOST_FAULT_FLAGS,
	IO_SYS_HOST_FAULT_STAGE,
	IO_VDP_DITHER,
	IO_VDP_CMD,
	IO_VDP_CMD_ARG_COUNT,
	IO_VDP_FIFO,
	IO_VDP_FIFO_CTRL,
	IO_VDP_PRIMARY_ATLAS_ID,
	IO_VDP_RD_DATA,
	IO_VDP_RD_MODE,
	IO_VDP_RD_STATUS,
	IO_VDP_RD_SURFACE,
	IO_VDP_RD_X,
	IO_VDP_RD_Y,
	IO_VDP_SECONDARY_ATLAS_ID,
	IO_VDP_STATUS,
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
	VDP_ATLAS_ID_NONE,
	VDP_FIFO_CTRL_SEAL,
	VDP_RD_MODE_RGBA8888,
	VDP_RD_STATUS_OVERFLOW,
	VDP_RD_STATUS_READY,
	VDP_STATUS_SUBMIT_BUSY,
	VDP_STATUS_SUBMIT_REJECTED,
	VDP_STATUS_VBLANK,
} from '../bus/io';
import {
	buildMarshalContext,
	describeMarshalSegment,
	extendMarshalContext,
	getOrAssignTableId,
	getOrCreateAssetsNativeObject,
	getOrCreateNativeObject,
	nextNativeEntry,
	pushNativePairsIterator,
	toNativeValue,
	toRuntimeValue,
	wrapNativeResult,
} from './js_bridge';
import { collectApiMembers } from './api/members';
import { buildLuaFrameRawLabel } from '../../ide/editor/contrib/runtime_error/format';
import { isStringValue, stringValueToString } from '../memory/string/pool';

import type { StringValue } from '../memory/string/pool';
import type { LuaMarshalContext } from '../runtime/contracts';
import type { Runtime } from '../runtime/runtime';
import * as luaPipeline from '../../ide/runtime/lua_pipeline';
import { callClosureInto } from '../program/executor';
import { compileLoadChunk } from '../program/load_compiler';

const ACTION_STATE_FLAG_PRESSED = 1 << 0;
const ACTION_STATE_FLAG_JUSTPRESSED = 1 << 1;
const ACTION_STATE_FLAG_JUSTRELEASED = 1 << 2;
const ACTION_STATE_FLAG_CONSUMED = 1 << 5;
const ACTION_STATE_FLAG_GUARDEDJUSTPRESSED = 1 << 9;
const ACTION_STATE_FLAG_REPEATPRESSED = 1 << 10;

// start repeated-sequence-acceptable -- Lua tostring semantics live in firmware; disassembler formatting is intentionally separate.
export function valueToString(value: Value): string {
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
	if (isStringValue(value)) {
		return stringValueToString(value);
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

export function valueToStringValue(runtime: Runtime, value: Value): StringValue {
	return runtime.internString(valueToString(value));
}

function buildMachineManifestTable(runtime: Runtime, manifest: MachineManifest): Table {
	const table = new Table(0, 5);
	if (manifest.namespace.length > 0) {
		table.set(runtime.luaKey('namespace'), runtime.internString(manifest.namespace));
	}
	if (manifest.ufps) {
		table.set(runtime.luaKey('ufps'), manifest.ufps);
	}
	if (manifest.render_size.width > 0 && manifest.render_size.height > 0) {
		const renderSize = new Table(0, 2);
		renderSize.set(runtime.luaKey('width'), manifest.render_size.width);
		renderSize.set(runtime.luaKey('height'), manifest.render_size.height);
		table.set(runtime.luaKey('render_size'), renderSize);
	}
	const specs = new Table(0, 5);
	const specCpu = manifest.specs.cpu;
	const cpu = new Table(0, 2);
	if (specCpu.cpu_freq_hz) {
		cpu.set(runtime.luaKey('cpu_freq_hz'), specCpu.cpu_freq_hz);
	}
	if (specCpu.imgdec_bytes_per_sec) {
		cpu.set(runtime.luaKey('imgdec_bytes_per_sec'), specCpu.imgdec_bytes_per_sec);
	}
	specs.set(runtime.luaKey('cpu'), cpu);
	const specDma = manifest.specs.dma;
	const dma = new Table(0, 2);
	if (specDma.dma_bytes_per_sec_iso) {
		dma.set(runtime.luaKey('dma_bytes_per_sec_iso'), specDma.dma_bytes_per_sec_iso);
	}
	if (specDma.dma_bytes_per_sec_bulk) {
		dma.set(runtime.luaKey('dma_bytes_per_sec_bulk'), specDma.dma_bytes_per_sec_bulk);
	}
	specs.set(runtime.luaKey('dma'), dma);
	const vdp = new Table(0, 1);
	vdp.set(runtime.luaKey('work_units_per_sec'), manifest.specs.vdp?.work_units_per_sec ?? DEFAULT_VDP_WORK_UNITS_PER_SEC);
	specs.set(runtime.luaKey('vdp'), vdp);
	const geo = new Table(0, 1);
	geo.set(runtime.luaKey('work_units_per_sec'), manifest.specs.geo?.work_units_per_sec ?? DEFAULT_GEO_WORK_UNITS_PER_SEC);
	specs.set(runtime.luaKey('geo'), geo);
	const ram = manifest.specs.ram;
	if (ram?.ram_bytes) {
		const ramTable = new Table(0, 1);
		ramTable.set(runtime.luaKey('ram_bytes'), ram.ram_bytes);
		specs.set(runtime.luaKey('ram'), ramTable);
	}
	const vram = manifest.specs.vram;
	if (vram && (vram.atlas_slot_bytes || vram.system_atlas_slot_bytes || vram.staging_bytes)) {
		const vramTable = new Table(0, 3);
		if (vram.atlas_slot_bytes) {
			vramTable.set(runtime.luaKey('atlas_slot_bytes'), vram.atlas_slot_bytes);
		}
		if (vram.system_atlas_slot_bytes) {
			vramTable.set(runtime.luaKey('system_atlas_slot_bytes'), vram.system_atlas_slot_bytes);
		}
		if (vram.staging_bytes) {
			vramTable.set(runtime.luaKey('staging_bytes'), vram.staging_bytes);
		}
		specs.set(runtime.luaKey('vram'), vramTable);
	}
	const voices = manifest.specs.audio?.max_voices;
	if (voices && (voices.sfx || voices.music || voices.ui)) {
		const audio = new Table(0, 1);
		const maxVoices = new Table(0, 3);
		if (voices.sfx) {
			maxVoices.set(runtime.luaKey('sfx'), voices.sfx);
		}
		if (voices.music) {
			maxVoices.set(runtime.luaKey('music'), voices.music);
		}
		if (voices.ui) {
			maxVoices.set(runtime.luaKey('ui'), voices.ui);
		}
		audio.set(runtime.luaKey('max_voices'), maxVoices);
		specs.set(runtime.luaKey('audio'), audio);
	}
	table.set(runtime.luaKey('specs'), specs);
	return table;
}

function buildCartManifestTable(runtime: Runtime, manifest: CartManifest, machine: MachineManifest, entryPath: string): Table {
	const table = new Table(0, 4);
	if (manifest.title !== undefined && manifest.title.length > 0) {
		table.set(runtime.luaKey('title'), runtime.internString(manifest.title));
	}
	if (manifest.short_name !== undefined && manifest.short_name.length > 0) {
		table.set(runtime.luaKey('short_name'), runtime.internString(manifest.short_name));
	}
	if (manifest.rom_name !== undefined && manifest.rom_name.length > 0) {
		table.set(runtime.luaKey('rom_name'), runtime.internString(manifest.rom_name));
	}
	table.set(runtime.luaKey('machine'), buildMachineManifestTable(runtime, machine));
	const lua = new Table(0, 1);
	lua.set(runtime.luaKey('entry_path'), runtime.internString(entryPath));
	table.set(runtime.luaKey('lua'), lua);
	return table;
}

class LuaThrownValueError extends Error {
	public readonly value: Value;

	public constructor(value: Value) {
		super(valueToString(value));
		this.name = 'LuaThrownValueError';
		this.value = value;
	}
}

export function formatLuaString(runtime: Runtime, template: string, args: ReadonlyArray<Value>, argStart: number): string {
	let argumentIndex = argStart;
	let output = '';

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
				let text = value === null ? 'nil' : valueToString(value);
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
				const raw = value === null ? 'nil' : valueToString(value);
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

function pushResolvedRomAssetRange(runtime: Runtime, args: ReadonlyArray<Value>, out: Value[], scope: 'cart' | 'sys'): void {
	const assetId = stringValueToString(args[0] as StringValue);
	const range = runtime.assets.resolveRomAssetRange(assetId, scope);
	out.push(range.romBase);
	out.push(range.start);
	out.push(range.end);
}

export function seedLuaGlobals(runtime: Runtime): void {
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
	const paletteRKey = key('r');
	const paletteGKey = key('g');
	const paletteBKey = key('b');
	const paletteAKey = key('a');
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
		if (isStringValue(value)) {
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
			const visited = runtime.luaScratch.acquireTableMarshal();
			try {
				table.forEachEntry((keyValue, value) => {
					if (typeof keyValue === 'number' && Number.isInteger(keyValue) && keyValue >= 1) {
						output[keyValue - 1] = toNativeValue(runtime, value, extendMarshalContext(tableContext, String(keyValue)), visited);
						return;
					}
					const segment = describeMarshalSegment(keyValue);
					const nextContext = segment ? extendMarshalContext(tableContext, segment) : tableContext;
					output.push(toNativeValue(runtime, value, nextContext, visited));
				});
				return output;
			} finally {
				runtime.luaScratch.releaseTableMarshal(visited);
			}
		};

	const exposeObjects = (): void => {
		const entries: Array<[string, object]> = [
			['game', $],
			['$', $],
		];
		for (const [name, object] of entries) {
			luaPipeline.registerGlobal(runtime, name, getOrCreateNativeObject(runtime, object));
		}
		luaPipeline.registerGlobal(runtime, 'assets', getOrCreateAssetsNativeObject(runtime));
		const cartManifest = $.cart_manifest;
		luaPipeline.registerGlobal(runtime, 'cart_manifest', cartManifest === null ? null : buildCartManifestTable(runtime, cartManifest, $.machine_manifest, cartManifest.lua.entry_path));
		luaPipeline.registerGlobal(runtime, 'machine_manifest', buildMachineManifestTable(runtime, $.machine_manifest));
		luaPipeline.registerGlobal(runtime, 'cart_project_root_path', $.cart_project_root_path === null ? null : runtime.internString($.cart_project_root_path));
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
		const seedValue = args.length > 0 ? (args[0] as number) : $.platform.clock.now();
		luaPipeline.setRandomSeed(runtime, Math.floor(seedValue) >>> 0);
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
	luaPipeline.registerGlobal(runtime, 'sys_cart_bootready', IO_SYS_CART_BOOTREADY);
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
	const maxAssets = Math.floor((ASSET_TABLE_SIZE - ASSET_TABLE_HEADER_SIZE) / ASSET_TABLE_ENTRY_SIZE);
	luaPipeline.registerGlobal(runtime, 'sys_max_assets', maxAssets);
	luaPipeline.registerGlobal(runtime, 'sys_max_cycles_per_frame', runtime.timing.cycleBudgetPerFrame);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_dither', IO_VDP_DITHER);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_cmd', IO_VDP_CMD);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_cmd_arg_count', IO_VDP_CMD_ARG_COUNT);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_stream_base', VDP_STREAM_BUFFER_BASE);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_stream_capacity_words', VDP_STREAM_CAPACITY_WORDS);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_stream_packet_header_words', VDP_STREAM_PACKET_HEADER_WORDS);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_fifo', IO_VDP_FIFO);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_fifo_ctrl', IO_VDP_FIFO_CTRL);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_fifo_ctrl_seal', VDP_FIFO_CTRL_SEAL);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_primary_atlas_id', IO_VDP_PRIMARY_ATLAS_ID);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_secondary_atlas_id', IO_VDP_SECONDARY_ATLAS_ID);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_atlas_none', VDP_ATLAS_ID_NONE);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_rd_surface', IO_VDP_RD_SURFACE);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_rd_x', IO_VDP_RD_X);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_rd_y', IO_VDP_RD_Y);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_rd_mode', IO_VDP_RD_MODE);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_rd_status', IO_VDP_RD_STATUS);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_rd_data', IO_VDP_RD_DATA);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_status', IO_VDP_STATUS);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_rd_mode_rgba8888', VDP_RD_MODE_RGBA8888);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_rd_status_ready', VDP_RD_STATUS_READY);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_rd_status_overflow', VDP_RD_STATUS_OVERFLOW);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_status_vblank', VDP_STATUS_VBLANK);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_status_submit_busy', VDP_STATUS_SUBMIT_BUSY);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_status_submit_rejected', VDP_STATUS_SUBMIT_REJECTED);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_layer_world', 0);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_layer_ui', 1);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_layer_ide', 2);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_arg_stride', IO_ARG_STRIDE);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_cmd_clear', IO_CMD_VDP_CLEAR);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_cmd_fill_rect', IO_CMD_VDP_FILL_RECT);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_cmd_blit', IO_CMD_VDP_BLIT);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_cmd_draw_line', IO_CMD_VDP_DRAW_LINE);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_cmd_glyph_run', IO_CMD_VDP_GLYPH_RUN);
	luaPipeline.registerGlobal(runtime, 'sys_vdp_cmd_tile_run', IO_CMD_VDP_TILE_RUN);
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
	luaPipeline.registerGlobal(runtime, 'sys_apu_handle', IO_APU_HANDLE);
	luaPipeline.registerGlobal(runtime, 'sys_apu_channel', IO_APU_CHANNEL);
	luaPipeline.registerGlobal(runtime, 'sys_apu_priority', IO_APU_PRIORITY);
	luaPipeline.registerGlobal(runtime, 'sys_apu_rate_step_q16', IO_APU_RATE_STEP_Q16);
	luaPipeline.registerGlobal(runtime, 'sys_apu_gain_q12', IO_APU_GAIN_Q12);
	luaPipeline.registerGlobal(runtime, 'sys_apu_start_sample', IO_APU_START_SAMPLE);
	luaPipeline.registerGlobal(runtime, 'sys_apu_filter_kind', IO_APU_FILTER_KIND);
	luaPipeline.registerGlobal(runtime, 'sys_apu_filter_freq_hz', IO_APU_FILTER_FREQ_HZ);
	luaPipeline.registerGlobal(runtime, 'sys_apu_filter_q_milli', IO_APU_FILTER_Q_MILLI);
	luaPipeline.registerGlobal(runtime, 'sys_apu_filter_gain_millidb', IO_APU_FILTER_GAIN_MILLIDB);
	luaPipeline.registerGlobal(runtime, 'sys_apu_fade_samples', IO_APU_FADE_SAMPLES);
	luaPipeline.registerGlobal(runtime, 'sys_apu_crossfade_samples', IO_APU_CROSSFADE_SAMPLES);
	luaPipeline.registerGlobal(runtime, 'sys_apu_sync_loop', IO_APU_SYNC_LOOP);
	luaPipeline.registerGlobal(runtime, 'sys_apu_start_at_loop', IO_APU_START_AT_LOOP);
	luaPipeline.registerGlobal(runtime, 'sys_apu_start_fresh', IO_APU_START_FRESH);
	luaPipeline.registerGlobal(runtime, 'sys_apu_cmd', IO_APU_CMD);
	luaPipeline.registerGlobal(runtime, 'sys_apu_status', IO_APU_STATUS);
	luaPipeline.registerGlobal(runtime, 'sys_apu_event_kind', IO_APU_EVENT_KIND);
	luaPipeline.registerGlobal(runtime, 'sys_apu_event_channel', IO_APU_EVENT_CHANNEL);
	luaPipeline.registerGlobal(runtime, 'sys_apu_event_handle', IO_APU_EVENT_HANDLE);
	luaPipeline.registerGlobal(runtime, 'sys_apu_event_voice', IO_APU_EVENT_VOICE);
	luaPipeline.registerGlobal(runtime, 'sys_apu_event_seq', IO_APU_EVENT_SEQ);
	luaPipeline.registerGlobal(runtime, 'apu_cmd_play', APU_CMD_PLAY);
	luaPipeline.registerGlobal(runtime, 'apu_cmd_stop_channel', APU_CMD_STOP_CHANNEL);
	luaPipeline.registerGlobal(runtime, 'apu_cmd_queue_play', APU_CMD_QUEUE_PLAY);
	luaPipeline.registerGlobal(runtime, 'apu_channel_sfx', APU_CHANNEL_SFX);
	luaPipeline.registerGlobal(runtime, 'apu_channel_music', APU_CHANNEL_MUSIC);
	luaPipeline.registerGlobal(runtime, 'apu_channel_ui', APU_CHANNEL_UI);
	luaPipeline.registerGlobal(runtime, 'apu_sample_rate_hz', APU_SAMPLE_RATE_HZ);
	luaPipeline.registerGlobal(runtime, 'apu_rate_step_q16_one', APU_RATE_STEP_Q16_ONE);
	luaPipeline.registerGlobal(runtime, 'apu_gain_q12_one', APU_GAIN_Q12_ONE);
	luaPipeline.registerGlobal(runtime, 'apu_priority_auto', APU_PRIORITY_AUTO);
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
	luaPipeline.registerGlobal(runtime, 'apu_event_voice_ended', APU_EVENT_VOICE_ENDED);
	luaPipeline.registerGlobal(runtime, 'inp_ctrl_commit', INP_CTRL_COMMIT);
	luaPipeline.registerGlobal(runtime, 'inp_ctrl_arm', INP_CTRL_ARM);
	luaPipeline.registerGlobal(runtime, 'inp_ctrl_reset', INP_CTRL_RESET);
	luaPipeline.registerGlobal(runtime, 'inp_pressed', ACTION_STATE_FLAG_PRESSED);
	luaPipeline.registerGlobal(runtime, 'inp_justpressed', ACTION_STATE_FLAG_JUSTPRESSED);
	luaPipeline.registerGlobal(runtime, 'inp_justreleased', ACTION_STATE_FLAG_JUSTRELEASED);
	luaPipeline.registerGlobal(runtime, 'inp_consumed', ACTION_STATE_FLAG_CONSUMED);
	luaPipeline.registerGlobal(runtime, 'inp_guardedjustpressed', ACTION_STATE_FLAG_GUARDEDJUSTPRESSED);
	luaPipeline.registerGlobal(runtime, 'inp_repeatpressed', ACTION_STATE_FLAG_REPEATPRESSED);
	luaPipeline.registerGlobal(runtime, 'sys_rom_system_base', SYSTEM_ROM_BASE);
	luaPipeline.registerGlobal(runtime, 'sys_rom_cart_base', CART_ROM_BASE);
	luaPipeline.registerGlobal(runtime, 'sys_rom_overlay_base', OVERLAY_ROM_BASE);
	luaPipeline.registerGlobal(runtime, 'sys_rom_overlay_size', runtime.machine.memory.getOverlayRomSize());
	luaPipeline.registerGlobal(runtime, 'resolve_cart_rom_asset_range', createNativeFunction('resolve_cart_rom_asset_range', (args, out) => {
		pushResolvedRomAssetRange(runtime, args, out, 'cart');
	}));
	luaPipeline.registerGlobal(runtime, 'resolve_sys_rom_asset_range', createNativeFunction('resolve_sys_rom_asset_range', (args, out) => {
		pushResolvedRomAssetRange(runtime, args, out, 'sys');
	}));
	luaPipeline.registerGlobal(runtime, 'resolve_rom_asset_range', createNativeFunction('resolve_rom_asset_range', (args, out) => {
		pushResolvedRomAssetRange(runtime, args, out, 'sys');
	}));
	luaPipeline.registerGlobal(runtime, 'sys_vram_system_atlas_base', VRAM_SYSTEM_ATLAS_BASE);
	luaPipeline.registerGlobal(runtime, 'sys_vram_primary_atlas_base', VRAM_PRIMARY_ATLAS_BASE);
	luaPipeline.registerGlobal(runtime, 'sys_vram_secondary_atlas_base', VRAM_SECONDARY_ATLAS_BASE);
	luaPipeline.registerGlobal(runtime, 'sys_vram_framebuffer_base', VRAM_FRAMEBUFFER_BASE);
	luaPipeline.registerGlobal(runtime, 'sys_vram_staging_base', VRAM_STAGING_BASE);
	luaPipeline.registerGlobal(runtime, 'sys_vram_system_atlas_size', VRAM_SYSTEM_ATLAS_SIZE);
	luaPipeline.registerGlobal(runtime, 'sys_vram_primary_atlas_size', VRAM_PRIMARY_ATLAS_SIZE);
	luaPipeline.registerGlobal(runtime, 'sys_vram_secondary_atlas_size', VRAM_SECONDARY_ATLAS_SIZE);
	luaPipeline.registerGlobal(runtime, 'sys_vram_framebuffer_size', VRAM_FRAMEBUFFER_SIZE);
	luaPipeline.registerGlobal(runtime, 'sys_vram_staging_size', VRAM_STAGING_SIZE);
	luaPipeline.registerGlobal(runtime, 'sys_vram_size', runtime.machine.resourceUsageDetector.getVramTotalBytes());
	luaPipeline.registerGlobal(runtime, 'sys_palette_color', createNativeFunction('sys_palette_color', (args, out) => {
		const index = args[0] as number;
		if (!Number.isInteger(index)) {
			throw runtime.createApiRuntimeError('sys_palette_color(index) requires an integer palette index.');
		}
		const color = BmsxColors[index];
		if (color === undefined) {
			throw runtime.createApiRuntimeError(`sys_palette_color(index) index ${index} is outside the palette range.`);
		}
		const table = new Table(0, 4);
		table.set(paletteRKey, color.r);
		table.set(paletteGKey, color.g);
		table.set(paletteBKey, color.b);
		table.set(paletteAKey, color.a);
		out.push(table);
	}));
	luaPipeline.registerGlobal(runtime, 'sys_cpu_cycles_used', createNativeFunction('sys_cpu_cycles_used', (_args, out) => {
		out.push(runtime.frameScheduler.lastTickCpuUsedCycles);
	}));
	luaPipeline.registerGlobal(runtime, 'sys_cpu_cycles_granted', createNativeFunction('sys_cpu_cycles_granted', (_args, out) => {
		out.push(runtime.frameScheduler.lastTickCpuBudgetGranted);
	}));
	luaPipeline.registerGlobal(runtime, 'sys_cpu_active_cycles_used', createNativeFunction('sys_cpu_active_cycles_used', (_args, out) => {
		out.push(runtime.frameScheduler.lastTickCpuUsedCycles);
	}));
	luaPipeline.registerGlobal(runtime, 'sys_cpu_active_cycles_granted', createNativeFunction('sys_cpu_active_cycles_granted', (_args, out) => {
		out.push(runtime.frameScheduler.lastTickCpuBudgetGranted);
	}));
	luaPipeline.registerGlobal(runtime, 'sys_ram_used', createNativeFunction('sys_ram_used', (_args, out) => {
		out.push(runtime.machine.resourceUsageDetector.getRamUsedBytes());
	}));
	luaPipeline.registerGlobal(runtime, 'sys_vram_used', createNativeFunction('sys_vram_used', (_args, out) => {
		out.push(runtime.machine.resourceUsageDetector.getVramUsedBytes());
	}));
	luaPipeline.registerGlobal(runtime, 'sys_vdp_work_units_per_sec', createNativeFunction('sys_vdp_work_units_per_sec', (_args, out) => {
		out.push(runtime.timing.vdpWorkUnitsPerSec);
	}));
	luaPipeline.registerGlobal(runtime, 'sys_vdp_work_units_last', createNativeFunction('sys_vdp_work_units_last', (_args, out) => {
		out.push(runtime.frameScheduler.lastTickVdpFrameCost);
	}));
	luaPipeline.registerGlobal(runtime, 'sys_vdp_frame_held', createNativeFunction('sys_vdp_frame_held', (_args, out) => {
		out.push(runtime.frameScheduler.lastTickVdpFrameHeld ? 1 : 0);
	}));
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
	luaPipeline.registerGlobal(runtime, 'sys_geo_ctrl_start', GEO_CTRL_START);
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
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_mode_candidate_pairs', GEO_OVERLAP2D_MODE_CANDIDATE_PAIRS);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_mode_full_pass', GEO_OVERLAP2D_MODE_FULL_PASS);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_broadphase_none', GEO_OVERLAP2D_BROADPHASE_NONE);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_broadphase_local_bounds_aabb', GEO_OVERLAP2D_BROADPHASE_LOCAL_BOUNDS_AABB);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_contact_clipped_feature', GEO_OVERLAP2D_CONTACT_POLICY_CLIPPED_FEATURE);
	luaPipeline.registerGlobal(runtime, 'sys_geo_overlap_output_stop_on_overflow', GEO_OVERLAP2D_OUTPUT_POLICY_STOP_ON_OVERFLOW);
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
		out.push($.platform.clock.now());
	}));
	luaPipeline.registerGlobal(runtime, 'type', createNativeFunction('type', (args, out) => {
		const value = args.length > 0 ? args[0] : null;
		out.push(typeOfValue(value));
	}));
	luaPipeline.registerGlobal(runtime, 'tostring', createNativeFunction('tostring', (args, out) => {
		const value = args.length > 0 ? args[0] : null;
		out.push(valueToStringValue(runtime, value));
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
		if (isStringValue(value)) {
			const text = stringValueToString(value);
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
			throw new LuaThrownValueError(message);
		}
		for (let index = 0; index < args.length; index += 1) {
			out.push(args[index]);
		}
	}));
	luaPipeline.registerGlobal(runtime, 'error', createNativeFunction('error', (args, out) => {
		void out;
		const message = args.length > 0 ? args[0] : runtime.internString('error');
		throw new LuaThrownValueError(message);
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
			target.setMetatable(metatable);
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
			out.push(target.getMetatable());
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
		if (isStringValue(index) && stringValueToString(index) === '#') {
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
		const callArgs = runtime.luaScratch.acquireValue();
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
			runtime.luaScratch.releaseValue(callArgs);
		}
	}));
	luaPipeline.registerGlobal(runtime, 'xpcall', createNativeFunction('xpcall', (args, out) => {
		const fn = args[0];
		const handler = args[1];
		const callArgs = runtime.luaScratch.acquireValue();
		const handlerArgs = runtime.luaScratch.acquireValue();
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
			runtime.luaScratch.releaseValue(handlerArgs);
			runtime.luaScratch.releaseValue(callArgs);
		}
	}));
	luaPipeline.registerGlobal(runtime, 'loadstring', createNativeFunction('loadstring', (args, out) => {
		if (!isStringValue(args[0])) {
			throw runtime.createApiRuntimeError('loadstring(source [, chunkname]) requires a string source.');
		}
		if (args.length > 1 && args[1] !== null && !isStringValue(args[1])) {
			throw runtime.createApiRuntimeError('loadstring(source [, chunkname]) requires a string chunkname.');
		}
		const source = luaPipeline.requireString(args[0]);
		const chunkName = args.length > 1 && args[1] !== null ? luaPipeline.requireString(args[1]) : 'loadstring';
		try {
			out.push(compileLoadChunk(runtime, source, chunkName));
		} catch (error) {
			out.push(null);
			out.push(runtime.internString(extractErrorMessage(error)));
		}
	}));
	luaPipeline.registerGlobal(runtime, 'load', createNativeFunction('load', (args, out) => {
		if (!isStringValue(args[0])) {
			throw runtime.createApiRuntimeError('load(source [, chunkname [, mode]]) requires a string source.');
		}
		if (args.length > 2 && args[2] !== null) {
			if (!isStringValue(args[2])) {
				throw runtime.createApiRuntimeError('load(source [, chunkname [, mode]]) requires mode to be a string.');
			}
			const mode = luaPipeline.requireString(args[2]);
			if (mode !== 't' && mode !== 'bt') {
				throw runtime.createApiRuntimeError("load only supports text mode ('t' or 'bt').");
			}
		}
		if (args.length > 1 && args[1] !== null && !isStringValue(args[1])) {
			throw runtime.createApiRuntimeError('load(source [, chunkname [, mode]]) requires chunkname to be a string.');
		}
		if (args.length > 3 && args[3] !== null) {
			throw runtime.createApiRuntimeError('load does not support the environment argument.');
		}
		const source = luaPipeline.requireString(args[0]);
		const chunkName = args.length > 1 && args[1] !== null ? luaPipeline.requireString(args[1]) : 'load';
		try {
			out.push(compileLoadChunk(runtime, source, chunkName));
		} catch (error) {
			out.push(null);
			out.push(runtime.internString(extractErrorMessage(error)));
		}
	}));
	luaPipeline.registerGlobal(runtime, 'require', createNativeFunction('require', (args, out) => {
		const moduleName = luaPipeline.requireString(args[0]).trim();
		out.push(luaPipeline.requireModule(runtime, moduleName));
	}));
	luaPipeline.registerGlobal(runtime, 'array', createNativeFunction('array', (args, out) => {
		const ctxBase = buildMarshalContext(runtime);
		let result: unknown[] = [];
		if (args.length === 1 && args[0] instanceof Table) {
			result = createNativeArrayFromTable(args[0], ctxBase);
		} else {
			result = new Array(args.length);
			const visited = runtime.luaScratch.acquireTableMarshal();
			try {
				for (let index = 0; index < args.length; index += 1) {
					result[index] = toNativeValue(runtime, args[index], ctxBase, visited);
				}
			} finally {
				runtime.luaScratch.releaseTableMarshal(visited);
			}
		}
		out.push(getOrCreateNativeObject(runtime, result));
	}));
	luaPipeline.registerGlobal(runtime, 'print', createNativeFunction('print', (args, out) => {
		const parts: string[] = [];
		for (let index = 0; index < args.length; index += 1) {
			parts.push(valueToString(args[index]));
		}
		const text = parts.length === 0 ? '' : parts.join('\t');
		runtime.terminal.appendStdout(text);
		// eslint-disable-next-line no-console
		console.log(text);
		out.length = 0;
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
		const text = luaPipeline.requireString(args[0]);
		const maxChars = Math.floor(args[1] as number);
		const firstPrefix = args.length > 2 && args[2] !== null ? luaPipeline.requireString(args[2]) : '';
		const nextPrefix = args.length > 3 && args[3] !== null ? luaPipeline.requireString(args[3]) : firstPrefix;
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
		out.push(runtime.machine.cpu.getStringPool().codepointCount(value));
	}));
	setKey(stringTable, 'upper', createNativeFunction('string.upper', (args, out) => {
		const text = luaPipeline.requireString(args[0]);
		out.push(runtime.internString(text.toUpperCase()));
	}));
	setKey(stringTable, 'lower', createNativeFunction('string.lower', (args, out) => {
		const text = luaPipeline.requireString(args[0]);
		out.push(runtime.internString(text.toLowerCase()));
	}));
	setKey(stringTable, 'rep', createNativeFunction('string.rep', (args, out) => {
		const text = luaPipeline.requireString(args[0]);
		const count = Math.floor(args.length > 1 ? (args[1] as number) : 1);
		if (count <= 0) {
			out.push(runtime.internString(''));
			return;
		}
		const hasSeparator = args.length > 2 && args[2] !== null;
		const separator = hasSeparator ? luaPipeline.requireString(args[2]) : '';
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
		const text = stringValueToString(value);
		const length = runtime.machine.cpu.getStringPool().codepointCount(value);
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
		const source = stringValueToString(sourceValue);
		const pattern = args.length > 1 ? stringValueToString(args[1] as StringValue) : '';
		const length = runtime.machine.cpu.getStringPool().codepointCount(sourceValue);
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
		const source = stringValueToString(sourceValue);
		const pattern = args.length > 1 ? stringValueToString(args[1] as StringValue) : '';
		const length = runtime.machine.cpu.getStringPool().codepointCount(sourceValue);
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
		const source = luaPipeline.requireString(args[0]);
		const pattern = args.length > 1 ? luaPipeline.requireString(args[1]) : '';
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
		const fnArgs = runtime.luaScratch.acquireValue();
		const fnResults = runtime.luaScratch.acquireValue();
		try {
			const renderReplacement = (match: RegExpExecArray): string => {
				if (isStringValue(replacement) || typeof replacement === 'number') {
					const template = isStringValue(replacement) ? stringValueToString(replacement) : String(replacement);
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
					return mapped === null ? match[0] : valueToString(mapped);
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
					return valueToString(value);
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
			runtime.luaScratch.releaseValue(fnResults);
			runtime.luaScratch.releaseValue(fnArgs);
		}
	}));
	setKey(stringTable, 'gmatch', createNativeFunction('string.gmatch', (args, out) => {
		const source = luaPipeline.requireString(args[0]);
		const pattern = args.length > 1 ? luaPipeline.requireString(args[1]) : '';
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
		const source = luaPipeline.requireString(args[0]);
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
		const template = luaPipeline.requireString(args[0]);
		const formatted = formatLuaString(runtime, template, args, 1);
		out.push(runtime.internString(formatted));
	}));
	runtime.machine.cpu.setStringIndexTable(stringTable);
	luaPipeline.registerGlobal(runtime, 'string', stringTable);

	const tableLibrary = new Table(0, 0);
	setKey(tableLibrary, 'insert', createNativeFunction('table.insert', (args, out) => {
		const target = args[0] as Table;
		let position: number;
		let value: Value;
		if (args.length === 2) {
			value = args[1];
			position = target.length() + 1;
		} else {
			position = Math.floor(args[1] as number);
			value = args[2];
		}
		const length = target.length();
		for (let index = length; index >= position; index -= 1) {
			target.set(index + 1, target.get(index));
		}
		target.set(position, value);
		out.length = 0;
	}));
	setKey(tableLibrary, 'remove', createNativeFunction('table.remove', (args, out) => {
		const target = args[0] as Table;
		const position = args.length > 1 ? Math.floor(args[1] as number) : target.length();
		const length = target.length();
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
		const separator = args.length > 1 ? luaPipeline.requireString(args[1]) : '';
		const length = target.length();
		const startIndex = args.length > 2 ? normalizeLuaIndex(args[2] as number, length, 1) : 1;
		const endIndex = args.length > 3 ? normalizeLuaIndex(args[3] as number, length, length) : length;
		if (endIndex < startIndex) {
			out.push(runtime.internString(''));
			return;
		}
		const parts = runtime.luaScratch.acquireString();
		try {
			for (let index = startIndex; index <= endIndex; index += 1) {
				const value = target.get(index);
				parts.push(value === null ? '' : valueToString(value));
			}
			out.push(runtime.internString(parts.join(separator)));
		} finally {
			runtime.luaScratch.releaseString(parts);
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
		const length = target.length();
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
		const length = target.length();
		const values = runtime.luaScratch.acquireValue();
		const comparatorArgs = runtime.luaScratch.acquireValue();
		const comparatorResults = runtime.luaScratch.acquireValue();
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
				if (isStringValue(left) && isStringValue(right)) {
					if (left === right) {
						return 0;
					}
					return stringValueToString(left) < stringValueToString(right) ? -1 : 1;
				}
				throw runtime.createApiRuntimeError('table.sort comparison expects numbers or strings.');
			});
			for (let index = 1; index <= length; index += 1) {
				target.set(index, values[index - 1]);
			}
			out.push(target);
		} finally {
			runtime.luaScratch.releaseValue(comparatorResults);
			runtime.luaScratch.releaseValue(comparatorArgs);
			runtime.luaScratch.releaseValue(values);
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
		out.push($.platform.clock.now() / 1000);
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
		const format = args.length > 0 && args[0] !== null ? luaPipeline.requireString(args[0]) : '%c';
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
			throw runtime.createApiRuntimeError(`pairs expects a table or native object (got ${valueToString(target)}). stack=${stack}`);
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

	const members = collectApiMembers(runtime.api);
	for (const { name, kind, descriptor } of members) {
		if (kind === 'method') {
			const callable = descriptor.value as (...args: unknown[]) => unknown;
			const native = createNativeFunction(`api.${name}`, (args, out) => {
				const ctxBase = buildMarshalContext(runtime);
				const visited = runtime.luaScratch.acquireTableMarshal();
				const jsArgs = runtime.luaScratch.acquireValue() as unknown[];
				try {
					for (let index = 0; index < args.length; index += 1) {
						const nextCtx = extendMarshalContext(ctxBase, `arg${index}`);
						jsArgs.push(toNativeValue(runtime, args[index], nextCtx, visited));
					}
					const result = callable.apply(runtime.api, jsArgs);
					wrapNativeResult(runtime, result, out);
				} catch (error) {
					const message = extractErrorMessage(error);
					throw runtime.createApiRuntimeError(`[api.${name}] ${message}`);
				} finally {
					runtime.luaScratch.releaseValue(jsArgs as unknown as Value[]);
					runtime.luaScratch.releaseTableMarshal(visited);
				}
			});
			luaPipeline.registerGlobal(runtime, name, native);
			continue;
		}
		if (descriptor.get) {
			const getter = descriptor.get;
			const native = createNativeFunction(`api.${name}`, (_args, out) => {
				try {
					const result = getter.call(runtime.api);
					wrapNativeResult(runtime, result, out);
				} catch (error) {
					const message = extractErrorMessage(error);
					throw runtime.createApiRuntimeError(`[api.${name}] ${message}`);
				}
			});
			luaPipeline.registerGlobal(runtime, name, native);
		}
	}

	exposeObjects();
}
