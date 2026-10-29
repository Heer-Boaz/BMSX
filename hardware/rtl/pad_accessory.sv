`timescale 1ns/1ps
// Synthesizable reference accessory: sensor/controls, response staging, SPI
// receiver and actuator are independent owners. The reference sensor supplies
// normalized signed16.16 absolute X/Y (0..1 covers the complete image); the
// standard producer maps and clips before transport. Nonstandard accessories
// may transport raw pointer words with STANDARD_POINTER=0. U7 never clips them.
module pad_accessory #(
    parameter integer CLOCK_HZ = 33868800,
    parameter [15:0] MODEL_ID = 16'h0001,
    parameter [7:0] FEATURES = 8'h03,
    parameter [31:0] CAPABILITY = 32'h00000001,
    parameter STANDARD_POINTER = 1
) (
    input wire clk, reset_n,
    input wire pad_clk, pad_select_n, pad_command,
    output wire pad_data,
    output wire pad_data_oe,
    input wire [223:0] pad_words,
    input wire [127:0] pointer_words,
    output reg request_accepted,
    output reg apply_accepted,
    output reg [31:0] last_apply_tag,
    output reg [31:0] requested_intensity, requested_duration_ms,
    output wire [16:0] motor_level_q16,
    output reg [31:0] remaining_ms,
    output reg context_valid,
    output reg [15:0] display_width, display_height,
    output reg [31:0] display_epoch
);
    import pad_protocol_pkg::*;
    (* async_reg = "true" *) reg clock_meta, clock_sync, select_meta, select_sync;
    (* async_reg = "true" *) reg command_meta, command_sync;
    reg clock_previous, select_previous;
    reg [1:0] reset_release;
    wire select_start = select_previous && !select_sync;
    wire select_end = !select_previous && select_sync;
    wire sample_edge = !clock_previous && clock_sync;
    wire launch_edge = clock_previous && !clock_sync;
    reg [9:0] edge_count;
    reg [8:0] tx_index;
    reg [511:0] rx_frame, tx_frame, reply_bank, build_frame;
    reg [15:0] rx_crc, build_crc;
    reg [8:0] build_index;
    reg building, apply_seen;
    reg [31:0] actuator_phase;
    wire [32:0] actuator_sum = {1'b0,actuator_phase}+1000;
    reg [511:0] reply_body;
    reg signed [47:0] mapped_x, mapped_y, limit_x, limit_y;
    reg signed [47:0] positive_x, positive_y;
    reg [31:0] pointer_x, pointer_y;
    wire [8:0] rx_bit = {edge_count[8:3],3'b0}+{6'b0,~edge_count[2:0]};
    wire [8:0] tx_bit = {tx_index[8:3],3'b0}+{6'b0,~tx_index[2:0]};
    assign pad_data_oe = !pad_select_n;
    assign pad_data = tx_frame[tx_bit];
    assign motor_level_q16 = remaining_ms == 0 || !CAPABILITY[0] ? 17'd0 :
        requested_intensity >= 32'h00010000 ? 17'h10000 : requested_intensity[16:0];

    // Signed-wide subtraction is intentional: an empty extent has upper
    // endpoint -1. Exactly the same min(max(mapped,0),endpoint) datapath applies
    // to zero as to every other representable extent, with no frozen position.
    always @* begin
        limit_x = ($signed({1'b0,display_width})-48'sd1) <<< 16;
        limit_y = ($signed({1'b0,display_height})-48'sd1) <<< 16;
        mapped_x = $signed(pointer_words[32 +:32]) *
            ($signed({1'b0,display_width})-48'sd1);
        mapped_y = $signed(pointer_words[64 +:32]) *
            ($signed({1'b0,display_height})-48'sd1);
        positive_x = mapped_x < 0 ? 48'sd0 : mapped_x;
        positive_y = mapped_y < 0 ? 48'sd0 : mapped_y;
        pointer_x = positive_x > limit_x ? limit_x[31:0] : positive_x[31:0];
        pointer_y = positive_y > limit_y ? limit_y[31:0] : positive_y[31:0];
        reply_body = 0;
        reply_body[0+:32]=32'h44415042;
        reply_body[32+:8]=1;
        reply_body[40+:8]=FEATURES;
        // Until a complete owned context arrives the standard pointer has no
        // qualified position record. Absence is a feature/lifetime state, not
        // a fabricated positive display size or neutral coordinate fallback.
        if (STANDARD_POINTER && !context_valid) reply_body[41]=0;
        reply_body[42]=apply_seen;
        reply_body[48+:16]=MODEL_ID;
        reply_body[64+:32]=CAPABILITY;
        reply_body[96+:32]=last_apply_tag;
        reply_body[128+:224]=pad_words;
        reply_body[352+:128]=pointer_words;
        if (STANDARD_POINTER) begin
            reply_body[384+:32]=pointer_x;
            reply_body[416+:32]=pointer_y;
        end
    end

    always @(posedge clk or negedge reset_n) begin
        if (!reset_n) begin
            reset_release<=0;
            clock_meta<=0;clock_sync<=0;clock_previous<=0;
            select_meta<=1;select_sync<=1;select_previous<=1;
            command_meta<=1;command_sync<=1;
            edge_count<=0;tx_index<=0;rx_frame<=0;tx_frame<=0;
            reply_bank<=0;build_frame<=0;rx_crc<=16'hffff;
            build_crc<=16'hffff;build_index<=0;building<=0;
            apply_seen<=0;request_accepted<=0;apply_accepted<=0;
            last_apply_tag<=0;requested_intensity<=0;requested_duration_ms<=0;
            actuator_phase<=0;remaining_ms<=0;
            context_valid<=0;display_width<=0;display_height<=0;display_epoch<=0;
        end else begin
            reset_release<={reset_release[0],1'b1};
            clock_meta<=pad_clk;clock_sync<=clock_meta;clock_previous<=clock_sync;
            select_meta<=pad_select_n;select_sync<=select_meta;select_previous<=select_sync;
            command_meta<=pad_command;command_sync<=command_meta;
            request_accepted<=0;apply_accepted<=0;
            if (reset_release[1]) begin
                // Preparation costs 497 local clocks; it is independent of SPI.
                // Only a complete CRC-bearing frame clocks the pre-staged bank.
                if (!building) begin
                    build_frame<=reply_body;build_crc<=16'hffff;
                    build_index<=0;building<=1;
                end else if (build_index < 496) begin
                    build_crc<=pad_crc_bit(build_crc,
                        build_frame[{build_index[8:3],3'b0}+{6'b0,~build_index[2:0]}]);
                    build_index<=build_index+1'b1;
                end else begin
                    reply_bank<=build_frame;
                    reply_bank[496+:8]<=build_crc[15:8];
                    reply_bank[504+:8]<=build_crc[7:0];
                    building<=0;
                end
                // Millisecond expiration starts at APPLY commit, rather than a
                // free-running tick's phase. Serial clocks may stop completely.
                if (remaining_ms != 0) begin
                    if (actuator_sum >= CLOCK_HZ) begin
                        actuator_phase<=actuator_sum-CLOCK_HZ;
                        remaining_ms<=remaining_ms-1'b1;
                    end else actuator_phase<=actuator_sum[31:0];
                end
                if (select_start) begin
                    tx_frame<=reply_bank;tx_index<=0;
                    edge_count<=0;rx_frame<=0;rx_crc<=16'hffff;
                end
                if (!select_sync && sample_edge) begin
                    if (edge_count < 512) begin
                        rx_frame[rx_bit]<=command_sync;
                        if (edge_count < 496) rx_crc<=pad_crc_bit(rx_crc,command_sync);
                    end
                    if (edge_count < 513) edge_count<=edge_count+1'b1;
                end
                if (!select_sync && launch_edge && tx_index != 511)
                    tx_index<=tx_index+1'b1;
                if (select_end && edge_count == 512 &&
                    rx_crc == {rx_frame[496+:8],rx_frame[504+:8]} &&
                    rx_frame[0+:32]==32'h58534d42 && rx_frame[32+:8]==1) begin
                    request_accepted<=1;
                    context_valid<=rx_frame[48];
                    display_width<=rx_frame[160+:16];
                    display_height<=rx_frame[176+:16];
                    display_epoch<=rx_frame[192+:32];
                    if (rx_frame[40+:8]==1) begin
                        apply_accepted<=1;apply_seen<=1;
                        last_apply_tag<=rx_frame[64+:32];
                        requested_intensity<=rx_frame[96+:32];
                        requested_duration_ms<=rx_frame[128+:32];
                        remaining_ms<=rx_frame[96+:32]==0 || !CAPABILITY[0] ?
                            32'd0 : rx_frame[128+:32];
                        actuator_phase<=0;
                    end
                end
            end
        end
    end
endmodule
