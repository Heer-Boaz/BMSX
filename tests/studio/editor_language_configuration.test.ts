import assert from 'node:assert/strict';
import { test } from 'node:test';
import { textLanguageConfiguration } from '../../ide/language/configuration';

test('editing syntax follows the authored language, including both AEM formats', () => {
	assert.deepEqual(textLanguageConfiguration('lua', 'entry.lua'), { indentationUnit: '\t', lineComment: '--', documentFormatting: true });
	assert.deepEqual(textLanguageConfiguration('yaml', 'res/data/stage.yaml'), { indentationUnit: '  ', lineComment: '#', documentFormatting: false });
	assert.deepEqual(textLanguageConfiguration('aem', 'res/actor.yaml'), { indentationUnit: '  ', lineComment: '#', documentFormatting: false });
	assert.deepEqual(textLanguageConfiguration('aem', 'res/actor.json'), { indentationUnit: '  ', lineComment: undefined, documentFormatting: true });
});
