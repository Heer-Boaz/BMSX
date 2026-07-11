export const ZCOORD_MAX = 10000;

// Centralized texture unit assignments for WebGL. Keep these stable.
// Used by pipelines, backend, and view code.
export const TEXTURE_UNIT_SLOT_PRIMARY = 0;
export const TEXTURE_UNIT_SLOT_SECONDARY = 1;
export const TEXTURE_UNIT_SLOT_SYSTEM = 11;
export const TEXTURE_UNIT_CUBEMAP = 6;
export const TEXTURE_UNIT_POST_PROCESSING_SOURCE = 8;
// A high-numbered scratch unit for temporary uploads
export const TEXTURE_UNIT_UPLOAD = 15;
