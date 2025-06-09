
/**
 * Interface for a loaded resource, which includes metadata about the resource.
 */
import type { ImgMeta } from '../src/bmsx/rompack';

interface RomPackerOptions {
	rom_name: string;
	title: string;
	bootloader_path: string;
	respath: string;
	force: boolean;
	buildreslist: boolean;
	deploy: boolean;
}

export interface LoadedResource extends ResourceMeta {
	buffer: Buffer;
	img?: any;
	imgmeta?: ImgMeta;
}

/**
 * Interface for metadata about a resource.
 */
export interface ResourceMeta {
	filepath?: string;
	name: string;
	ext?: string;
	type: string;
	id: number;
	collisionType?: 'concave' | 'convex' | 'aabb';
}

export interface RomManifest {
	title?: string;
	short_name?: string;
	rom_name?: string;
}
