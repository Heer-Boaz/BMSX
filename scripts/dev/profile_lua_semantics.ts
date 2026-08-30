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

type IncomingCallLocation = {
	path: string;
	line: number;
	column: number;
};

type IncomingCallProfile = {
	location: IncomingCallLocation;
	label: string;
	targetCount: number;
	callerGroupCount: number;
	callSiteCount: number;
	symbolMs: number;
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

function parseIncomingCallLocation(value: string | undefined): IncomingCallLocation | undefined {
	if (value === undefined) {
		return undefined;
	}
	const match = /^(.*):(\d+):(\d+)$/.exec(value);
	if (!match) {
		throw new Error(`Invalid incoming-call location '${value}'; expected <path>:<line>:<column>.`);
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
	},
	allowPositionals: true,
});
const editPath = positionals[0];
const sourceRoots = positionals.slice(1);
if (editPath === undefined || sourceRoots.length === 0) {
	throw new Error('Usage: profile_lua_semantics.ts [--incoming <path>:<line>:<column>] <edit-file> <source-root>...');
}
const incomingCallLocation = parseIncomingCallLocation(values.incoming);

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

let incomingCallProfile: IncomingCallProfile | undefined;
if (incomingCallLocation) {
	const symbolStartedAt = performance.now();
	const symbols = frontend.findSymbolsByPosition(
		incomingCallLocation.path,
		incomingCallLocation.line,
		incomingCallLocation.column,
	);
	const symbolMs = performance.now() - symbolStartedAt;
	if (!symbols) {
		throw new Error(`No semantic symbol at '${values.incoming}'.`);
	}
	let callerGroupCount = 0;
	let callSiteCount = 0;
	const coldStartedAt = performance.now();
	for (let targetIndex = 0; targetIndex < symbols.targets.length; targetIndex += 1) {
		const calls = frontend.provideIncomingCalls(symbols.targets[targetIndex].id);
		callerGroupCount += calls.length;
		for (let callIndex = 0; callIndex < calls.length; callIndex += 1) {
			callSiteCount += calls[callIndex].fromRanges.length;
		}
	}
	const coldMs = performance.now() - coldStartedAt;
	const warmStartedAt = performance.now();
	for (let index = 0; index < symbols.targets.length; index += 1) {
		frontend.provideIncomingCalls(symbols.targets[index].id);
	}
	const warmMs = performance.now() - warmStartedAt;
	incomingCallProfile = {
		location: incomingCallLocation,
		label: symbols.label,
		targetCount: symbols.targets.length,
		callerGroupCount,
		callSiteCount,
		symbolMs,
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
	incomingCalls: incomingCallProfile,
	edit: {
		parseMs: summarizeTimingSamples(parseMeasurements),
		semanticMs: summarizeTimingSamples(semanticMeasurements),
		indexMs: summarizeTimingSamples(indexMeasurements),
		snapshotMs: summarizeTimingSamples(snapshotMeasurements),
		frontendMs: summarizeTimingSamples(frontendMeasurements),
		fileQueryMs: summarizeTimingSamples(fileQueryMeasurements),
	},
}, null, 2));
