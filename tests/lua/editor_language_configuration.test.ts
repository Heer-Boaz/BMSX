import assert from 'node:assert/strict';
import { test } from 'node:test';
import { textLanguageConfiguration } from '../../ide/language/configuration';

test('editing syntax follows the authored language, including both AEM formats', () => {
	assert.deepEqual(textLanguageConfiguration('lua', 'entry.lua'), { indentationUnit: '\t', lineComment: '--' });
	assert.deepEqual(textLanguageConfiguration('yaml', 'res/data/stage.yaml'), { indentationUnit: '  ', lineComment: '#' });
	assert.deepEqual(textLanguageConfiguration('aem', 'res/actor.yaml'), { indentationUnit: '  ', lineComment: '#' });
	assert.deepEqual(textLanguageConfiguration('aem', 'res/actor.json'), { indentationUnit: '  ', lineComment: undefined });
});
