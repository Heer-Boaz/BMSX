// Shared lightweight GPU-related public types to avoid circular deps between backend and texture manager.
import { Size } from '../rompack/rompack';

export type TextureHandle = unknown; // Opaque handle (WebGLTexture | GPUTexture in future)

export interface TextureParams {
    size?: Size; // For procedural/empty textures (e.g., shadow maps)
    wrapS?: number;
    wrapT?: number;
    minFilter?: number;
    magFilter?: number;
}
