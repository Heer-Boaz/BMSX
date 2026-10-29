`timescale 1ns/1ps
// Sequential stereo gain and summation datapath for the sixteen APU slots.
// The scheduler starts a frame, then supplies exactly sixteen slot records in
// slot order. Inactive slots are supplied too, with slot_active deasserted.
// A single signed 16x34 multiplier serves channel levels and samples. The
// proposed raw level word contains signed Q2.14 left/right halfwords. Each
// combines with the signed Q12 master gain before sample multiplication.
// Unity levels bypass this step; identical actual samples and levels share one
// product. The physical result retains 34 signed bits without gain wrap.
// Inactive slots advance without a multiplication. Both 64-bit accumulators
// retain full Q12 products until the final ASR/clip.
// Output is retained while frame_valid && !frame_ready_out. This block owns
// neither source fetch, interpolation, filter, gain/fade updates nor cadence.
//
// Reference: MiSTer SNES DSP separates source/envelope/mix datapath and output
// scheduling (https://github.com/MiSTer-devel/SNES_MiSTer/blob/master/rtl/DSP.vhd).
// Its SNES arithmetic is not the BMSX gain contract.
module apu_mix_engine (
    input wire clk, reset_n,
    input wire start_valid,
    output wire start_ready,
    input wire slot_valid,
    output wire slot_ready,
    input wire slot_active,
    input wire signed [15:0] slot_left, slot_right,
    input wire signed [31:0] slot_gain_q12,
    input wire [31:0] slot_level_lr_q14,
    output reg frame_valid,
    input wire frame_ready_out,
    output reg signed [15:0] frame_left, frame_right
);
    localparam [2:0] IDLE=0, SLOT=1, LEVEL_LEFT=2, LEFT=3,
                     LEVEL_RIGHT=4, RIGHT=5, FINISH=6, OUTPUT=7;
    reg [2:0] state;
    reg [3:0] slot_index;
    reg signed [15:0] left_latched, right_latched;
    reg signed [31:0] gain_latched;
    reg signed [15:0] level_left,level_right;
    reg signed [33:0] effective_gain;
    reg signed [63:0] sum_left, sum_right;
    wire level_step=state==LEVEL_LEFT || state==LEVEL_RIGHT;
    wire signed [33:0] multiplicand=level_step ? {{2{gain_latched[31]}},gain_latched} : effective_gain;
    wire signed [15:0] multiplier=state==LEVEL_LEFT ? level_left :
                                      state==LEVEL_RIGHT ? level_right :
                                      state==LEFT ? left_latched : right_latched;
    wire signed [49:0] product=multiplicand*multiplier;
    wire signed [63:0] product_extended={{14{product[49]}},product};
    wire signed [63:0] scaled_left = sum_left >>> 12;
    wire signed [63:0] scaled_right = sum_right >>> 12;

    assign start_ready = state==IDLE;
    assign slot_ready = state==SLOT;
    always @(posedge clk or negedge reset_n) begin
        if (!reset_n) begin
            state<=IDLE;slot_index<=0;
            left_latched<=0;right_latched<=0;gain_latched<=0;
            level_left<=0;level_right<=0;effective_gain<=0;
            sum_left<=0;sum_right<=0;frame_valid<=0;frame_left<=0;frame_right<=0;
        end else begin
            case (state)
                IDLE: if (start_valid) begin
                    sum_left<=0;sum_right<=0;slot_index<=0;state<=SLOT;
                end
                SLOT: if (slot_valid) begin
                    if(!slot_active) begin
                        if(slot_index==15) state<=FINISH;
                        else slot_index<=slot_index+1'b1;
                    end else begin
                        left_latched<=slot_left;right_latched<=slot_right;
                        gain_latched<=slot_gain_q12;
                        level_left<=slot_level_lr_q14[15:0];
                        level_right<=slot_level_lr_q14[31:16];
                        effective_gain<={{2{slot_gain_q12[31]}},slot_gain_q12};
                        state<=slot_level_lr_q14[15:0]==16'h4000 ? LEFT : LEVEL_LEFT;
                    end
                end
                LEVEL_LEFT: begin effective_gain<=product[47:14];state<=LEFT;end
                LEFT: begin
                    sum_left<=sum_left+product_extended;
                    if(left_latched==right_latched && level_left==level_right) begin
                        sum_right<=sum_right+product_extended;
                        if(slot_index==15) state<=FINISH;
                        else begin slot_index<=slot_index+1'b1;state<=SLOT;end
                    end else if(level_right==16'h4000) begin
                        effective_gain<={{2{gain_latched[31]}},gain_latched};state<=RIGHT;
                    end else state<=LEVEL_RIGHT;
                end
                LEVEL_RIGHT: begin effective_gain<=product[47:14];state<=RIGHT;end
                RIGHT: begin
                    sum_right<=sum_right+product_extended;
                    if(slot_index==15) state<=FINISH;
                    else begin slot_index<=slot_index+1'b1;state<=SLOT;end
                end
                FINISH: begin
                    frame_left<=scaled_left < -64'sd32768 ? 16'sh8000 :
                        scaled_left > 64'sd32767 ? 16'sh7fff : scaled_left[15:0];
                    frame_right<=scaled_right < -64'sd32768 ? 16'sh8000 :
                        scaled_right > 64'sd32767 ? 16'sh7fff : scaled_right[15:0];
                    frame_valid<=1;state<=OUTPUT;
                end
                OUTPUT: if(frame_ready_out) begin frame_valid<=0;state<=IDLE;end
            endcase
        end
    end
endmodule
