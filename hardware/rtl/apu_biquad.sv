`timescale 1ns/1ps
// Shared stereo Q14 biquad datapath and sixteen independent history banks.
// The scheduler supplies current slot-register words with each interpolated or
// generated stereo sample. PLAY clears the chosen slot before its first sample;
// live coefficient changes do not clear histories. A disabled filter bypasses
// the input and does not update history. The response remains held under stall.
// The time-multiplexed five-product recurrence is BMSX's transposed direct
// form II, not MAME's floating-point arithmetic. Production reference:
// https://github.com/mamedev/mame/blob/master/src/devices/sound/flt_biquad.cpp
module apu_biquad (
 input wire clk,reset_n,
 input wire clear_valid,output wire clear_ready,input wire [3:0] clear_slot,
 input wire req_valid,output wire req_ready,input wire [3:0] req_slot,
 input wire [31:0] req_control,req_b0_b1,req_b2_a1,req_a2,
 input wire [31:0] req_samples,
 output wire rsp_valid,input wire rsp_ready,output reg [31:0] rsp_samples
);
 localparam [2:0] IDLE=0,B0=1,B1=2,A1=3,B2=4,A2=5,REPLY=6;
 reg [2:0] state;
 reg [3:0] slot;
 reg channel;
 reg signed [15:0] b0,b1,b2,a1,a2,x;
 reg signed [31:0] y;
 reg signed [63:0] acc;
 reg [31:0] input_samples;
 reg [31:0] l1[0:15],l2[0:15],r1[0:15],r2[0:15];
 reg signed [15:0] multiplier_coefficient;
 reg signed [31:0] multiplier_input;
 integer i;
 always @* begin
  case(state)
   B0: multiplier_coefficient=b0;
   B1: multiplier_coefficient=b1;
   A1: multiplier_coefficient=a1;
   B2: multiplier_coefficient=b2;
   default: multiplier_coefficient=a2;
  endcase
  multiplier_input=(state==A1 || state==A2) ? y : {{16{x[15]}},x};
 end
 wire signed [47:0] product=multiplier_coefficient*multiplier_input;
 wire signed [63:0] wide_product={{16{product[47]}},product};
 wire signed [31:0] old_z1=channel ? r1[slot] : l1[slot];
 wire signed [31:0] old_z2=channel ? r2[slot] : l2[slot];
 wire signed [63:0] b0sum=wide_product+{{32{old_z1[31]}},old_z1};
 wire signed [63:0] next_z1=acc-wide_product;
 wire signed [63:0] next_z2=acc-wide_product;
 wire [15:0] clipped=y < -32'sd32768 ? 16'h8000 : y > 32'sd32767 ? 16'h7fff : y[15:0];
 assign clear_ready=reset_n && state==IDLE;
 assign req_ready=reset_n && state==IDLE && !clear_valid;
 assign rsp_valid=reset_n && state==REPLY;
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin
   state<=IDLE;slot<=0;channel<=0;b0<=0;b1<=0;b2<=0;a1<=0;a2<=0;x<=0;y<=0;acc<=0;
   input_samples<=0;rsp_samples<=0;
   for(i=0;i<16;i=i+1) begin l1[i]<=0;l2[i]<=0;r1[i]<=0;r2[i]<=0;end
  end else case(state)
   IDLE: if(clear_valid && clear_ready) begin
    l1[clear_slot]<=0;l2[clear_slot]<=0;r1[clear_slot]<=0;r2[clear_slot]<=0;
   end else if(req_valid && req_ready) begin
    slot<=req_slot;channel<=0;input_samples<=req_samples;x<=req_samples[15:0];
    b0<=req_b0_b1[15:0];b1<=req_b0_b1[31:16];
    b2<=req_b2_a1[15:0];a1<=req_b2_a1[31:16];a2<=req_a2[15:0];
    if(req_control[0]) state<=B0;
    else begin rsp_samples<=req_samples;state<=REPLY;end
   end
   B0: begin y<=b0sum>>>14;state<=B1;end
   B1: begin acc<=wide_product+{{32{old_z2[31]}},old_z2};state<=A1;end
   A1: begin if(channel) r1[slot]<=next_z1[31:0];else l1[slot]<=next_z1[31:0];state<=B2;end
   B2: begin acc<=wide_product;state<=A2;end
   A2: begin
    if(channel) begin r2[slot]<=next_z2[31:0];rsp_samples[31:16]<=clipped;state<=REPLY;end
    else begin l2[slot]<=next_z2[31:0];rsp_samples[15:0]<=clipped;
     x<=input_samples[31:16];channel<=1;state<=B0;end
   end
   REPLY: if(rsp_ready) state<=IDLE;
  endcase
 end
endmodule
