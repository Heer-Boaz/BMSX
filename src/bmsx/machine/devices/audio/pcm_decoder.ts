import {
	APU_FAULT_NONE,
	APU_FAULT_OUTPUT_DATA_RANGE,
	type ApuAudioSource,
} from './contracts';

export type ApuPcmValidationResult = {
	faultCode: number;
	faultDetail: number;
};

const APU_PCM_VALIDATION_OK: ApuPcmValidationResult = { faultCode: APU_FAULT_NONE, faultDetail: 0 };

export function validateApuPcmSourceData(source: ApuAudioSource): ApuPcmValidationResult {
	const bytesPerSample = source.bitsPerSample === 16 ? 2 : 1;
	const requiredDataBytes = source.frameCount * source.channels * bytesPerSample;
	if (requiredDataBytes > source.dataBytes) {
		return { faultCode: APU_FAULT_OUTPUT_DATA_RANGE, faultDetail: source.dataBytes };
	}
	return APU_PCM_VALIDATION_OK;
}
