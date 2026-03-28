import { color } from '../../shared/render_types';

export const DEFAULT_VERTEX_COLOR: color = { r: 1.0, g: 1.0, b: 1.0, a: 1.0 };

// Canonical GPU-side sprite batch size for the shared 2D path.
export const MAX_SPRITES = 5000;
export const MAX_DIR_LIGHTS = 4;
export const MAX_POINT_LIGHTS = 4;

export const VERTICES_PER_SPRITE = 6; // Number of vertices per sprite (2 triangles, 3 vertices each)

export const ZCOORD_MAX = 10000;
export const DEFAULT_ZCOORD = 0;

export const SPRITE_DRAW_OFFSET = 0;

// Centralized texture unit assignments for WebGL. Keep these stable.
// Used by pipelines, backend, and view code.
export const TEXTURE_UNIT_ATLAS_PRIMARY = 0;
export const TEXTURE_UNIT_ATLAS_SECONDARY = 1;
export const TEXTURE_UNIT_ATLAS_ENGINE = 11;
export const TEXTURE_UNIT_ALBEDO = 2;
export const TEXTURE_UNIT_NORMAL = 3;
export const TEXTURE_UNIT_METALLIC_ROUGHNESS = 4;
export const TEXTURE_UNIT_SHADOW_MAP = 5;
export const TEXTURE_UNIT_SKYBOX = 6;
export const TEXTURE_UNIT_PARTICLE = 7;
export const TEXTURE_UNIT_POST_PROCESSING_SOURCE = 8;
export const TEXTURE_UNIT_MORPH_POS = 9;
export const TEXTURE_UNIT_MORPH_NORM = 10;
// A high-numbered scratch unit for temporary uploads
export const TEXTURE_UNIT_UPLOAD = 15;
