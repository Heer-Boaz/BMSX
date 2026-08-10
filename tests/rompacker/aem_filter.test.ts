import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	assertValidAemDocument,
	buildAemEventMap,
	buildAemValidationLookup,
} from '../../toolchain/ts/rompack/aem';

test('AEM production cooks filters into exact packed Q14 APU register words', () => {
	const preset = {
		filter: {
			type: 'lowpass',
			frequency: 1000,
			q: 0.707,
			gain: 0,
		},
	};
	const document = {
		events: {
			filtered: {
				channel: 'sfx',
				rules: [{
					go: {
						audio_id: 'tone',
						modulation_preset: 'audio_presets.lowpass',
					},
				}],
			},
		},
	};
	const lookup = buildAemValidationLookup({
		audioIds: ['tone'],
		dataRecords: [{
			name: 'audio_presets',
			value: { lowpass: preset },
		}],
	});
	assertValidAemDocument(document, lookup, 'filter.aem.yaml');

	const eventMap = buildAemEventMap(document, lookup);
	const action = (eventMap.filtered as {
		rules: Array<{ go: Record<string, unknown> }>;
	}).rules[0]!.go;
	assert.deepEqual(action.modulation_params, {
		filter_control: 0x00000001,
		filter_b0_b1: 0x0097004b,
		filter_b2_a1: 0x8cdc004b,
		filter_a2: 0x00003452,
	});
	assert.equal(action.modulation_preset, undefined);
	assert.deepEqual(preset, {
		filter: {
			type: 'lowpass',
			frequency: 1000,
			q: 0.707,
			gain: 0,
		},
	});
});
