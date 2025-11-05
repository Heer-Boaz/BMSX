/**
 * Reserved atlas metadata for engine/runtime resources.
 *
 * Atlas indices are stored in packed sprite metadata and must fit in an
 * unsigned byte. We reserve index 254 for engine assets so carts can safely
 * use lower indices without risk of collision.
 */
export const ENGINE_ATLAS_INDEX = 254;

/**
 * Texture dictionary key used by GameView to cache the engine atlas texture.
 */
export const ENGINE_ATLAS_TEXTURE_KEY = '_atlas_engine';
