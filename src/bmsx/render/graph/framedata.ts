/** FrameData builder (initial). Extracts snapshot data from existing subsystems. */
import { $ } from '../../core/game';
import { RenderView } from '../view/render_view';
import type { FrameData, View } from './rendergraph';

// We keep dependencies extremely light; detailed draw command unification will happen later.

// External fixed-step timing supplied by the game loop (no internal accumulation here).
let extFrameIndex = 0;
let extTimeSeconds = 0;
let extDeltaSeconds = 0;
export function updateExternalFrameTiming(frameIndex: number, timeSeconds: number, deltaSeconds: number): void {
    extFrameIndex = frameIndex;
    extTimeSeconds = timeSeconds;
    extDeltaSeconds = deltaSeconds;
}

// Reusable fallback vector (avoid per-frame allocations).
const ZERO_VEC3 = new Float32Array([0, 0, 0]);

// Minimal expected camera shape. We rely on engine code guaranteeing these.
type Vec3Like = Float32Array | { 0: number; 1: number; 2: number } | number[] | any; // 'any' here only inside type alias to accommodate existing vec3 type.

interface Camera3DShape {
    view: Float32Array;
    projection: Float32Array;
    viewProjection: Float32Array;
    skyboxView?: Float32Array; // used elsewhere (skybox pass)
    inverseView?: Float32Array; viewInverse?: Float32Array;
    inverseProjection?: Float32Array; projectionInverse?: Float32Array;
    position?: Vec3Like; // direct buffer from engine (avoid copies)
}

export function buildFrameData(view: RenderView): FrameData {
    const mainCam = $.model.activeCamera3D as Camera3DShape | undefined;
    const views: View[] = [];
    if (mainCam) {
        // Attempt to locate inverse matrices if exposed under common alt names; fallback to identity/new copies.
        const invView = mainCam.inverseView || mainCam.viewInverse || mainCam.view;
        const invProj = mainCam.inverseProjection || mainCam.projectionInverse || mainCam.projection;
        const cameraPos = mainCam.position ?? ZERO_VEC3; // direct reference (no allocation)
        views.push({
            name: 'Main',
            viewport: { x: 0, y: 0, w: view.canvas.width, h: view.canvas.height },
            viewMatrix: mainCam.view,
            projMatrix: mainCam.projection,
            viewProj: mainCam.viewProjection,
            invView,
            invProj,
            cameraPos,
            flags: 0,
        });
    }

    const frame: FrameData = {
        frameIndex: extFrameIndex,
        time: extTimeSeconds,
        delta: extDeltaSeconds,
        views,
        // Placeholders – these will be populated during later migration steps.
        drawCommands: [],
        postFx: {
            crt: {
                noise: view.noiseIntensity,
                colorBleed: view.colorBleed,
                blur: view.blurIntensity,
                glowColor: view.glowColor,
                flags: {
                    noise: view.applyNoise,
                    colorBleed: view.applyColorBleed,
                    scanlines: view.applyScanlines,
                    blur: view.applyBlur,
                    glow: view.applyGlow,
                    fringe: view.applyFringing,
                },
            },
        },
    } as FrameData;

    return frame;
}
