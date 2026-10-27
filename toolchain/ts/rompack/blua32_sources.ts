import { utf8FatalDecoder } from '../../../machine/ts/common/serializer/binencoder';
import type { Blua32DiagnosticSourceMap } from './blua32_diagnostics';
import { toLuaModulePath } from '../lua/module_path';

/** Admitted source bytes/text and their written path, independent of a working copy. */
export type Blua32CompiledSource = {
	readonly displayPath: string;
	content: { kind: 'text'; text: string } | { kind: 'utf8'; bytes: Uint8Array };
};

/** ROM text is decoded once, only when inspection asks for it. */
export function readBlua32CompiledSource(source: Blua32CompiledSource): string {
	if (source.content.kind === 'utf8') source.content = { kind: 'text', text: utf8FatalDecoder.decode(source.content.bytes) };
	return source.content.text;
}

/** Selected diagnostic proof includes direct compiler inputs and explicitly mapped authored origins. */
export function compiledBlua32Sources(sources: Blua32DiagnosticSourceMap): ReadonlyMap<string, Blua32CompiledSource> {
	const compiled = new Map<string, Blua32CompiledSource>();
	for (const [module, source] of sources) compiled.set(toLuaModulePath(module), {
		displayPath: source.displayPath, content: { kind: 'text', text: source.source },
	});
	return compiled;
}
