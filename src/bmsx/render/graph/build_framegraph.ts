import { $ } from '../..';
import { PipelineId } from '../backend/interfaces';
import { isAmbientLight, LightingSystem } from '../lighting/lightingsystem';
import { pipelineRegistry } from '../pipelines/pipelineregistry';
import { RenderView } from '../view/render_view';
import { RenderGraphRuntime } from './rendergraph';

// Temporary diagnostics / debug flags
const DEBUG_FORCE_VISIBLE_CLEAR = false; // set true to force magenta
// Instance-scoped debug mark (Map keyed by RenderGraphRuntime) so hot reload or multiple views remain isolated
const rgDebugLogged = new WeakMap<RenderGraphRuntime, boolean>();
// Local cached clone of the pipeline registry (stable across frames unless hot-reload triggers full refresh)
// We keep only the data needed for graph building to avoid accidental mutation of shared registry objects.
// Extended: future fields (e.g. transient scratch targets, MRT descriptors) can be added here without changing loop logic.
interface LocalPipelineDesc {
    name: string;
    consumes: typeof pipelineRegistry[number]['consumes'];
    writesDepth?: boolean;
    id: PipelineId;
    presentStage?: boolean;
    isStateOnly?: boolean;
    shouldExecute?: () => boolean;
    prepare: typeof pipelineRegistry[number]['prepare'];
}
const localPipelineRegistry: LocalPipelineDesc[] = pipelineRegistry.map(p => ({
    name: p.name,
    consumes: p.consumes,
    writesDepth: p.writesDepth,
    id: p.id,
    presentStage: (p as any).presentStage as boolean | undefined,
    isStateOnly: (p as any).isStateOnly as boolean | undefined,
    shouldExecute: p.shouldExecute?.bind(p),
    prepare: p.prepare as any,
}));

// Diagnostics helper (accesses private internals of RenderGraphRuntime via 'any' – debug only)
function logGraphDiagnostics(rg: RenderGraphRuntime, label: string, frameColorHandle: number | null): void {
    try {
        const order = rg.getPassOrder();
        const reachable = rg.getReachableMask();
        const names = rg.getPassNames();
        const texInfo = rg.getTextureDebugInfo();
        const frameColorInfo = frameColorHandle != null ? texInfo.find(t => t.index === frameColorHandle) : undefined;
        // eslint-disable-next-line no-console
        console.warn(`[RG-DIAG] ${label} | order=${order.map(i => names[i] || ('#' + i)).join(' -> ')}`);
        // eslint-disable-next-line no-console
        console.warn('[RG-DIAG] Reachability:', names.map((n, i) => ({ i, name: n, reachable: !!reachable[i], orderIndex: order.indexOf(i) })));
        if (frameColorInfo) {
            // eslint-disable-next-line no-console
            console.warn('[RG-DIAG] FrameColor writers:', frameColorInfo.writers.map(i => names[i]));
        }
    } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[RG-DIAG] Failed to dump graph diagnostics', e);
    }
}

/** Build the render graph for a WebGLRenderView. */
export function buildFrameGraph(view: RenderView, lightingSystem: LightingSystem): RenderGraphRuntime {
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
            ctx.backend.setPipelineState?.('__frame_shared__', { view: viewState, lighting });
        }
    });

    // Add passes for each registered pipeline (including presentStage CRT)
    // We build passes first; expected writers resolved dynamically at Present pass execution (after shouldExecute filters).
    for (const desc of localPipelineRegistry) {
        // Flags for behavior
        const isPresent = !!desc.presentStage;
        const isStateOnly = !!desc.isStateOnly;
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
                const willRun = !desc.shouldExecute || desc.shouldExecute();
                if (!willRun) return; // skip entirely (not counted as expected writer)
                if (data.present) {
                    // For the present (CRT) stage we build the pipeline state using the graph-produced color texture
                    const srcTex = view.rgColor ? (ctx.getTex(view.rgColor) as WebGLTexture | null) : null;
                    if (!rgDebugLogged.get(rg)) {
                        // eslint-disable-next-line no-console
                        console.log('[RG-DIAG] Present pass: srcTex', !!srcTex, 'size', view.offscreenCanvasSize.x, view.offscreenCanvasSize.y);
                        if (!srcTex) {
                            // Attempt fallback discovery of FrameColor handle via exported/present texture debug info if initial handle missing
                            if (frameColorHandle == null) {
                                try {
                                    const texInfo = rg.getTextureDebugInfo();
                                    const maybePresent = texInfo.find(t => t.present);
                                    if (maybePresent) frameColorHandle = maybePresent.index;
                                } catch { /* ignore */ }
                            }
                            logGraphDiagnostics(rg, 'Blank frame (no srcTex)', frameColorHandle);
                        } else if (DEBUG_FORCE_VISIBLE_CLEAR) {
                            logGraphDiagnostics(rg, 'Debug clear active', frameColorHandle);
                        }
                        // Runtime validation: check all expected writers participated in the FrameColor chain.
                        try {
                            const texInfo = rg.getTextureDebugInfo();
                            const names = rg.getPassNames();
                            const colorRes = frameColorHandle == null ? undefined : texInfo.find(t => t.index === frameColorHandle);
                            const writerNames = colorRes ? colorRes.writers.map(i => names[i]) : [];
                            // Dynamically derive expected writers (passes that produced FrameColor besides Clear & Present & state-only)
                            const dynamicExpected = writerNames.filter(n => n !== 'Clear' && n !== desc.name);
                            const missing = dynamicExpected.filter(n => !writerNames.includes(n));
                            if (missing.length) {
                                // eslint-disable-next-line no-console
                                console.warn('[RG-DIAG] Missing expected writer passes in FrameColor chain:', missing);
                            }
                        } catch { /* ignore */ }
                        rgDebugLogged.set(rg, true);
                    }
                    // Recreate the state normally set in the registry but sourcing the RG texture instead of legacy FBO
                    ctx.backend.setPipelineState?.('CRT', {
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
                    ctx.backend.executePipeline?.('CRT', null);
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

    // Post-compile validation (lazy): compile once with minimal frame to inspect writers
    try {
        const dummyFrame: any = { views: [], frameIndex: 0, time: 0, delta: 0 };
        rg.compile(dummyFrame); // safe to call compile early
        const texInfo = rg.getTextureDebugInfo();
        const frameColor = frameColorHandle != null ? texInfo.find(t => t.index === frameColorHandle) : texInfo.find(t => t.present);
        if (frameColor) {
            const writerNames = frameColor.writers.map(i => rg.getPassNames()[i]);
            const nonClearWriters = writerNames.filter(n => n !== 'Clear' && n !== 'CRTPost');
            if (nonClearWriters.length === 0) {
                // eslint-disable-next-line no-console
                console.warn('[RG-DIAG] Validation: Only Clear pass writes to FrameColor (no scene content passes).');
            }
        }
    } catch (e) {
        console.error(`[RG-DIAG] Validation: Render graph compile failed: ${e}`);
        /* ignore validation errors (e.g., if compile requires real frame data) */
    }

    return rg;
}
