import { $ } from '../core/engine_core';
import { taskGate } from '../core/taskgate';
import * as SkyboxPipeline from '../render/3d/skybox_pipeline';
import type { SkyboxImageIds } from '../render/shared/render_types';
import type { RomAsset, RuntimeAssets } from '../rompack/rompack';
import {
	ATLAS_PRIMARY_SLOT_ID,
	ATLAS_SECONDARY_SLOT_ID,
	ENGINE_ATLAS_INDEX,
	ENGINE_ATLAS_TEXTURE_KEY,
	SKYBOX_FACE_DEFAULT_SIZE,
	SKYBOX_SLOT_IDS,
	generateAtlasName,
	type AtlasSlotIndex,
	type TextureSource,
} from '../rompack/rompack';
import type { RawAssetSource } from '../rompack/asset_source';
import { decodePngToRgba } from '../utils/image_decode';
import { IO_VDP_DITHER } from './vm_io';
import type { VmAssetEntry } from './vm_memory';
import { VmMemory } from './vm_memory';

const SKYBOX_FACE_KEYS = ['posx', 'negx', 'posy', 'negy', 'posz', 'negz'] as const;
const SKYBOX_SLOT_ID_SET = new Set<string>(SKYBOX_SLOT_IDS);

export class VDP {
	private readonly assetUpdateGate = taskGate.group('asset:update');
	private readonly atlasSlotById = new Map<number, number>();
	private readonly atlasViewsById = new Map<number, VmAssetEntry[]>();
	private readonly atlasResourcesById = new Map<number, RomAsset>();
	private readonly slotAtlasIds: Array<number | null> = [null, null];
	private atlasSlotEntries: VmAssetEntry[] = [];
	private skyboxSlotEntries: VmAssetEntry[] = [];
	private dirtyAtlasBindings = false;
	private dirtySkybox = false;
	private skyboxFaceIds: SkyboxImageIds | null = null;
	private lastDitherType = 0;

	public constructor(
		private readonly memory: VmMemory,
	) {}

	public initializeRegisters(): void {
		const dither = $.view.dither_type;
		this.memory.writeValue(IO_VDP_DITHER, dither);
		this.lastDitherType = dither;
	}

	public syncRegisters(): void {
		const dither = this.memory.readValue(IO_VDP_DITHER) as number;
		if (dither === this.lastDitherType) {
			return;
		}
		this.lastDitherType = dither;
		$.view.dither_type = dither;
	}

	public setDitherType(value: number): void {
		this.memory.writeValue(IO_VDP_DITHER, value);
		this.syncRegisters();
	}

	public getDitherType(): number {
		return this.lastDitherType;
	}

	public getSkyboxFaceIds(): SkyboxImageIds | null {
		return this.skyboxFaceIds;
	}

	public commitViewSnapshot(): void {
		const view = $.view;
		if (this.dirtyAtlasBindings) {
			view.primaryAtlasIdInSlot = this.slotAtlasIds[0];
			view.secondaryAtlasIdInSlot = this.slotAtlasIds[1];
			this.dirtyAtlasBindings = false;
		}
		if (this.dirtySkybox) {
			view.skyboxFaceIds = this.skyboxFaceIds;
			this.dirtySkybox = false;
		}
	}

	public getAtlasSlotMapping(): { primary: number | null; secondary: number | null } {
		return { primary: this.slotAtlasIds[0], secondary: this.slotAtlasIds[1] };
	}

	public restoreAtlasSlotMapping(mapping: { primary: number | null; secondary: number | null }): void {
		this.atlasSlotById.clear();
		this.slotAtlasIds[0] = mapping.primary;
		this.slotAtlasIds[1] = mapping.secondary;
		if (mapping.primary !== null) {
			this.atlasSlotById.set(mapping.primary, 0);
		}
		if (mapping.secondary !== null) {
			this.atlasSlotById.set(mapping.secondary, 1);
		}
		this.dirtyAtlasBindings = true;
		if (mapping.primary !== null) {
			const viewEntries = this.atlasViewsById.get(mapping.primary);
			if (viewEntries) {
				for (let index = 0; index < viewEntries.length; index += 1) {
					this.memory.updateImageViewBase(viewEntries[index], this.atlasSlotEntries[0]);
				}
			}
		}
		if (mapping.secondary !== null) {
			const viewEntries = this.atlasViewsById.get(mapping.secondary);
			if (viewEntries) {
				for (let index = 0; index < viewEntries.length; index += 1) {
					this.memory.updateImageViewBase(viewEntries[index], this.atlasSlotEntries[1]);
				}
			}
		}
	}

	public setSkyboxImages(ids: SkyboxImageIds): void {
		const source = $.asset_source;
		if (!source) {
			throw new Error('[BmsxVDP] Asset source not configured.');
		}
		const slots = this.getSkyboxSlotEntries();
		const assets = $.assets;
		this.skyboxFaceIds = ids;
		this.dirtySkybox = true;
		SkyboxPipeline.clearSkyboxSources();
		const tasks = SKYBOX_FACE_KEYS.map((key, index) =>
			this.loadSkyboxFaceIntoSlot(slots[index], ids[key], source, assets)
		);
		void Promise.all(tasks).then(() => {
			this.applySkyboxSlots(ids);
		});
	}

	public clearSkybox(): void {
		this.skyboxFaceIds = null;
		this.dirtySkybox = true;
		SkyboxPipeline.clearSkyboxSources();
	}

	public async registerImageAssets(source: RawAssetSource, assets: RuntimeAssets): Promise<void> {
		const entries = source.list();
		const viewEntries: RomAsset[] = [];
		const engineAtlasName = generateAtlasName(ENGINE_ATLAS_INDEX);
		let engineAtlasEntry: RomAsset | null = null;
		let engineEntryRecord: VmAssetEntry | null = null;
		this.atlasResourcesById.clear();
		this.atlasViewsById.clear();
		this.atlasSlotById.clear();
		this.slotAtlasIds[0] = null;
		this.slotAtlasIds[1] = null;
		this.dirtyAtlasBindings = true;
		this.skyboxSlotEntries = [];
		this.skyboxFaceIds = null;
		this.dirtySkybox = true;
		SkyboxPipeline.clearSkyboxSources();

		for (let index = 0; index < entries.length; index += 1) {
			const entry = entries[index];
			if (entry.type !== 'image' && entry.type !== 'atlas') {
				continue;
			}
			const imgAsset = assets.img[entry.resid];
			if (!imgAsset) {
				throw new Error(`[BmsxVDP] Image asset '${entry.resid}' not found.`);
			}
			const meta = imgAsset.imgmeta;
			if (!meta) {
				throw new Error(`[BmsxVDP] Image asset '${entry.resid}' missing metadata.`);
			}
			if (entry.type === 'atlas') {
				if (entry.resid === engineAtlasName) {
					if (this.memory.hasAsset(engineAtlasName)) {
						engineEntryRecord = this.memory.getAssetEntry(engineAtlasName);
					} else {
						engineAtlasEntry = entry;
					}
					continue;
				}
				if (typeof meta.atlasid !== 'number') {
					throw new Error(`[BmsxVDP] Atlas '${entry.resid}' missing atlas id.`);
				}
				this.atlasResourcesById.set(meta.atlasid, entry);
				continue;
			}
			if (meta.atlassed) {
				viewEntries.push(entry);
				continue;
			}
		}

		if (!engineEntryRecord && this.memory.hasAsset(engineAtlasName)) {
			engineEntryRecord = this.memory.getAssetEntry(engineAtlasName);
		}

		if (!engineEntryRecord) {
			if (!engineAtlasEntry) {
				throw new Error('[BmsxVDP] Engine atlas missing from asset list.');
			}
			if (typeof engineAtlasEntry.start !== 'number' || typeof engineAtlasEntry.end !== 'number') {
				throw new Error('[BmsxVDP] Engine atlas missing ROM buffer offsets.');
			}
			const engineImgAsset = assets.img[engineAtlasEntry.resid];
			const engineDecoded = await decodePngToRgba(source.getBuffer(engineAtlasEntry));
			if (engineImgAsset.imgmeta.width <= 0) {
				engineImgAsset.imgmeta.width = engineDecoded.width;
			}
			if (engineImgAsset.imgmeta.height <= 0) {
				engineImgAsset.imgmeta.height = engineDecoded.height;
			}
			engineEntryRecord = this.memory.registerImageBuffer({
				id: engineAtlasEntry.resid,
				width: engineDecoded.width,
				height: engineDecoded.height,
				pixels: engineDecoded.pixels,
			});
		}

		const skyboxFaceSize = assets.manifest.vm.skybox_face_size ?? SKYBOX_FACE_DEFAULT_SIZE;
		if (skyboxFaceSize <= 0) {
			throw new Error(`[BmsxVDP] Invalid skybox_face_size: ${skyboxFaceSize}.`);
		}
		const skyboxBytes = skyboxFaceSize * skyboxFaceSize * 4;
		for (let index = 0; index < SKYBOX_SLOT_IDS.length; index += 1) {
			const slotId = SKYBOX_SLOT_IDS[index];
			const slotEntry = this.memory.hasAsset(slotId)
				? this.memory.getAssetEntry(slotId)
				: this.memory.registerImageSlot({
					id: slotId,
					capacityBytes: skyboxBytes,
				});
			this.skyboxSlotEntries.push(slotEntry);
		}

		let maxAtlasBytes = 0;
		for (const atlasEntry of this.atlasResourcesById.values()) {
			const atlasAsset = assets.img[atlasEntry.resid];
			const meta = atlasAsset.imgmeta;
			const width = meta.width;
			const height = meta.height;
			const bytes = width * height * 4;
			if (bytes > maxAtlasBytes) {
				maxAtlasBytes = bytes;
			}
		}
		if (maxAtlasBytes <= 0) {
			throw new Error('[BmsxVDP] No atlas resources available for slot allocation.');
		}

		const primarySlotEntry = this.memory.hasAsset(ATLAS_PRIMARY_SLOT_ID)
			? this.memory.getAssetEntry(ATLAS_PRIMARY_SLOT_ID)
			: this.memory.registerImageSlot({
				id: ATLAS_PRIMARY_SLOT_ID,
				capacityBytes: maxAtlasBytes,
			});
		const secondarySlotEntry = this.memory.hasAsset(ATLAS_SECONDARY_SLOT_ID)
			? this.memory.getAssetEntry(ATLAS_SECONDARY_SLOT_ID)
			: this.memory.registerImageSlot({
				id: ATLAS_SECONDARY_SLOT_ID,
				capacityBytes: maxAtlasBytes,
			});
		this.atlasSlotEntries = [primarySlotEntry, secondarySlotEntry];

		const atlasIds = Array.from(this.atlasResourcesById.keys()).sort((a, b) => a - b);
		const primaryAtlasId = atlasIds.length > 0 ? atlasIds[0] : null;
		const secondaryAtlasId = atlasIds.length > 1 ? atlasIds[1] : null;
		if (primaryAtlasId !== null) {
			this.atlasSlotById.set(primaryAtlasId, 0);
			this.slotAtlasIds[0] = primaryAtlasId;
		}
		if (secondaryAtlasId !== null) {
			this.atlasSlotById.set(secondaryAtlasId, 1);
			this.slotAtlasIds[1] = secondaryAtlasId;
		}

		for (let index = 0; index < viewEntries.length; index += 1) {
			const entry = viewEntries[index];
			const imgAsset = assets.img[entry.resid];
			const meta = imgAsset.imgmeta;
			if (!meta.atlassed) {
				throw new Error(`[BmsxVDP] Image asset '${entry.resid}' expected to be atlassed.`);
			}
			if (!meta.texcoords) {
				throw new Error(`[BmsxVDP] Image asset '${entry.resid}' missing atlas texcoords.`);
			}
			const atlasId = meta.atlasid;
			if (atlasId === undefined || atlasId === null) {
				throw new Error(`[BmsxVDP] Image asset '${entry.resid}' missing atlas id.`);
			}
			let atlasWidth = 0;
			let atlasHeight = 0;
			let baseEntry = primarySlotEntry;
			if (atlasId === ENGINE_ATLAS_INDEX) {
				baseEntry = engineEntryRecord;
				atlasWidth = engineEntryRecord.regionW;
				atlasHeight = engineEntryRecord.regionH;
			} else {
				const atlasEntry = this.atlasResourcesById.get(atlasId);
				if (!atlasEntry) {
					throw new Error(`[BmsxVDP] Atlas ${atlasId} not registered for '${entry.resid}'.`);
				}
				const atlasAsset = assets.img[atlasEntry.resid];
				atlasWidth = atlasAsset.imgmeta.width;
				atlasHeight = atlasAsset.imgmeta.height;
				const mappedSlot = this.atlasSlotById.get(atlasId);
				if (mappedSlot !== undefined) {
					baseEntry = this.atlasSlotEntries[mappedSlot];
				}
			}
			const coords = meta.texcoords;
			const minU = Math.min(coords[0], coords[2], coords[4], coords[6], coords[8], coords[10]);
			const maxU = Math.max(coords[0], coords[2], coords[4], coords[6], coords[8], coords[10]);
			const minV = Math.min(coords[1], coords[3], coords[5], coords[7], coords[9], coords[11]);
			const maxV = Math.max(coords[1], coords[3], coords[5], coords[7], coords[9], coords[11]);
			const offsetX = Math.floor(minU * atlasWidth);
			const offsetY = Math.floor(minV * atlasHeight);
			const regionW = Math.max(1, Math.min(atlasWidth - offsetX, Math.round((maxU - minU) * atlasWidth)));
			const regionH = Math.max(1, Math.min(atlasHeight - offsetY, Math.round((maxV - minV) * atlasHeight)));
			const viewEntry = this.memory.hasAsset(entry.resid)
				? this.memory.getAssetEntry(entry.resid)
				: this.memory.registerImageView({
					id: entry.resid,
					baseEntry,
					regionX: offsetX,
					regionY: offsetY,
					regionW,
					regionH,
				});
			let list = this.atlasViewsById.get(atlasId);
			if (!list) {
				list = [];
				this.atlasViewsById.set(atlasId, list);
			}
			list.push(viewEntry);
		}

		if (primaryAtlasId !== null) {
			await this.loadAtlasIntoSlot(0, primaryAtlasId, source, assets);
		}
		if (secondaryAtlasId !== null) {
			await this.loadAtlasIntoSlot(1, secondaryAtlasId, source, assets);
		}
	}

	public flushAssetEdits(): void {
		const dirty = this.memory.consumeDirtyAssets();
		if (dirty.length === 0) {
			return;
		}
		const skyboxIds = this.skyboxFaceIds;
		let refreshSkybox = false;
		for (let index = 0; index < dirty.length; index += 1) {
			const entry = dirty[index];
			if (entry.type === 'image') {
				if (SKYBOX_SLOT_ID_SET.has(entry.id)) {
					refreshSkybox = true;
					continue;
				}
				const pixels = this.memory.getImagePixels(entry);
				const width = entry.regionW;
				const height = entry.regionH;
				const token = this.assetUpdateGate.begin({ blocking: false, category: 'texture', tag: `asset:${entry.id}` });
				const textureKey = entry.id === generateAtlasName(ENGINE_ATLAS_INDEX) ? ENGINE_ATLAS_TEXTURE_KEY : entry.id;
				void $.texmanager.updateTexturesForKey(textureKey, pixels, width, height)
					.finally(() => this.assetUpdateGate.end(token));
			} else if (entry.type === 'audio') {
				$.sndmaster.invalidateClip(entry.id);
			}
		}
		if (refreshSkybox && skyboxIds) {
			this.applySkyboxSlots(skyboxIds);
		}
	}

	public async uploadAtlasTextures(): Promise<void> {
		const engineAtlasName = generateAtlasName(ENGINE_ATLAS_INDEX);
		const engineEntry = this.memory.getAssetEntry(engineAtlasName);
		const enginePixels = this.memory.getImagePixels(engineEntry);
		await $.texmanager.loadTextureFromPixels(ENGINE_ATLAS_TEXTURE_KEY, enginePixels, engineEntry.regionW, engineEntry.regionH);
		$.view.loadEngineAtlasTexture();

		const primaryEntry = this.memory.getAssetEntry(ATLAS_PRIMARY_SLOT_ID);
		if (primaryEntry.regionW > 0 && primaryEntry.regionH > 0) {
			const primaryPixels = this.memory.getImagePixels(primaryEntry);
			const primaryHandle = await $.texmanager.loadTextureFromPixels(
				ATLAS_PRIMARY_SLOT_ID,
				primaryPixels,
				primaryEntry.regionW,
				primaryEntry.regionH,
			);
			$.view.textures[ATLAS_PRIMARY_SLOT_ID] = primaryHandle;
		}

		const secondaryEntry = this.memory.getAssetEntry(ATLAS_SECONDARY_SLOT_ID);
		if (secondaryEntry && secondaryEntry.regionW > 0 && secondaryEntry.regionH > 0) {
			const secondaryPixels = this.memory.getImagePixels(secondaryEntry);
			const secondaryHandle = await $.texmanager.loadTextureFromPixels(
				ATLAS_SECONDARY_SLOT_ID,
				secondaryPixels,
				secondaryEntry.regionW,
				secondaryEntry.regionH,
			);
			$.view.textures[ATLAS_SECONDARY_SLOT_ID] = secondaryHandle;
		}
		this.dirtyAtlasBindings = true;
	}

	private getSkyboxSlotEntries(): VmAssetEntry[] {
		if (this.skyboxSlotEntries.length !== SKYBOX_FACE_KEYS.length) {
			throw new Error('[BmsxVDP] Skybox slots not allocated in asset RAM.');
		}
		return this.skyboxSlotEntries;
	}

	private async loadSkyboxFaceIntoSlot(
		slotEntry: VmAssetEntry,
		assetId: string,
		source: RawAssetSource,
		assets: RuntimeAssets,
	): Promise<void> {
		const entry = source.getEntry(assetId);
		if (!entry) {
			throw new Error(`[BmsxVDP] Skybox image '${assetId}' not found.`);
		}
		if (entry.type !== 'image') {
			throw new Error(`[BmsxVDP] Skybox image '${assetId}' is not an image.`);
		}
		if (typeof entry.start !== 'number' || typeof entry.end !== 'number') {
			throw new Error(`[BmsxVDP] Skybox image '${assetId}' missing ROM buffer offsets.`);
		}
		const asset = assets.img[assetId];
		if (!asset || !asset.imgmeta) {
			throw new Error(`[BmsxVDP] Skybox image '${assetId}' missing metadata.`);
		}
		if (asset.imgmeta.atlassed) {
			throw new Error(`[BmsxVDP] Skybox image '${assetId}' must not be atlassed.`);
		}
		const decoded = await decodePngToRgba(source.getBuffer(entry));
		if (asset.imgmeta.width <= 0) {
			asset.imgmeta.width = decoded.width;
		}
		if (asset.imgmeta.height <= 0) {
			asset.imgmeta.height = decoded.height;
		}
		const faceSize = assets.manifest.vm.skybox_face_size ?? SKYBOX_FACE_DEFAULT_SIZE;
		this.memory.writeImageSlot(slotEntry, {
			pixels: decoded.pixels,
			width: faceSize,
			height: faceSize,
		});
	}

	private applySkyboxSlots(ids: SkyboxImageIds): void {
		const slots = this.getSkyboxSlotEntries();
		const loaders = slots.map((entry) => this.resolveSkyboxSlotSource(entry));
		SkyboxPipeline.setSkyboxSources(ids, loaders);
	}

	private resolveSkyboxSlotSource(entry: VmAssetEntry): Promise<TextureSource> {
		if (entry.type !== 'image') {
			throw new Error(`[BmsxVDP] Skybox slot '${entry.id}' is not an image.`);
		}
		const pixels = this.memory.getImagePixels(entry);
		return Promise.resolve({ width: entry.regionW, height: entry.regionH, data: pixels });
	}

	private async loadAtlasIntoSlot(
		slot: AtlasSlotIndex,
		atlasId: number,
		source: RawAssetSource,
		assets: RuntimeAssets,
	): Promise<void> {
		const atlasEntry = this.atlasResourcesById.get(atlasId);
		if (!atlasEntry) {
			throw new Error(`[BmsxVDP] Atlas ${atlasId} not found in ROM assets.`);
		}
		if (typeof atlasEntry.start !== 'number' || typeof atlasEntry.end !== 'number') {
			throw new Error(`[BmsxVDP] Atlas '${atlasEntry.resid}' missing ROM buffer offsets.`);
		}
		const decoded = await decodePngToRgba(source.getBuffer(atlasEntry));
		const atlasAsset = assets.img[atlasEntry.resid];
		if (atlasAsset.imgmeta.width <= 0) {
			atlasAsset.imgmeta.width = decoded.width;
		}
		if (atlasAsset.imgmeta.height <= 0) {
			atlasAsset.imgmeta.height = decoded.height;
		}
		const slotEntry = this.atlasSlotEntries[slot];
		this.memory.writeImageSlot(slotEntry, {
			pixels: decoded.pixels,
			width: decoded.width,
			height: decoded.height,
		});
		const existingSlot = this.atlasSlotById.get(atlasId);
		if (existingSlot !== undefined && existingSlot !== slot) {
			this.slotAtlasIds[existingSlot] = null;
		}
		const previousAtlasId = this.slotAtlasIds[slot];
		if (previousAtlasId !== null) {
			this.atlasSlotById.delete(previousAtlasId);
		}
		this.atlasSlotById.set(atlasId, slot);
		this.slotAtlasIds[slot] = atlasId;
		this.dirtyAtlasBindings = true;
		const viewEntries = this.atlasViewsById.get(atlasId);
		if (viewEntries) {
			for (let index = 0; index < viewEntries.length; index += 1) {
				this.memory.updateImageViewBase(viewEntries[index], slotEntry);
			}
		}
	}
}
