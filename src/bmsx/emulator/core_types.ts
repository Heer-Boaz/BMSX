import type { CanonicalizationType, Viewport } from '../rompack/rompack';

export type RuntimeOptions = {
	playerIndex: number;
	canonicalization?: CanonicalizationType;
	viewport: Viewport;
	namespace: string;
};

export type MarshalContext = {
	moduleId: string;
	path: string[];
};

export type RuntimeError = Error & {
	path?: string;
	line?: number;
	column?: number;
};
