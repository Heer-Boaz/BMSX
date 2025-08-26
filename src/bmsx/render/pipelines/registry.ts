import { $ } from '../../core/game';
import { Atmosphere, registerAtmosphereHotkeys } from '../3d/atmosphere';
import { M4 } from '../3d/math3d';
import * as MeshPipeline from '../3d/mesh_pipeline';
import * as ParticlesPipeline from '../3d/particles_pipeline';
import * as SkyboxPipeline from '../3d/skybox_pipeline';
import { GPUBackend, PipelineId } from '../backend/interfaces';
import { RGCommandKind } from '../graph/rendergraph';
import { RenderContext } from '../view/render_context';
import { RenderView as WebGLRenderView } from '../view/render_view';

export interface PipelinePassDescriptor {
    id: PipelineId;
    name: string;
    consumes: RGCommandKind[];
    writesDepth?: boolean;
    prepare(view: Pick<RenderContext, 'glctx'> & Partial<WebGLRenderView>, ctx: { backend: GPUBackend; width: number; height: number }): void;
    shouldExecute?(): boolean;
    presentStage?: boolean; // marks a post-process / final stage
}

const particleCamRight = new Float32Array(3);
const particleCamUp = new Float32Array(3);

export const pipelineRegistry: PipelinePassDescriptor[] = [
    {
        id: PipelineId.Fog,
        name: 'FogState',
        consumes: [],
        writesDepth: false,
        shouldExecute: () => Atmosphere.enableFog || Atmosphere.enableHeightFog || Atmosphere.enableHeightGradient,
        prepare(view, { backend, width, height }) {
            registerAtmosphereHotkeys();
            const fogState = {
                fogColor: Atmosphere.fogColor,
                fogDensity: (() => { const p = Atmosphere.progressFactor; const anim = Atmosphere.enableAutoAnimation ? (0.5 - 0.5 * Math.cos(p * 6.28318530718)) : 0.0; return Atmosphere.baseFogDensity + Atmosphere.dynamicFogDensity * anim; })(),
                enableFog: Atmosphere.enableFog, fogMode: Atmosphere.fogMode,
                enableHeightFog: Atmosphere.enableHeightFog, heightFogStart: Atmosphere.heightFogStart, heightFogEnd: Atmosphere.heightFogEnd,
                heightLowColor: Atmosphere.heightLowColor, heightHighColor: Atmosphere.heightHighColor,
                heightMin: Atmosphere.heightMin, heightMax: Atmosphere.heightMax, enableHeightGradient: Atmosphere.enableHeightGradient,
            };
            backend.setPipelineState?.(PipelineId.Fog, { width, height, fog: fogState });
        }
    },
    {
        id: PipelineId.Skybox,
        name: 'Skybox',
        consumes: [RGCommandKind.Skybox],
        writesDepth: true,
        shouldExecute: () => !!$.model.activeCamera3D && !!SkyboxPipeline.skyboxKey,
        prepare(_view, { backend, width, height }) {
            const cam = $.model.activeCamera3D; if (!cam) return;
            const tex = $.texmanager.getTexture(SkyboxPipeline.skyboxKey) as WebGLTexture | undefined;
            if (!tex) return;
            backend.setPipelineState?.(PipelineId.Skybox, { view: cam.skyboxView, proj: cam.projection, tex, width, height });
        }
    },
    {
        id: PipelineId.MeshBatch,
        name: 'Meshes',
        consumes: [RGCommandKind.MeshBatch],
        writesDepth: true,
        shouldExecute: () => (MeshPipeline.meshesToDraw?.length ?? 0) > 0,
        prepare(_view, { backend, width, height }) {
            const cam = $.model.activeCamera3D; if (!cam) return;
            const frameShared = backend.getPipelineState?.('__frame_shared__') as { lighting?: unknown } | undefined;
            const fogStateHolder = backend.getPipelineState?.(PipelineId.Fog) as { fog?: any } | undefined;
            let fog = fogStateHolder?.fog;
            if (!fog) {
                // Recompute fog locally if Fog state pass hasn't executed yet (graph ordering)
                const density = (() => { const p = Atmosphere.progressFactor; const anim = Atmosphere.enableAutoAnimation ? (0.5 - 0.5 * Math.cos(p * 6.28318530718)) : 0.0; return Atmosphere.baseFogDensity + Atmosphere.dynamicFogDensity * anim; })();
                fog = {
                    fogColor: Atmosphere.fogColor,
                    fogDensity: density,
                    enableFog: Atmosphere.enableFog,
                    fogMode: Atmosphere.fogMode,
                    enableHeightFog: Atmosphere.enableHeightFog,
                    heightFogStart: Atmosphere.heightFogStart,
                    heightFogEnd: Atmosphere.heightFogEnd,
                    heightLowColor: Atmosphere.heightLowColor,
                    heightHighColor: Atmosphere.heightHighColor,
                    heightMin: Atmosphere.heightMin,
                    heightMax: Atmosphere.heightMax,
                    enableHeightGradient: Atmosphere.enableHeightGradient,
                };
            }
            backend.setPipelineState?.(PipelineId.MeshBatch, { width, height, view: { camPos: cam.position, viewProj: cam.viewProjection }, lighting: frameShared && (frameShared as any).lighting, fog });
        }
    },
    {
        id: PipelineId.Particles,
        name: 'Particles',
        consumes: [RGCommandKind.ParticleBatch],
        writesDepth: true,
        shouldExecute: () => (ParticlesPipeline.particlesToDraw?.length ?? 0) > 0,
        prepare(_view, { backend, width, height }) {
            const cam = $.model.activeCamera3D; if (!cam) return;
            M4.viewRightUpInto(cam.view, particleCamRight, particleCamUp);
            backend.setPipelineState?.(PipelineId.Particles, { width, height, viewProj: cam.viewProjection, camRight: particleCamRight, camUp: particleCamUp });
        }
    },
    {
        id: PipelineId.Sprites,
        name: 'Sprites2D',
        consumes: [RGCommandKind.SpriteBatch],
        writesDepth: true,
        prepare(_view, { backend, width, height }) {
            // Provide both offscreen buffer size (width/height) and logical viewport size for correct 2D scaling
            const viewAny: any = _view;
            backend.setPipelineState?.(PipelineId.Sprites, {
                width, height, // offscreen buffer (e.g. 640x480)
                baseWidth: viewAny.viewportSize?.x ?? width / 2,
                baseHeight: viewAny.viewportSize?.y ?? height / 2,
            });
        }
    },
    {
        id: PipelineId.CRT,
        name: 'CRTPost',
        consumes: [RGCommandKind.PostProcess],
        writesDepth: false,
        presentStage: true,
        prepare(view, { backend, width, height }) {
            const glview = view as WebGLRenderView; // structural usage
            backend.setPipelineState?.(PipelineId.CRT, {
                width: glview.offscreenCanvasSize.x,   // actual offscreen buffer size (after integer upscale)
                height: glview.offscreenCanvasSize.y,
                baseWidth: glview.viewportSize.x,      // logical game resolution
                baseHeight: glview.viewportSize.y,
                fragScale: glview.offscreenCanvasSize.x / glview.viewportSize.x, // integer upscale factor
                outWidth: glview.canvasSize.x,
                outHeight: glview.canvasSize.y,
                colorTex: glview.textures.post_processing_source_texture, // legacy FBO color texture
                options: {
                    applyNoise: glview.applyNoise,
                    applyColorBleed: glview.applyColorBleed,
                    applyScanlines: glview.applyScanlines,
                    applyBlur: glview.applyBlur,
                    applyGlow: glview.applyGlow,
                    applyFringing: glview.applyFringing,
                    noiseIntensity: glview.noiseIntensity,
                    colorBleed: glview.colorBleed,
                    blurIntensity: glview.blurIntensity,
                    glowColor: glview.glowColor,
                }
            });
        }
    }
];