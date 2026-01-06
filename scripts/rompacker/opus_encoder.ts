export type opus_int32 = number;
export type opus_uint32 = number;
export type opus_int16 = number;
export type opus_val16 = number;
export type opus_val32 = number;

export const MAX_ENCODER_BUFFER = 480;
export const PSEUDO_SNR_THRESHOLD = 316.23;

export const OPUS_OK = 0;
export const OPUS_BAD_ARG = -1;
export const OPUS_BUFFER_TOO_SMALL = -2;
export const OPUS_INTERNAL_ERROR = -3;
export const OPUS_UNIMPLEMENTED = -5;
export const OPUS_ALLOC_FAIL = -7;

export const OPUS_APPLICATION_VOIP = 2048;
export const OPUS_APPLICATION_AUDIO = 2049;
export const OPUS_APPLICATION_RESTRICTED_LOWDELAY = 2051;

export const OPUS_AUTO = -1000;
export const OPUS_BITRATE_MAX = -1;

export const OPUS_BANDWIDTH_NARROWBAND = 1101;
export const OPUS_BANDWIDTH_MEDIUMBAND = 1102;
export const OPUS_BANDWIDTH_WIDEBAND = 1103;
export const OPUS_BANDWIDTH_SUPERWIDEBAND = 1104;
export const OPUS_BANDWIDTH_FULLBAND = 1105;

export const OPUS_FRAMESIZE_ARG = 5000;
export const OPUS_FRAMESIZE_2_5_MS = 5001;
export const OPUS_FRAMESIZE_5_MS = 5002;
export const OPUS_FRAMESIZE_10_MS = 5003;
export const OPUS_FRAMESIZE_20_MS = 5004;
export const OPUS_FRAMESIZE_40_MS = 5005;
export const OPUS_FRAMESIZE_60_MS = 5006;
export const OPUS_FRAMESIZE_80_MS = 5007;
export const OPUS_FRAMESIZE_100_MS = 5008;
export const OPUS_FRAMESIZE_120_MS = 5009;

export const OPUS_SIGNAL_VOICE = 3001;
export const OPUS_SIGNAL_MUSIC = 3002;

export const MODE_SILK_ONLY = 1000;
export const MODE_HYBRID = 1001;
export const MODE_CELT_ONLY = 1002;

export interface StereoWidthState {
	XX: opus_val32;
	XY: opus_val32;
	YY: opus_val32;
	smoothed_width: opus_val16;
	max_follower: opus_val16;
}

export interface SilkEncControlStruct {
	nChannelsAPI: opus_int32;
	nChannelsInternal: opus_int32;
	API_sampleRate: opus_int32;
	maxInternalSampleRate: opus_int32;
	minInternalSampleRate: opus_int32;
	desiredInternalSampleRate: opus_int32;
	payloadSize_ms: opus_int32;
	bitRate: opus_int32;
	packetLossPercentage: opus_int32;
	complexity: opus_int32;
	useInBandFEC: opus_int32;
	useDTX: opus_int32;
	useCBR: opus_int32;
	reducedDependency: opus_int32;
	allowBandwidthSwitch: opus_int32;
	inWBmodeWithoutVariableLP: opus_int32;
	toMono: opus_int32;
	LBRR_coded: opus_int32;
	maxBits: opus_int32;
	internalSampleRate: opus_int32;
	opusCanSwitch: opus_int32;
	switchReady: opus_int32;
	stereoWidth_Q14: opus_int32;
	signalType: opus_int32;
	offset: opus_int32;
}

export interface TonalityAnalysisState {}

export class OpusEncoder {
	celt_enc_offset = 0;
	silk_enc_offset = 0;
	silk_mode: SilkEncControlStruct;
	application = OPUS_APPLICATION_AUDIO;
	channels = 1;
	delay_compensation = 0;
	force_channels = OPUS_AUTO;
	signal_type = OPUS_AUTO;
	user_bandwidth = OPUS_AUTO;
	max_bandwidth = OPUS_BANDWIDTH_FULLBAND;
	user_forced_mode = OPUS_AUTO;
	voice_ratio = -1;
	Fs = 48000;
	use_vbr = 1;
	vbr_constraint = 1;
	variable_duration = OPUS_FRAMESIZE_ARG;
	bitrate_bps = 0;
	user_bitrate_bps = OPUS_AUTO;
	lsb_depth = 24;
	encoder_buffer = 0;
	lfe = 0;
	arch = 0;
	use_dtx = 0;
	analysis: TonalityAnalysisState;
	stream_channels = 1;
	hybrid_stereo_width_Q14 = 0;
	variable_HP_smth2_Q15 = 0;
	prev_HB_gain = 0;
	hp_mem: Float32Array;
	mode = MODE_HYBRID;
	prev_mode = 0;
	prev_channels = 0;
	prev_framesize = 0;
	bandwidth = OPUS_BANDWIDTH_FULLBAND;
	auto_bandwidth = 0;
	silk_bw_switch = 0;
	first = 1;
	energy_masking: Float32Array | null = null;
	width_mem: StereoWidthState;
	delay_buffer: Float32Array;
	detected_bandwidth = 0;
	nb_no_activity_frames = 0;
	peak_signal_energy = 0;
	nonfinal_frame = 0;
	rangeFinal = 0;

	constructor() {
		this.silk_mode = createSilkEncControlStruct();
		this.analysis = createTonalityAnalysisState();
		this.width_mem = createStereoWidthState();
		this.hp_mem = new Float32Array(4);
		this.delay_buffer = new Float32Array(MAX_ENCODER_BUFFER * 2);
	}
}

export const mono_voice_bandwidth_thresholds = new Int32Array([
	10000, 1000,
	11000, 1000,
	13500, 1000,
	14000, 2000,
]);

export const mono_music_bandwidth_thresholds = new Int32Array([
	10000, 1000,
	11000, 1000,
	13500, 1000,
	14000, 2000,
]);

export const stereo_voice_bandwidth_thresholds = new Int32Array([
	10000, 1000,
	11000, 1000,
	13500, 1000,
	14000, 2000,
]);

export const stereo_music_bandwidth_thresholds = new Int32Array([
	10000, 1000,
	11000, 1000,
	13500, 1000,
	14000, 2000,
]);

export const stereo_voice_threshold = 24000;
export const stereo_music_threshold = 24000;

export const mode_thresholds = [
	[64000, 16000],
	[36000, 16000],
];

export const fec_thresholds = new Int32Array([
	12000, 1000,
	14000, 1000,
	16000, 1000,
	20000, 1000,
	22000, 1000,
]);

export function opus_encoder_create(Fs: opus_int32, channels: number, application: number): OpusEncoder {
	const st = new OpusEncoder();
	opus_encoder_init(st, Fs, channels, application);
	return st;
}

export function opus_encoder_init(st: OpusEncoder, Fs: opus_int32, channels: number, application: number): void {
	st.Fs = Fs;
	st.channels = channels;
	st.stream_channels = channels;
	st.application = application;

	st.use_vbr = 1;
	st.vbr_constraint = 1;
	st.user_bitrate_bps = OPUS_AUTO;
	st.bitrate_bps = 3000 + Fs * channels;
	st.signal_type = OPUS_AUTO;
	st.user_bandwidth = OPUS_AUTO;
	st.max_bandwidth = OPUS_BANDWIDTH_FULLBAND;
	st.force_channels = OPUS_AUTO;
	st.user_forced_mode = OPUS_AUTO;
	st.voice_ratio = -1;
	st.encoder_buffer = Math.trunc(Fs / 100);
	st.lsb_depth = 24;
	st.variable_duration = OPUS_FRAMESIZE_ARG;
	st.delay_compensation = Math.trunc(Fs / 250);
	st.hybrid_stereo_width_Q14 = 1 << 14;
	st.prev_HB_gain = 1;
	st.variable_HP_smth2_Q15 = 0;
	st.first = 1;
	st.mode = MODE_HYBRID;
	st.bandwidth = OPUS_BANDWIDTH_FULLBAND;

	const silk = st.silk_mode;
	silk.nChannelsAPI = channels;
	silk.nChannelsInternal = channels;
	silk.API_sampleRate = st.Fs;
	silk.maxInternalSampleRate = 16000;
	silk.minInternalSampleRate = 8000;
	silk.desiredInternalSampleRate = 16000;
	silk.payloadSize_ms = 20;
	silk.bitRate = 25000;
	silk.packetLossPercentage = 0;
	silk.complexity = 9;
	silk.useInBandFEC = 0;
	silk.useDTX = 0;
	silk.useCBR = 0;
	silk.reducedDependency = 0;
	silk.allowBandwidthSwitch = 0;
	silk.inWBmodeWithoutVariableLP = 0;
	silk.toMono = 0;
	silk.LBRR_coded = 0;
	silk.maxBits = 0;
	silk.internalSampleRate = 0;
	silk.opusCanSwitch = 0;
	silk.switchReady = 0;
	silk.stereoWidth_Q14 = 0;
	silk.signalType = 0;
	silk.offset = 0;

	st.hp_mem.fill(0);
	st.delay_buffer.fill(0);
	st.width_mem = createStereoWidthState();
	st.energy_masking = null;
	st.detected_bandwidth = 0;
	st.nb_no_activity_frames = 0;
	st.peak_signal_energy = 0;
	st.nonfinal_frame = 0;
	st.rangeFinal = 0;
}

function createStereoWidthState(): StereoWidthState {
	return {
		XX: 0,
		XY: 0,
		YY: 0,
		smoothed_width: 0,
		max_follower: 0,
	};
}

function createSilkEncControlStruct(): SilkEncControlStruct {
	return {
		nChannelsAPI: 0,
		nChannelsInternal: 0,
		API_sampleRate: 0,
		maxInternalSampleRate: 0,
		minInternalSampleRate: 0,
		desiredInternalSampleRate: 0,
		payloadSize_ms: 0,
		bitRate: 0,
		packetLossPercentage: 0,
		complexity: 0,
		useInBandFEC: 0,
		useDTX: 0,
		useCBR: 0,
		reducedDependency: 0,
		allowBandwidthSwitch: 0,
		inWBmodeWithoutVariableLP: 0,
		toMono: 0,
		LBRR_coded: 0,
		maxBits: 0,
		internalSampleRate: 0,
		opusCanSwitch: 0,
		switchReady: 0,
		stereoWidth_Q14: 0,
		signalType: 0,
		offset: 0,
	};
}

function createTonalityAnalysisState(): TonalityAnalysisState {
	return {};
}
