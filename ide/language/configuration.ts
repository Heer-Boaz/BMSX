import { aemDocumentFormat } from '../../toolchain/ts/rompack/aem';

export type EditorDocumentMode = 'lua' | 'aem' | 'yaml';

export type TextLanguageConfiguration = {
	readonly indentationUnit: string;
	readonly lineComment: string | undefined;
	readonly documentFormatting: boolean;
};

const LUA: TextLanguageConfiguration = { indentationUnit: '\t', lineComment: '--', documentFormatting: true };
const YAML: TextLanguageConfiguration = { indentationUnit: '  ', lineComment: '#', documentFormatting: false };
const JSON: TextLanguageConfiguration = { indentationUnit: '  ', lineComment: undefined, documentFormatting: true };

/** Editing syntax belongs to the authored language, not the resource's runtime use. */
export function textLanguageConfiguration(mode: EditorDocumentMode, path: string): TextLanguageConfiguration {
	switch (mode) {
		case 'lua': return LUA;
		case 'yaml': return YAML;
		case 'aem': return aemDocumentFormat(path) === 'yaml' ? YAML : JSON;
	}
}
