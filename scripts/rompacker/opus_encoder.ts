// import { Buffer } from "buffer";
// import { FFTComplexRadix2 } from "./fft";
// import { clamp, clamp01 } from "../../src/bmsx/utils/clamp";

// export type opus_int32 = number;
// export type opus_uint32 = number;
// export type opus_int16 = number;
// export type opus_val16 = number;
// export type opus_val32 = number;

// export const MAX_ENCODER_BUFFER = 480;
// export const PSEUDO_SNR_THRESHOLD = 316.23;
// export const OPUS_MAX_PACKET_BYTES = 1276;
// export const VERY_SMALL = 1e-12;
// export const DEFAULT_HP_CUTOFF_HZ = 60;
// export const DEFAULT_OVERLAP_48 = 120;
// export const Q14_ONE = 1 << 14;
// export const STEREO_WIDTH_EPS = 1e-12;
// export const DTX_ACTIVITY_THRESHOLD = 0.4;
// export const NB_SPEECH_FRAMES_BEFORE_DTX = 50;
// export const MAX_CONSECUTIVE_DTX = 600;
// const ANALYSIS_MIN_FFT = 128;
// const ANALYSIS_PEAK_RATIO = 0.01;
// const ANALYSIS_EPS = 1e-12;
// const STUB_SPECTRAL_LOG_MAPPING = true;
// const VARIABLE_HP_MIN_CUTOFF_HZ = DEFAULT_HP_CUTOFF_HZ;
// const VARIABLE_HP_MAX_CUTOFF_HZ = 140;
// const VARIABLE_HP_SMTH_COEF2 = 0.015;

// export const OPUS_OK = 0;
// export const OPUS_BAD_ARG = -1;
// export const OPUS_BUFFER_TOO_SMALL = -2;
// export const OPUS_INTERNAL_ERROR = -3;
// export const OPUS_UNIMPLEMENTED = -5;
// export const OPUS_ALLOC_FAIL = -7;

// export const OPUS_APPLICATION_VOIP = 2048;
// export const OPUS_APPLICATION_AUDIO = 2049;
// export const OPUS_APPLICATION_RESTRICTED_LOWDELAY = 2051;

// export const OPUS_AUTO = -1000;
// export const OPUS_BITRATE_MAX = -1;

// export const OPUS_BANDWIDTH_NARROWBAND = 1101;
// export const OPUS_BANDWIDTH_MEDIUMBAND = 1102;
// export const OPUS_BANDWIDTH_WIDEBAND = 1103;
// export const OPUS_BANDWIDTH_SUPERWIDEBAND = 1104;
// export const OPUS_BANDWIDTH_FULLBAND = 1105;

// export const OPUS_FRAMESIZE_ARG = 5000;
// export const OPUS_FRAMESIZE_2_5_MS = 5001;
// export const OPUS_FRAMESIZE_5_MS = 5002;
// export const OPUS_FRAMESIZE_10_MS = 5003;
// export const OPUS_FRAMESIZE_20_MS = 5004;
// export const OPUS_FRAMESIZE_40_MS = 5005;
// export const OPUS_FRAMESIZE_60_MS = 5006;
// export const OPUS_FRAMESIZE_80_MS = 5007;
// export const OPUS_FRAMESIZE_100_MS = 5008;
// export const OPUS_FRAMESIZE_120_MS = 5009;

// export const OPUS_SIGNAL_VOICE = 3001;
// export const OPUS_SIGNAL_MUSIC = 3002;

// export const OPUS_SET_APPLICATION_REQUEST = 4000;
// export const OPUS_GET_APPLICATION_REQUEST = 4001;
// export const OPUS_SET_BITRATE_REQUEST = 4002;
// export const OPUS_GET_BITRATE_REQUEST = 4003;
// export const OPUS_SET_MAX_BANDWIDTH_REQUEST = 4004;
// export const OPUS_GET_MAX_BANDWIDTH_REQUEST = 4005;
// export const OPUS_SET_VBR_REQUEST = 4006;
// export const OPUS_GET_VBR_REQUEST = 4007;
// export const OPUS_SET_BANDWIDTH_REQUEST = 4008;
// export const OPUS_GET_BANDWIDTH_REQUEST = 4009;
// export const OPUS_SET_COMPLEXITY_REQUEST = 4010;
// export const OPUS_GET_COMPLEXITY_REQUEST = 4011;
// export const OPUS_SET_INBAND_FEC_REQUEST = 4012;
// export const OPUS_GET_INBAND_FEC_REQUEST = 4013;
// export const OPUS_SET_PACKET_LOSS_PERC_REQUEST = 4014;
// export const OPUS_GET_PACKET_LOSS_PERC_REQUEST = 4015;
// export const OPUS_SET_DTX_REQUEST = 4016;
// export const OPUS_GET_DTX_REQUEST = 4017;
// export const OPUS_SET_VBR_CONSTRAINT_REQUEST = 4020;
// export const OPUS_GET_VBR_CONSTRAINT_REQUEST = 4021;
// export const OPUS_SET_FORCE_CHANNELS_REQUEST = 4022;
// export const OPUS_GET_FORCE_CHANNELS_REQUEST = 4023;
// export const OPUS_SET_SIGNAL_REQUEST = 4024;
// export const OPUS_GET_SIGNAL_REQUEST = 4025;
// export const OPUS_GET_LOOKAHEAD_REQUEST = 4027;
// export const OPUS_SET_VOICE_RATIO_REQUEST = 11018;
// export const OPUS_GET_VOICE_RATIO_REQUEST = 11019;
// export const OPUS_RESET_STATE = 4028;
// export const OPUS_GET_SAMPLE_RATE_REQUEST = 4029;
// export const OPUS_GET_FINAL_RANGE_REQUEST = 4031;
// export const OPUS_SET_LSB_DEPTH_REQUEST = 4036;
// export const OPUS_GET_LSB_DEPTH_REQUEST = 4037;
// export const OPUS_SET_ENERGY_MASK_REQUEST = 4038;
// export const OPUS_SET_EXPERT_FRAME_DURATION_REQUEST = 4040;
// export const OPUS_GET_EXPERT_FRAME_DURATION_REQUEST = 4041;
// export const OPUS_SET_PREDICTION_DISABLED_REQUEST = 4042;
// export const OPUS_GET_PREDICTION_DISABLED_REQUEST = 4043;
// export const OPUS_SET_PHASE_INVERSION_DISABLED_REQUEST = 4046;
// export const OPUS_GET_PHASE_INVERSION_DISABLED_REQUEST = 4047;
// export const OPUS_SET_LFE_REQUEST = 4048;
// export const OPUS_SET_FORCE_MODE_REQUEST = 11002;

// export const MODE_SILK_ONLY = 1000;
// export const MODE_HYBRID = 1001;
// export const MODE_CELT_ONLY = 1002;

// export interface StereoWidthState {
// 	XX: opus_val32;
// 	XY: opus_val32;
// 	YY: opus_val32;
// 	smoothed_width: opus_val16;
// 	max_follower: opus_val16;
// }

// export interface SilkEncControlStruct {
// 	nChannelsAPI: opus_int32;
// 	nChannelsInternal: opus_int32;
// 	API_sampleRate: opus_int32;
// 	maxInternalSampleRate: opus_int32;
// 	minInternalSampleRate: opus_int32;
// 	desiredInternalSampleRate: opus_int32;
// 	payloadSize_ms: opus_int32;
// 	bitRate: opus_int32;
// 	packetLossPercentage: opus_int32;
// 	complexity: opus_int32;
// 	useInBandFEC: opus_int32;
// 	useDTX: opus_int32;
// 	useCBR: opus_int32;
// 	reducedDependency: opus_int32;
// 	allowBandwidthSwitch: opus_int32;
// 	inWBmodeWithoutVariableLP: opus_int32;
// 	toMono: opus_int32;
// 	LBRR_coded: opus_int32;
// 	maxBits: opus_int32;
// 	internalSampleRate: opus_int32;
// 	opusCanSwitch: opus_int32;
// 	switchReady: opus_int32;
// 	stereoWidth_Q14: opus_int32;
// 	signalType: opus_int32;
// 	offset: opus_int32;
// }

// export interface TonalityAnalysisState {
// 	fftSize: number;
// 	fft: FFTComplexRadix2;
// 	window: Float64Array;
// 	re: Float64Array;
// 	im: Float64Array;
// }

// interface AnalysisInfo {
// 	valid: boolean;
// 	activity_probability: number;
// 	music_prob: number;
// 	bandwidth: number;
// 	low_freq_ratio: number;
// }

// interface StubSpectrum {
// 	fftSize: number;
// 	half: number;
// 	prefix: Float64Array;
// 	inv_total: number;
// }

// interface StubSpectrumCache {
// 	pcm: Float32Array;
// 	offset: number;
// 	frame_size: number;
// 	spectrum: StubSpectrum | null;
// }

// export class OpusEncoder {
// 	celt_enc_offset = 0;
// 	silk_enc_offset = 0;
// 	silk_mode: SilkEncControlStruct;
// 	application = OPUS_APPLICATION_AUDIO;
// 	channels = 1;
// 	delay_compensation = 0;
// 	force_channels = OPUS_AUTO;
// 	signal_type = OPUS_AUTO;
// 	user_bandwidth = OPUS_AUTO;
// 	max_bandwidth = OPUS_BANDWIDTH_FULLBAND;
// 	user_forced_mode = OPUS_AUTO;
// 	voice_ratio = -1;
// 	Fs = 48000;
// 	use_vbr = 1;
// 	vbr_constraint = 1;
// 	variable_duration = OPUS_FRAMESIZE_ARG;
// 	bitrate_bps = 0;
// 	user_bitrate_bps = OPUS_AUTO;
// 	lsb_depth = 24;
// 	encoder_buffer = 0;
// 	lfe = 0;
// 	arch = 0;
// 	use_dtx = 0;
// 	analysis: TonalityAnalysisState;
// 	stream_channels = 1;
// 	hybrid_stereo_width_Q14 = 0;
// 	variable_HP_smth2_Q15 = 0;
// 	prev_HB_gain = 0;
// 	hp_mem: Float32Array;
// 	mode = MODE_HYBRID;
// 	prev_mode = 0;
// 	prev_channels = 0;
// 	prev_framesize = 0;
// 	prev_bandwidth = 0;
// 	bandwidth = OPUS_BANDWIDTH_FULLBAND;
// 	auto_bandwidth = 0;
// 	silk_bw_switch = 0;
// 	first = 1;
// 	energy_masking: Float32Array | null = null;
// 	width_mem: StereoWidthState;
// 	delay_buffer: Float32Array;
// 	pcm_scratch: Float32Array;
// 	pcm_buf: Float32Array;
// 	tmp_prefill: Float32Array;
// 	detected_bandwidth = 0;
// 	nb_no_activity_frames = 0;
// 	peak_signal_energy = 0;
// 	nonfinal_frame = 0;
// 	rangeFinal = 0;
// 	last_stereo_width = 0;
// 	phase_inversion_disabled = 0;
// 	stub_seed = 0;

// 	constructor() {
// 		this.silk_mode = createSilkEncControlStruct();
// 		this.analysis = createTonalityAnalysisState();
// 		this.width_mem = createStereoWidthState();
// 		this.hp_mem = new Float32Array(4);
// 		this.delay_buffer = new Float32Array(MAX_ENCODER_BUFFER * 2);
// 		this.pcm_scratch = new Float32Array(0);
// 		this.pcm_buf = new Float32Array(0);
// 		this.tmp_prefill = new Float32Array(0);
// 	}
// }

// export const mono_voice_bandwidth_thresholds = new Int32Array([
// 	10000, 1000,
// 	11000, 1000,
// 	13500, 1000,
// 	14000, 2000,
// ]);

// export const mono_music_bandwidth_thresholds = new Int32Array([
// 	10000, 1000,
// 	11000, 1000,
// 	13500, 1000,
// 	14000, 2000,
// ]);

// export const stereo_voice_bandwidth_thresholds = new Int32Array([
// 	10000, 1000,
// 	11000, 1000,
// 	13500, 1000,
// 	14000, 2000,
// ]);

// export const stereo_music_bandwidth_thresholds = new Int32Array([
// 	10000, 1000,
// 	11000, 1000,
// 	13500, 1000,
// 	14000, 2000,
// ]);

// export const stereo_voice_threshold = 24000;
// export const stereo_music_threshold = 24000;

// export const mode_thresholds = [
// 	[64000, 16000],
// 	[36000, 16000],
// ];

// export const fec_thresholds = new Int32Array([
// 	12000, 1000,
// 	14000, 1000,
// 	16000, 1000,
// 	20000, 1000,
// 	22000, 1000,
// ]);

// export function opus_encoder_create(Fs: opus_int32, channels: number, application: number): OpusEncoder {
// 	const st = new OpusEncoder();
// 	opus_encoder_init(st, Fs, channels, application);
// 	return st;
// }

// export function opus_encoder_init(st: OpusEncoder, Fs: opus_int32, channels: number, application: number): void {
// 	if (
// 		(Fs !== 48000 && Fs !== 24000 && Fs !== 16000 && Fs !== 12000 && Fs !== 8000) ||
// 		(channels !== 1 && channels !== 2) ||
// 		(application !== OPUS_APPLICATION_VOIP &&
// 			application !== OPUS_APPLICATION_AUDIO &&
// 			application !== OPUS_APPLICATION_RESTRICTED_LOWDELAY)
// 	) {
// 		throw new Error("OPUS_BAD_ARG");
// 	}
// 	st.Fs = Fs;
// 	st.channels = channels;
// 	st.stream_channels = channels;
// 	st.application = application;

// 	st.use_vbr = 1;
// 	st.vbr_constraint = 1;
// 	st.user_bitrate_bps = OPUS_AUTO;
// 	st.bitrate_bps = 3000 + Fs * channels;
// 	st.signal_type = OPUS_AUTO;
// 	st.user_bandwidth = OPUS_AUTO;
// 	st.max_bandwidth = OPUS_BANDWIDTH_FULLBAND;
// 	st.force_channels = OPUS_AUTO;
// 	st.user_forced_mode = OPUS_AUTO;
// 	st.voice_ratio = -1;
// 	st.encoder_buffer = Math.trunc(Fs / 100);
// 	st.lsb_depth = 24;
// 	st.variable_duration = OPUS_FRAMESIZE_ARG;
// 	st.delay_compensation = Math.trunc(Fs / 250);
// 	st.hybrid_stereo_width_Q14 = 1 << 14;
// 	st.prev_HB_gain = 1;
// 	st.variable_HP_smth2_Q15 = lin2log2q8(VARIABLE_HP_MIN_CUTOFF_HZ);
// 	st.first = 1;
// 	st.mode = MODE_HYBRID;
// 	st.bandwidth = OPUS_BANDWIDTH_FULLBAND;
// 	st.prev_bandwidth = st.bandwidth;

// 	const silk = st.silk_mode;
// 	silk.nChannelsAPI = channels;
// 	silk.nChannelsInternal = channels;
// 	silk.API_sampleRate = st.Fs;
// 	silk.maxInternalSampleRate = 16000;
// 	silk.minInternalSampleRate = 8000;
// 	silk.desiredInternalSampleRate = 16000;
// 	silk.payloadSize_ms = 20;
// 	silk.bitRate = 25000;
// 	silk.packetLossPercentage = 0;
// 	silk.complexity = 9;
// 	silk.useInBandFEC = 0;
// 	silk.useDTX = 0;
// 	silk.useCBR = 0;
// 	silk.reducedDependency = 0;
// 	silk.allowBandwidthSwitch = 0;
// 	silk.inWBmodeWithoutVariableLP = 0;
// 	silk.toMono = 0;
// 	silk.LBRR_coded = 0;
// 	silk.maxBits = 0;
// 	silk.internalSampleRate = 0;
// 	silk.opusCanSwitch = 0;
// 	silk.switchReady = 0;
// 	silk.stereoWidth_Q14 = Q14_ONE;
// 	silk.signalType = 0;
// 	silk.offset = 0;

// 	st.hp_mem.fill(0);
// 	st.delay_buffer.fill(0);
// 	st.width_mem = createStereoWidthState();
// 	st.energy_masking = null;
// 	st.detected_bandwidth = 0;
// 	st.nb_no_activity_frames = 0;
// 	st.peak_signal_energy = 0;
// 	st.nonfinal_frame = 0;
// 	st.rangeFinal = 0;
// 	st.stub_seed = 0;
// }

// export function frame_size_select(frame_size: opus_int32, variable_duration: number, Fs: opus_int32): opus_int32 {
// 	const fs400 = Math.trunc(Fs / 400);
// 	let new_size = 0;
// 	if (frame_size < fs400) return -1;
// 	if (variable_duration === OPUS_FRAMESIZE_ARG) {
// 		new_size = frame_size;
// 	} else if (variable_duration >= OPUS_FRAMESIZE_2_5_MS && variable_duration <= OPUS_FRAMESIZE_120_MS) {
// 		if (variable_duration <= OPUS_FRAMESIZE_40_MS) {
// 			new_size = fs400 << (variable_duration - OPUS_FRAMESIZE_2_5_MS);
// 		} else {
// 			new_size = Math.trunc((variable_duration - OPUS_FRAMESIZE_2_5_MS - 2) * Fs / 50);
// 		}
// 	} else {
// 		return -1;
// 	}
// 	if (new_size > frame_size) return -1;
// 	if (
// 		400 * new_size !== Fs &&
// 		200 * new_size !== Fs &&
// 		100 * new_size !== Fs &&
// 		50 * new_size !== Fs &&
// 		25 * new_size !== Fs &&
// 		50 * new_size !== 3 * Fs &&
// 		50 * new_size !== 4 * Fs &&
// 		50 * new_size !== 5 * Fs &&
// 		50 * new_size !== 6 * Fs
// 	) {
// 		return -1;
// 	}
// 	return new_size;
// }

// export function user_bitrate_to_bitrate(st: OpusEncoder, frame_size: number, max_data_bytes: number): opus_int32 {
// 	const size = frame_size !== 0 ? frame_size : Math.trunc(st.Fs / 400);
// 	if (st.user_bitrate_bps === OPUS_AUTO) {
// 		return Math.trunc((60 * st.Fs) / size + st.Fs * st.channels);
// 	}
// 	if (st.user_bitrate_bps === OPUS_BITRATE_MAX) {
// 		return Math.trunc((max_data_bytes * 8 * st.Fs) / size);
// 	}
// 	return st.user_bitrate_bps;
// }

// export function opus_encode_float(st: OpusEncoder, pcm: Float32Array, analysis_frame_size: number, max_data_bytes: number): Buffer {
// 	const frame_size = frame_size_select(analysis_frame_size, st.variable_duration, st.Fs);
// 	if (frame_size <= 0) {
// 		throw new Error(`Invalid frame size ${analysis_frame_size}`);
// 	}
// 	if (max_data_bytes <= 0) {
// 		throw new Error("max_data_bytes must be > 0");
// 	}
// 	const frame_samples = frame_size * st.channels;
// 	st.pcm_scratch = ensureFloat32Capacity(st.pcm_scratch, frame_samples);
// 	st.pcm_scratch.set(pcm.subarray(0, frame_samples));
// 	return opus_encode_native(st, st.pcm_scratch, frame_size, max_data_bytes, 24);
// }

// export function opus_encode(st: OpusEncoder, pcm: Int16Array, analysis_frame_size: number, max_data_bytes: number): Buffer {
// 	const frame_size = frame_size_select(analysis_frame_size, st.variable_duration, st.Fs);
// 	if (frame_size <= 0) {
// 		throw new Error(`Invalid frame size ${analysis_frame_size}`);
// 	}
// 	if (max_data_bytes <= 0) {
// 		throw new Error("max_data_bytes must be > 0");
// 	}
// 	const frame_samples = frame_size * st.channels;
// 	st.pcm_scratch = ensureFloat32Capacity(st.pcm_scratch, frame_samples);
// 	for (let i = 0; i < frame_samples; i++) {
// 		st.pcm_scratch[i] = pcm[i] / 32768;
// 	}
// 	return opus_encode_native(st, st.pcm_scratch, frame_size, max_data_bytes, 16);
// }

// export function opus_encode_native(
// 	st: OpusEncoder,
// 	pcm: Float32Array,
// 	frame_size: number,
// 	out_data_bytes: number,
// 	lsb_depth: number
// ): Buffer {
// 	const depth = Math.min(lsb_depth, st.lsb_depth);
// 	return encode_placeholder_packet(st, frame_size, out_data_bytes, pcm, depth);
// }

// export type OpusCtlGetRequest =
// 	| typeof OPUS_GET_APPLICATION_REQUEST
// 	| typeof OPUS_GET_BITRATE_REQUEST
// 	| typeof OPUS_GET_FORCE_CHANNELS_REQUEST
// 	| typeof OPUS_GET_MAX_BANDWIDTH_REQUEST
// 	| typeof OPUS_GET_BANDWIDTH_REQUEST
// 	| typeof OPUS_GET_DTX_REQUEST
// 	| typeof OPUS_GET_COMPLEXITY_REQUEST
// 	| typeof OPUS_GET_INBAND_FEC_REQUEST
// 	| typeof OPUS_GET_PACKET_LOSS_PERC_REQUEST
// 	| typeof OPUS_GET_VBR_REQUEST
// 	| typeof OPUS_GET_VOICE_RATIO_REQUEST
// 	| typeof OPUS_GET_VBR_CONSTRAINT_REQUEST
// 	| typeof OPUS_GET_SIGNAL_REQUEST
// 	| typeof OPUS_GET_LOOKAHEAD_REQUEST
// 	| typeof OPUS_GET_SAMPLE_RATE_REQUEST
// 	| typeof OPUS_GET_FINAL_RANGE_REQUEST
// 	| typeof OPUS_GET_LSB_DEPTH_REQUEST
// 	| typeof OPUS_GET_EXPERT_FRAME_DURATION_REQUEST
// 	| typeof OPUS_GET_PREDICTION_DISABLED_REQUEST
// 	| typeof OPUS_GET_PHASE_INVERSION_DISABLED_REQUEST;

// export type OpusCtlSetRequest =
// 	| typeof OPUS_SET_APPLICATION_REQUEST
// 	| typeof OPUS_SET_BITRATE_REQUEST
// 	| typeof OPUS_SET_FORCE_CHANNELS_REQUEST
// 	| typeof OPUS_SET_MAX_BANDWIDTH_REQUEST
// 	| typeof OPUS_SET_BANDWIDTH_REQUEST
// 	| typeof OPUS_SET_DTX_REQUEST
// 	| typeof OPUS_SET_COMPLEXITY_REQUEST
// 	| typeof OPUS_SET_INBAND_FEC_REQUEST
// 	| typeof OPUS_SET_PACKET_LOSS_PERC_REQUEST
// 	| typeof OPUS_SET_VBR_REQUEST
// 	| typeof OPUS_SET_VOICE_RATIO_REQUEST
// 	| typeof OPUS_SET_VBR_CONSTRAINT_REQUEST
// 	| typeof OPUS_SET_SIGNAL_REQUEST
// 	| typeof OPUS_SET_LSB_DEPTH_REQUEST
// 	| typeof OPUS_SET_EXPERT_FRAME_DURATION_REQUEST
// 	| typeof OPUS_SET_PREDICTION_DISABLED_REQUEST
// 	| typeof OPUS_SET_PHASE_INVERSION_DISABLED_REQUEST
// 	| typeof OPUS_SET_FORCE_MODE_REQUEST
// 	| typeof OPUS_SET_LFE_REQUEST
// 	| typeof OPUS_SET_ENERGY_MASK_REQUEST
// 	| typeof OPUS_RESET_STATE;

// export function opus_encoder_ctl(st: OpusEncoder, request: OpusCtlGetRequest): number;
// export function opus_encoder_ctl(st: OpusEncoder, request: OpusCtlSetRequest, value?: number | Float32Array | null): number;
// export function opus_encoder_ctl(st: OpusEncoder, request: number, value?: number | Float32Array | null): number {
// 	switch (request) {
// 		case OPUS_SET_APPLICATION_REQUEST: {
// 			const v = value as number;
// 			if (
// 				(v !== OPUS_APPLICATION_VOIP && v !== OPUS_APPLICATION_AUDIO && v !== OPUS_APPLICATION_RESTRICTED_LOWDELAY) ||
// 				(!st.first && st.application !== v)
// 			) {
// 				return OPUS_BAD_ARG;
// 			}
// 			st.application = v;
// 			return OPUS_OK;
// 		}
// 		case OPUS_GET_APPLICATION_REQUEST:
// 			return st.application;
// 		case OPUS_SET_BITRATE_REQUEST: {
// 			let v = value as number;
// 			if (v !== OPUS_AUTO && v !== OPUS_BITRATE_MAX) {
// 				if (v <= 0) return OPUS_BAD_ARG;
// 				if (v <= 500) v = 500;
// 				if (v > 300000 * st.channels) v = 300000 * st.channels;
// 			}
// 			st.user_bitrate_bps = v;
// 			return OPUS_OK;
// 		}
// 		case OPUS_GET_BITRATE_REQUEST:
// 			return user_bitrate_to_bitrate(st, st.prev_framesize, OPUS_MAX_PACKET_BYTES);
// 		case OPUS_SET_FORCE_CHANNELS_REQUEST: {
// 			const v = value as number;
// 			if ((v < 1 || v > st.channels) && v !== OPUS_AUTO) return OPUS_BAD_ARG;
// 			st.force_channels = v;
// 			return OPUS_OK;
// 		}
// 		case OPUS_GET_FORCE_CHANNELS_REQUEST:
// 			return st.force_channels;
// 		case OPUS_SET_MAX_BANDWIDTH_REQUEST: {
// 			const v = value as number;
// 			if (v < OPUS_BANDWIDTH_NARROWBAND || v > OPUS_BANDWIDTH_FULLBAND) return OPUS_BAD_ARG;
// 			st.max_bandwidth = v;
// 			if (v === OPUS_BANDWIDTH_NARROWBAND) st.silk_mode.maxInternalSampleRate = 8000;
// 			else if (v === OPUS_BANDWIDTH_MEDIUMBAND) st.silk_mode.maxInternalSampleRate = 12000;
// 			else st.silk_mode.maxInternalSampleRate = 16000;
// 			return OPUS_OK;
// 		}
// 		case OPUS_GET_MAX_BANDWIDTH_REQUEST:
// 			return st.max_bandwidth;
// 		case OPUS_SET_BANDWIDTH_REQUEST: {
// 			const v = value as number;
// 			if ((v < OPUS_BANDWIDTH_NARROWBAND || v > OPUS_BANDWIDTH_FULLBAND) && v !== OPUS_AUTO) return OPUS_BAD_ARG;
// 			st.user_bandwidth = v;
// 			if (v === OPUS_BANDWIDTH_NARROWBAND) st.silk_mode.maxInternalSampleRate = 8000;
// 			else if (v === OPUS_BANDWIDTH_MEDIUMBAND) st.silk_mode.maxInternalSampleRate = 12000;
// 			else st.silk_mode.maxInternalSampleRate = 16000;
// 			return OPUS_OK;
// 		}
// 		case OPUS_GET_BANDWIDTH_REQUEST:
// 			return st.bandwidth;
// 		case OPUS_SET_DTX_REQUEST: {
// 			const v = value as number;
// 			if (v < 0 || v > 1) return OPUS_BAD_ARG;
// 			st.use_dtx = v;
// 			return OPUS_OK;
// 		}
// 		case OPUS_GET_DTX_REQUEST:
// 			return st.use_dtx;
// 		case OPUS_SET_COMPLEXITY_REQUEST: {
// 			const v = value as number;
// 			if (v < 0 || v > 10) return OPUS_BAD_ARG;
// 			st.silk_mode.complexity = v;
// 			return OPUS_OK;
// 		}
// 		case OPUS_GET_COMPLEXITY_REQUEST:
// 			return st.silk_mode.complexity;
// 		case OPUS_SET_INBAND_FEC_REQUEST: {
// 			const v = value as number;
// 			if (v < 0 || v > 1) return OPUS_BAD_ARG;
// 			st.silk_mode.useInBandFEC = v;
// 			return OPUS_OK;
// 		}
// 		case OPUS_GET_INBAND_FEC_REQUEST:
// 			return st.silk_mode.useInBandFEC;
// 		case OPUS_SET_PACKET_LOSS_PERC_REQUEST: {
// 			const v = value as number;
// 			if (v < 0 || v > 100) return OPUS_BAD_ARG;
// 			st.silk_mode.packetLossPercentage = v;
// 			return OPUS_OK;
// 		}
// 		case OPUS_GET_PACKET_LOSS_PERC_REQUEST:
// 			return st.silk_mode.packetLossPercentage;
// 		case OPUS_SET_VBR_REQUEST: {
// 			const v = value as number;
// 			if (v < 0 || v > 1) return OPUS_BAD_ARG;
// 			st.use_vbr = v;
// 			st.silk_mode.useCBR = 1 - v;
// 			return OPUS_OK;
// 		}
// 		case OPUS_GET_VBR_REQUEST:
// 			return st.use_vbr;
// 		case OPUS_SET_VOICE_RATIO_REQUEST: {
// 			const v = value as number;
// 			if (v < -1 || v > 100) return OPUS_BAD_ARG;
// 			st.voice_ratio = v;
// 			return OPUS_OK;
// 		}
// 		case OPUS_GET_VOICE_RATIO_REQUEST:
// 			return st.voice_ratio;
// 		case OPUS_SET_VBR_CONSTRAINT_REQUEST: {
// 			const v = value as number;
// 			if (v < 0 || v > 1) return OPUS_BAD_ARG;
// 			st.vbr_constraint = v;
// 			return OPUS_OK;
// 		}
// 		case OPUS_GET_VBR_CONSTRAINT_REQUEST:
// 			return st.vbr_constraint;
// 		case OPUS_SET_SIGNAL_REQUEST: {
// 			const v = value as number;
// 			if (v !== OPUS_AUTO && v !== OPUS_SIGNAL_VOICE && v !== OPUS_SIGNAL_MUSIC) return OPUS_BAD_ARG;
// 			st.signal_type = v;
// 			return OPUS_OK;
// 		}
// 		case OPUS_GET_SIGNAL_REQUEST:
// 			return st.signal_type;
// 		case OPUS_GET_LOOKAHEAD_REQUEST: {
// 			let lookahead = Math.trunc(st.Fs / 400);
// 			if (st.application !== OPUS_APPLICATION_RESTRICTED_LOWDELAY) {
// 				lookahead += st.delay_compensation;
// 			}
// 			return lookahead;
// 		}
// 		case OPUS_GET_SAMPLE_RATE_REQUEST:
// 			return st.Fs;
// 		case OPUS_GET_FINAL_RANGE_REQUEST:
// 			return st.rangeFinal;
// 		case OPUS_SET_LSB_DEPTH_REQUEST: {
// 			const v = value as number;
// 			if (v < 8 || v > 24) return OPUS_BAD_ARG;
// 			st.lsb_depth = v;
// 			return OPUS_OK;
// 		}
// 		case OPUS_GET_LSB_DEPTH_REQUEST:
// 			return st.lsb_depth;
// 		case OPUS_SET_EXPERT_FRAME_DURATION_REQUEST: {
// 			const v = value as number;
// 			if (
// 				v !== OPUS_FRAMESIZE_ARG &&
// 				v !== OPUS_FRAMESIZE_2_5_MS &&
// 				v !== OPUS_FRAMESIZE_5_MS &&
// 				v !== OPUS_FRAMESIZE_10_MS &&
// 				v !== OPUS_FRAMESIZE_20_MS &&
// 				v !== OPUS_FRAMESIZE_40_MS &&
// 				v !== OPUS_FRAMESIZE_60_MS &&
// 				v !== OPUS_FRAMESIZE_80_MS &&
// 				v !== OPUS_FRAMESIZE_100_MS &&
// 				v !== OPUS_FRAMESIZE_120_MS
// 			) {
// 				return OPUS_BAD_ARG;
// 			}
// 			st.variable_duration = v;
// 			return OPUS_OK;
// 		}
// 		case OPUS_GET_EXPERT_FRAME_DURATION_REQUEST:
// 			return st.variable_duration;
// 		case OPUS_SET_PREDICTION_DISABLED_REQUEST: {
// 			const v = value as number;
// 			if (v < 0 || v > 1) return OPUS_BAD_ARG;
// 			st.silk_mode.reducedDependency = v;
// 			return OPUS_OK;
// 		}
// 		case OPUS_GET_PREDICTION_DISABLED_REQUEST:
// 			return st.silk_mode.reducedDependency;
// 		case OPUS_SET_PHASE_INVERSION_DISABLED_REQUEST: {
// 			const v = value as number;
// 			if (v < 0 || v > 1) return OPUS_BAD_ARG;
// 			st.phase_inversion_disabled = v;
// 			return OPUS_OK;
// 		}
// 		case OPUS_GET_PHASE_INVERSION_DISABLED_REQUEST:
// 			return st.phase_inversion_disabled;
// 		case OPUS_RESET_STATE:
// 			reset_encoder_state(st);
// 			return OPUS_OK;
// 		case OPUS_SET_FORCE_MODE_REQUEST: {
// 			const v = value as number;
// 			if ((v < MODE_SILK_ONLY || v > MODE_CELT_ONLY) && v !== OPUS_AUTO) return OPUS_BAD_ARG;
// 			st.user_forced_mode = v;
// 			return OPUS_OK;
// 		}
// 		case OPUS_SET_LFE_REQUEST:
// 			st.lfe = value as number;
// 			return OPUS_OK;
// 		case OPUS_SET_ENERGY_MASK_REQUEST: {
// 			const v = value as Float32Array | null;
// 			if (v !== null && !(v instanceof Float32Array)) return OPUS_BAD_ARG;
// 			st.energy_masking = v;
// 			return OPUS_OK;
// 		}
// 		default:
// 			return OPUS_UNIMPLEMENTED;
// 	}
// }

// function createStereoWidthState(): StereoWidthState {
// 	return {
// 		XX: 0,
// 		XY: 0,
// 		YY: 0,
// 		smoothed_width: 0,
// 		max_follower: 0,
// 	};
// }

// function createSilkEncControlStruct(): SilkEncControlStruct {
// 	return {
// 		nChannelsAPI: 0,
// 		nChannelsInternal: 0,
// 		API_sampleRate: 0,
// 		maxInternalSampleRate: 0,
// 		minInternalSampleRate: 0,
// 		desiredInternalSampleRate: 0,
// 		payloadSize_ms: 0,
// 		bitRate: 0,
// 		packetLossPercentage: 0,
// 		complexity: 0,
// 		useInBandFEC: 0,
// 		useDTX: 0,
// 		useCBR: 0,
// 		reducedDependency: 0,
// 		allowBandwidthSwitch: 0,
// 		inWBmodeWithoutVariableLP: 0,
// 		toMono: 0,
// 		LBRR_coded: 0,
// 		maxBits: 0,
// 		internalSampleRate: 0,
// 		opusCanSwitch: 0,
// 		switchReady: 0,
// 		stereoWidth_Q14: 0,
// 		signalType: 0,
// 		offset: 0,
// 	};
// }

// function createTonalityAnalysisState(): TonalityAnalysisState {
// 	const size = ANALYSIS_MIN_FFT;
// 	return {
// 		fftSize: size,
// 		fft: new FFTComplexRadix2(size),
// 		window: createHannWindow(size),
// 		re: new Float64Array(size),
// 		im: new Float64Array(size),
// 	};
// }

// function lin2log2q8(hz: number): number {
// 	return Math.log2(hz) * 256;
// }

// function log2q8ToHz(log2q8: number): number {
// 	return Math.pow(2, log2q8 / 256);
// }

// function nextPow2(value: number): number {
// 	let v = 1;
// 	while (v < value) v <<= 1;
// 	return v;
// }

// function ensureAnalysisState(state: TonalityAnalysisState, size: number): void {
// 	if (state.fftSize === size) return;
// 	state.fftSize = size;
// 	state.fft = new FFTComplexRadix2(size);
// 	state.window = createHannWindow(size);
// 	state.re = new Float64Array(size);
// 	state.im = new Float64Array(size);
// }

// function createHannWindow(size: number): Float64Array {
// 	const window = new Float64Array(size);
// 	const scale = (2 * Math.PI) / (size - 1);
// 	for (let i = 0; i < size; i++) {
// 		window[i] = 0.5 - 0.5 * Math.cos(scale * i);
// 	}
// 	return window;
// }

// function update_variable_hp_cutoff(st: OpusEncoder, analysis_info: AnalysisInfo): number {
// 	let target_hz = VARIABLE_HP_MIN_CUTOFF_HZ;
// 	if (analysis_info.valid) {
// 		const low_weight = clamp01(analysis_info.low_freq_ratio * 5);
// 		target_hz = VARIABLE_HP_MAX_CUTOFF_HZ - (VARIABLE_HP_MAX_CUTOFF_HZ - VARIABLE_HP_MIN_CUTOFF_HZ) * low_weight;
// 	}
// 	const target_log = lin2log2q8(target_hz);
// 	st.variable_HP_smth2_Q15 += (target_log - st.variable_HP_smth2_Q15) * VARIABLE_HP_SMTH_COEF2;
// 	return log2q8ToHz(st.variable_HP_smth2_Q15);
// }

// function run_tonality_analysis(
// 	state: TonalityAnalysisState,
// 	pcm: Float32Array,
// 	frame_size: number,
// 	channels: number,
// 	offset: number,
// 	Fs: number,
// 	complexity: number,
// 	is_silence: boolean,
// 	activity_probability: number
// ): AnalysisInfo {
// 	if (is_silence || Fs < 16000 || complexity < 7) {
// 		return {
// 			valid: false,
// 			activity_probability,
// 			music_prob: 0,
// 			bandwidth: 0,
// 			low_freq_ratio: 0,
// 		};
// 	}

// 	const fftSize = Math.max(ANALYSIS_MIN_FFT, nextPow2(frame_size));
// 	ensureAnalysisState(state, fftSize);

// 	const re = state.re;
// 	const im = state.im;
// 	const window = state.window;
// 	const stride = channels;
// 	for (let i = 0; i < fftSize; i++) {
// 		let sample = 0;
// 		if (i < frame_size) {
// 			const base = offset + i * stride;
// 			if (channels === 1) {
// 				sample = pcm[base];
// 			} else {
// 				sample = 0.5 * (pcm[base] + pcm[base + 1]);
// 			}
// 		}
// 		re[i] = sample * window[i];
// 		im[i] = 0;
// 	}

// 	state.fft.forward(re, im);

// 	const half = fftSize >>> 1;
// 	let total_energy = 0;
// 	let peak = 0;
// 	let centroid_sum = 0;
// 	let log_sum = 0;
// 	let low_energy = 0;
// 	const bin_hz = Fs / fftSize;
// 	const low_limit = Math.max(1, Math.min(half, Math.floor(200 / bin_hz)));

// 	for (let i = 1; i <= half; i++) {
// 		const r = re[i];
// 		const iv = im[i];
// 		const mag2 = r * r + iv * iv;
// 		total_energy += mag2;
// 		if (mag2 > peak) peak = mag2;
// 		centroid_sum += i * mag2;
// 		log_sum += Math.log(mag2 + ANALYSIS_EPS);
// 		if (i <= low_limit) low_energy += mag2;
// 	}

// 	const mean = total_energy / half;
// 	const flatness = Math.exp(log_sum / half) / (mean + ANALYSIS_EPS);
// 	const centroid_norm = total_energy > 0 ? centroid_sum / (total_energy * half) : 0;
// 	const music_prob = clamp01(0.6 * centroid_norm + 0.4 * (1 - flatness));
// 	const low_freq_ratio = total_energy > 0 ? low_energy / (total_energy + ANALYSIS_EPS) : 0;

// 	let band_edge = 1;
// 	const threshold = peak * ANALYSIS_PEAK_RATIO;
// 	for (let i = 1; i <= half; i++) {
// 		const r = re[i];
// 		const iv = im[i];
// 		const mag2 = r * r + iv * iv;
// 		if (mag2 >= threshold) band_edge = i;
// 	}
// 	const bandwidth = (band_edge * Fs) / (fftSize * 1000);

// 	return {
// 		valid: true,
// 		activity_probability,
// 		music_prob,
// 		bandwidth,
// 		low_freq_ratio,
// 	};
// }

// function map_analysis_bandwidth(bandwidth_khz: number): number {
// 	if (bandwidth_khz <= 12) return OPUS_BANDWIDTH_NARROWBAND;
// 	if (bandwidth_khz <= 14) return OPUS_BANDWIDTH_MEDIUMBAND;
// 	if (bandwidth_khz <= 16) return OPUS_BANDWIDTH_WIDEBAND;
// 	if (bandwidth_khz <= 18) return OPUS_BANDWIDTH_SUPERWIDEBAND;
// 	return OPUS_BANDWIDTH_FULLBAND;
// }

// function gen_toc(mode: number, framerate: number, bandwidth: number, channels: number): number {
// 	let period = 0;
// 	let rate = framerate;
// 	while (rate < 400) {
// 		rate <<= 1;
// 		period++;
// 	}
// 	let toc = 0;
// 	if (mode === MODE_SILK_ONLY) {
// 		toc = (bandwidth - OPUS_BANDWIDTH_NARROWBAND) << 5;
// 		toc |= (period - 2) << 3;
// 	} else if (mode === MODE_CELT_ONLY) {
// 		let tmp = bandwidth - OPUS_BANDWIDTH_MEDIUMBAND;
// 		if (tmp < 0) tmp = 0;
// 		toc = 0x80;
// 		toc |= tmp << 5;
// 		toc |= period << 3;
// 	} else {
// 		toc = 0x60;
// 		toc |= (bandwidth - OPUS_BANDWIDTH_SUPERWIDEBAND) << 4;
// 		toc |= (period - 2) << 3;
// 	}
// 	toc |= (channels === 2 ? 1 : 0) << 2;
// 	return toc & 0xff;
// }

// function ensureFloat32Capacity(buf: Float32Array, size: number): Float32Array {
// 	if (buf.length < size) {
// 		return new Float32Array(size);
// 	}
// 	return buf;
// }

// function encode_placeholder_packet(
// 	st: OpusEncoder,
// 	frame_size: number,
// 	max_data_bytes: number,
// 	pcm_frame: Float32Array,
// 	lsb_depth: number
// ): Buffer {
// 	st.rangeFinal = 0;
// 	let max_bytes = Math.min(OPUS_MAX_PACKET_BYTES, max_data_bytes);
// 	const total_buffer = st.application === OPUS_APPLICATION_RESTRICTED_LOWDELAY ? 0 : st.delay_compensation;
// 	const channels = st.channels;
// 	const pcm_buf_samples = (total_buffer + frame_size) * channels;
// 	st.pcm_buf = ensureFloat32Capacity(st.pcm_buf, pcm_buf_samples);
// 	const delay_offset = (st.encoder_buffer - total_buffer) * channels;
// 	st.pcm_buf.set(st.delay_buffer.subarray(delay_offset, delay_offset + total_buffer * channels), 0);
// 	const frame_offset = total_buffer * channels;
// 	const is_silence = is_digital_silence(pcm_frame, frame_size, channels, lsb_depth);
// 	const raw_energy = compute_frame_energy(pcm_frame, frame_size, channels, 0);
// 	const base_activity_probability = estimate_activity_probability(raw_energy, frame_size, channels);
// 	const analysis_info = run_tonality_analysis(
// 		st.analysis,
// 		pcm_frame,
// 		frame_size,
// 		channels,
// 		0,
// 		st.Fs,
// 		st.silk_mode.complexity,
// 		is_silence,
// 		base_activity_probability
// 	);
// 	const cutoff_Hz = update_variable_hp_cutoff(st, analysis_info);
// 	if (st.application === OPUS_APPLICATION_VOIP) {
// 		hp_cutoff(pcm_frame, cutoff_Hz, st.pcm_buf, st.hp_mem, frame_size, channels, st.Fs, frame_offset);
// 	} else {
// 		dc_reject(pcm_frame, 3, st.pcm_buf, st.hp_mem, frame_size, channels, st.Fs, frame_offset);
// 	}
// 	st.stub_seed = compute_pcm_seed(st.pcm_buf, frame_offset, frame_size * channels);
// 	const activity_probability = analysis_info.activity_probability;
// 	if (!is_silence) {
// 		st.voice_ratio = -1;
// 		if (analysis_info.valid && st.signal_type === OPUS_AUTO) {
// 			st.voice_ratio = Math.floor(0.5 + 100 * (1 - analysis_info.music_prob));
// 		}
// 		if (analysis_info.valid && activity_probability > DTX_ACTIVITY_THRESHOLD) {
// 			const decay = 0.999;
// 			st.peak_signal_energy = Math.max(st.peak_signal_energy * decay, raw_energy);
// 		}
// 		if (analysis_info.valid) {
// 			st.detected_bandwidth = map_analysis_bandwidth(analysis_info.bandwidth);
// 		} else {
// 			st.detected_bandwidth = estimate_detected_bandwidth(pcm_frame, frame_size, channels, 0, st.Fs, raw_energy);
// 		}
// 	} else {
// 		st.detected_bandwidth = 0;
// 	}

// 	const stereo_width = channels === 2 && st.force_channels !== 1
// 		? compute_stereo_width(st.pcm_buf, frame_size, st.Fs, st.width_mem, frame_offset)
// 		: 0;
// 	st.last_stereo_width = stereo_width;

// 	const frame_rate = Math.trunc(st.Fs / frame_size);
// 	st.bitrate_bps = user_bitrate_to_bitrate(st, frame_size, max_bytes);
// 	if (!st.use_vbr) {
// 		const frame_rate12 = Math.trunc((12 * st.Fs) / frame_size);
// 		const cbrBytes = Math.min(Math.trunc((12 * st.bitrate_bps / 8 + frame_rate12 / 2) / frame_rate12), max_bytes);
// 		st.bitrate_bps = Math.trunc((cbrBytes * frame_rate12 * 8) / 12);
// 		max_bytes = Math.max(1, cbrBytes);
// 	}
// 	if (
// 		max_bytes < 3 ||
// 		st.bitrate_bps < 3 * frame_rate * 8 ||
// 		(frame_rate < 50 && (max_bytes * frame_rate < 300 || st.bitrate_bps < 2400))
// 	) {
// 		return build_plc_packet(st, frame_rate, max_bytes);
// 	}
// 	const max_rate = frame_rate * max_bytes * 8;
// 	let equiv_rate = compute_equiv_rate(
// 		st.bitrate_bps,
// 		st.channels,
// 		frame_rate,
// 		st.use_vbr,
// 		0,
// 		st.silk_mode.complexity,
// 		st.silk_mode.packetLossPercentage
// 	);
// 	const voice_est = compute_voice_est(st);

// 	if (st.force_channels !== OPUS_AUTO && st.channels === 2) {
// 		st.stream_channels = st.force_channels;
// 	} else if (st.channels === 2) {
// 		let stereo_threshold = stereo_music_threshold + Math.trunc((voice_est * voice_est * (stereo_voice_threshold - stereo_music_threshold)) / 16384);
// 		if (st.stream_channels === 2) stereo_threshold -= 1000;
// 		else stereo_threshold += 1000;
// 		st.stream_channels = equiv_rate > stereo_threshold ? 2 : 1;
// 	} else {
// 		st.stream_channels = st.channels;
// 	}

// 	equiv_rate = compute_equiv_rate(
// 		st.bitrate_bps,
// 		st.stream_channels,
// 		frame_rate,
// 		st.use_vbr,
// 		st.mode,
// 		st.silk_mode.complexity,
// 		st.silk_mode.packetLossPercentage
// 	);

// 	if (st.application === OPUS_APPLICATION_RESTRICTED_LOWDELAY) {
// 		st.mode = MODE_CELT_ONLY;
// 	} else if (st.user_forced_mode === OPUS_AUTO) {
// 		const mode_voice = (1 - stereo_width) * mode_thresholds[0][0] + stereo_width * mode_thresholds[1][0];
// 		const mode_music = mode_thresholds[1][1];
// 		let threshold = mode_music + Math.trunc((voice_est * voice_est * (mode_voice - mode_music)) / 16384);
// 		if (st.application === OPUS_APPLICATION_VOIP) threshold += 8000;
// 		if (st.prev_mode === MODE_CELT_ONLY) threshold -= 4000;
// 		else if (st.prev_mode > 0) threshold += 4000;
// 		st.mode = equiv_rate >= threshold ? MODE_CELT_ONLY : MODE_SILK_ONLY;
// 		if (st.silk_mode.useInBandFEC && st.silk_mode.packetLossPercentage > ((128 - voice_est) >> 4)) {
// 			st.mode = MODE_SILK_ONLY;
// 		}
// 		st.silk_mode.useDTX = st.use_dtx && !(analysis_info.valid || is_silence);
// 		if (st.silk_mode.useDTX && voice_est > 100) {
// 			st.mode = MODE_SILK_ONLY;
// 		}
// 		const min_bytes = ((frame_rate > 50 ? 9000 : 6000) * frame_size) / (st.Fs * 8);
// 		if (max_bytes < min_bytes) st.mode = MODE_CELT_ONLY;
// 	} else {
// 		st.mode = st.user_forced_mode;
// 	}

// 	if (st.mode !== MODE_CELT_ONLY && frame_size < st.Fs / 100) st.mode = MODE_CELT_ONLY;
// 	if (st.lfe) st.mode = MODE_CELT_ONLY;

// 	if (
// 		st.stream_channels === 1 &&
// 		st.prev_channels === 2 &&
// 		st.silk_mode.toMono === 0 &&
// 		st.mode !== MODE_CELT_ONLY &&
// 		st.prev_mode !== MODE_CELT_ONLY
// 	) {
// 		st.silk_mode.toMono = 1;
// 		st.stream_channels = 2;
// 	} else {
// 		st.silk_mode.toMono = 0;
// 	}

// 	equiv_rate = compute_equiv_rate(
// 		st.bitrate_bps,
// 		st.stream_channels,
// 		frame_rate,
// 		st.use_vbr,
// 		st.mode,
// 		st.silk_mode.complexity,
// 		st.silk_mode.packetLossPercentage
// 	);

// 	if (st.mode === MODE_CELT_ONLY || st.first || st.silk_mode.allowBandwidthSwitch) {
// 		const voice_bw = channels === 2 && st.force_channels !== 1
// 			? stereo_voice_bandwidth_thresholds
// 			: mono_voice_bandwidth_thresholds;
// 		const music_bw = channels === 2 && st.force_channels !== 1
// 			? stereo_music_bandwidth_thresholds
// 			: mono_music_bandwidth_thresholds;
// 		const bandwidth_thresholds = new Int32Array(8);
// 		for (let i = 0; i < 8; i++) {
// 			bandwidth_thresholds[i] = music_bw[i] + Math.trunc((voice_est * voice_est * (voice_bw[i] - music_bw[i])) / 16384);
// 		}
// 		let bandwidth = OPUS_BANDWIDTH_FULLBAND;
// 		do {
// 			const idx = 2 * (bandwidth - OPUS_BANDWIDTH_MEDIUMBAND);
// 			let threshold = bandwidth_thresholds[idx];
// 			const hysteresis = bandwidth_thresholds[idx + 1];
// 			if (!st.first) {
// 				if (st.auto_bandwidth >= bandwidth) threshold -= hysteresis;
// 				else threshold += hysteresis;
// 			}
// 			if (equiv_rate >= threshold) break;
// 		} while (--bandwidth > OPUS_BANDWIDTH_NARROWBAND);
// 		st.bandwidth = bandwidth;
// 		st.auto_bandwidth = bandwidth;
// 		if (!st.first && st.mode !== MODE_CELT_ONLY && !st.silk_mode.inWBmodeWithoutVariableLP && st.bandwidth > OPUS_BANDWIDTH_WIDEBAND) {
// 			st.bandwidth = OPUS_BANDWIDTH_WIDEBAND;
// 		}
// 	}

// 	if (st.bandwidth > st.max_bandwidth) st.bandwidth = st.max_bandwidth;
// 	if (st.user_bandwidth !== OPUS_AUTO) st.bandwidth = st.user_bandwidth;
// 	if (st.mode !== MODE_CELT_ONLY && max_rate < 15000) {
// 		st.bandwidth = Math.min(st.bandwidth, OPUS_BANDWIDTH_WIDEBAND);
// 	}
// 	if (st.Fs <= 24000 && st.bandwidth > OPUS_BANDWIDTH_SUPERWIDEBAND) st.bandwidth = OPUS_BANDWIDTH_SUPERWIDEBAND;
// 	if (st.Fs <= 16000 && st.bandwidth > OPUS_BANDWIDTH_WIDEBAND) st.bandwidth = OPUS_BANDWIDTH_WIDEBAND;
// 	if (st.Fs <= 12000 && st.bandwidth > OPUS_BANDWIDTH_MEDIUMBAND) st.bandwidth = OPUS_BANDWIDTH_MEDIUMBAND;
// 	if (st.Fs <= 8000 && st.bandwidth > OPUS_BANDWIDTH_NARROWBAND) st.bandwidth = OPUS_BANDWIDTH_NARROWBAND;

// 	if (st.detected_bandwidth && st.user_bandwidth === OPUS_AUTO) {
// 		let min_detected_bandwidth = OPUS_BANDWIDTH_FULLBAND;
// 		if (equiv_rate <= 18000 * st.stream_channels && st.mode === MODE_CELT_ONLY) {
// 			min_detected_bandwidth = OPUS_BANDWIDTH_NARROWBAND;
// 		} else if (equiv_rate <= 24000 * st.stream_channels && st.mode === MODE_CELT_ONLY) {
// 			min_detected_bandwidth = OPUS_BANDWIDTH_MEDIUMBAND;
// 		} else if (equiv_rate <= 30000 * st.stream_channels) {
// 			min_detected_bandwidth = OPUS_BANDWIDTH_WIDEBAND;
// 		} else if (equiv_rate <= 44000 * st.stream_channels) {
// 			min_detected_bandwidth = OPUS_BANDWIDTH_SUPERWIDEBAND;
// 		}
// 		st.detected_bandwidth = Math.max(st.detected_bandwidth, min_detected_bandwidth);
// 		st.bandwidth = Math.min(st.bandwidth, st.detected_bandwidth);
// 	}

// 	const fec_decision = decide_fec(
// 		st.silk_mode.useInBandFEC,
// 		st.silk_mode.packetLossPercentage,
// 		st.silk_mode.LBRR_coded,
// 		st.mode,
// 		st.bandwidth,
// 		equiv_rate
// 	);
// 	st.silk_mode.LBRR_coded = fec_decision.fec;
// 	st.bandwidth = fec_decision.bandwidth;

// 	if (st.mode === MODE_CELT_ONLY && st.bandwidth === OPUS_BANDWIDTH_MEDIUMBAND) st.bandwidth = OPUS_BANDWIDTH_WIDEBAND;
// 	if (st.lfe) st.bandwidth = OPUS_BANDWIDTH_NARROWBAND;
// 	if (st.mode === MODE_SILK_ONLY && st.bandwidth > OPUS_BANDWIDTH_WIDEBAND) st.mode = MODE_HYBRID;
// 	if (st.mode === MODE_HYBRID && st.bandwidth <= OPUS_BANDWIDTH_WIDEBAND) st.mode = MODE_SILK_ONLY;
// 	if (st.mode !== MODE_HYBRID || st.stream_channels === 1) {
// 		st.silk_mode.stereoWidth_Q14 = Math.min(Q14_ONE, 2 * Math.max(0, equiv_rate - 24000));
// 	}

// 	st.silk_mode.allowBandwidthSwitch = st.mode !== MODE_CELT_ONLY ? 1 : 0;
// 	st.silk_mode.switchReady = st.bandwidth !== st.prev_bandwidth && st.mode !== MODE_CELT_ONLY ? 1 : 0;
// 	st.prev_bandwidth = st.bandwidth;

// 	if ((frame_size > st.Fs / 50 && st.mode !== MODE_SILK_ONLY) || frame_size > (3 * st.Fs) / 50) {
// 		const layout = compute_multiframe_layout(st, frame_size);
// 		return encode_multiframe_packet(st, frame_size, layout.frame_size, layout.nb_frames, max_bytes, st.pcm_buf, frame_offset);
// 	}

// 	if (st.use_vbr && frame_size === st.Fs / 50) {
// 		return build_two_frame_vbr_packet(st, frame_size, max_bytes, st.pcm_buf, frame_offset);
// 	}

// 	let redundancy = 0;
// 	let redundancy_bytes = 0;
// 	let redundancy_header_bytes = 0;
// 	let celt_to_silk = 0;
// 	let prefill = 0;
// 	if (st.silk_bw_switch) {
// 		redundancy = 1;
// 		celt_to_silk = 1;
// 		st.silk_bw_switch = 0;
// 		prefill = 1;
// 	}
// 	if (st.mode === MODE_CELT_ONLY) {
// 		redundancy = 0;
// 	}
// 	st.silk_mode.opusCanSwitch = st.silk_mode.switchReady && !st.nonfinal_frame;
// 	if (st.silk_mode.opusCanSwitch) {
// 		redundancy = 1;
// 		celt_to_silk = 0;
// 		st.silk_bw_switch = 1;
// 	}
// 	if (redundancy) {
// 		redundancy_bytes = compute_redundancy_bytes(st, max_bytes, frame_size);
// 		if (redundancy_bytes < 2) {
// 			redundancy = 0;
// 			redundancy_bytes = 0;
// 		}
// 	}

// 	const prefill_samples = Math.trunc((st.Fs / 400) * channels);
// 	st.tmp_prefill = ensureFloat32Capacity(st.tmp_prefill, prefill_samples);
// 	if (st.mode !== MODE_SILK_ONLY && st.mode !== st.prev_mode && st.prev_mode > 0) {
// 		const prefill_offset = (st.encoder_buffer - total_buffer - Math.trunc(st.Fs / 400)) * channels;
// 		st.tmp_prefill.set(st.delay_buffer.subarray(prefill_offset, prefill_offset + prefill_samples), 0);
// 	}
// 	if (prefill && total_buffer > 0 && st.encoder_buffer > total_buffer + Math.trunc(st.Fs / 400)) {
// 		const prefill_offset = st.channels * (st.encoder_buffer - total_buffer - Math.trunc(st.Fs / 400));
// 		const prefill_len = Math.trunc(st.Fs / 400);
// 		const window48 = getFadeWindow48(DEFAULT_OVERLAP_48);
// 		gain_fade(st.delay_buffer, prefill_offset, st.delay_buffer, prefill_offset, 0, 1, DEFAULT_OVERLAP_48, prefill_len, st.channels, window48, st.Fs);
// 		st.delay_buffer.fill(0, 0, prefill_offset);
// 	}

// 	const buffered = st.encoder_buffer - frame_size - total_buffer;
// 	if (buffered > 0) {
// 		const move_count = buffered * channels;
// 		st.delay_buffer.copyWithin(0, frame_size * channels, frame_size * channels + move_count);
// 		st.delay_buffer.set(st.pcm_buf.subarray(0, (frame_size + total_buffer) * channels), move_count);
// 	} else {
// 		const start = (frame_size + total_buffer - st.encoder_buffer) * channels;
// 		st.delay_buffer.set(st.pcm_buf.subarray(start, start + st.encoder_buffer * channels), 0);
// 	}

// 	let bytes_target = Math.min(
// 		max_bytes - redundancy_bytes,
// 		Math.floor((st.bitrate_bps * frame_size) / (st.Fs * 8))
// 	) - 1;
// 	if (bytes_target < 0) {
// 		throw new Error(`Computed bytes_target=${bytes_target} for frame_size=${frame_size}`);
// 	}
// 	redundancy_header_bytes = redundancy ? (st.mode === MODE_HYBRID ? 2 : 1) : 0;
// 	if (redundancy && bytes_target < redundancy_header_bytes) {
// 		redundancy = 0;
// 		redundancy_bytes = 0;
// 		redundancy_header_bytes = 0;
// 		bytes_target = Math.min(
// 			max_bytes,
// 			Math.floor((st.bitrate_bps * frame_size) / (st.Fs * 8))
// 		) - 1;
// 		if (bytes_target < 0) {
// 			throw new Error(`Computed bytes_target=${bytes_target} for frame_size=${frame_size}`);
// 		}
// 	}
// 	const main_payload_bytes = Math.max(0, bytes_target - redundancy_header_bytes);

// 	update_silk_mode_control(st, frame_size, frame_rate, max_bytes, bytes_target, max_rate);
// 	const HB_gain = compute_hb_gain(st, frame_rate, bytes_target);

// 	const window48 = getFadeWindow48(DEFAULT_OVERLAP_48);
// 	if (st.prev_HB_gain < 1 || HB_gain < 1) {
// 		gain_fade(st.pcm_buf, frame_offset, st.pcm_buf, frame_offset, st.prev_HB_gain, HB_gain, DEFAULT_OVERLAP_48, frame_size, channels, window48, st.Fs);
// 	}
// 	st.prev_HB_gain = HB_gain;

// 	if (!st.energy_masking && st.channels === 2) {
// 		if (st.hybrid_stereo_width_Q14 < Q14_ONE || st.silk_mode.stereoWidth_Q14 < Q14_ONE) {
// 			const g1 = st.hybrid_stereo_width_Q14 / Q14_ONE;
// 			const g2 = st.silk_mode.stereoWidth_Q14 / Q14_ONE;
// 			stereo_fade(st.pcm_buf, frame_offset, st.pcm_buf, frame_offset, g1, g2, DEFAULT_OVERLAP_48, frame_size, channels, window48, st.Fs);
// 			st.hybrid_stereo_width_Q14 = st.silk_mode.stereoWidth_Q14;
// 		}
// 	}
// 	const toc = gen_toc(st.mode, frame_rate, st.bandwidth, st.stream_channels);
// 	const payload_len = bytes_target + redundancy_bytes;
// 	const out_len = Math.min(OPUS_MAX_PACKET_BYTES, max_bytes, payload_len + 1);
// 	if (out_len < 1) {
// 		throw new Error(`Computed out_len=${out_len}`);
// 	}
// 	if (st.use_dtx) {
// 		if (decide_dtx_mode(st, activity_probability, st.pcm_buf, frame_size, channels, frame_offset, is_silence)) {
// 			const out = Buffer.alloc(1);
// 			out[0] = toc;
// 			st.rangeFinal = 0;
// 			st.prev_mode = st.mode;
// 			st.prev_framesize = frame_size;
// 			st.prev_channels = st.stream_channels;
// 			st.first = 0;
// 			return out;
// 		}
// 	}
// 	if (!redundancy) {
// 		st.silk_bw_switch = 0;
// 	}
// 	if (!st.use_vbr && max_bytes > out_len) {
// 		if (redundancy_bytes > 0) {
// 			const payload = Buffer.alloc(payload_len);
// 			if (redundancy_header_bytes > 0) {
// 				write_redundancy_header_bits(payload, 0, celt_to_silk, redundancy_bytes, st.mode === MODE_HYBRID);
// 			}
// 			const spectrum_cache = { pcm: st.pcm_buf, offset: frame_offset, frame_size, spectrum: null };
// 			const frame_spectrum = compute_stub_spectrum(st, st.pcm_buf, frame_offset, frame_size, spectrum_cache);
// 			const redundancy_window_size = celt_to_silk
// 				? Math.min(frame_size, Math.trunc(st.Fs / 200))
// 				: frame_size;
// 			encode_stub_payload(
// 				st,
// 				frame_size,
// 				main_payload_bytes,
// 				payload,
// 				redundancy_header_bytes,
// 				0,
// 				st.pcm_buf,
// 				frame_offset,
// 				frame_spectrum,
// 				spectrum_cache
// 			);
// 			if (redundancy_bytes > 0) {
// 				const seed = ((celt_to_silk ? 0x52 : 0x72) << 24) ^ st.stub_seed;
// 				encode_redundancy_payload(
// 					st,
// 					frame_size,
// 					payload,
// 					bytes_target,
// 					redundancy_bytes,
// 					st.pcm_buf,
// 					frame_offset,
// 					seed ^ frame_size ^ st.bandwidth,
// 					frame_spectrum,
// 					redundancy_window_size,
// 					spectrum_cache
// 				);
// 			}
// 			const out = build_code3_packet(
// 				st,
// 				frame_size,
// 				[payload.length],
// 				toc,
// 				false,
// 				max_bytes,
// 				(outBuf, offset, length) => {
// 					write_payload_from_buffer(payload, outBuf, offset, length);
// 				}
// 			);
// 			const payload_info = parse_code3_cbr_payload(out);
// 			const main_hash = compute_range_hash(out, payload_info.payload_offset, bytes_target);
// 			const redundancy_hash = compute_range_hash(
// 				out,
// 				payload_info.payload_offset + bytes_target,
// 				payload_info.payload_length - bytes_target
// 			);
// 			st.rangeFinal = (main_hash ^ redundancy_hash) >>> 0;
// 			st.prev_mode = st.mode;
// 			st.prev_framesize = frame_size;
// 			st.prev_channels = st.stream_channels;
// 			st.first = 0;
// 			return out;
// 		}
// 		const spectrum_cache: StubSpectrumCache = {
// 			pcm: st.pcm_buf,
// 			offset: frame_offset,
// 			frame_size,
// 			spectrum: null,
// 		};
// 		const frame_spectrum = compute_stub_spectrum(st, st.pcm_buf, frame_offset, frame_size, spectrum_cache);
// 		const out = build_code3_packet(
// 			st,
// 			frame_size,
// 			[payload_len],
// 			toc,
// 			false,
// 			max_bytes,
// 			(outBuf, offset, length, frame_index) => {
// 				encode_stub_payload(
// 					st,
// 					frame_size,
// 					length,
// 					outBuf,
// 					offset,
// 					frame_index,
// 					st.pcm_buf,
// 					frame_offset,
// 					frame_spectrum,
// 					spectrum_cache
// 				);
// 			}
// 		);
// 		st.prev_mode = st.mode;
// 		st.prev_framesize = frame_size;
// 		st.prev_channels = st.stream_channels;
// 		st.first = 0;
// 		return out;
// 	}
// 	const out = Buffer.alloc(out_len);
// 	out[0] = toc;
// 	const payload_offset = 1;
// 	if (redundancy_header_bytes > 0) {
// 		write_redundancy_header_bits(out, payload_offset, celt_to_silk, redundancy_bytes, st.mode === MODE_HYBRID);
// 	}
// 	const redundancy_window_size = celt_to_silk
// 		? Math.min(frame_size, Math.trunc(st.Fs / 200))
// 		: frame_size;
// 	const spectrum_cache = redundancy_bytes > 0
// 		? { pcm: st.pcm_buf, offset: frame_offset, frame_size, spectrum: null }
// 		: null;
// 	const frame_spectrum = redundancy_bytes > 0
// 		? compute_stub_spectrum(st, st.pcm_buf, frame_offset, frame_size, spectrum_cache)
// 		: undefined;
// 	encode_stub_payload(
// 		st,
// 		frame_size,
// 		main_payload_bytes,
// 		out,
// 		payload_offset + redundancy_header_bytes,
// 		0,
// 		st.pcm_buf,
// 		frame_offset,
// 		frame_spectrum,
// 		spectrum_cache
// 	);
// 	if (redundancy_bytes > 0) {
// 		const seed = ((celt_to_silk ? 0x52 : 0x72) << 24) ^ st.stub_seed;
// 		encode_redundancy_payload(
// 			st,
// 			frame_size,
// 			out,
// 			payload_offset + bytes_target,
// 			redundancy_bytes,
// 			st.pcm_buf,
// 			frame_offset,
// 			seed ^ frame_size ^ st.bandwidth,
// 			frame_spectrum,
// 			redundancy_window_size,
// 			spectrum_cache
// 		);
// 		const main_hash = compute_range_hash(out, payload_offset, bytes_target);
// 		const redundancy_hash = compute_range_hash(out, payload_offset + bytes_target, redundancy_bytes);
// 		st.rangeFinal = (main_hash ^ redundancy_hash) >>> 0;
// 	} else {
// 		update_range_final(st, out, payload_offset);
// 	}
// 	st.prev_mode = st.mode;
// 	st.prev_framesize = frame_size;
// 	st.prev_channels = st.stream_channels;
// 	st.first = 0;
// 	return out;
// }

// export function hp_cutoff(
// 	input: Float32Array,
// 	cutoff_Hz: number,
// 	output: Float32Array,
// 	hp_mem: Float32Array,
// 	len: number,
// 	channels: number,
// 	Fs: number,
// 	out_offset: number
// ): void {
// 	const Fc = (1.5 * Math.PI * cutoff_Hz) / Fs;
// 	const r = 1.0 - 0.92 * Fc;
// 	const B0 = r;
// 	const B1 = -2 * r;
// 	const B2 = r;
// 	const A0 = -r * (2 - Fc * Fc);
// 	const A1 = r * r;
// 	silk_biquad_float(input, 0, output, out_offset, hp_mem, 0, B0, B1, B2, A0, A1, len, channels);
// 	if (channels === 2) {
// 		silk_biquad_float(input, 1, output, out_offset + 1, hp_mem, 2, B0, B1, B2, A0, A1, len, channels);
// 	}
// }

// export function dc_reject(
// 	input: Float32Array,
// 	cutoff_Hz: number,
// 	output: Float32Array,
// 	hp_mem: Float32Array,
// 	len: number,
// 	channels: number,
// 	Fs: number,
// 	out_offset: number
// ): void {
// 	const coef = (4.0 * cutoff_Hz) / Fs;
// 	const coef2 = 1 - coef;
// 	if (channels === 2) {
// 		let m0 = hp_mem[0];
// 		let m1 = hp_mem[1];
// 		let m2 = hp_mem[2];
// 		let m3 = hp_mem[3];
// 		for (let i = 0; i < len; i++) {
// 			const x0 = input[2 * i];
// 			const x1 = input[2 * i + 1];
// 			const tmp0 = x0 - m0;
// 			const tmp1 = x1 - m2;
// 			m0 = coef * x0 + VERY_SMALL + coef2 * m0;
// 			m2 = coef * x1 + VERY_SMALL + coef2 * m2;
// 			const y0 = tmp0 - m1;
// 			const y1 = tmp1 - m3;
// 			m1 = coef * tmp0 + VERY_SMALL + coef2 * m1;
// 			m3 = coef * tmp1 + VERY_SMALL + coef2 * m3;
// 			output[out_offset + 2 * i] = y0;
// 			output[out_offset + 2 * i + 1] = y1;
// 		}
// 		hp_mem[0] = m0;
// 		hp_mem[1] = m1;
// 		hp_mem[2] = m2;
// 		hp_mem[3] = m3;
// 	} else {
// 		let m0 = hp_mem[0];
// 		let m1 = hp_mem[1];
// 		for (let i = 0; i < len; i++) {
// 			const x = input[i];
// 			const tmp = x - m0;
// 			m0 = coef * x + VERY_SMALL + coef2 * m0;
// 			const y = tmp - m1;
// 			m1 = coef * tmp + VERY_SMALL + coef2 * m1;
// 			output[out_offset + i] = y;
// 		}
// 		hp_mem[0] = m0;
// 		hp_mem[1] = m1;
// 	}
// }

// function silk_biquad_float(
// 	input: Float32Array,
// 	in_offset: number,
// 	output: Float32Array,
// 	out_offset: number,
// 	state: Float32Array,
// 	state_offset: number,
// 	B0: number,
// 	B1: number,
// 	B2: number,
// 	A0: number,
// 	A1: number,
// 	len: number,
// 	stride: number
// ): void {
// 	let s0 = state[state_offset];
// 	let s1 = state[state_offset + 1];
// 	for (let k = 0; k < len; k++) {
// 		const inval = input[in_offset + k * stride];
// 		const vout = s0 + B0 * inval;
// 		s0 = s1 - vout * A0 + B1 * inval;
// 		s1 = -vout * A1 + B2 * inval + VERY_SMALL;
// 		output[out_offset + k * stride] = vout;
// 	}
// 	state[state_offset] = s0;
// 	state[state_offset + 1] = s1;
// }

// export function downmix_float(
// 	input: Float32Array,
// 	output: Float32Array,
// 	subframe: number,
// 	offset: number,
// 	c1: number,
// 	c2: number,
// 	C: number,
// 	out_offset: number
// ): void {
// 	for (let j = 0; j < subframe; j++) {
// 		output[out_offset + j] = input[(j + offset) * C + c1];
// 	}
// 	if (c2 > -1) {
// 		for (let j = 0; j < subframe; j++) {
// 			output[out_offset + j] += input[(j + offset) * C + c2];
// 		}
// 	} else if (c2 === -2) {
// 		for (let c = 1; c < C; c++) {
// 			for (let j = 0; j < subframe; j++) {
// 				output[out_offset + j] += input[(j + offset) * C + c];
// 			}
// 		}
// 	}
// }

// export function downmix_int(
// 	input: Int16Array,
// 	output: Float32Array,
// 	subframe: number,
// 	offset: number,
// 	c1: number,
// 	c2: number,
// 	C: number,
// 	out_offset: number
// ): void {
// 	for (let j = 0; j < subframe; j++) {
// 		output[out_offset + j] = input[(j + offset) * C + c1];
// 	}
// 	if (c2 > -1) {
// 		for (let j = 0; j < subframe; j++) {
// 			output[out_offset + j] += input[(j + offset) * C + c2];
// 		}
// 	} else if (c2 === -2) {
// 		for (let c = 1; c < C; c++) {
// 			for (let j = 0; j < subframe; j++) {
// 				output[out_offset + j] += input[(j + offset) * C + c];
// 			}
// 		}
// 	}
// }

// export function is_digital_silence(
// 	pcm: Float32Array,
// 	frame_size: number,
// 	channels: number,
// 	lsb_depth: number
// ): boolean {
// 	const total = frame_size * channels;
// 	let sample_max = 0;
// 	for (let i = 0; i < total; i++) {
// 		const v = Math.abs(pcm[i]);
// 		if (v > sample_max) sample_max = v;
// 	}
// 	const threshold = 1 / Math.pow(2, lsb_depth);
// 	return sample_max <= threshold;
// }

// export function compute_frame_energy(
// 	pcm: Float32Array,
// 	frame_size: number,
// 	channels: number,
// 	offset: number
// ): number {
// 	const total = frame_size * channels;
// 	let energy = 0;
// 	for (let i = 0; i < total; i++) {
// 		const v = pcm[offset + i];
// 		energy += v * v;
// 	}
// 	return energy;
// }

// function compute_pcm_seed(pcm: Float32Array, offset: number, total_samples: number): number {
// 	let hash = 2166136261;
// 	const stride = Math.max(1, Math.floor(total_samples / 256));
// 	for (let i = 0; i < total_samples; i += stride) {
// 		const v = Math.trunc(pcm[offset + i] * 32768);
// 		hash ^= v & 0xff;
// 		hash = Math.imul(hash, 16777619);
// 		hash ^= (v >> 8) & 0xff;
// 		hash = Math.imul(hash, 16777619);
// 	}
// 	return hash >>> 0;
// }

// function estimate_activity_probability(energy: number, frame_size: number, channels: number): number {
// 	const mean_energy = energy / (frame_size * channels);
// 	return mean_energy / (mean_energy + 1e-4);
// }

// function estimate_detected_bandwidth(
// 	pcm: Float32Array,
// 	frame_size: number,
// 	channels: number,
// 	offset: number,
// 	Fs: number,
// 	frame_energy: number
// ): number {
// 	const total = frame_size * channels;
// 	let diff_energy = 0;
// 	for (let i = channels; i < total; i++) {
// 		const diff = pcm[offset + i] - pcm[offset + i - channels];
// 		diff_energy += diff * diff;
// 	}
// 	const ratio = diff_energy / (frame_energy + 1e-9);
// 	let bw = OPUS_BANDWIDTH_FULLBAND;
// 	if (ratio < 0.05) bw = OPUS_BANDWIDTH_NARROWBAND;
// 	else if (ratio < 0.1) bw = OPUS_BANDWIDTH_MEDIUMBAND;
// 	else if (ratio < 0.2) bw = OPUS_BANDWIDTH_WIDEBAND;
// 	else if (ratio < 0.35) bw = OPUS_BANDWIDTH_SUPERWIDEBAND;
// 	if (Fs <= 8000) return OPUS_BANDWIDTH_NARROWBAND;
// 	if (Fs <= 12000) return Math.min(bw, OPUS_BANDWIDTH_MEDIUMBAND);
// 	if (Fs <= 16000) return Math.min(bw, OPUS_BANDWIDTH_WIDEBAND);
// 	if (Fs <= 24000) return Math.min(bw, OPUS_BANDWIDTH_SUPERWIDEBAND);
// 	return bw;
// }

// export function compute_stereo_width(
// 	pcm: Float32Array,
// 	frame_size: number,
// 	Fs: number,
// 	mem: StereoWidthState,
// 	offset: number
// ): number {
// 	const frame_rate = Fs / frame_size;
// 	const short_alpha = 1 - 25 / Math.max(50, frame_rate);
// 	let xx = 0;
// 	let xy = 0;
// 	let yy = 0;
// 	for (let i = 0; i < frame_size - 3; i += 4) {
// 		let pxx = 0;
// 		let pxy = 0;
// 		let pyy = 0;
// 		let x = pcm[offset + 2 * i];
// 		let y = pcm[offset + 2 * i + 1];
// 		pxx += x * x * 0.25;
// 		pxy += x * y * 0.25;
// 		pyy += y * y * 0.25;
// 		x = pcm[offset + 2 * i + 2];
// 		y = pcm[offset + 2 * i + 3];
// 		pxx += x * x * 0.25;
// 		pxy += x * y * 0.25;
// 		pyy += y * y * 0.25;
// 		x = pcm[offset + 2 * i + 4];
// 		y = pcm[offset + 2 * i + 5];
// 		pxx += x * x * 0.25;
// 		pxy += x * y * 0.25;
// 		pyy += y * y * 0.25;
// 		x = pcm[offset + 2 * i + 6];
// 		y = pcm[offset + 2 * i + 7];
// 		pxx += x * x * 0.25;
// 		pxy += x * y * 0.25;
// 		pyy += y * y * 0.25;
// 		xx += pxx * 0.0009765625;
// 		xy += pxy * 0.0009765625;
// 		yy += pyy * 0.0009765625;
// 	}
// 	mem.XX += short_alpha * (xx - mem.XX);
// 	mem.XY += short_alpha * (xy - mem.XY);
// 	mem.YY += short_alpha * (yy - mem.YY);
// 	mem.XX = Math.max(0, mem.XX);
// 	mem.XY = Math.max(0, mem.XY);
// 	mem.YY = Math.max(0, mem.YY);
// 	let width = 0;
// 	if (Math.max(mem.XX, mem.YY) > 8e-4) {
// 		const sqrt_xx = Math.sqrt(mem.XX);
// 		const sqrt_yy = Math.sqrt(mem.YY);
// 		const qrrt_xx = Math.sqrt(sqrt_xx);
// 		const qrrt_yy = Math.sqrt(sqrt_yy);
// 		mem.XY = Math.min(mem.XY, sqrt_xx * sqrt_yy);
// 		const corr = mem.XY / (STEREO_WIDTH_EPS + sqrt_xx * sqrt_yy);
// 		const ldiff = Math.abs(qrrt_xx - qrrt_yy) / (STEREO_WIDTH_EPS + qrrt_xx + qrrt_yy);
// 		const corr2 = Math.max(0, 1 - corr * corr);
// 		width = Math.sqrt(corr2) * ldiff;
// 		mem.smoothed_width += (width - mem.smoothed_width) / frame_rate;
// 		mem.max_follower = Math.max(mem.max_follower - 0.02 / frame_rate, mem.smoothed_width);
// 	}
// 	return Math.min(1, 20 * mem.max_follower);
// }

// export function decide_fec(
// 	useInBandFEC: number,
// 	packetLoss_perc: number,
// 	last_fec: number,
// 	mode: number,
// 	bandwidth: number,
// 	rate: number
// ): { fec: number; bandwidth: number } {
// 	if (!useInBandFEC || packetLoss_perc === 0 || mode === MODE_CELT_ONLY) {
// 		return { fec: 0, bandwidth };
// 	}
// 	let bw = bandwidth;
// 	const orig_bandwidth = bw;
// 	for (; ;) {
// 		const idx = 2 * (bw - OPUS_BANDWIDTH_NARROWBAND);
// 		let LBRR_rate_thres_bps = fec_thresholds[idx];
// 		const hysteresis = fec_thresholds[idx + 1];
// 		if (last_fec === 1) LBRR_rate_thres_bps -= hysteresis;
// 		if (last_fec === 0) LBRR_rate_thres_bps += hysteresis;
// 		const loss_scale = 125 - Math.min(packetLoss_perc, 25);
// 		LBRR_rate_thres_bps = Math.trunc((LBRR_rate_thres_bps * loss_scale) / 100);
// 		if (rate > LBRR_rate_thres_bps) return { fec: 1, bandwidth: bw };
// 		if (packetLoss_perc <= 5) return { fec: 0, bandwidth: bw };
// 		if (bw > OPUS_BANDWIDTH_NARROWBAND) {
// 			bw -= 1;
// 		} else {
// 			break;
// 		}
// 	}
// 	return { fec: 0, bandwidth: orig_bandwidth };
// }

// export function compute_silk_rate_for_hybrid(
// 	rate: number,
// 	bandwidth: number,
// 	frame20ms: number,
// 	vbr: number,
// 	fec: number
// ): number {
// 	const rate_table = [
// 		[0, 0, 0, 0, 0],
// 		[12000, 10000, 10000, 11000, 11000],
// 		[16000, 13500, 13500, 15000, 15000],
// 		[20000, 16000, 16000, 18000, 18000],
// 		[24000, 18000, 18000, 21000, 21000],
// 		[32000, 22000, 22000, 28000, 28000],
// 		[64000, 38000, 38000, 50000, 50000],
// 	];
// 	const entry = 1 + frame20ms + 2 * fec;
// 	let i = 1;
// 	for (; i < rate_table.length; i++) {
// 		if (rate_table[i][0] > rate) break;
// 	}
// 	let silk_rate = 0;
// 	if (i === rate_table.length) {
// 		silk_rate = rate_table[i - 1][entry];
// 		silk_rate += Math.trunc((rate - rate_table[i - 1][0]) / 2);
// 	} else {
// 		const lo = rate_table[i - 1][entry];
// 		const hi = rate_table[i][entry];
// 		const x0 = rate_table[i - 1][0];
// 		const x1 = rate_table[i][0];
// 		silk_rate = Math.trunc((lo * (x1 - rate) + hi * (rate - x0)) / (x1 - x0));
// 	}
// 	if (!vbr) silk_rate += 100;
// 	if (bandwidth === OPUS_BANDWIDTH_SUPERWIDEBAND) silk_rate += 300;
// 	return silk_rate;
// }

// export function compute_equiv_rate(
// 	bitrate: number,
// 	channels: number,
// 	frame_rate: number,
// 	vbr: number,
// 	mode: number,
// 	complexity: number,
// 	loss: number
// ): number {
// 	let equiv = bitrate;
// 	equiv -= (40 * channels + 20) * (frame_rate - 50);
// 	if (!vbr) equiv -= Math.trunc(equiv / 12);
// 	equiv = Math.trunc((equiv * (90 + complexity)) / 100);
// 	if (mode === MODE_SILK_ONLY || mode === MODE_HYBRID) {
// 		if (complexity < 2) equiv = Math.trunc((equiv * 4) / 5);
// 		equiv -= Math.trunc((equiv * loss) / (6 * loss + 10));
// 	} else if (mode === MODE_CELT_ONLY) {
// 		if (complexity < 5) equiv = Math.trunc((equiv * 9) / 10);
// 	} else {
// 		equiv -= Math.trunc((equiv * loss) / (12 * loss + 20));
// 	}
// 	return equiv;
// }

// function compute_voice_est(st: OpusEncoder): number {
// 	if (st.signal_type === OPUS_SIGNAL_VOICE) return 127;
// 	if (st.signal_type === OPUS_SIGNAL_MUSIC) return 0;
// 	if (st.voice_ratio >= 0) {
// 		let voice_est = Math.trunc((st.voice_ratio * 327) / 256);
// 		if (st.application === OPUS_APPLICATION_AUDIO) voice_est = Math.min(voice_est, 115);
// 		return voice_est;
// 	}
// 	if (st.application === OPUS_APPLICATION_VOIP) return 115;
// 	return 48;
// }

// function build_plc_packet(st: OpusEncoder, frame_rate: number, max_bytes: number): Buffer {
// 	let tocmode = st.mode;
// 	let bw = st.bandwidth === 0 ? OPUS_BANDWIDTH_NARROWBAND : st.bandwidth;
// 	let packet_code = 0;
// 	let num_multiframes = 0;
// 	let fr = frame_rate;

// 	if (tocmode === 0) tocmode = MODE_SILK_ONLY;
// 	if (fr > 100) tocmode = MODE_CELT_ONLY;
// 	if (fr === 25 && tocmode !== MODE_SILK_ONLY) {
// 		fr = 50;
// 		packet_code = 1;
// 	}
// 	if (fr <= 16) {
// 		if (max_bytes === 1 || (tocmode === MODE_SILK_ONLY && fr !== 10)) {
// 			tocmode = MODE_SILK_ONLY;
// 			packet_code = fr <= 12 ? 1 : 0;
// 			fr = fr === 12 ? 25 : 16;
// 		} else {
// 			num_multiframes = Math.trunc(50 / fr);
// 			fr = 50;
// 			packet_code = 3;
// 		}
// 	}

// 	if (tocmode === MODE_SILK_ONLY && bw > OPUS_BANDWIDTH_WIDEBAND) bw = OPUS_BANDWIDTH_WIDEBAND;
// 	else if (tocmode === MODE_CELT_ONLY && bw === OPUS_BANDWIDTH_MEDIUMBAND) bw = OPUS_BANDWIDTH_NARROWBAND;
// 	else if (tocmode === MODE_HYBRID && bw <= OPUS_BANDWIDTH_SUPERWIDEBAND) bw = OPUS_BANDWIDTH_SUPERWIDEBAND;

// 	const toc = gen_toc(tocmode, fr, bw, st.stream_channels);
// 	const header_len = packet_code <= 1 ? 1 : 2;
// 	if (!st.use_vbr && max_bytes > header_len) {
// 		const frame_count = packet_code === 1 ? 2 : packet_code === 3 ? num_multiframes : 1;
// 		const frame_size = Math.trunc(st.Fs / fr);
// 		const lengths = new Array(frame_count).fill(0);
// 		const out = build_code3_packet(st, frame_size, lengths, toc, false, max_bytes);
// 		st.rangeFinal = 0;
// 		return out;
// 	}
// 	const out_len = st.use_vbr ? header_len : Math.max(max_bytes, header_len);
// 	const out = Buffer.alloc(out_len);
// 	out[0] = toc | packet_code;
// 	if (packet_code === 3) out[1] = num_multiframes;
// 	st.rangeFinal = 0;
// 	return out;
// }

// function reset_encoder_state(st: OpusEncoder): void {
// 	st.stream_channels = st.channels;
// 	st.hybrid_stereo_width_Q14 = Q14_ONE;
// 	st.prev_HB_gain = 1;
// 	st.first = 1;
// 	st.mode = MODE_HYBRID;
// 	st.bandwidth = OPUS_BANDWIDTH_FULLBAND;
// 	st.variable_HP_smth2_Q15 = lin2log2q8(VARIABLE_HP_MIN_CUTOFF_HZ);
// 	st.prev_mode = 0;
// 	st.prev_channels = 0;
// 	st.prev_framesize = 0;
// 	st.prev_bandwidth = st.bandwidth;
// 	st.auto_bandwidth = 0;
// 	st.silk_bw_switch = 0;
// 	st.nonfinal_frame = 0;
// 	st.rangeFinal = 0;
// 	st.detected_bandwidth = 0;
// 	st.nb_no_activity_frames = 0;
// 	st.peak_signal_energy = 0;
// 	st.last_stereo_width = 0;
// 	st.phase_inversion_disabled = 0;
// 	st.stub_seed = 0;
// 	st.width_mem = createStereoWidthState();
// 	st.hp_mem.fill(0);
// 	st.delay_buffer.fill(0);
// 	st.silk_mode.toMono = 0;
// 	st.silk_mode.LBRR_coded = 0;
// 	st.silk_mode.opusCanSwitch = 0;
// 	st.silk_mode.switchReady = 0;
// 	st.silk_mode.allowBandwidthSwitch = 0;
// 	st.silk_mode.stereoWidth_Q14 = Q14_ONE;
// }

// function decide_dtx_mode(
// 	st: OpusEncoder,
// 	activity_probability: number,
// 	pcm: Float32Array,
// 	frame_size: number,
// 	channels: number,
// 	offset: number,
// 	is_silence: boolean
// ): boolean {
// 	let is_noise = false;
// 	let is_sufficiently_quiet = false;
// 	if (!is_silence) {
// 		is_noise = activity_probability < DTX_ACTIVITY_THRESHOLD;
// 		if (is_noise) {
// 			const noise_energy = compute_frame_energy(pcm, frame_size, channels, offset);
// 			is_sufficiently_quiet = st.peak_signal_energy >= PSEUDO_SNR_THRESHOLD * noise_energy;
// 		}
// 	}

// 	if (is_silence || (is_noise && is_sufficiently_quiet)) {
// 		st.nb_no_activity_frames++;
// 		if (st.nb_no_activity_frames > NB_SPEECH_FRAMES_BEFORE_DTX) {
// 			if (st.nb_no_activity_frames <= NB_SPEECH_FRAMES_BEFORE_DTX + MAX_CONSECUTIVE_DTX) {
// 				return true;
// 			}
// 			st.nb_no_activity_frames = NB_SPEECH_FRAMES_BEFORE_DTX;
// 		}
// 	} else {
// 		st.nb_no_activity_frames = 0;
// 	}
// 	return false;
// }

// function compute_multiframe_layout(st: OpusEncoder, frame_size: number): { frame_size: number; nb_frames: number } {
// 	let enc_frame_size = 0;
// 	if (st.mode === MODE_SILK_ONLY) {
// 		if (frame_size === (2 * st.Fs) / 25) {
// 			enc_frame_size = st.Fs / 25;
// 		} else if (frame_size === (3 * st.Fs) / 25) {
// 			enc_frame_size = (3 * st.Fs) / 50;
// 		} else {
// 			enc_frame_size = st.Fs / 50;
// 		}
// 	} else {
// 		enc_frame_size = st.Fs / 50;
// 	}
// 	const nb_frames = Math.trunc(frame_size / enc_frame_size);
// 	return { frame_size: enc_frame_size, nb_frames };
// }

// function encode_multiframe_packet(
// 	st: OpusEncoder,
// 	full_frame_size: number,
// 	enc_frame_size: number,
// 	nb_frames: number,
// 	max_bytes: number,
// 	pcm_frame: Float32Array,
// 	pcm_offset: number
// ): Buffer {
// 	const vbr = st.use_vbr !== 0;
// 	let packet_code = 3;
// 	if (nb_frames === 2) {
// 		packet_code = vbr ? 2 : 1;
// 	}
// 	const frame_rate = Math.trunc(st.Fs / enc_frame_size);
// 	const toc = gen_toc(st.mode, frame_rate, st.bandwidth, st.stream_channels);
// 	const worst_header = packet_code === 1
// 		? 1
// 		: packet_code === 2
// 			? 3
// 			: vbr
// 				? 2 + 2 * (nb_frames - 1)
// 				: 2;
// 	const total_payload_raw = Math.max(0, Math.floor((st.bitrate_bps * full_frame_size) / (st.Fs * 8)) - 1);
// 	const budget = Math.min(max_bytes - worst_header, total_payload_raw);
// 	const payload_budget = Math.max(0, budget);
// 	let frame_lengths: number[] = [];
// 	if (packet_code === 1) {
// 		const bytes_per_frame = payload_budget >= nb_frames ? Math.max(1, Math.floor(payload_budget / nb_frames)) : 0;
// 		frame_lengths = [bytes_per_frame, bytes_per_frame];
// 	} else if (packet_code === 2) {
// 		const split = split_two_frame_budget(payload_budget);
// 		frame_lengths = [split.first, split.second];
// 	} else if (vbr) {
// 		frame_lengths = allocate_vbr_frame_bytes(nb_frames, payload_budget);
// 	} else {
// 		const bytes_per_frame = payload_budget >= nb_frames ? Math.max(1, Math.floor(payload_budget / nb_frames)) : 0;
// 		frame_lengths = new Array(nb_frames).fill(bytes_per_frame);
// 	}
// 	let header_len = 1;
// 	if (packet_code === 2) {
// 		header_len = 1 + frame_size_bytes(frame_lengths[0]);
// 	} else if (packet_code === 3) {
// 		header_len = 2;
// 		if (vbr) {
// 			for (let i = 0; i < nb_frames - 1; i++) {
// 				header_len += frame_size_bytes(frame_lengths[i]);
// 			}
// 		}
// 	}
// 	const payload_len = frame_lengths.reduce((sum, len) => sum + len, 0);
// 	const out_len = header_len + payload_len;
// 	const samples_per_frame = enc_frame_size * st.channels;
// 	const frame_seeds = new Array(nb_frames);
// 	const spectrum_cache: StubSpectrumCache = {
// 		pcm: pcm_frame,
// 		offset: pcm_offset,
// 		frame_size: enc_frame_size,
// 		spectrum: null,
// 	};
// 	const frame_spectra = new Array<StubSpectrum>(nb_frames);
// 	for (let i = 0; i < nb_frames; i++) {
// 		const sub_offset = pcm_offset + i * samples_per_frame;
// 		frame_seeds[i] = compute_pcm_seed(pcm_frame, sub_offset, samples_per_frame);
// 		spectrum_cache.offset = sub_offset;
// 		spectrum_cache.frame_size = enc_frame_size;
// 		frame_spectra[i] = compute_stub_spectrum(st, pcm_frame, sub_offset, enc_frame_size, spectrum_cache);
// 	}
// 	if (!vbr && max_bytes > out_len) {
// 		const out = build_code3_packet(
// 			st,
// 			enc_frame_size,
// 			frame_lengths,
// 			toc,
// 			false,
// 			max_bytes,
// 			(outBuf, offset, length, frame_index) => {
// 				st.stub_seed = frame_seeds[frame_index];
// 				encode_stub_payload(
// 					st,
// 					enc_frame_size,
// 					length,
// 					outBuf,
// 					offset,
// 					frame_index,
// 					pcm_frame,
// 					pcm_offset + frame_index * samples_per_frame,
// 					frame_spectra[frame_index]
// 				);
// 			}
// 		);
// 		st.nonfinal_frame = 0;
// 		st.prev_mode = st.mode;
// 		st.prev_framesize = full_frame_size;
// 		st.prev_channels = st.stream_channels;
// 		st.first = 0;
// 		return out;
// 	}
// 	const out = Buffer.alloc(out_len);
// 	out[0] = toc | packet_code;
// 	let offset = 1;
// 	if (packet_code === 2) {
// 		offset += write_frame_size(frame_lengths[0], out, offset);
// 	} else if (packet_code === 3) {
// 		out[1] = (nb_frames & 0x3f) | (vbr ? 0x40 : 0);
// 		offset = 2;
// 		if (vbr) {
// 			for (let i = 0; i < nb_frames - 1; i++) {
// 				offset += write_frame_size(frame_lengths[i], out, offset);
// 			}
// 		}
// 	}
// 	for (let i = 0; i < frame_lengths.length; i++) {
// 		st.nonfinal_frame = i < nb_frames - 1 ? 1 : 0;
// 		const bytes = frame_lengths[i];
// 		st.stub_seed = frame_seeds[i];
// 		encode_stub_payload(
// 			st,
// 			enc_frame_size,
// 			bytes,
// 			out,
// 			offset,
// 			i,
// 			pcm_frame,
// 			pcm_offset + i * samples_per_frame,
// 			frame_spectra[i]
// 		);
// 		offset += bytes;
// 	}
// 	update_range_final(st, out, header_len);
// 	st.nonfinal_frame = 0;
// 	st.prev_mode = st.mode;
// 	st.prev_framesize = full_frame_size;
// 	st.prev_channels = st.stream_channels;
// 	st.first = 0;
// 	return out;
// }

// function frame_size_bytes(length: number): number {
// 	return length < 252 ? 1 : 2;
// }

// function write_frame_size(length: number, out: Buffer, offset: number): number {
// 	if (length < 252) {
// 		out[offset] = length;
// 		return 1;
// 	}
// 	out[offset] = 252 + (length & 3);
// 	out[offset + 1] = length >> 2;
// 	return 2;
// }

// function write_bits(out: Buffer, bit_offset: number, value: number, bits: number): number {
// 	for (let i = bits - 1; i >= 0; i--) {
// 		const bit = (value >> i) & 1;
// 		const byte_index = bit_offset >> 3;
// 		const bit_index = 7 - (bit_offset & 7);
// 		if (bit) out[byte_index] |= 1 << bit_index;
// 		bit_offset++;
// 	}
// 	return bit_offset;
// }

// function write_redundancy_header_bits(
// 	out: Buffer,
// 	byte_offset: number,
// 	celt_to_silk: number,
// 	redundancy_bytes: number,
// 	hybrid: boolean
// ): void {
// 	const header_bytes = hybrid ? 2 : 1;
// 	out.fill(0, byte_offset, byte_offset + header_bytes);
// 	let bit_offset = byte_offset << 3;
// 	bit_offset = write_bits(out, bit_offset, 1, 1);
// 	bit_offset = write_bits(out, bit_offset, celt_to_silk ? 1 : 0, 1);
// 	if (hybrid) {
// 		const length_value = clamp(redundancy_bytes - 2, 0, 255);
// 		write_bits(out, bit_offset, length_value, 8);
// 	}
// }

// function write_padding_length(padding: number, out: Buffer, offset: number): number {
// 	let remaining = padding;
// 	let written = 0;
// 	while (remaining >= 255) {
// 		out[offset + written] = 255;
// 		remaining -= 255;
// 		written++;
// 	}
// 	out[offset + written] = remaining;
// 	return written + 1;
// }

// function build_code3_packet(
// 	st: OpusEncoder,
// 	frame_size: number,
// 	frame_lengths: number[],
// 	toc: number,
// 	vbr: boolean,
// 	target_len?: number,
// 	writePayload: (out: Buffer, offset: number, length: number, frame_index: number) => void = (out, offset, length, frame_index) => {
// 		encode_stub_payload(st, frame_size, length, out, offset, frame_index);
// 	}
// ): Buffer {
// 	const nb_frames = frame_lengths.length;
// 	const lengths = frame_lengths.slice();
// 	let length_bytes = 0;
// 	if (vbr && nb_frames > 1) {
// 		for (let i = 0; i < nb_frames - 1; i++) {
// 			length_bytes += frame_size_bytes(lengths[i]);
// 		}
// 	}
// 	let payload_len = 0;
// 	for (let i = 0; i < nb_frames; i++) payload_len += lengths[i];

// 	let padding = 0;
// 	let pad_len_bytes = 0;
// 	if (target_len !== undefined) {
// 		const base_len = 2 + length_bytes + payload_len;
// 		if (target_len > base_len) {
// 			let extra = target_len - base_len;
// 			if (extra % 256 === 0) {
// 				if (vbr) {
// 					lengths[nb_frames - 1] += 1;
// 					payload_len += 1;
// 					extra -= 1;
// 				} else {
// 					for (let i = 0; i < nb_frames; i++) lengths[i] += 1;
// 					payload_len += nb_frames;
// 					extra -= nb_frames;
// 				}
// 			}
// 			const k = Math.floor((extra - 1) / 256);
// 			const r = extra - 1 - 256 * k;
// 			padding = 255 * k + r;
// 			pad_len_bytes = k + 1;
// 		}
// 	}

// 	const pad_flag = pad_len_bytes > 0;
// 	length_bytes = 0;
// 	if (vbr && nb_frames > 1) {
// 		for (let i = 0; i < nb_frames - 1; i++) {
// 			length_bytes += frame_size_bytes(lengths[i]);
// 		}
// 	}
// 	const header_len = 2 + length_bytes + (pad_flag ? pad_len_bytes : 0);
// 	const out_len = header_len + payload_len + (pad_flag ? padding : 0);
// 	const out = Buffer.alloc(out_len);
// 	out[0] = toc | 3;
// 	out[1] = (nb_frames - 1) | (vbr ? 0x80 : 0) | (pad_flag ? 0x40 : 0);
// 	let offset = 2;
// 	if (vbr && nb_frames > 1) {
// 		for (let i = 0; i < nb_frames - 1; i++) {
// 			offset += write_frame_size(lengths[i], out, offset);
// 		}
// 	}
// 	if (pad_flag) {
// 		offset += write_padding_length(padding, out, offset);
// 	}
// 	for (let i = 0; i < nb_frames; i++) {
// 		st.nonfinal_frame = i < nb_frames - 1 ? 1 : 0;
// 		writePayload(out, offset, lengths[i], i);
// 		offset += lengths[i];
// 	}
// 	if (pad_flag && padding > 0) {
// 		out.fill(0, offset, offset + padding);
// 	}
// 	update_range_final(st, out, header_len, payload_len);
// 	st.nonfinal_frame = 0;
// 	return out;
// }

// function write_payload_from_buffer(payload: Buffer, out: Buffer, offset: number, length: number): void {
// 	const copy_len = Math.min(payload.length, length);
// 	out.set(payload.subarray(0, copy_len), offset);
// 	if (copy_len < length) out.fill(0, offset + copy_len, offset + length);
// }

// function parse_code3_cbr_payload(out: Buffer): { payload_offset: number; payload_length: number } {
// 	let offset = 2;
// 	let padding_length = 0;
// 	if (out[1] & 0x40) {
// 		for (; ;) {
// 			const v = out[offset];
// 			padding_length += v;
// 			offset++;
// 			if (v < 255) break;
// 		}
// 	}
// 	const payload_offset = offset;
// 	const payload_length = out.length - payload_offset - padding_length;
// 	return { payload_offset, payload_length };
// }

// function split_two_frame_budget(budget: number): { first: number; second: number } {
// 	if (budget <= 0) return { first: 0, second: 0 };
// 	if (budget === 1) return { first: 1, second: 0 };
// 	const first = Math.max(1, Math.floor((budget * 5) / 8));
// 	const second = Math.max(1, budget - first);
// 	return { first, second };
// }

// function allocate_vbr_frame_bytes(nb_frames: number, budget: number): number[] {
// 	const lengths = new Array(nb_frames).fill(0);
// 	if (budget <= 0) return lengths;
// 	const base = Math.floor(budget / nb_frames);
// 	if (base === 0) {
// 		for (let i = 0; i < budget; i++) {
// 			lengths[i] = 1;
// 		}
// 		return lengths;
// 	}
// 	for (let i = 0; i < nb_frames; i++) {
// 		lengths[i] = base;
// 	}
// 	let remaining = budget - base * nb_frames;
// 	for (let i = 0; i < remaining; i++) {
// 		lengths[i] += 1;
// 	}
// 	return lengths;
// }

// function build_two_frame_vbr_packet(
// 	st: OpusEncoder,
// 	frame_size: number,
// 	max_bytes: number,
// 	pcm_frame: Float32Array,
// 	pcm_offset: number
// ): Buffer {
// 	const packet_code = 2;
// 	const frame_rate = Math.trunc(st.Fs / frame_size);
// 	const toc = gen_toc(st.mode, frame_rate, st.bandwidth, st.stream_channels);
// 	const worst_header = 3;
// 	const total_payload = Math.max(0, Math.floor((st.bitrate_bps * frame_size) / (st.Fs * 8)) - 1);
// 	const budget = Math.min(max_bytes - worst_header, total_payload);
// 	const payload_budget = Math.max(0, budget);
// 	const split = split_two_frame_budget(payload_budget);
// 	const header_len = 1 + frame_size_bytes(split.first);
// 	const out_len = header_len + split.first + split.second;
// 	const subframe_size = Math.trunc(frame_size / 2);
// 	const samples_per_subframe = subframe_size * st.channels;
// 	const first_seed = compute_pcm_seed(pcm_frame, pcm_offset, samples_per_subframe);
// 	const second_seed = compute_pcm_seed(pcm_frame, pcm_offset + samples_per_subframe, samples_per_subframe);
// 	const spectrum_cache: StubSpectrumCache = {
// 		pcm: pcm_frame,
// 		offset: pcm_offset,
// 		frame_size: subframe_size,
// 		spectrum: null,
// 	};
// 	const first_spectrum = compute_stub_spectrum(st, pcm_frame, pcm_offset, subframe_size, spectrum_cache);
// 	spectrum_cache.offset = pcm_offset + samples_per_subframe;
// 	spectrum_cache.frame_size = subframe_size;
// 	const second_spectrum = compute_stub_spectrum(st, pcm_frame, pcm_offset + samples_per_subframe, subframe_size, spectrum_cache);
// 	const out = Buffer.alloc(out_len);
// 	out[0] = toc | packet_code;
// 	let offset = 1;
// 	offset += write_frame_size(split.first, out, offset);
// 	st.stub_seed = first_seed;
// 	encode_stub_payload(
// 		st,
// 		subframe_size,
// 		split.first,
// 		out,
// 		offset,
// 		0,
// 		pcm_frame,
// 		pcm_offset,
// 		first_spectrum
// 	);
// 	offset += split.first;
// 	st.stub_seed = second_seed;
// 	encode_stub_payload(
// 		st,
// 		subframe_size,
// 		split.second,
// 		out,
// 		offset,
// 		1,
// 		pcm_frame,
// 		pcm_offset + samples_per_subframe,
// 		second_spectrum
// 	);
// 	update_range_final(st, out, header_len);
// 	st.prev_mode = st.mode;
// 	st.prev_framesize = frame_size;
// 	st.prev_channels = st.stream_channels;
// 	st.first = 0;
// 	return out;
// }

// function bandwidth_to_hz(bandwidth: number): number {
// 	switch (bandwidth) {
// 		case OPUS_BANDWIDTH_NARROWBAND:
// 			return 4000;
// 		case OPUS_BANDWIDTH_MEDIUMBAND:
// 			return 6000;
// 		case OPUS_BANDWIDTH_WIDEBAND:
// 			return 8000;
// 		case OPUS_BANDWIDTH_SUPERWIDEBAND:
// 			return 12000;
// 		case OPUS_BANDWIDTH_FULLBAND:
// 			return 20000;
// 		default:
// 			return 20000;
// 	}
// }

// function get_silk_band_hz(st: OpusEncoder): number {
// 	const bw_hz = bandwidth_to_hz(st.bandwidth);
// 	if (st.mode === MODE_HYBRID) {
// 		return Math.min(8000, bw_hz);
// 	}
// 	return bw_hz;
// }

// function compute_stub_spectrum(
// 	st: OpusEncoder,
// 	pcm: Float32Array,
// 	pcm_offset: number,
// 	frame_size: number,
// 	cache?: StubSpectrumCache | null
// ): StubSpectrum {
// 	if (cache && cache.pcm === pcm && cache.offset === pcm_offset && cache.frame_size === frame_size && cache.spectrum) {
// 		return cache.spectrum;
// 	}
// 	const fftSize = Math.max(ANALYSIS_MIN_FFT, nextPow2(frame_size));
// 	ensureAnalysisState(st.analysis, fftSize);
// 	const re = st.analysis.re;
// 	const im = st.analysis.im;
// 	const window = st.analysis.window;
// 	const channels = st.channels;
// 	const stride = channels;
// 	for (let i = 0; i < fftSize; i++) {
// 		let sample = 0;
// 		if (i < frame_size) {
// 			const base = pcm_offset + i * stride;
// 			if (channels === 1) {
// 				sample = pcm[base];
// 			} else {
// 				sample = 0.5 * (pcm[base] + pcm[base + 1]);
// 			}
// 		}
// 		re[i] = sample * window[i];
// 		im[i] = 0;
// 	}
// 	st.analysis.fft.forward(re, im);
// 	const half = fftSize >>> 1;
// 	let sum = 0;
// 	re[0] = 0;
// 	for (let i = 1; i <= half; i++) {
// 		const r = re[i];
// 		const iv = im[i];
// 		const mag2 = r * r + iv * iv;
// 		im[i] = mag2;
// 		sum += mag2;
// 		re[i] = sum;
// 	}
// 	const spectrum = { fftSize, half, prefix: re, inv_total: 1 / (sum + ANALYSIS_EPS) };
// 	if (cache) {
// 		cache.pcm = pcm;
// 		cache.offset = pcm_offset;
// 		cache.frame_size = frame_size;
// 		cache.spectrum = spectrum;
// 	}
// 	return spectrum;
// }

// function write_spectral_bytes(
// 	prefix: Float64Array,
// 	inv_total: number,
// 	out: Buffer,
// 	out_offset: number,
// 	length: number,
// 	start_bin: number,
// 	end_bin: number,
// 	seed: number
// ): number {
// 	const use_log = STUB_SPECTRAL_LOG_MAPPING;
// 	let log_start = 0;
// 	let log_span = 0;
// 	let bin_count = 0;
// 	if (use_log) {
// 		const log_end = Math.log(end_bin + 1);
// 		log_start = Math.log(start_bin);
// 		log_span = log_end - log_start;
// 	} else {
// 		bin_count = end_bin - start_bin + 1;
// 	}
// 	let prng = seed | 0;
// 	for (let i = 0; i < length; i++) {
// 		let b0 = 0;
// 		let b1 = 0;
// 		if (use_log) {
// 			const f0 = i / length;
// 			const f1 = (i + 1) / length;
// 			const edge0 = Math.exp(log_start + f0 * log_span);
// 			const edge1 = Math.exp(log_start + f1 * log_span);
// 			b0 = clamp(Math.floor(edge0), start_bin, end_bin);
// 			b1 = clamp(Math.floor(edge1) - 1, b0, end_bin);
// 		} else {
// 			b0 = clamp(start_bin + Math.floor((i * bin_count) / length), start_bin, end_bin);
// 			b1 = clamp(start_bin + Math.floor(((i + 1) * bin_count) / length) - 1, b0, end_bin);
// 		}
// 		const end = b1 >= b0 ? b1 : b0;
// 		const energy = prefix[end] - prefix[b0 - 1];
// 		const ratio = energy * inv_total;
// 		const shaped = Math.sqrt(ratio);
// 		prng = (Math.imul(prng, 1664525) + 1013904223) | 0;
// 		const dither = ((prng >>> 29) & 0x7) - 3;
// 		out[out_offset + i] = clamp(Math.trunc(shaped * 255 + dither), 0, 255);
// 	}
// 	return prng;
// }

// function encode_redundancy_payload(
// 	st: OpusEncoder,
// 	frame_size: number,
// 	out: Buffer,
// 	offset: number,
// 	length: number,
// 	pcm?: Float32Array,
// 	pcm_offset = 0,
// 	seed = 0,
// 	spectrum?: StubSpectrum,
// 	redundancy_window_size = frame_size,
// 	cache?: StubSpectrumCache | null
// ): void {
// 	if (!pcm) {
// 		fill_stub_payload(out, offset, length, seed);
// 		return;
// 	}
// 	const window_size = Math.min(frame_size, redundancy_window_size);
// 	const needed_fft = Math.max(ANALYSIS_MIN_FFT, nextPow2(window_size));
// 	const spec = spectrum && spectrum.fftSize === needed_fft
// 		? spectrum
// 		: compute_stub_spectrum(st, pcm, pcm_offset, window_size, cache);
// 	const max_bin = clamp(Math.trunc((bandwidth_to_hz(st.bandwidth) * spec.fftSize) / st.Fs), 1, spec.half);
// 	const silk_bin = clamp(Math.trunc((get_silk_band_hz(st) * spec.fftSize) / st.Fs), 1, max_bin);
// 	write_spectral_bytes(spec.prefix, spec.inv_total, out, offset, length, 1, silk_bin, seed);
// }

// function encode_stub_payload(
// 	st: OpusEncoder,
// 	frame_size: number,
// 	bytes_target: number,
// 	out: Buffer,
// 	offset: number,
// 	frame_index: number,
// 	pcm?: Float32Array,
// 	pcm_offset = 0,
// 	spectrum?: StubSpectrum,
// 	cache?: StubSpectrumCache | null
// ): void {
// 	const split = split_stub_bytes(st, frame_size, bytes_target);
// 	const base_seed = st.stub_seed | 0;
// 	if (!pcm) {
// 		if (split.silk_bytes > 0) {
// 			fill_stub_payload(out, offset, split.silk_bytes, base_seed ^ (0x53 << 24) ^ (st.mode << 16) ^ frame_index);
// 		}
// 		if (split.celt_bytes > 0) {
// 			fill_stub_payload(
// 				out,
// 				offset + split.silk_bytes,
// 				split.celt_bytes,
// 				base_seed ^ (0x43 << 24) ^ (st.bandwidth << 8) ^ frame_index
// 			);
// 		}
// 		return;
// 	}

// 	const spec = spectrum ?? compute_stub_spectrum(st, pcm, pcm_offset, frame_size, cache);
// 	const max_bin = clamp(Math.trunc((bandwidth_to_hz(st.bandwidth) * spec.fftSize) / st.Fs), 1, spec.half);
// 	let split_bin = clamp(Math.trunc((get_silk_band_hz(st) * spec.fftSize) / st.Fs), 1, max_bin);
// 	if (split.silk_bytes === 0) split_bin = 0;
// 	else if (split.celt_bytes === 0) split_bin = max_bin;
// 	let seed = base_seed ^ Math.imul(frame_index + 1, 0x9e3779b9);
// 	if (split.silk_bytes > 0) {
// 		seed = write_spectral_bytes(
// 			spec.prefix,
// 			spec.inv_total,
// 			out,
// 			offset,
// 			split.silk_bytes,
// 			1,
// 			split_bin,
// 			seed ^ 0x53
// 		);
// 	}
// 	if (split.celt_bytes > 0) {
// 		const start_bin = clamp(split_bin + 1, 1, max_bin);
// 		write_spectral_bytes(
// 			spec.prefix,
// 			spec.inv_total,
// 			out,
// 			offset + split.silk_bytes,
// 			split.celt_bytes,
// 			start_bin,
// 			max_bin,
// 			seed ^ 0x43
// 		);
// 	}
// }

// function update_silk_mode_control(
// 	st: OpusEncoder,
// 	frame_size: number,
// 	frame_rate: number,
// 	max_bytes: number,
// 	bytes_target: number,
// 	max_rate: number
// ): void {
// 	const redundancy_bytes = compute_redundancy_bytes(st, max_bytes, frame_size);
// 	const curr_bandwidth = st.bandwidth;
// 	const total_bitRate = 8 * bytes_target * frame_rate;
// 	if (st.mode === MODE_HYBRID) {
// 		st.silk_mode.bitRate = compute_silk_rate_for_hybrid(
// 			total_bitRate,
// 			curr_bandwidth,
// 			st.Fs === 50 * frame_size ? 1 : 0,
// 			st.use_vbr,
// 			st.silk_mode.LBRR_coded
// 		);
// 	} else {
// 		st.silk_mode.bitRate = total_bitRate;
// 	}
// 	if (st.energy_masking && st.use_vbr && !st.lfe && st.mode !== MODE_CELT_ONLY) {
// 		st.silk_mode.bitRate += compute_energy_masking_rate_offset(st);
// 	}

// 	st.silk_mode.payloadSize_ms = Math.trunc((1000 * frame_size) / st.Fs);
// 	st.silk_mode.nChannelsAPI = st.channels;
// 	st.silk_mode.nChannelsInternal = st.stream_channels;

// 	if (curr_bandwidth === OPUS_BANDWIDTH_NARROWBAND) {
// 		st.silk_mode.desiredInternalSampleRate = 8000;
// 	} else if (curr_bandwidth === OPUS_BANDWIDTH_MEDIUMBAND) {
// 		st.silk_mode.desiredInternalSampleRate = 12000;
// 	} else {
// 		st.silk_mode.desiredInternalSampleRate = 16000;
// 	}

// 	if (st.mode === MODE_HYBRID) {
// 		st.silk_mode.minInternalSampleRate = 16000;
// 	} else {
// 		st.silk_mode.minInternalSampleRate = 8000;
// 	}
// 	st.silk_mode.maxInternalSampleRate = 16000;

// 	if (st.mode === MODE_SILK_ONLY) {
// 		let effective_max_rate = max_rate;
// 		if (frame_rate > 50) {
// 			effective_max_rate = Math.trunc((effective_max_rate * 2) / 3);
// 		}
// 		if (effective_max_rate < 8000) {
// 			st.silk_mode.maxInternalSampleRate = 12000;
// 			st.silk_mode.desiredInternalSampleRate = Math.min(12000, st.silk_mode.desiredInternalSampleRate);
// 		}
// 		if (effective_max_rate < 7000) {
// 			st.silk_mode.maxInternalSampleRate = 8000;
// 			st.silk_mode.desiredInternalSampleRate = Math.min(8000, st.silk_mode.desiredInternalSampleRate);
// 		}
// 	}

// 	st.silk_mode.useCBR = st.use_vbr ? 0 : 1;
// 	st.silk_mode.maxBits = (max_bytes - 1) * 8;
// 	if (st.silk_mode.useCBR && st.mode === MODE_HYBRID) {
// 		const maxBits = Math.trunc((st.silk_mode.bitRate * frame_size) / st.Fs);
// 		st.silk_mode.maxBits = Math.min(st.silk_mode.maxBits, maxBits);
// 	} else if (!st.silk_mode.useCBR && st.mode === MODE_HYBRID) {
// 		const maxBitRate = compute_silk_rate_for_hybrid(
// 			Math.trunc((st.silk_mode.maxBits * st.Fs) / frame_size),
// 			curr_bandwidth,
// 			st.Fs === 50 * frame_size ? 1 : 0,
// 			st.use_vbr,
// 			st.silk_mode.LBRR_coded
// 		);
// 		st.silk_mode.maxBits = Math.trunc((maxBitRate * frame_size) / st.Fs);
// 	}
// 	if (st.silk_mode.LBRR_coded && redundancy_bytes >= 2) {
// 		st.silk_mode.maxBits -= redundancy_bytes * 8 + 1;
// 		if (st.mode === MODE_HYBRID) st.silk_mode.maxBits -= 20;
// 	}
// }

// function compute_hb_gain(st: OpusEncoder, frame_rate: number, bytes_target: number): number {
// 	if (st.mode !== MODE_HYBRID || st.energy_masking) {
// 		return 1;
// 	}
// 	const total_bit_rate = 8 * bytes_target * frame_rate;
// 	const celt_rate = total_bit_rate - st.silk_mode.bitRate;
// 	if (celt_rate <= 0) return 1;
// 	const exp2 = Math.pow(2, -celt_rate / 1024);
// 	return 1 - 0.5 * exp2;
// }

// function compute_redundancy_bytes(st: OpusEncoder, max_bytes: number, frame_size: number): number {
// 	let redundancy_bytes = Math.trunc((max_bytes * (st.Fs / 200)) / (frame_size + st.Fs / 200));
// 	if (redundancy_bytes > 257) redundancy_bytes = 257;
// 	if (st.use_vbr) {
// 		const rate_limit = Math.trunc(st.bitrate_bps / 1600);
// 		if (redundancy_bytes > rate_limit) redundancy_bytes = rate_limit;
// 	}
// 	return redundancy_bytes;
// }

// function split_stub_bytes(
// 	st: OpusEncoder,
// 	frame_size: number,
// 	bytes_target: number
// ): { silk_bytes: number; celt_bytes: number } {
// 	if (st.mode === MODE_CELT_ONLY) {
// 		return { silk_bytes: 0, celt_bytes: bytes_target };
// 	}
// 	if (st.mode === MODE_SILK_ONLY) {
// 		return { silk_bytes: bytes_target, celt_bytes: 0 };
// 	}
// 	const frame_rate = Math.trunc(st.Fs / frame_size);
// 	const total_bit_rate = 8 * bytes_target * frame_rate;
// 	const silk_rate = compute_silk_rate_for_hybrid(
// 		total_bit_rate,
// 		st.bandwidth,
// 		st.Fs === 50 * frame_size ? 1 : 0,
// 		st.use_vbr,
// 		st.silk_mode.LBRR_coded
// 	);
// 	const silk_bytes = Math.min(bytes_target, Math.max(0, Math.floor((silk_rate * frame_size) / (st.Fs * 8))));
// 	return { silk_bytes, celt_bytes: bytes_target - silk_bytes };
// }

// function compute_energy_masking_rate_offset(st: OpusEncoder): number {
// 	const masking = st.energy_masking as Float32Array;
// 	let end = 17;
// 	let srate = 16000;
// 	if (st.bandwidth === OPUS_BANDWIDTH_NARROWBAND) {
// 		end = 13;
// 		srate = 8000;
// 	} else if (st.bandwidth === OPUS_BANDWIDTH_MEDIUMBAND) {
// 		end = 15;
// 		srate = 12000;
// 	}

// 	let mask_sum = 0;
// 	for (let c = 0; c < st.channels; c++) {
// 		const base = 21 * c;
// 		for (let i = 0; i < end; i++) {
// 			let mask = clamp(masking[base + i], -2, 0.5);
// 			if (mask > 0) mask *= 0.5;
// 			mask_sum += mask;
// 		}
// 	}

// 	const masking_depth = mask_sum / (end * st.channels) + 0.2;
// 	let rate_offset = srate * masking_depth;
// 	const min_offset = (-2 * st.silk_mode.bitRate) / 3;
// 	if (rate_offset < min_offset) rate_offset = min_offset;
// 	if (st.bandwidth === OPUS_BANDWIDTH_SUPERWIDEBAND || st.bandwidth === OPUS_BANDWIDTH_FULLBAND) {
// 		rate_offset = (3 * rate_offset) / 5;
// 	}
// 	return rate_offset;
// }

// function fill_stub_payload(out: Buffer, offset: number, length: number, seed: number): void {
// 	let x = seed | 0;
// 	for (let i = 0; i < length; i++) {
// 		x = (Math.imul(x, 1664525) + 1013904223) | 0;
// 		out[offset + i] = x & 0xff;
// 	}
// }

// function compute_range_hash(packet: Buffer, payload_offset: number, payload_length: number): number {
// 	const end = payload_offset + payload_length;
// 	let hash = 2166136261;
// 	for (let i = payload_offset; i < end; i++) {
// 		hash ^= packet[i];
// 		hash = Math.imul(hash, 16777619);
// 	}
// 	return hash >>> 0;
// }

// function update_range_final(st: OpusEncoder, packet: Buffer, payload_offset: number, payload_length?: number): void {
// 	const length = payload_length === undefined ? packet.length - payload_offset : payload_length;
// 	st.rangeFinal = compute_range_hash(packet, payload_offset, length);
// }

// function gain_fade(
// 	input: Float32Array,
// 	in_offset: number,
// 	output: Float32Array,
// 	out_offset: number,
// 	g1: number,
// 	g2: number,
// 	overlap48: number,
// 	frame_size: number,
// 	channels: number,
// 	window48: Float32Array,
// 	Fs: number
// ): void {
// 	const inc = Math.trunc(48000 / Fs);
// 	const overlap = Math.trunc(overlap48 / inc);
// 	if (channels === 1) {
// 		for (let i = 0; i < overlap; i++) {
// 			const w = window48[i * inc];
// 			const w2 = w * w;
// 			const g = w2 * g2 + (1 - w2) * g1;
// 			output[out_offset + i] = g * input[in_offset + i];
// 		}
// 		for (let i = overlap; i < frame_size; i++) {
// 			output[out_offset + i] = g2 * input[in_offset + i];
// 		}
// 	} else {
// 		for (let i = 0; i < overlap; i++) {
// 			const w = window48[i * inc];
// 			const w2 = w * w;
// 			const g = w2 * g2 + (1 - w2) * g1;
// 			const base = i * channels;
// 			output[out_offset + base] = g * input[in_offset + base];
// 			output[out_offset + base + 1] = g * input[in_offset + base + 1];
// 		}
// 		for (let i = overlap; i < frame_size; i++) {
// 			const base = i * channels;
// 			output[out_offset + base] = g2 * input[in_offset + base];
// 			output[out_offset + base + 1] = g2 * input[in_offset + base + 1];
// 		}
// 	}
// }

// function stereo_fade(
// 	input: Float32Array,
// 	in_offset: number,
// 	output: Float32Array,
// 	out_offset: number,
// 	g1: number,
// 	g2: number,
// 	overlap48: number,
// 	frame_size: number,
// 	channels: number,
// 	window48: Float32Array,
// 	Fs: number
// ): void {
// 	const inc = Math.trunc(48000 / Fs);
// 	const overlap = Math.trunc(overlap48 / inc);
// 	const g1r = 1 - g1;
// 	const g2r = 1 - g2;
// 	for (let i = 0; i < overlap; i++) {
// 		const w = window48[i * inc];
// 		const w2 = w * w;
// 		const g = w2 * g2r + (1 - w2) * g1r;
// 		const base = i * channels;
// 		const diff = (input[in_offset + base] - input[in_offset + base + 1]) * 0.5;
// 		const d = g * diff;
// 		output[out_offset + base] = output[out_offset + base] - d;
// 		output[out_offset + base + 1] = output[out_offset + base + 1] + d;
// 	}
// 	for (let i = overlap; i < frame_size; i++) {
// 		const base = i * channels;
// 		const diff = (input[in_offset + base] - input[in_offset + base + 1]) * 0.5;
// 		const d = g2r * diff;
// 		output[out_offset + base] = output[out_offset + base] - d;
// 		output[out_offset + base + 1] = output[out_offset + base + 1] + d;
// 	}
// }

// function getFadeWindow48(overlap48: number): Float32Array {
// 	let window = fade_window_48;
// 	if (window.length !== overlap48) {
// 		window = createFadeWindow(overlap48);
// 		fade_window_48 = window;
// 	}
// 	return window;
// }

// let fade_window_48 = createFadeWindow(DEFAULT_OVERLAP_48);

// function createFadeWindow(length: number): Float32Array {
// 	const window = new Float32Array(length);
// 	for (let i = 0; i < length; i++) {
// 		const x = Math.sin(((i + 0.5) * Math.PI) / (2 * length));
// 		window[i] = x;
// 	}
// 	return window;
// }
