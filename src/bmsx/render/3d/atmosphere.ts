export interface AtmosphereParams {
    fogColor: [number, number, number];
    baseFogDensity: number;
    dynamicFogDensity: number;
    heightMin: number;
    heightMax: number;
    heightLowColor: [number, number, number];
    heightHighColor: [number, number, number];
    enableFog: boolean;
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
};

// Console exposure for tweaking
(globalThis as any).atm = Atmosphere;

export function registerAtmosphereHotkeys(): void {
    if ((registerAtmosphereHotkeys as any)._installed) return;
    (registerAtmosphereHotkeys as any)._installed = true;
    window.addEventListener('keydown', (e) => {
        if (e.key === 'f') Atmosphere.enableFog = !Atmosphere.enableFog;
        else if (e.key === 'g') Atmosphere.enableHeightGradient = !Atmosphere.enableHeightGradient;
    });
}

export function noteCandidateBuildingTop(topY: number): void {
    if (topY > Atmosphere.heightMax) Atmosphere.heightMax = topY;
}