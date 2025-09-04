/**
 * Interface for a loaded resource, which includes metadata about the resource.
 */
import { Buffer } from 'buffer';
import type { asset_type, ImgMeta } from '../../src/bmsx/rompack/rompack';

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

export type resourcetype = asset_type | 'rommanifest' | 'romlabel' | 'fsm' | 'aem';
export type collisiontype = 'concave' | 'convex' | 'aabb';
export type datatype = 'json' | 'yaml' | 'bin';

export interface Resource {
    filepath?: string;
    name: string;
    ext?: string;
    type: resourcetype;
    id: number;
    collisionType?: collisiontype;
    datatype?: datatype;
    targetAtlasIndex?: number;
    atlasid?: number;
    buffer?: Buffer;
    img?: any;
    imgmeta?: ImgMeta;
}

export interface RomManifest {
    title?: string;
    short_name?: string;
    rom_name?: string;
}
