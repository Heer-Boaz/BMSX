/**
 * Interface for a loaded resource, which includes metadata about the resource.
 */
import type { asset_type, ImgMeta } from '../src/bmsx/rompack/rompack';

interface RomPackerOptions {
	rom_name: string;
	title: string;
	bootloader_path: string;
	respath: string;
	force: boolean;
	debug: boolean;
	buildreslist: boolean;
	deploy: boolean;
	useTextureAtlas: boolean;
}

export interface Resource {
	filepath?: string;
	name: string;
	ext?: string;
	type: resourcetype;
	id: number;
	collisionType?: 'concave' | 'convex' | 'aabb';
	datatype?: 'json' | 'yaml' | 'bin'; // If the resource is a data file, this indicates the type of data it contains
	targetAtlasIndex?: number; // If this is not an atlas image, index of atlas this image belongs to
	atlasid?: number; // If this is an atlas image, id (=index) of the atlas
	buffer?: Buffer;
	img?: any;
	imgmeta?: ImgMeta;
}

export type resourcetype = asset_type | 'rommanifest' | 'romlabel';

export interface RomManifest {
	title?: string;
	short_name?: string;
	rom_name?: string;
}
