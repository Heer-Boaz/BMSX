import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type ArchitectureBoundaryRule = {
	from: string;
	to: string | readonly string[];
	except?: readonly string[];
	message?: string;
};

export type ArchitectureBoundaryConfig = {
	rootSegment: string;
	layers: readonly string[];
	rules: readonly ArchitectureBoundaryRule[];
};

export type AnalysisScanConfig = {
	roots: readonly string[];
	cppRoots: readonly string[];
	cppHeaderFilter: string;
};

export type AnalysisConfig = {
	directiveMarker: string;
	scan: AnalysisScanConfig;
	architecture: ArchitectureBoundaryConfig | null;
};

const DEFAULT_SCAN_CONFIG: AnalysisScanConfig = {
	roots: ['src', 'scripts', 'tests', 'tools'],
	cppRoots: ['src'],
	cppHeaderFilter: '.*',
};

const DEFAULT_CONFIG: AnalysisConfig = {
	directiveMarker: '@code-quality',
	scan: DEFAULT_SCAN_CONFIG,
	architecture: null,
};

function stringArray(value: unknown): string[] {
	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function configuredStringArray(value: unknown, fallback: readonly string[]): string[] {
	const configured = stringArray(value);
	return configured.length === 0 ? [...fallback] : configured;
}

function scanConfig(value: unknown): AnalysisScanConfig {
	if (value === null || typeof value !== 'object') {
		return DEFAULT_SCAN_CONFIG;
	}
	const raw = value as {
		roots?: unknown;
		cppRoots?: unknown;
		cppHeaderFilter?: unknown;
	};
	return {
		roots: configuredStringArray(raw.roots, DEFAULT_SCAN_CONFIG.roots),
		cppRoots: configuredStringArray(raw.cppRoots, DEFAULT_SCAN_CONFIG.cppRoots),
		cppHeaderFilter: typeof raw.cppHeaderFilter === 'string' ? raw.cppHeaderFilter : DEFAULT_SCAN_CONFIG.cppHeaderFilter,
	};
}

function architectureRule(value: unknown): ArchitectureBoundaryRule | null {
	if (value === null || typeof value !== 'object') {
		return null;
	}
	const raw = value as {
		from?: unknown;
		to?: unknown;
		except?: unknown;
		message?: unknown;
	};
	if (typeof raw.from !== 'string') {
		return null;
	}
	const to = typeof raw.to === 'string' ? raw.to : stringArray(raw.to);
	if (Array.isArray(to) && to.length === 0) {
		return null;
	}
	return {
		from: raw.from,
		to,
		except: stringArray(raw.except),
		message: typeof raw.message === 'string' ? raw.message : undefined,
	};
}

function architectureConfig(value: unknown): ArchitectureBoundaryConfig | null {
	if (value === null || typeof value !== 'object') {
		return null;
	}
	const raw = value as {
		rootSegment?: unknown;
		layers?: unknown;
		rules?: unknown;
	};
	if (typeof raw.rootSegment !== 'string') {
		return null;
	}
	const layers = stringArray(raw.layers);
	if (layers.length === 0 || !Array.isArray(raw.rules)) {
		return null;
	}
	const rules: ArchitectureBoundaryRule[] = [];
	for (let index = 0; index < raw.rules.length; index += 1) {
		const rule = architectureRule(raw.rules[index]);
		if (rule !== null) {
			rules.push(rule);
		}
	}
	return {
		rootSegment: raw.rootSegment,
		layers,
		rules,
	};
}

export function loadAnalysisConfig(): AnalysisConfig {
	const candidates = [
		resolve(process.cwd(), 'code-quality.config.json'),
		resolve(process.cwd(), '.code-quality.json'),
	];
	for (let index = 0; index < candidates.length; index += 1) {
		const candidate = candidates[index];
		if (!existsSync(candidate)) {
			continue;
		}
		const raw = JSON.parse(readFileSync(candidate, 'utf8')) as {
			directiveMarker?: unknown;
			scan?: unknown;
			architecture?: unknown;
		};
		return {
			directiveMarker: typeof raw.directiveMarker === 'string' ? raw.directiveMarker : DEFAULT_CONFIG.directiveMarker,
			scan: scanConfig(raw.scan),
			architecture: architectureConfig(raw.architecture),
		};
	}
	return DEFAULT_CONFIG;
}
