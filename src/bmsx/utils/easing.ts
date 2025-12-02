export type EasingFn = (t: number) => number;

const clamp01 = (v: number): number => (v <= 0 ? 0 : v >= 1 ? 1 : v);

const BASE_EASINGS: Record<string, EasingFn> = {
	linear: (t: number) => clamp01(t),
	easeInQuad: (t: number) => {
		const x = clamp01(t);
		return x * x;
	},
	easeOutQuad: (t: number) => {
		const x = clamp01(1 - t);
		return 1 - x * x;
	},
	easeInOutQuad: (t: number) => {
		const x = clamp01(t);
		return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
	},
	easeOutBack: (t: number) => {
		const x = clamp01(t);
		const c1 = 1.70158;
		const c3 = c1 + 1;
		return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
	},
};

export const DEFAULT_EASING = 'easeOutQuad' as const;

export function get_easing(name?: string): EasingFn {
	if (!name) return BASE_EASINGS[DEFAULT_EASING];
	return BASE_EASINGS[name] ?? BASE_EASINGS[DEFAULT_EASING];
}

export function register_easing(name: string, fn: EasingFn): void {
	if (!name || typeof fn !== 'function') throw new Error('Cannot register easing: invalid arguments');
	BASE_EASINGS[name] = fn;
}

export function has_easing(name: string): boolean {
	return !!BASE_EASINGS[name];
}

export function list_easing_names(): readonly string[] {
	return Object.keys(BASE_EASINGS);
}

export function evaluate_easing(name: string, t: number): number {
	return get_easing(name)(t);
}
