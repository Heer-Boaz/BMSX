import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { medianMilliseconds } from '../../helpers/performance';
import { semanticSnapshot } from '../../lua/semantic_test_harness';
import { buildLuaFileSemanticData } from '../../../toolchain/ts/lua/semantic/model';
import { parseLuaChunkWithRecovery, type ParsedLuaChunk } from '../../../toolchain/ts/lua/analysis/parse';
import { BehaviorSourceReader } from '../../../ide/workbench/contrib/behavior_lens/source_reader';
import { collectBehaviorRegistrations } from '../../../ide/workbench/contrib/behavior_lens/registrations';

const sources: { path: string; text: string; parsed: ParsedLuaChunk }[] = [];
for (const root of process.argv.slice(2)) {
	for (const entry of readdirSync(root, { recursive: true, withFileTypes: true })) {
		if (!entry.isFile() || !entry.name.endsWith('.lua')) continue;
		const path = join(entry.parentPath, entry.name);
		const text = readFileSync(path, 'utf8');
		sources.push({ path, text, parsed: parseLuaChunkWithRecovery(text, path) });
	}
}
assert.ok(sources.length > 0, 'pass workspace source roots, e.g. cartlib carts/nemesis_s');
sources.sort((a, b) => a.path.localeCompare(b.path));
const files = sources.map(source => buildLuaFileSemanticData(source.text, source.path, source.parsed));
const resources = files.map(file => ({ domain: 0 as const, path: file.file }));
const snapshot = semanticSnapshot(...files);
const collect = (reader: BehaviorSourceReader) => {
	let count = 0;
	for (const resource of resources) count += collectBehaviorRegistrations(resource, reader).registrations.length;
	return count;
};
const registrations = collect(new BehaviorSourceReader(snapshot));
const bindingMs = medianMilliseconds(() => {
	for (const source of sources) buildLuaFileSemanticData(source.text, source.path, source.parsed);
});
const snapshotAndCatalogMs = medianMilliseconds(() => {
	assert.equal(collect(new BehaviorSourceReader(semanticSnapshot(...files))), registrations);
});
const catalogRebuildMs = medianMilliseconds(() => {
	assert.equal(collect(new BehaviorSourceReader(snapshot)), registrations);
});
const reader = new BehaviorSourceReader(snapshot);
const catalog = resources.flatMap(resource => collectBehaviorRegistrations(resource, reader).registrations
	.map(registration => [resource.path, registration.label, registration.range.start.line]));
console.log(JSON.stringify({ files: files.length, sourceUtf16: sources.reduce((sum, source) => sum + source.text.length, 0),
	registrations, bindingMs, snapshotAndCatalogMs, catalogRebuildMs, catalog,
	boundary: 'retained parse / fresh binder; fresh workspace snapshot and catalog; retained snapshot catalog rebuild. No guest or UI-frame timing.' }));
