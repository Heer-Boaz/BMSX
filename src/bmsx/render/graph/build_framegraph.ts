import { $ } from '../..';
import { PipelineId } from '../backend/interfaces';
import { getPipelinePasses } from '../backend/pipeline_registry';
import { isAmbientLight, LightingSystem } from '../lighting/lightingsystem';
import { GLView } from '../view/render_view';
import { RenderGraphRuntime } from './rendergraph';

// Debug output removed for production usage; keep constant for quick local enabling if needed
const DEBUG_FORCE_VISIBLE_CLEAR = false;
// Local cached clone of the pipeline registry (stable across frames unless hot-reload triggers full refresh)
// We keep only the data needed for graph building to avoid accidental mutation of shared registry objects.
// Extended: future fields (e.g. transient scratch targets, MRT descriptors) can be added here without changing loop logic.
type PipelinePassPrepare = ReturnType<typeof getPipelinePasses>[number]['prepare'];
interface LocalPipelineDesc {
    name: string;
    writesDepth?: boolean;
    id: PipelineId;
    presentStage?: boolean;
    isStateOnly?: boolean;
    shouldExecute?: () => boolean;
    prepare: PipelinePassPrepare;
}
function clonePasses(): LocalPipelineDesc[] {
    const src = getPipelinePasses();
    return src.map(p => ({
        name: p.name,
        writesDepth: p.writesDepth,
        id: p.id,
        presentStage: p.presentStage,
        isStateOnly: p.isStateOnly,
        shouldExecute: p.shouldExecute?.bind(p),
        prepare: p.prepare,
    }));
}

// Diagnostics removed; helper stubs kept minimal to avoid churn if reintroduced
/* noop */

/** Build the render graph for a WebGLRenderView. */
export function buildFrameGraph(view: GLView, lightingSystem: LightingSystem, customPasses?: LocalPipelineDesc[]): RenderGraphRuntime {
    const rg = new RenderGraphRuntime(view.getBackend());
    view.rgColor = null; view.rgDepth = null;
    // (particle camera vectors handled inside pipeline registry now)
    // Keep a handle reference for diagnostics (populated inside Clear pass setup)
    let frameColorHandle: number | null = null;

    rg.addPass({
        name: 'Clear',
        setup: (io) => {
            view.rgColor = io.createTex({ width: view.offscreenCanvasSize.x, height: view.offscreenCanvasSize.y, name: 'FrameColor' });
            view.rgDepth = io.createTex({ width: view.offscreenCanvasSize.x, height: view.offscreenCanvasSize.y, depth: true, name: 'FrameDepth' });
            const clearCol: [number, number, number, number] = DEBUG_FORCE_VISIBLE_CLEAR ? [1, 0, 1, 1] : [0, 0, 0, 1];
            if (view.rgColor) io.writeTex(view.rgColor, { clearColor: clearCol });
            if (view.rgDepth) io.writeTex(view.rgDepth, { clearDepth: 1.0 });
            if (view.rgColor) io.exportToBackbuffer(view.rgColor);
            frameColorHandle = view.rgColor;
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
            ctx.backend.setPipelineState?.('FrameShared', { view: viewState, lighting });
        }
    });

    // Add passes for each registered pipeline (including presentStage CRT)
    // We build passes first; expected writers resolved dynamically at Present pass execution (after shouldExecute filters).
    const passList = customPasses ?? clonePasses();
    for (const desc of passList) {
        // Flags for behavior
        const isPresent = !!desc.presentStage;
        const isStateOnly = !!desc.isStateOnly;
        rg.addPass({
            name: desc.name,
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
                const willRun = !desc.shouldExecute || desc.shouldExecute();
                if (!willRun) return; // skip entirely (not counted as expected writer)
                if (data.present) {
                    const srcTex = view.rgColor ? (ctx.getTex(view.rgColor) as WebGLTexture | null) : null;
                    // Prepare & execute like any other pass (now passes srcTex)
                    desc.prepare(view, { backend: ctx.backend, width: data.width, height: data.height, srcTex });
                    ctx.backend.executePipeline?.(desc.id, null);
                } else if (isStateOnly) {
                    // Fog/state-only – just prepare state (no FBO binding by graph for writers)
                    desc.prepare(view, { backend: ctx.backend, width: data.width, height: data.height });
                } else {
                    // Non-present passes keep using their descriptor-based prepare logic
                    desc.prepare(view, { backend: ctx.backend, width: data.width, height: data.height });
                    // executePipeline is loosely typed in backend (string id). Use the enum value as key.
                    ctx.backend.executePipeline?.(desc.id, ctx.getFBO(view.rgColor!, view.rgDepth!) as WebGLFramebuffer);
                }
            }
        });
    }

    // Optional early compile removed (diagnostics disabled)

    return rg;
}
