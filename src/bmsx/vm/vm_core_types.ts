import type { CanonicalizationType, Viewport } from '../rompack/rompack';

export type VmRuntimeOptions = {
	playerIndex: number;
	canonicalization?: CanonicalizationType;
	viewport: Viewport;
	namespace: string;
};

export type VmMarshalContext = {
	moduleId: string;
	path: string[];
};

export type VmRuntimeError = Error & {
	path?: string;
	line?: number;
	column?: number;
};
