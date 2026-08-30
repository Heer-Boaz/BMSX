import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import {
	buildLuaFileSemanticData,
	LuaSemanticWorkspace,
	type FileSemanticData,
} from '../../toolchain/ts/lua/semantic/model';
import { buildLuaSemanticFrontendFromSnapshot } from '../../toolchain/ts/lua/semantic/frontend';
import { parseLuaChunkWithRecovery } from '../../toolchain/ts/lua/analysis/parse';

type LuaSource = {
	path: string;
	source: string;
};

type SemanticQueryLocation = {
	path: string;
	line: number;
	column: number;
};

type CallHierarchyProfile = {
	direction: 'incoming' | 'outgoing';
	location: SemanticQueryLocation;
	label: string;
	targetCount: number;
	groupCount: number;
	callSiteCount: number;
	symbolMs: number;
	coldMs: number;
	warmMs: number;
};

type HoverProfile = {
	location: SemanticQueryLocation;
	contentCount: number;
	coldMs: number;
	warmMs: number;
};

const EDIT_ITERATION_COUNT = 12;
const EDIT_WARMUP_COUNT = 2;

function collectLuaSources(workspaceRoot: string, directory: string, sources: LuaSource[]): void {
	for (const name of readdirSync(directory)) {
		const absolutePath = path.join(directory, name);
		const stats = statSync(absolutePath);
		if (stats.isDirectory()) {
			collectLuaSources(workspaceRoot, absolutePath, sources);
		} else if (name.endsWith('.lua')) {
			sources.push({
				path: path.relative(workspaceRoot, absolutePath),
				source: readFileSync(absolutePath, 'utf8'),
			});
		}
	}
}

function summarizeTimingSamples(values: readonly number[]): { median: number; p90: number; max: number } {
	const ordered = Array.from(values).sort((left, right) => left - right);
	return {
		median: ordered[ordered.length >> 1],
		p90: ordered[Math.trunc((ordered.length - 1) * 0.9)],
		max: ordered[ordered.length - 1],
	};
}

function parseSemanticQueryLocation(value: string | undefined, option: string): SemanticQueryLocation | undefined {
	if (value === undefined) {
		return undefined;
	}
	const match = /^(.*):(\d+):(\d+)$/.exec(value);
	if (!match) {
		throw new Error(`Invalid ${option} location '${value}'; expected <path>:<line>:<column>.`);
	}
	return {
		path: match[1],
		line: Number.parseInt(match[2], 10),
		column: Number.parseInt(match[3], 10),
	};
}

const workspaceRoot = process.cwd();
const { values, positionals } = parseArgs({
	args: process.argv.slice(2),
	options: {
		incoming: { type: 'string' },
		outgoing: { type: 'string' },
		hover: { type: 'string' },
	},
	allowPositionals: true,
});
const editPath = positionals[0];
const sourceRoots = positionals.slice(1);
if (editPath === undefined || sourceRoots.length === 0) {
	throw new Error('Usage: profile_lua_semantics.ts [--incoming <path>:<line>:<column> | --outgoing <path>:<line>:<column> | --hover <path>:<line>:<column>] <edit-file> <source-root>...');
}
const selectedQueryCount = Number(values.incoming !== undefined)
	+ Number(values.outgoing !== undefined)
	+ Number(values.hover !== undefined);
if (selectedQueryCount > 1) {
	throw new Error('Choose one semantic query to profile.');
}
const callHierarchyDirection = values.outgoing === undefined ? 'incoming' : 'outgoing';
const callHierarchyOptionValue = values.outgoing === undefined ? values.incoming : values.outgoing;
const callHierarchyLocation = parseSemanticQueryLocation(
	callHierarchyOptionValue,
	callHierarchyDirection,
);
const hoverLocation = parseSemanticQueryLocation(values.hover, 'hover');

const sources: LuaSource[] = [];
for (const root of sourceRoots) {
	collectLuaSources(workspaceRoot, path.resolve(workspaceRoot, root), sources);
}
sources.sort((left, right) => left.path.localeCompare(right.path));
if (sources.length < 2) {
	throw new Error('Semantic profiling requires at least two Lua sources to verify retained file identity.');
}

const workspace = new LuaSemanticWorkspace();
const analyses = new Array<FileSemanticData>(sources.length);
const coldAnalysisStartedAt = performance.now();
for (let index = 0; index < sources.length; index += 1) {
	const source = sources[index];
	analyses[index] = buildLuaFileSemanticData(source.source, source.path);
}
const coldAnalysisMs = performance.now() - coldAnalysisStartedAt;

const coldIndexStartedAt = performance.now();
workspace.updateFiles(analyses);
const coldIndexMs = performance.now() - coldIndexStartedAt;

const coldSnapshotStartedAt = performance.now();
let snapshot = workspace.getSnapshot();
const coldSnapshotMs = performance.now() - coldSnapshotStartedAt;

const coldFrontendStartedAt = performance.now();
let frontend = buildLuaSemanticFrontendFromSnapshot(snapshot);
const coldFrontendMs = performance.now() - coldFrontendStartedAt;

const coldFileQueryStartedAt = performance.now();
frontend.getFile(editPath);
const coldFileQueryMs = performance.now() - coldFileQueryStartedAt;

let callHierarchyProfile: CallHierarchyProfile | undefined;
if (callHierarchyLocation) {
	const symbolStartedAt = performance.now();
	const symbols = frontend.findSymbolsByPosition(
		callHierarchyLocation.path,
		callHierarchyLocation.line,
		callHierarchyLocation.column,
	);
	const symbolMs = performance.now() - symbolStartedAt;
	if (!symbols) {
		throw new Error(`No semantic symbol at '${callHierarchyOptionValue}'.`);
	}
	let groupCount = 0;
	let callSiteCount = 0;
	const coldStartedAt = performance.now();
	for (let targetIndex = 0; targetIndex < symbols.targets.length; targetIndex += 1) {
		const calls = callHierarchyDirection === 'incoming'
			? frontend.provideIncomingCalls(symbols.targets[targetIndex].id)
			: frontend.provideOutgoingCalls(symbols.targets[targetIndex].id);
		groupCount += calls.length;
		for (let callIndex = 0; callIndex < calls.length; callIndex += 1) {
			callSiteCount += calls[callIndex].fromRanges.length;
		}
	}
	const coldMs = performance.now() - coldStartedAt;
	const warmStartedAt = performance.now();
	for (let index = 0; index < symbols.targets.length; index += 1) {
		if (callHierarchyDirection === 'incoming') {
			frontend.provideIncomingCalls(symbols.targets[index].id);
		} else {
			frontend.provideOutgoingCalls(symbols.targets[index].id);
		}
	}
	const warmMs = performance.now() - warmStartedAt;
	callHierarchyProfile = {
		direction: callHierarchyDirection,
		location: callHierarchyLocation,
		label: symbols.label,
		targetCount: symbols.targets.length,
		groupCount,
		callSiteCount,
		symbolMs,
		coldMs,
		warmMs,
	};
}

let hoverProfile: HoverProfile | undefined;
if (hoverLocation) {
	const coldStartedAt = performance.now();
	const hover = frontend.provideHover(
		hoverLocation.path,
		hoverLocation.line,
		hoverLocation.column,
	);
	const coldMs = performance.now() - coldStartedAt;
	if (hover === null) {
		throw new Error(`No semantic hover at '${values.hover}'.`);
	}
	const warmStartedAt = performance.now();
	frontend.provideHover(
		hoverLocation.path,
		hoverLocation.line,
		hoverLocation.column,
	);
	const warmMs = performance.now() - warmStartedAt;
	hoverProfile = {
		location: hoverLocation,
		contentCount: hover.contents.length,
		coldMs,
		warmMs,
	};
}

const editedSource = sources.find(source => source.path === editPath);
if (editedSource === undefined) {
	throw new Error(`Edit file '${editPath}' is not contained by the profiled source roots.`);
}
const unchangedSource = sources[editedSource === sources[0] ? 1 : 0];
const unchangedData = workspace.getFileData(unchangedSource.path);
const parseMeasurements: number[] = [];
const semanticMeasurements: number[] = [];
const indexMeasurements: number[] = [];
const snapshotMeasurements: number[] = [];
const frontendMeasurements: number[] = [];
const fileQueryMeasurements: number[] = [];

for (let iteration = 0; iteration < EDIT_ITERATION_COUNT; iteration += 1) {
	const source = `${editedSource.source}\n-- lua-semantic-profile-${iteration}\n`;
	const parseStartedAt = performance.now();
	const parsed = parseLuaChunkWithRecovery(source, editPath);
	const parseMs = performance.now() - parseStartedAt;

	const semanticStartedAt = performance.now();
	const analysis = buildLuaFileSemanticData(source, editPath, parsed);
	const semanticMs = performance.now() - semanticStartedAt;

	const indexStartedAt = performance.now();
	workspace.updateFiles([analysis]);
	const indexMs = performance.now() - indexStartedAt;

	const snapshotStartedAt = performance.now();
	snapshot = workspace.getSnapshot();
	const snapshotMs = performance.now() - snapshotStartedAt;

	const frontendStartedAt = performance.now();
	frontend = buildLuaSemanticFrontendFromSnapshot(snapshot);
	const frontendMs = performance.now() - frontendStartedAt;

	const fileQueryStartedAt = performance.now();
	frontend.getFile(editPath);
	const fileQueryMs = performance.now() - fileQueryStartedAt;

	if (workspace.getFileData(unchangedSource.path) !== unchangedData) {
		throw new Error(`Edit rebuilt unchanged semantic file '${unchangedSource.path}'.`);
	}
	if (snapshot.getFileData(unchangedSource.path) !== unchangedData) {
		throw new Error(`Program snapshot replaced unchanged semantic file '${unchangedSource.path}'.`);
	}
	if (iteration >= EDIT_WARMUP_COUNT) {
		parseMeasurements.push(parseMs);
		semanticMeasurements.push(semanticMs);
		indexMeasurements.push(indexMs);
		snapshotMeasurements.push(snapshotMs);
		frontendMeasurements.push(frontendMs);
		fileQueryMeasurements.push(fileQueryMs);
	}
}

console.log(JSON.stringify({
	files: sources.length,
	bytes: sources.reduce((total, source) => total + source.source.length, 0),
	cold: {
		analysisMs: coldAnalysisMs,
		indexMs: coldIndexMs,
		snapshotMs: coldSnapshotMs,
		frontendMs: coldFrontendMs,
		fileQueryMs: coldFileQueryMs,
	},
	callHierarchy: callHierarchyProfile,
	hover: hoverProfile,
	edit: {
		parseMs: summarizeTimingSamples(parseMeasurements),
		semanticMs: summarizeTimingSamples(semanticMeasurements),
		indexMs: summarizeTimingSamples(indexMeasurements),
		snapshotMs: summarizeTimingSamples(snapshotMeasurements),
		frontendMs: summarizeTimingSamples(frontendMeasurements),
		fileQueryMs: summarizeTimingSamples(fileQueryMeasurements),
	},
}, null, 2));
