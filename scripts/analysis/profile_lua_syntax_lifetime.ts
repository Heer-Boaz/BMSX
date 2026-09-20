// node node_modules/tsx/dist/cli.mjs --expose-gc --tsconfig tsconfig.base.json \
//   scripts/analysis/profile_lua_syntax_lifetime.ts /tmp/pietious-workspace.json
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { getLuaSemanticAnnotations } from '../../toolchain/ts/lua/semantic/tokens';
import { buildLuaSemanticFrontendFromSnapshot } from '../../toolchain/ts/lua/semantic/frontend';
import {
	buildLuaFileSemanticData,
	LuaSemanticWorkspace,
	type LuaSemanticWorkspaceSnapshot,
	type LuaSemanticWorkspaceSnapshotInput,
} from '../../toolchain/ts/lua/semantic/model';

// Keep construction temporaries off the measurement frame's stack. Without
// this boundary and an event-loop turn, V8 can retain dead temporary roots.
function retainSnapshot(files: readonly LuaSemanticWorkspaceSnapshotInput[]): LuaSemanticWorkspaceSnapshot {
	const workspace = new LuaSemanticWorkspace();
	workspace.updateFiles(files.map(file => buildLuaFileSemanticData(file.source, file.path)));
	return workspace.getSnapshot();
}

async function main(): Promise<void> {
	const files: LuaSemanticWorkspaceSnapshotInput[] = JSON.parse(readFileSync(process.argv[2], 'utf8'));
	await setImmediate();
	globalThis.gc();
	const initial = process.memoryUsage().heapUsed;
	let snapshot: LuaSemanticWorkspaceSnapshot | null = retainSnapshot(files);
	await setImmediate();
	globalThis.gc();
	const retained = process.memoryUsage().heapUsed;
	const fileCount = snapshot.files.length;
	snapshot.files.forEach(getLuaSemanticAnnotations);
	await setImmediate();
	globalThis.gc();
	const highlighted = process.memoryUsage().heapUsed;
	let frontend = buildLuaSemanticFrontendFromSnapshot(snapshot);
	for (const file of snapshot.files) frontend.getFile(file.file);
	await setImmediate();
	globalThis.gc();
	const diagnosed = process.memoryUsage().heapUsed;
	frontend = null;
	snapshot = null;
	await setImmediate();
	globalThis.gc();
	await setImmediate();
	globalThis.gc();
	const released = process.memoryUsage().heapUsed;
	console.log(JSON.stringify({
		node: process.version,
		files: fileCount,
		retainedHeapMiB: (retained - initial) / (1024 * 1024),
		highlightedHeapMiB: (highlighted - initial) / (1024 * 1024),
		diagnosedHeapMiB: (diagnosed - initial) / (1024 * 1024),
		releasedHeapMiB: (released - initial) / (1024 * 1024),
		note: 'Heap deltas after GC, not allocation counts or a browser memory measurement. Input source strings are already present in the initial heap. Retained is binding without highlighting; highlighted additionally materializes every file annotation presentation; diagnosed additionally retains a frontend with diagnostics for every file and demanded signature/query caches. Both frontend and snapshot are released before the final measurement.',
	}, null, 2));
}

void main();
