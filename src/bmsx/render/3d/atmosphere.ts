export interface AtmosphereParams {
    fogColor: [number, number, number];
    baseFogDensity: number;
    dynamicFogDensity: number;
    heightMin: number;
    heightMax: number;
    heightLowColor: [number, number, number];
    heightHighColor: [number, number, number];
    enableFog: boolean;
    /** Fog mode: 0 = exponential (exp), 1 = exponential squared (exp2) */
    fogMode: 0 | 1;
    /** Enable additional ground / height fog modulation */
    enableHeightFog: boolean;
    /** World Y at which height fog is at full strength (below or equal) */
    heightFogStart: number;
    /** World Y where height fog fully dissipates */
    heightFogEnd: number;
    enableHeightGradient: boolean;
    progressFactor: number;
    enableAutoAnimation: boolean;
}

export const Atmosphere: AtmosphereParams = {
    fogColor: [0.05, 0.07, 0.10],
    baseFogDensity: 0.004,
    dynamicFogDensity: 0.010,
    heightMin: 0,
    heightMax: 200,
    heightLowColor: [0.90, 0.95, 1.00],
    heightHighColor: [1.15, 1.05, 0.85],
    enableFog: true,
    enableHeightGradient: true,
    progressFactor: 0,
    enableAutoAnimation: true,
    fogMode: 1, // default to exp2 for smoother far fade
    enableHeightFog: true,
    heightFogStart: 0,
    heightFogEnd: 140,
};

// Console exposure for tweaking (declare on global interface for typing)
declare global { interface Window { atm?: AtmosphereParams } }
window.atm = Atmosphere;

let atmosphereHotkeysInstalled = false;
export function registerAtmosphereHotkeys(): void {
    if (atmosphereHotkeysInstalled) return;
    atmosphereHotkeysInstalled = true;
    window.addEventListener('keydown', (e) => {
        if (e.key === 'f') Atmosphere.enableFog = !Atmosphere.enableFog;
        else if (e.key === 'g') Atmosphere.enableHeightGradient = !Atmosphere.enableHeightGradient;
        else if (e.key === 'h') Atmosphere.enableHeightFog = !Atmosphere.enableHeightFog;
        else if (e.key === 'm') Atmosphere.fogMode = Atmosphere.fogMode === 0 ? 1 : 0; // toggle fog mode
    });
}

export function noteCandidateBuildingTop(topY: number): void {
    if (topY > Atmosphere.heightMax) Atmosphere.heightMax = topY;
}