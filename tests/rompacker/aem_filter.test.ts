import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
	assertValidAemDocument,
	buildAemEventMap,
	buildAemValidationLookup,
} from '../../toolchain/ts/rompack/aem';

test('AEM production lowers modulation to runtime fields and packed Q14 filter words', () => {
	const preset = {
		pitchDelta: 2,
		pitchRange: [-0.5, 0.5],
		volumeDelta: -3,
		volumeRange: [-1, 2],
		offset: 0.25,
		offsetRange: [0.25, 0.5],
		playbackRate: 1.25,
		playbackRateRange: [-0.25, 0.5],
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
		rules: Array<{ action: Record<string, unknown> }>;
	}).rules[0]!.action;
	assert.equal(action.kind, 'play');
	assert.deepEqual(action.modulation, {
		pitch_delta: 2,
		pitch_range_min: -0.5,
		pitch_range_span: 1,
		volume_delta: -3,
		volume_range_min: -1,
		volume_range_span: 3,
		start_sample: 11025,
		start_range_min: 11025,
		start_range_span: 11025,
		rate: 1.25,
		rate_range_min: -0.25,
		rate_range_span: 0.75,
		filter_control: 0x00000001,
		filter_b0_b1: 0x0097004b,
		filter_b2_a1: 0x8cdc004b,
		filter_a2: 0x00003452,
	});
	assert.deepEqual(preset, {
		pitchDelta: 2,
		pitchRange: [-0.5, 0.5],
		volumeDelta: -3,
		volumeRange: [-1, 2],
		offset: 0.25,
		offsetRange: [0.25, 0.5],
		playbackRate: 1.25,
		playbackRateRange: [-0.25, 0.5],
		filter: {
			type: 'lowpass',
			frequency: 1000,
			q: 0.707,
			gain: 0,
		},
	});
});
