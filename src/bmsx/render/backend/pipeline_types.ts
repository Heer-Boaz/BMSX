// Typed pipeline state interfaces separated from interfaces.ts for clarity.
// These represent the concrete state objects expected by built-in pipelines.

export interface SkyboxState { view: Float32Array; proj: Float32Array; tex: WebGLTexture; width?: number; height?: number }
export interface MeshBatchState { width: number; height: number; view: { camPos: { x: number; y: number; z: number }; viewProj: Float32Array }; fog?: any; lighting?: any }
export interface ParticlesState { width: number; height: number; viewProj: Float32Array; camRight: Float32Array; camUp: Float32Array }
export interface SpritesState { width: number; height: number; baseWidth?: number; baseHeight?: number }
export interface CRTState { width: number; height: number; baseWidth?: number; baseHeight?: number; fragScale?: number; outWidth?: number; outHeight?: number; colorTex?: WebGLTexture | null; options?: any }
export interface FogState { width: number; height: number; fog: any }
export interface FrameSharedState { view: any; lighting: any }

// Mapping of PipelineId -> State; kept loose so external custom pipelines can extend via declaration merging.
// Use interface merging in consuming code to augment if needed.
export interface PipelineStates {
    Skybox: SkyboxState;
    MeshBatch: MeshBatchState;
    Particles: ParticlesState;
    Sprites: SpritesState;
    CRT: CRTState;
    Fog: FogState;
    FrameShared: FrameSharedState; // formalized (replaces legacy __frame_shared__)
}

export type KnownPipelineId = keyof PipelineStates;
