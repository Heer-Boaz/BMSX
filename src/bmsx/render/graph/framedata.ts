/** FrameData builder (initial). Extracts snapshot data from existing subsystems. */
import { $ } from '../../core/game';
import { Camera } from '../3d/camera3d';
import { GLView } from '../view/render_view';
import type { FrameData, View } from './rendergraph';

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

export function buildFrameData(view: GLView): FrameData {
    const mainCam = $.model.activeCamera3D as Camera | undefined;
    const views: View[] = [];
    if (mainCam) {
        // Attempt to locate inverse matrices if exposed under common alt names; fallback to identity/new copies.
        const invView = mainCam.view; // inverse not exposed; use view as placeholder
        const invProj = mainCam.projection; // inverse not exposed; use projection as placeholder
        const cameraPos = mainCam.position; // vec3 from camera (avoid allocation)
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
        // drawCommands removed – pipelines reference their own global queues
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
