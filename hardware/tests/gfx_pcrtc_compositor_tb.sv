`timescale 1ns/1ps
module gfx_pcrtc_compositor_tb;
 reg clk=0;always #5 clk=~clk;reg reset_n=0,req_valid=0,rsp_ready=0;
 reg [31:0] pm=0,bg=0,c1=0,c2=0;reg in1=0,in2=0;
 wire req_ready,rsp_valid;wire [31:0] out;
 gfx_pcrtc_compositor dut(.clk(clk),.reset_n(reset_n),.req_valid(req_valid),.req_ready(req_ready),
  .req_pmode(pm),.req_bgcolor(bg),.req_c1_rgba(c1),.req_c2_rgba(c2),.req_c1_inside(in1),.req_c2_inside(in2),
  .rsp_valid(rsp_valid),.rsp_ready(rsp_ready),.rsp_rgba(out));
 integer f,count,n,rc,i,tmp1,tmp2,qval;reg [31:0] expected;
 initial begin
  for(qval=0;qval<=65152;qval=qval+1)
   if(qval/255 != ((qval+1+(qval>>8))>>8))$fatal(1,"exact quotient %0d",qval);
  f=$fopen("build/tests/gfx-pcrtc-compositor-vectors.txt","r");if(!f)$fatal(1,"missing vectors");
  rc=$fscanf(f,"%d\n",count);repeat(2)@(negedge clk);reset_n=1;
  for(n=0;n<count;n=n+1) begin
   rc=$fscanf(f,"%h %h %h %h %h %h %h\n",pm,bg,c1,c2,tmp1,tmp2,expected);if(rc!=7)$fatal(1,"vector");in1=tmp1;in2=tmp2;
   @(negedge clk);while(!req_ready)@(negedge clk);req_valid=1;
   @(negedge clk);req_valid=0;if(!rsp_valid || out!==expected)$fatal(1,"case %0d expected %h actual %h",n,expected,out);
   for(i=0;i<(n&3);i=i+1)begin @(negedge clk);if(!rsp_valid||out!==expected)$fatal(1,"stall");end
   rsp_ready=1;@(negedge clk);rsp_ready=0;
  end
  // A consumer accepting every clock can replace the output register on the
  // same edge it consumes the prior pixel; no per-pixel dead cycle is needed.
  rsp_ready=1;
  for(i=0;i<64;i=i+1) begin
   @(negedge clk);req_valid=1;pm=0;bg=i;
   @(posedge clk);#1;if(!rsp_valid || out!==i)$fatal(1,"stream pixel %0d got %h",i,out);
  end
  @(negedge clk);req_valid=0;@(posedge clk);#1;if(rsp_valid)$fatal(1,"stream did not drain");
  $display("PASS %0d PCRTC compositor samples vs actual TS/C++ scanout owners, windows/alpha/blend and stalls",count);$finish;
 end
 initial begin #100000000;$fatal(1,"timeout");end
endmodule
