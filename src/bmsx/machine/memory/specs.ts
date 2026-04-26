import type { RawAssetSource } from '../../rompack/source';
import type { MachineManifest } from '../../rompack/format';
import {
	TEXTPAGE_PRIMARY_SLOT_ID,
	TEXTPAGE_SECONDARY_SLOT_ID,
	BIOS_ATLAS_ID,
	FRAMEBUFFER_RENDER_TEXTURE_KEY,
	FRAMEBUFFER_TEXTURE_KEY,
	getMachineMemorySpecs,
	generateAtlasAssetId,
} from '../../rompack/format';
import type { RuntimeAssetLayer } from '../../rompack/loader';
import { ASSET_TABLE_ENTRY_SIZE, ASSET_TABLE_HEADER_SIZE } from './memory';
import {
	DEFAULT_GEO_SCRATCH_SIZE,
	DEFAULT_STRING_HANDLE_COUNT,
	DEFAULT_STRING_HEAP_SIZE,
	DEFAULT_VRAM_TEXTPAGE_SLOT_SIZE,
	DEFAULT_VRAM_STAGING_SIZE,
	IO_REGION_SIZE,
	IO_WORD_SIZE,
	STRING_HANDLE_ENTRY_SIZE,
	VDP_STREAM_BUFFER_SIZE,
	alignUp,
	type MemoryMapSpecs,
} from './map';
import {
	buildRuntimeLayerLookup,
	resolveRuntimeLayerAssetById,
} from './asset/layers';
import { resolvePositiveSafeInteger, resolveRuntimeRenderSize } from '../specs';

const ASSET_DATA_ALIGNMENT_BYTES = 0x1000;
const DEFAULT_ASSET_DATA_HEADROOM_BYTES = 1 << 20; // 1 MiB

function runtimeMemorySpecFault(message: string): Error {
	return new Error(`Runtime fault: ${message}`);
}

function collectAssetEntryIds(engineSource: RawAssetSource, assetSource: RawAssetSource, assetLayers: ReadonlyArray<RuntimeAssetLayer>): Set<string> {
	void assetSource;
	const layerLookup = buildRuntimeLayerLookup(assetLayers);
	const ids = new Set<string>();
	const engineTextpageId = generateAtlasAssetId(BIOS_ATLAS_ID);
	resolveRuntimeLayerAssetById(layerLookup, engineSource, 'img', engineTextpageId);
	ids.add(engineTextpageId);
	ids.add(TEXTPAGE_PRIMARY_SLOT_ID);
	ids.add(TEXTPAGE_SECONDARY_SLOT_ID);

	return ids;
}

function computeAssetTableBytes(engineSource: RawAssetSource, assetSource: RawAssetSource, assetLayers: ReadonlyArray<RuntimeAssetLayer>): { bytes: number; entryCount: number; stringBytes: number } {
	const ids = collectAssetEntryIds(engineSource, assetSource, assetLayers);
	ids.add(FRAMEBUFFER_TEXTURE_KEY);
	ids.add(FRAMEBUFFER_RENDER_TEXTURE_KEY);
	const encoder = new TextEncoder();
	let stringBytes = 0;
	for (const id of ids) {
		stringBytes += encoder.encode(id).byteLength + 1;
	}
	const entryCount = ids.size;
	const bytes = ASSET_TABLE_HEADER_SIZE + (entryCount * ASSET_TABLE_ENTRY_SIZE) + stringBytes;
	return { bytes, entryCount, stringBytes };
}

function computeRequiredAssetDataBytes(assetSource: RawAssetSource, assetLayers: ReadonlyArray<RuntimeAssetLayer>): number {
	void assetSource;
	void assetLayers;
	let requiredBytes = 0;
	requiredBytes += DEFAULT_ASSET_DATA_HEADROOM_BYTES;
	return alignUp(requiredBytes, ASSET_DATA_ALIGNMENT_BYTES);
}

function resolveEngineTextpageSlotBytes(engineSource: RawAssetSource): number {
	const engineTextpage = engineSource.getEntry(generateAtlasAssetId(BIOS_ATLAS_ID));
	if (!engineTextpage || !engineTextpage.imgmeta) {
		throw runtimeMemorySpecFault('engine textpage metadata is missing.');
	}
	const width = resolvePositiveSafeInteger(engineTextpage.imgmeta.width, 'engine_textpage.width');
	const height = resolvePositiveSafeInteger(engineTextpage.imgmeta.height, 'engine_textpage.height');
	return width * height * 4;
}

export function resolveRuntimeMemoryMapSpecs(params: {
	machine: MachineManifest;
	engineMachine: MachineManifest;
	engineSource: RawAssetSource;
	assetSource: RawAssetSource;
	assetLayers: ReadonlyArray<RuntimeAssetLayer>;
}): MemoryMapSpecs {
	const machineConfig = params.machine;
	const engineMachine = params.engineMachine;
	const memorySpecs = getMachineMemorySpecs(machineConfig);
	const engineMemorySpecs = getMachineMemorySpecs(engineMachine);
	const stringHandleCount = DEFAULT_STRING_HANDLE_COUNT;
	const stringHeapBytes = DEFAULT_STRING_HEAP_SIZE;
	const textpageSlotBytes = memorySpecs.textpage_slot_bytes ?? DEFAULT_VRAM_TEXTPAGE_SLOT_SIZE;
	const systemTextpageSlotBytes = engineMemorySpecs.system_textpage_slot_bytes ?? resolveEngineTextpageSlotBytes(params.engineSource);
	const renderSize = resolveRuntimeRenderSize(machineConfig);
	const frameBufferWidth = renderSize.width;
	const frameBufferHeight = renderSize.height;
	const frameBufferBytes = frameBufferWidth * frameBufferHeight * 4;
	if (!Number.isSafeInteger(systemTextpageSlotBytes) || systemTextpageSlotBytes <= 0) {
		throw runtimeMemorySpecFault('system textpage slot bytes must be a positive integer.');
	}
	const stagingBytes = memorySpecs.staging_bytes ?? DEFAULT_VRAM_STAGING_SIZE;
	const assetTableInfo = computeAssetTableBytes(params.engineSource, params.assetSource, params.assetLayers);
	const assetTableBytes = assetTableInfo.bytes;
	const requiredAssetDataBytes = computeRequiredAssetDataBytes(params.assetSource, params.assetLayers);
	const assetDataBaseOffset = IO_REGION_SIZE
		+ (stringHandleCount * STRING_HANDLE_ENTRY_SIZE)
		+ stringHeapBytes
		+ assetTableBytes;
	const assetDataBasePadding = alignUp(assetDataBaseOffset, IO_WORD_SIZE) - assetDataBaseOffset;
	const fixedRamBytes = assetDataBaseOffset
		+ assetDataBasePadding
		+ DEFAULT_GEO_SCRATCH_SIZE
		+ VDP_STREAM_BUFFER_SIZE;
	const requiredRamBytes = fixedRamBytes + requiredAssetDataBytes;
	const ramBytes = memorySpecs.ram_bytes === undefined
		? requiredRamBytes
		: resolvePositiveSafeInteger(memorySpecs.ram_bytes, 'machine.specs.ram.ram_bytes');
	if (ramBytes < requiredRamBytes) {
		throw runtimeMemorySpecFault(`machine.specs.ram.ram_bytes (${ramBytes}) must be at least required size ${requiredRamBytes}.`);
	}
	const assetDataBytes = ramBytes - fixedRamBytes;
	const footprintMiB = (ramBytes / (1024 * 1024)).toFixed(2);
	console.info(
		`memory footprint: ram=${ramBytes} bytes (${footprintMiB} MiB) `
		+ `(io=${IO_REGION_SIZE}, string_handles=${stringHandleCount}, string_heap=${stringHeapBytes}, `
		+ `asset_table=${assetTableBytes} (${assetTableInfo.entryCount} entries, ${assetTableInfo.stringBytes} string bytes), `
		+ `asset_data=${assetDataBytes}, geo_scratch=${DEFAULT_GEO_SCRATCH_SIZE}, vdp_stream=${VDP_STREAM_BUFFER_SIZE}, vram_staging=${stagingBytes}, framebuffer=${frameBufferBytes} (${frameBufferWidth}x${frameBufferHeight}), `
		+ `engine_textpage_slot=${systemTextpageSlotBytes}, textpage_slot=${textpageSlotBytes}x2=${textpageSlotBytes * 2}).`,
	);
	return {
		ram_bytes: ramBytes,
		string_handle_count: stringHandleCount,
		string_heap_bytes: stringHeapBytes,
		asset_table_bytes: assetTableBytes,
		asset_data_bytes: assetDataBytes,
		textpage_slot_bytes: textpageSlotBytes,
		system_textpage_slot_bytes: systemTextpageSlotBytes,
		staging_bytes: stagingBytes,
		framebuffer_bytes: frameBufferBytes,
	};
}
