`timescale 1ns/1ps
// IEEE binary64 square root, round-to-nearest/ties-even. Restoring radix-4
// recurrence; a 53-step significand datapath is shared over time. The
// classification/normalization/rounding separation follows the design of
// Berkeley HardFloat DivSqrtRecFN_small and Berkeley SoftFloat f64_sqrt:
// https://github.com/ucb-bar/berkeley-hardfloat/blob/master/hardfloat/src/main/scala/DivSqrtRecFN_small.scala
// https://github.com/ucb-bar/berkeley-softfloat-3/blob/master/source/f64_sqrt.c
// NaNs are quiet canonical NaNs; signed zero is preserved. POW's separate
// rules, including POW(-0,+0.5)=+0, belong to the CPU operation controller.
module core_binary64_sqrt(
 input wire clk,reset_n,
 input wire req_valid,output wire req_ready,input wire [63:0] req_a,
 output wire rsp_valid,input wire rsp_ready,output reg [63:0] rsp
);
 localparam [1:0] IDLE=0,RUN=1,ROUND=2,REPLY=3;
 reg [1:0] state;
 reg [105:0] radicand;
 reg [55:0] remainder;
 reg [52:0] root;
 reg [5:0] count;
 reg signed [12:0] out_exponent;
 wire [52:0] significand={|req_a[62:52],req_a[51:0]};
 wire [5:0] leading;
 binary64_lzc53 lzc(.value(significand),.count(leading));
 wire [52:0] normalized=significand << leading;
 wire signed [12:0] exponent=req_a[62:52]==0 ? -13'sd1022-$signed({7'b0,leading}) : $signed({2'b0,req_a[62:52]})-13'sd1023;
 wire [53:0] adjusted=exponent[0] ? {normalized,1'b0} : {1'b0,normalized};
 wire [55:0] shifted_remainder={remainder[53:0],radicand[105:104]};
 wire [55:0] trial={1'b0,root,2'b01};
 wire subtract=shifted_remainder>=trial;
 wire [53:0] rounded={1'b0,root} + (remainder > {3'b0,root});
 assign req_ready=reset_n && state==IDLE;
 assign rsp_valid=reset_n && state==REPLY;
 always @(posedge clk) begin
  if(!reset_n) begin
   state<=IDLE;radicand<=0;remainder<=0;root<=0;count<=0;out_exponent<=0;rsp<=0;
  end else case(state)
   IDLE: if(req_valid) begin
    if(req_a[62:0]==0) begin rsp<=req_a;state<=REPLY;end
    else if(req_a[62:52]==11'h7ff && req_a[51:0]==0 && !req_a[63]) begin rsp<=req_a;state<=REPLY;end
    else if(req_a[63] || req_a[62:52]==11'h7ff) begin rsp<=64'h7ff8000000000000;state<=REPLY;end
    else begin
     radicand<={adjusted,52'b0};remainder<=0;root<=0;count<=53;
     out_exponent<=((exponent >>> 1)+13'sd1023);
     state<=RUN;
    end
   end
   RUN: begin
    radicand<=radicand<<2;
    remainder<=subtract ? shifted_remainder-trial : shifted_remainder;
    root<={root[51:0],subtract};
    count<=count-1'b1;
    if(count==1)state<=ROUND;
   end
   ROUND: begin
    if(rounded[53])rsp<={1'b0,(out_exponent[10:0]+11'd1),52'b0};
    else rsp<={1'b0,out_exponent[10:0],rounded[51:0]};
    state<=REPLY;
   end
   REPLY: if(rsp_ready)state<=IDLE;
  endcase
 end
endmodule
