import type { ResourceDomain } from '../../../ide/common/resource';
import type { RomInspectorSnapshot } from '../../../ide/workbench/contrib/rom_inspector/model';
import { finalizePackedRomAssets, type RomAsset } from '../../../toolchain/ts/rompack/assets';
import { encodeCollisionShapeVariants, type CollisionShapeVariant } from '../../../toolchain/ts/rompack/collision_shape_codec';
import { encodeDirect16GxUpload } from '../../../toolchain/ts/rompack/gp0_encode';
import { encodeDirect16GxTexture } from '../../../toolchain/ts/rompack/gx_texture_codec';
import { GX_SYSTEM_TEXTURE_ASSET_ID } from '../../../toolchain/ts/rompack/system_texture';

/** Real atlas upload, optional encoded collision and independent data entry for native ROM readers. */
export function createRomInspectorImageSnapshot(domain: ResourceDomain, sourceContextId: string,
	shape?: CollisionShapeVariant): RomInspectorSnapshot {
	const texture = encodeDirect16GxTexture(2, 2, Uint8ClampedArray.of(255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255));
	const upload = encodeDirect16GxUpload(texture, 0, 0), end = 72 + upload.length;
	const collision = shape === undefined ? undefined : encodeCollisionShapeVariants({ original: shape, fliph: shape, flipv: shape, fliphv: shape });
	const collisionStart = end + 1024, metadata = collisionStart + (collision === undefined ? 0 : collision.length);
	const rom = new Uint8Array(metadata + 64); rom.set(upload, 72);
	for (let index = end; index < collisionStart; index++) rom[index] = index & 255;
	if (collision !== undefined) rom.set(collision, collisionStart);
	const image: RomAsset = { resid: 'a-image', type: 'image', source_path: 'a.lua', metabuffer_start: metadata, metabuffer_end: metadata + 16,
		imgmeta: { width: 2, height: 2, texture_u: 0, texture_v: 0 } };
	if (collision !== undefined) { image.collision_bin_start = collisionStart; image.collision_bin_end = metadata; }
	const assets: RomAsset[] = [
		{ resid: GX_SYSTEM_TEXTURE_ASSET_ID, type: 'bin', start: 72, end }, image,
		{ resid: 'b-data', type: 'bin', source_path: 'b.lua', start: end, end: collisionStart },
	];
	finalizePackedRomAssets(assets);
	return { domain, sourceContextId, label: 'Captured cartridge', rom, assets, header: {
		headerSize: 72, manifestOffset: 72, manifestLength: 0, dataOffset: 72, dataLength: metadata - 72,
		metadataOffset: metadata, metadataLength: 32, tocOffset: metadata + 32, tocLength: 32,
		blua32ImageOffset: 0, blua32ImageByteCount: 0, blua32StartupFunctionAddress: 0, blua32IrqFunctionAddress: 0,
		blua32ExceptionFunctionAddress: 0, blua32StaticLayoutTokenLo: 0, blua32StaticLayoutTokenHi: 0, blua32DiagnosticDirectoryOffset: 0,
	} };
}
