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
            const fogState = backend.getPipelineState?.(PipelineId.Fog) as { fog?: any } | undefined;
            backend.setPipelineState?.(PipelineId.MeshBatch, { width, height, view: { camPos: cam.position, viewProj: cam.viewProjection }, lighting: frameShared && (frameShared as any).lighting, fog: fogState?.fog });
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
            backend.setPipelineState?.(PipelineId.Sprites, { width, height });
        }
    },
    {
        id: PipelineId.CRT,
        name: 'CRTPost',
        consumes: [],
        writesDepth: false,
        presentStage: true,
        prepare(view, { backend, width, height }) {
            const v = view as WebGLRenderView; // structural usage
            // Pass source color texture + CRT options (pulled from view properties) to backend pipeline state
            const colorTex = (v as any).renderGraph ? undefined : undefined; // placeholder if future direct path needed
            backend.setPipelineState?.(PipelineId.CRT, {
                width: v.offscreenCanvasSize.x,
                height: v.offscreenCanvasSize.y,
                outWidth: v.canvasSize.x,
                outHeight: v.canvasSize.y,
                colorTex: v['textures']?.post_processing_source_texture, // legacy FBO color texture
                options: {
                    applyNoise: v['applyNoise'],
                    applyColorBleed: v['applyColorBleed'],
                    applyScanlines: v['applyScanlines'],
                    applyBlur: v['applyBlur'],
                    applyGlow: v['applyGlow'],
                    applyFringing: v['applyFringing'],
                    noiseIntensity: v['noiseIntensity'],
                    colorBleed: v['colorBleed'],
                    blurIntensity: v['blurIntensity'],
                    glowColor: v['glowColor'],
                }
            });
        }
    }
];