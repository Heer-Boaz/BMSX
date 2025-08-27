import { $ } from '../..';
import { RenderContext, RenderPassDef } from '../backend/pipeline_interfaces';
import { PipelineRegistry } from '../backend/pipeline_registry';
import { isAmbientLight, LightingSystem } from '../lighting/lightingsystem';
import { RenderGraphRuntime } from './rendergraph';

// Debug output removed for production usage; keep constant for quick local enabling if needed
const DEBUG_FORCE_VISIBLE_CLEAR = false;

// const MANDATORY_WRITERS: (keyof RenderPassDef)[] = ['Clear', 'Scene', 'PostProcess'];
// Local cached clone of the pipeline registry (stable across frames unless hot-reload triggers full refresh)
// We keep only the data needed for graph building to avoid accidental mutation of shared registry objects.
// Extended: future fields (e.g. transient scratch targets, MRT descriptors) can be added here without changing loop logic.
type PipelinePassPrepare = NonNullable<RenderPassDef['prepare']>;
interface LocalRenderPassDef {
    name: string;
    writesDepth?: boolean;
    id: string; // allow dynamic ids beyond PipelineId union
    present?: boolean;
    stateOnly?: boolean;
    shouldExecute?: () => boolean;
    prepare: PipelinePassPrepare;
}
function clonePasses(registry: PipelineRegistry): LocalRenderPassDef[] {
    const src = registry.getPipelinePasses();
    return src.map(p => ({
        name: p.name,
        writesDepth: p.writesDepth,
        id: String(p.id),
        present: p.present,
        stateOnly: p.stateOnly,
        shouldExecute: p.shouldExecute?.bind(p),
        prepare: p.prepare ?? (() => { /* no-op */ }),
    }));
}

export function buildFrameGraph(view: RenderContext, lightingSystem: LightingSystem, registry: PipelineRegistry, customPasses?: LocalRenderPassDef[]): RenderGraphRuntime {
    const rg = new RenderGraphRuntime(view.getBackend());
    // (particle camera vectors handled inside pipeline registry now)
    // Keep a handle reference for diagnostics (populated inside Clear pass setup)
    let frameColorHandle: number | null = null;
    let frameDepthHandle: number | null = null;

    rg.addPass({
        name: 'Clear',
        setup: (io) => {
            const color = io.createTex({ width: view.offscreenCanvasSize.x, height: view.offscreenCanvasSize.y, name: 'FrameColor' });
            const depth = io.createTex({ width: view.offscreenCanvasSize.x, height: view.offscreenCanvasSize.y, depth: true, name: 'FrameDepth' });
            const clearCol: [number, number, number, number] = DEBUG_FORCE_VISIBLE_CLEAR ? [1, 0, 1, 1] : [0, 0, 0, 1];
            io.writeTex(color, { clearColor: clearCol });
            io.writeTex(depth, { clearDepth: 1.0 });
            io.exportToBackbuffer(color);
            frameColorHandle = color;
            frameDepthHandle = depth;
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
            // Store shared frame state via registry so downstream prepare() calls can read it
            registry.setState('frame_shared', { view: viewState, lighting } as any);
        }
    });

    // Add passes for each registered pipeline (including presentStage CRT)
    // We build passes first; expected writers resolved dynamically at Present pass execution (after shouldExecute filters).
    const passList = customPasses ?? clonePasses(registry);
    for (const desc of passList) {
        // Flags for behavior
        const isPresent = !!desc.present;
        const isStateOnly = !!desc.stateOnly;
        rg.addPass({
            name: desc.name,
            alwaysExecute: isStateOnly, // ensure state-only pass runs
            setup: (io) => {
                if (!isPresent && !isStateOnly) {
                    // Rendering passes declare themselves as writers to the shared frame color/depth
                    if (frameColorHandle != null) io.writeTex(frameColorHandle);
                    if (desc.writesDepth && frameDepthHandle != null) io.writeTex(frameDepthHandle);
                } else {
                    if (frameColorHandle != null) io.readTex(frameColorHandle); // read final color for post-process
                }
                return { width: view.offscreenCanvasSize.x, height: view.offscreenCanvasSize.y, present: isPresent };
            },
            execute: (ctx, frame, data: { width: number; height: number; present: boolean }) => {
                const willRun = !desc.shouldExecute || desc.shouldExecute();
                if (!willRun) return; // skip entirely (not counted as expected writer)
                if (data.present) {
                    // Provide present state (CRT) with the final color texture and options
                    const colorTex = frameColorHandle != null ? ctx.getTex(frameColorHandle) : null;
                    try {
                        registry.setState('crt', {
                            width: view.offscreenCanvasSize.x,
                            height: view.offscreenCanvasSize.y,
                            baseWidth: view.viewportSize.x,
                            baseHeight: view.viewportSize.y,
                            colorTex,
                            options: (frame['postFx']?.crt),
                        });
                    } catch { /* registry may not have 'crt' yet */ }
                    desc.prepare(ctx.backend, undefined);
                    registry.execute(desc.id, null);
                } else if (isStateOnly) {
                    desc.prepare(ctx.backend, undefined);
                } else {
                    desc.prepare(ctx.backend, undefined);
                    if (frameColorHandle == null || frameDepthHandle == null) return;
                    registry.execute(desc.id, ctx.getFBO(frameColorHandle, frameDepthHandle) as WebGLFramebuffer);
                }
            }
        });
    }

    // Post-compile validation (lazy): compile once with minimal frame to inspect writers
    try {
        const dummyFrame: any = { views: [], frameIndex: 0, time: 0, delta: 0 };
        rg.compile(dummyFrame); // safe to call compile early
        // Simplified validation: ensure at least one non-Clear writer besides any present pass.
        const texInfo = rg.getTextureDebugInfo();
        const frameColor = frameColorHandle != null ? texInfo.find(t => t.index === frameColorHandle) : texInfo.find(t => t.present);
        if (frameColor) {
            const writerNames = frameColor.writers.map(i => rg.getPassNames()[i]);
            const contentWriters = writerNames.filter(n => n !== 'Clear');
            if (contentWriters.length === 0) {
                console.warn('Framegraph validation: Only Clear pass wrote to frame color.');
            }
        }
    } catch (e) {
        console.error(`Framegraph validation: Render graph compile failed.\n${e}`);
        /* ignore validation errors (e.g., if compile requires real frame data) */
    }

    return rg;
}
