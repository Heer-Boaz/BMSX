import type {
	AudioMeta,
	ImgMeta,
	RomAsset,
	PackedRomAsset,
	RomToolingPackage,
	CartridgeIndex,
	PackedCartridgeIndex,
	TextureMeta,
	SourceMeta,
} from './assets';
import { decodeBinary, decodeBinaryWithPropTable } from '../../../machine/ts/common/serializer/binencoder';
import { parseCartHeader, type CartRomHeader } from '../../../machine/ts/rompack/format';
import { parseRomMetadataSection } from './metadata';
import { RomSourceStack, type RawRomSource } from './source';
import { decodeRomToc } from '../../../machine/ts/rompack/toc';
import {
	parseCartridgePackage,
	type CartridgePackage,
	type RomImage,
	type RomImageDomain,
} from '../../../machine/ts/rompack/image';
import { loadModelFromBuffer } from './model_asset';

type RomAssetList = {
	entries: PackedRomAsset[];
	projectRootPath: string;
};

function decodedProjectRootPath(path: string | null): string {
	return path === null ? '' : path;
}


async function loadRomAssetListFromHeader(
	rom: Uint8Array,
	header: CartRomHeader,
	domain: RomImageDomain,
): Promise<RomAssetList> {
	const sliced = rom.subarray(header.tocOffset, header.tocOffset + header.tocLength);
	const decoded = decodeRomToc(sliced);
	const entryList: PackedRomAsset[] = decoded.entries;
	const projectRootPath = decodedProjectRootPath(decoded.projectRootPath);
	const sharedMetadata = header.metadataLength > 0
		? parseRomMetadataSection(rom.subarray(header.metadataOffset, header.metadataOffset + header.metadataLength))
		: null;

	for (const asset of entryList) {
		asset.payload_id = domain;
		if (asset.metabuffer_start != null && asset.metabuffer_end != null) {
			const metaStart = asset.metabuffer_start;
			const metaEnd = asset.metabuffer_end;
			const metaSlice = rom.subarray(metaStart, metaEnd);
			const decodedMeta = sharedMetadata && metaStart >= (header.metadataOffset + sharedMetadata.payloadOffset) && metaEnd <= (header.metadataOffset + header.metadataLength)
				? decodeBinaryWithPropTable(metaSlice, sharedMetadata.propNames)
				: decodeBinary(metaSlice);
			switch (asset.type) {
				case 'image':
					asset.imgmeta = decodedMeta as ImgMeta;
					break;
				case 'texture':
					asset.texturemeta = decodedMeta as TextureMeta;
					break;
				case 'audio':
					asset.audiometa = decodedMeta as AudioMeta;
					break;
				case 'data':
				case 'aem':
					asset.sourcemeta = decodedMeta as SourceMeta;
					break;
				case 'bin':
					break;
				case 'model':
					break;
				default:
					break;
			}
		}
	}
	return {
		entries: entryList,
		projectRootPath,
	};
}

export async function loadRomAssetList(
	rom: Uint8Array,
	domain: RomImageDomain,
): Promise<RomAssetList> {
	const header = parseCartHeader(rom);
	return loadRomAssetListFromHeader(rom, header, domain);
}

export async function parseCartridgeIndex(payload: Uint8Array): Promise<PackedCartridgeIndex> {
	return buildCartridgeIndex(parseCartridgePackage(payload));
}

async function buildCartridgeIndex(image: CartridgePackage): Promise<PackedCartridgeIndex> {
	const { entries, projectRootPath } = await loadRomAssetListFromHeader(
		image.bytes,
		image.header,
		'cart',
	);
	return {
		entries,
		projectRootPath,
		cart_manifest: image.manifest,
	};
}

async function loadDataFromBuffer(buffer: Uint8Array): Promise<any> {
	return decodeBinary(new Uint8Array(buffer));
}

async function load(source: RawRomSource, res: RomAsset, romPackage: RomToolingPackage) {
	if (res.op === 'delete') {
		return;
	}
	const baseAsset = res;
	const assetKey = baseAsset.resid;
	switch (res.type) {
		case 'image': {
			romPackage.img[assetKey] = baseAsset;
			break;
		}
		case 'texture':
			break;
		case 'audio':
			romPackage.audio[assetKey] = baseAsset;
			break;
		case 'model': {
			const texBuf = baseAsset.model_texture_start !== undefined
				? source.getBytesView({ ...baseAsset, start: baseAsset.model_texture_start, end: baseAsset.model_texture_end! })
				: undefined;
			romPackage.model[assetKey] = loadModelFromBuffer(res.resid, source.getBytesView(baseAsset), texBuf);
			break;
		}
		case 'data':
			romPackage.data[assetKey] = await loadDataFromBuffer(source.getBytes(baseAsset));
			break;
		case 'bin':
			romPackage.bin[assetKey] = baseAsset;
			break;
		case 'collision_shape':
			romPackage.collision_shape[assetKey] = baseAsset;
			break;
		case 'aem': {
			const u8 = source.getBytes(baseAsset);
			const audioevents = decodeBinary(u8);
			romPackage.audioevents[assetKey] = audioevents;
			break;
		}
		case 'lua':
		case 'code':
		case 'romlabel':
			break;
		default:
			throw new Error(`Unrecognised resource type in ROM: ${res.type}, while decoding runtime ROM package.`);
	}
}

export type RomToolingLayer<TDomain extends RomImageDomain = RomImageDomain> = RomImage & {
	id: TDomain;
	index: PackedCartridgeIndex;
	package: RomToolingPackage;
};

async function loadRomToolingPackageFromSource(source: RawRomSource, index: CartridgeIndex): Promise<RomToolingPackage> {
	const romPackage: RomToolingPackage = {
		img: {},
		audio: {},
		model: {},
		data: {},
		bin: {},
		collision_shape: {},
		audioevents: {},
		project_root_path: index.projectRootPath,
		cart_manifest: index.cart_manifest,
	};
	const entries = source.list();
	await Promise.all(entries.map(entry => load(source, entry, romPackage)));
	return romPackage;
}

export async function buildCartridgeToolingLayer(image: CartridgePackage): Promise<RomToolingLayer<'cart'>> {
	const index = await buildCartridgeIndex(image);
	const source = new RomSourceStack([{ id: 'cart', index, bytes: image.bytes }]);
	const toolingPackage = await loadRomToolingPackageFromSource(source, index);
	return { ...image, id: 'cart', index, package: toolingPackage };
}

export async function buildSystemToolingLayer(image: RomImage): Promise<RomToolingLayer<'system'>> {
	const { entries, projectRootPath } = await loadRomAssetListFromHeader(image.bytes, image.header, 'system');
	const index: PackedCartridgeIndex = {
		entries,
		projectRootPath,
		cart_manifest: null,
	};
	const source = new RomSourceStack([{ id: 'system', index, bytes: image.bytes }]);
	const toolingPackage = await loadRomToolingPackageFromSource(source, index);
	return { ...image, id: 'system', index, package: toolingPackage };
}
