`timescale 1ns/1ps
// Convert one complete signed RATE_STEP_Q16 word and unsigned source-rate word
// into the exact signed quotient and remainder at 44100 Hz. Product magnitude
// is divided by a shared 64-step restoring divider; sign is applied afterwards,
// giving truncation toward zero and the same-sign remainder. The result remains
// stable under output backpressure. This is command-time work, not per-sample
// work and not a guarantee that every command completes in one frame.
// A shared sequential divider is a normal hardware datapath, cf. PicoRV32:
// https://github.com/YosysHQ/picorv32/blob/main/picorv32.v
module apu_voice_rate (
 input wire clk,reset_n,
 input wire req_valid,output wire req_ready,input wire [31:0] req_rate_q16,req_source_hz,
 output wire rsp_valid,input wire rsp_ready,
 output reg signed [63:0] rsp_whole_q16,output reg signed [31:0] rsp_remainder
);
 localparam [1:0] IDLE=0,DIVIDE=1,HOLD=2;
 reg [1:0] state;reg negative;reg [63:0] dividend,quotient;reg [16:0] remainder;reg [6:0] count;
 wire signed [63:0] product=$signed(req_rate_q16)*$signed({1'b0,req_source_hz});
 wire [17:0] trial={remainder,dividend[63]};
 wire take=trial>=18'd44100;
 wire [17:0] reduced=take ? trial-18'd44100 : trial;
 wire [63:0] next_quotient={quotient[62:0],take};
 assign req_ready=reset_n && state==IDLE;
 assign rsp_valid=reset_n && state==HOLD;
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin state<=IDLE;negative<=0;dividend<=0;quotient<=0;remainder<=0;count<=0;rsp_whole_q16<=0;rsp_remainder<=0;end
  else case(state)
   IDLE: if(req_valid) begin negative<=product<0;dividend<=product<0 ? -product : product;quotient<=0;remainder<=0;count<=0;state<=DIVIDE;end
   DIVIDE: begin
    dividend<=dividend<<1;quotient<=next_quotient;remainder<=reduced[16:0];count<=count+1'b1;
    if(count==63) begin rsp_whole_q16<=negative ? -next_quotient : next_quotient;
     rsp_remainder<=negative ? -$signed({14'd0,reduced}) : $signed({14'd0,reduced});state<=HOLD;end
   end
   HOLD: if(rsp_ready)state<=IDLE;
  endcase
 end
endmodule
