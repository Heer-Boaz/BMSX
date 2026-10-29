`timescale 1ns/1ps
// One stereo BADP recurrence: high payload nibble is left, low nibble right.
// The 89 x 15-bit step ROM and two independent shift/add/saturate lanes are
// combinational; the decoder owner registers the resulting frame and indices.
// No multiplier, block cache, memory port or hidden playback state is present.
//
// Book I's header index is a raw BYTE. Preserve all eight selector bits here:
// the manual only supplies ROM entries 0..88, and the existing TS/C++ owners do
// not define a common result outside that range. Direct lookup leaves that
// unresolved boundary visible; it does not preclip, truncate or fabricate ROM
// contents. Qualification therefore covers header indices 0..88. The AFTER-step
// index saturation below is the specified codec operation, not input repair.
//
// Production reference: DuckStation src/core/spu.cpp Voice::DecodeBlock keeps
// codec recurrence/retained samples separate from RAM transfers and playback.
// Its PS1 ADPCM format and block predecode behavior are not imported into BADP.
module apu_badp_step (
    input wire signed [15:0] predictor_l, predictor_r,
    input wire [7:0] step_index_l, step_index_r,
    input wire [7:0] packed_codes,
    output wire signed [15:0] next_predictor_l, next_predictor_r,
    output wire [6:0] next_step_index_l, next_step_index_r
);
    // Least-significant ROM word is index 0. This is the exact Book I table.
    localparam [89*15-1:0] STEP_ROM = {
        15'd32767,15'd29794,15'd27086,15'd24623,15'd22385,15'd20350,
        15'd18500,15'd16818,15'd15289,15'd13899,15'd12635,15'd11487,
        15'd10442,15'd9493,15'd8630,15'd7845,15'd7132,15'd6484,
        15'd5894,15'd5358,15'd4871,15'd4428,15'd4026,15'd3660,
        15'd3327,15'd3024,15'd2749,15'd2499,15'd2272,15'd2066,
        15'd1878,15'd1707,15'd1552,15'd1411,15'd1282,15'd1166,
        15'd1060,15'd963,15'd876,15'd796,15'd724,15'd658,
        15'd598,15'd544,15'd494,15'd449,15'd408,15'd371,
        15'd337,15'd307,15'd279,15'd253,15'd230,15'd209,
        15'd190,15'd173,15'd157,15'd143,15'd130,15'd118,
        15'd107,15'd97,15'd88,15'd80,15'd73,15'd66,
        15'd60,15'd55,15'd50,15'd45,15'd41,15'd37,
        15'd34,15'd31,15'd28,15'd25,15'd23,15'd21,
        15'd19,15'd17,15'd16,15'd14,15'd13,15'd12,
        15'd11,15'd10,15'd9,15'd8,15'd7
    };
    // Signed 5-bit entries, indexed by the low three code bits.
    localparam [8*5-1:0] INDEX_ROM = {
        5'sd8,5'sd6,5'sd4,5'sd2,-5'sd1,-5'sd1,-5'sd1,-5'sd1
    };
    wire [14:0] step_l = STEP_ROM[step_index_l*15+:15];
    wire [14:0] step_r = STEP_ROM[step_index_r*15+:15];
    wire [16:0] wide_step_l = {2'b00,step_l};
    wire [16:0] wide_step_r = {2'b00,step_r};
    wire [16:0] difference_l = (wide_step_l>>3)
        + (packed_codes[6] ? wide_step_l : 17'd0)
        + (packed_codes[5] ? (wide_step_l>>1) : 17'd0)
        + (packed_codes[4] ? (wide_step_l>>2) : 17'd0);
    wire [16:0] difference_r = (wide_step_r>>3)
        + (packed_codes[2] ? wide_step_r : 17'd0)
        + (packed_codes[1] ? (wide_step_r>>1) : 17'd0)
        + (packed_codes[0] ? (wide_step_r>>2) : 17'd0);
    // Difference can reach 61436; predictor +/- difference needs signed 18 bits.
    wire signed [17:0] predicted_l = $signed({{2{predictor_l[15]}},predictor_l})
        + (packed_codes[7] ? -$signed({1'b0,difference_l}) : $signed({1'b0,difference_l}));
    wire signed [17:0] predicted_r = $signed({{2{predictor_r[15]}},predictor_r})
        + (packed_codes[3] ? -$signed({1'b0,difference_r}) : $signed({1'b0,difference_r}));
    wire signed [4:0] index_delta_l = INDEX_ROM[packed_codes[6:4]*5+:5];
    wire signed [4:0] index_delta_r = INDEX_ROM[packed_codes[2:0]*5+:5];
    wire signed [9:0] updated_index_l = $signed({2'b00,step_index_l}) + index_delta_l;
    wire signed [9:0] updated_index_r = $signed({2'b00,step_index_r}) + index_delta_r;

    assign next_predictor_l = predicted_l < -18'sd32768 ? 16'sh8000 :
        predicted_l > 18'sd32767 ? 16'sd32767 : predicted_l[15:0];
    assign next_predictor_r = predicted_r < -18'sd32768 ? 16'sh8000 :
        predicted_r > 18'sd32767 ? 16'sd32767 : predicted_r[15:0];
    assign next_step_index_l = updated_index_l < 0 ? 7'd0 :
        updated_index_l > 10'sd88 ? 7'd88 : updated_index_l[6:0];
    assign next_step_index_r = updated_index_r < 0 ? 7'd0 :
        updated_index_r > 10'sd88 ? 7'd88 : updated_index_r[6:0];
endmodule
