import type { RawAssetSource } from '../../rompack/asset_source';
import type { MachineManifest, RomAsset, RomImgAsset } from '../../rompack/rompack';
import {
	ATLAS_PRIMARY_SLOT_ID,
	ATLAS_SECONDARY_SLOT_ID,
	ENGINE_ATLAS_INDEX,
	getMachineMemorySpecs,
	generateAtlasName,
} from '../../rompack/rompack';
import type { RuntimeAssetLayer } from '../../rompack/romloader';
import { FRAMEBUFFER_RENDER_TEXTURE_KEY, FRAMEBUFFER_TEXTURE_KEY } from '../devices/vdp/vdp';
import { ASSET_TABLE_ENTRY_SIZE, ASSET_TABLE_HEADER_SIZE } from '../memory/memory';
import {
	DEFAULT_GEO_SCRATCH_SIZE,
	DEFAULT_STRING_HANDLE_COUNT,
	DEFAULT_STRING_HEAP_SIZE,
	DEFAULT_VRAM_ATLAS_SLOT_SIZE,
	DEFAULT_VRAM_STAGING_SIZE,
	IO_REGION_SIZE,
	IO_WORD_SIZE,
	STRING_HANDLE_ENTRY_SIZE,
	VDP_STREAM_BUFFER_SIZE,
	alignUp,
	type MemoryMapSpecs,
} from '../memory/memory_map';
import {
	buildRuntimeLayerLookup,
	resolveRuntimeLayerAssetById,
	resolveRuntimeLayerAssetFromEntry,
} from './runtime_asset_layers';
import { resolvePositiveSafeInteger, resolveRuntimeRenderSize } from './runtime_machine_specs';

const ASSET_DATA_ALIGNMENT_BYTES = 0x1000;
const DEFAULT_ASSET_DATA_HEADROOM_BYTES = 1 << 20; // 1 MiB

function runtimeMemorySpecFault(message: string): Error {
	return new Error(`Runtime fault: ${message}`);
}

function assertRomBufferRange(entry: RomAsset, kind: string): void {
	if (typeof entry.start !== 'number' || typeof entry.end !== 'number') {
		throw runtimeMemorySpecFault(`${kind} asset '${entry.resid}' missing ROM buffer offsets for memory sizing.`);
	}
}

function collectAssetEntryIds(engineSource: RawAssetSource, assetSource: RawAssetSource, assetLayers: ReadonlyArray<RuntimeAssetLayer>): Set<string> {
	const layerLookup = buildRuntimeLayerLookup(assetLayers);
	const ids = new Set<string>();
	const engineAtlasId = generateAtlasName(ENGINE_ATLAS_INDEX);
	resolveRuntimeLayerAssetById<RomImgAsset>(layerLookup, engineSource, 'img', engineAtlasId);
	ids.add(engineAtlasId);
	ids.add(ATLAS_PRIMARY_SLOT_ID);
	ids.add(ATLAS_SECONDARY_SLOT_ID);
	const sources = [engineSource, assetSource];
	for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
		const source = sources[sourceIndex]!;
		const entries = source.list();
		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index]!;
			if (entry.type !== 'image') {
				continue;
			}
			const asset = resolveRuntimeLayerAssetFromEntry<RomImgAsset>(layerLookup, 'img', entry);
			const meta = asset.imgmeta;
			if (!meta) {
				throw runtimeMemorySpecFault(`image asset '${entry.resid}' missing metadata for memory sizing.`);
			}
			if (meta.atlassed) {
				ids.add(entry.resid);
			}
		}
		const audioEntries = source.list('audio');
		for (let index = 0; index < audioEntries.length; index += 1) {
			const entry = audioEntries[index]!;
			assertRomBufferRange(entry, 'audio');
			ids.add(entry.resid);
		}
	}

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
	const layerLookup = buildRuntimeLayerLookup(assetLayers);
	let requiredBytes = 0;
	const entries = assetSource.list();
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index]!;
		if (entry.type !== 'image' && entry.type !== 'atlas') {
			continue;
		}
		const image = resolveRuntimeLayerAssetFromEntry<RomImgAsset>(layerLookup, 'img', entry);
		const meta = image.imgmeta;
		if (!meta) {
			throw runtimeMemorySpecFault(`image asset '${entry.resid}' missing metadata for memory sizing.`);
		}
		if (image.type === 'atlas' || meta.atlassed) {
			continue;
		}
		assertRomBufferRange(entry, 'image');
		requiredBytes += alignUp(assetSource.getBytesView(entry).byteLength, 4);
	}
	const audioEntries = assetSource.list('audio');
	for (let index = 0; index < audioEntries.length; index += 1) {
		const entry = audioEntries[index]!;
		resolveRuntimeLayerAssetFromEntry<RomAsset>(layerLookup, 'audio', entry);
		assertRomBufferRange(entry, 'audio');
		requiredBytes += alignUp(assetSource.getBytesView(entry).byteLength, 2);
	}
	requiredBytes += DEFAULT_ASSET_DATA_HEADROOM_BYTES;
	return alignUp(requiredBytes, ASSET_DATA_ALIGNMENT_BYTES);
}

function resolveEngineAtlasSlotBytes(engineSource: RawAssetSource): number {
	const engineAtlas = engineSource.getEntry(generateAtlasName(ENGINE_ATLAS_INDEX));
	if (!engineAtlas || !engineAtlas.imgmeta) {
		throw runtimeMemorySpecFault('engine atlas metadata is missing.');
	}
	const width = resolvePositiveSafeInteger(engineAtlas.imgmeta.width, 'engine_atlas.width');
	const height = resolvePositiveSafeInteger(engineAtlas.imgmeta.height, 'engine_atlas.height');
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
	const atlasSlotBytes = memorySpecs.atlas_slot_bytes ?? DEFAULT_VRAM_ATLAS_SLOT_SIZE;
	const engineAtlasSlotBytes = engineMemorySpecs.system_atlas_slot_bytes ?? resolveEngineAtlasSlotBytes(params.engineSource);
	const renderSize = resolveRuntimeRenderSize(machineConfig);
	const frameBufferWidth = renderSize.width;
	const frameBufferHeight = renderSize.height;
	const frameBufferBytes = frameBufferWidth * frameBufferHeight * 4;
	if (!Number.isSafeInteger(engineAtlasSlotBytes) || engineAtlasSlotBytes <= 0) {
		throw runtimeMemorySpecFault('system atlas slot bytes must be a positive integer.');
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
		+ `engine_atlas_slot=${engineAtlasSlotBytes}, atlas_slot=${atlasSlotBytes}x2=${atlasSlotBytes * 2}).`,
	);
	return {
		ram_bytes: ramBytes,
		string_handle_count: stringHandleCount,
		string_heap_bytes: stringHeapBytes,
		asset_table_bytes: assetTableBytes,
		asset_data_bytes: assetDataBytes,
		atlas_slot_bytes: atlasSlotBytes,
		system_atlas_slot_bytes: engineAtlasSlotBytes,
		staging_bytes: stagingBytes,
		framebuffer_bytes: frameBufferBytes,
	};
}
