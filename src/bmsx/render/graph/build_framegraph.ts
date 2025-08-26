import { $ } from '../..';
import { PipelineId } from '../backend/interfaces';
import { isAmbientLight, LightingSystem } from '../lighting/lightingsystem';
import { pipelineRegistry } from '../pipelines/registry';
import { RenderView } from '../view/render_view';
import { RenderGraphRuntime } from './rendergraph';

// Temporary diagnostics for blank frame investigation
const DEBUG_FORCE_VISIBLE_CLEAR = false; // set true to force magenta
let debugLoggedOnce = false;
// Local alias referencing external registry (allows incremental adoption without changing loop logic)
const localPipelineRegistry = pipelineRegistry.map(p => ({
    name: p.name,
    consumes: p.consumes,
    writesDepth: p.writesDepth,
    id: p.id,
    presentStage: (p as any).presentStage as boolean | undefined,
    shouldExecute: p.shouldExecute?.bind(p),
    prepare: p.prepare as any
}));

/** Build the render graph for a WebGLRenderView. */
export function buildFrameGraph(view: RenderView, lightingSystem: LightingSystem): RenderGraphRuntime {
    const rg = new RenderGraphRuntime(view.getBackend());
    view.rgColor = null; view.rgDepth = null;
    // (particle camera vectors handled inside pipeline registry now)

    rg.addPass({
        name: 'Clear',
        setup: (io) => {
            view.rgColor = io.createTex({ width: view.offscreenCanvasSize.x, height: view.offscreenCanvasSize.y, name: 'FrameColor' });
            view.rgDepth = io.createTex({ width: view.offscreenCanvasSize.x, height: view.offscreenCanvasSize.y, depth: true, name: 'FrameDepth' });
            const clearCol: [number, number, number, number] = DEBUG_FORCE_VISIBLE_CLEAR ? [1, 0, 1, 1] : [0, 0, 0, 1];
            if (view.rgColor) io.writeTex(view.rgColor, { clearColor: clearCol });
            if (view.rgDepth) io.writeTex(view.rgDepth, { clearDepth: 1.0 });
            if (view.rgColor) io.exportToBackbuffer(view.rgColor);
            return null;
        },
        execute: () => { }
    });

    rg.addPass({
        name: 'FrameSharedState',
        alwaysExecute: true,
        setup: () => null,
        execute: (ctx) => {
            const cam = $.model.activeCamera3D; if (!cam) return;
            const viewState = { camPos: cam.position, viewProj: cam.viewProjection, skyboxView: cam.skyboxView, proj: cam.projection };
            const maybeAmbient = $.model.ambientLight?.light;
            const lighting = lightingSystem.update(isAmbientLight(maybeAmbient) ? maybeAmbient : null);
            ctx.backend.setPipelineState?.('__frame_shared__', { view: viewState, lighting });
        }
    });

    // Add passes for each registered pipeline (including presentStage CRT)
    for (const desc of localPipelineRegistry) {
        const isPresent = desc.id === PipelineId.CRT && desc.presentStage;
        const isStateOnly = desc.id === PipelineId.Fog; // state aggregation only, no draws
        rg.addPass({
            name: desc.name,
            consumes: desc.consumes,
            alwaysExecute: isStateOnly, // ensure state-only pass runs
            setup: (io) => {
                if (!isPresent && !isStateOnly) {
                    // Rendering passes declare themselves as writers to the shared frame color/depth
                    if (view.rgColor) io.writeTex(view.rgColor);
                    if (desc.writesDepth && view.rgDepth) io.writeTex(view.rgDepth);
                } else {
                    if (view.rgColor) io.readTex(view.rgColor); // read final color for post-process
                }
                return { width: view.offscreenCanvasSize.x, height: view.offscreenCanvasSize.y, present: isPresent };
            },
            execute: (ctx, frame, data: { width: number; height: number; present: boolean }) => {
                if (desc.shouldExecute && !desc.shouldExecute()) return;
                if (data.present) {
                    // For the present (CRT) stage we build the pipeline state using the graph-produced color texture
                    const srcTex = view.rgColor ? (ctx.getTex(view.rgColor) as WebGLTexture | null) : null;
                    if (!debugLoggedOnce) {
                        // eslint-disable-next-line no-console
                        console.log('[RG-DIAG] Present pass: srcTex', !!srcTex, 'size', view.offscreenCanvasSize.x, view.offscreenCanvasSize.y);
                        debugLoggedOnce = true;
                    }
                    // Recreate the state normally set in the registry but sourcing the RG texture instead of legacy FBO
                    ctx.backend.setPipelineState?.(PipelineId.CRT, {
                        width: view.offscreenCanvasSize.x,
                        height: view.offscreenCanvasSize.y,
                        baseWidth: view.viewportSize.x,
                        baseHeight: view.viewportSize.y,
                        fragScale: view.offscreenCanvasSize.x / view.viewportSize.x,
                        outWidth: view.canvasSize.x,
                        outHeight: view.canvasSize.y,
                        colorTex: srcTex,
                        options: {
                            applyNoise: view.applyNoise,
                            applyColorBleed: view.applyColorBleed,
                            applyScanlines: view.applyScanlines,
                            applyBlur: view.applyBlur,
                            applyGlow: view.applyGlow,
                            applyFringing: view.applyFringing,
                            noiseIntensity: view.noiseIntensity,
                            colorBleed: view.colorBleed,
                            blurIntensity: view.blurIntensity,
                            glowColor: view.glowColor,
                        }
                    });
                    ctx.backend.executePipeline?.(PipelineId.CRT, null);
                } else if (isStateOnly) {
                    // Fog/state-only – just prepare state (no FBO binding by graph for writers)
                    desc.prepare(view, { backend: ctx.backend, width: data.width, height: data.height });
                } else {
                    // Non-present passes keep using their descriptor-based prepare logic
                    desc.prepare(view, { backend: ctx.backend, width: data.width, height: data.height });
                    ctx.backend.executePipeline?.(desc.id, ctx.getFBO(view.rgColor!, view.rgDepth!) as WebGLFramebuffer);
                }
            }
        });
    }

    return rg;
}

// Helper type guard reused from original location
// (ambient light type guard reused from lighting system import)
