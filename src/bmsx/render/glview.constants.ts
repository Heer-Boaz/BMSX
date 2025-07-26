import type { Color } from './view';

export const DEFAULT_VERTEX_COLOR: Color = { r: 1.0, g: 1.0, b: 1.0, a: 1.0 };
export const VERTEX_COLOR_COLORIZED_RED: Color = { r: 1.0, g: 0.0, b: 0.0, a: 1.0 };
export const VERTEX_COLOR_COLORIZED_GREEN: Color = { r: 0.0, g: 1.0, b: 0.0, a: 1.0 };
export const VERTEX_COLOR_COLORIZED_BLUE: Color = { r: 0.0, g: 0.0, b: 1.0, a: 1.0 };

export const MAX_SPRITES = 256;
export const MAX_DIR_LIGHTS = 4;
export const MAX_POINT_LIGHTS = 4;

export const VERTICES_PER_SPRITE = 6; // Number of vertices per sprite (2 triangles, 3 vertices each)
export const VERTEX_ATTRIBUTE_SIZE = 2;
export const TEXTURECOORD_ATTRIBUTE_SIZE = 2;
export const ZCOORD_ATTRIBUTE_SIZE = 1;
export const COLOR_OVERRIDE_ATTRIBUTE_SIZE = 4;
export const ATLAS_ID_ATTRIBUTE_SIZE = 1;

export const RESOLUTION_VECTOR_SIZE = 2;
export const VERTEXCOORDS_SIZE = VERTEX_ATTRIBUTE_SIZE * VERTICES_PER_SPRITE;
export const TEXTURECOORDS_SIZE = TEXTURECOORD_ATTRIBUTE_SIZE * VERTICES_PER_SPRITE;
export const ZCOORDS_SIZE = ZCOORD_ATTRIBUTE_SIZE * VERTICES_PER_SPRITE;
export const COLOR_OVERRIDE_SIZE = COLOR_OVERRIDE_ATTRIBUTE_SIZE * VERTICES_PER_SPRITE;
export const ATLAS_ID_SIZE = ATLAS_ID_ATTRIBUTE_SIZE * VERTICES_PER_SPRITE;

export const ZCOORD_MAX = 10000;
export const DEFAULT_ZCOORD = 0;
export const VERTEX_BUFFER_OFFSET_MULTIPLIER = 48;
export const ZCOORD_BUFFER_OFFSET_MULTIPLIER = 24;
export const COLOR_OVERRIDE_BUFFER_OFFSET_MULTIPLIER = 96;
export const ATLAS_ID_BUFFER_OFFSET_MULTIPLIER = ATLAS_ID_SIZE;

export const POSITION_COMPONENTS = 2;
export const TEXCOORD_COMPONENTS = 2;
export const ZCOORD_COMPONENTS = 1;
export const COLOR_OVERRIDE_COMPONENTS = 4;
export const ATLAS_ID_COMPONENTS = 1;

export const SPRITE_DRAW_OFFSET = 0;
