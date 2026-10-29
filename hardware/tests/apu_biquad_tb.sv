`timescale 1ns/1ps
module apu_biquad_tb;
 reg clk=0; always #5 clk=~clk;
 reg reset_n=0,clear_valid=0,req_valid=0,rsp_ready=0;
 reg [3:0] clear_slot=0,slot=0; reg [31:0] control=0,b01=0,b2a1=0,a2=0,samples=0;
 wire clear_ready,req_ready,rsp_valid;wire [31:0] rsp_samples;
 apu_biquad dut(.clk(clk),.reset_n(reset_n),.clear_valid(clear_valid),.clear_ready(clear_ready),.clear_slot(clear_slot),
  .req_valid(req_valid),.req_ready(req_ready),.req_slot(slot),.req_control(control),.req_b0_b1(b01),.req_b2_a1(b2a1),.req_a2(a2),.req_samples(samples),
  .rsp_valid(rsp_valid),.rsp_ready(rsp_ready),.rsp_samples(rsp_samples));
 integer f,n,count,ret,clear_int,slot_int,i;reg [31:0] expected;
 initial begin
  f=$fopen("build/tests/apu-biquad-vectors.txt","r");if(!f)$fatal(1,"no vectors");
  ret=$fscanf(f,"%d\n",count); repeat(3) @(negedge clk);reset_n=1;
  // Simultaneous clear and sample: clear owns the bank for this edge.
  @(negedge clk);clear_valid=1;req_valid=1;clear_slot=0;slot=0;#1;
  if(!clear_ready || req_ready)$fatal(1,"clear priority");
  @(negedge clk);clear_valid=0;req_valid=0;
  // Abort an enabled operation with reset, then separately abort a stalled
  // bypass response. Reset is an actual device reset, not write rollback.
  @(negedge clk);control=1;b01=32'h00004000;samples=32'h80007fff;req_valid=1;
  @(negedge clk);req_valid=0;repeat(2) @(negedge clk);reset_n=0;
  @(negedge clk);if(rsp_valid)$fatal(1,"reset during filter work");reset_n=1;
  @(negedge clk);control=0;req_valid=1;
  @(negedge clk);req_valid=0;while(!rsp_valid) @(negedge clk);
  clear_valid=1;#1;if(clear_ready)$fatal(1,"clear admitted during response stall");
  reset_n=0;clear_valid=0;@(negedge clk);if(rsp_valid)$fatal(1,"reset during response");reset_n=1;
  for(n=0;n<count;n=n+1) begin
   ret=$fscanf(f,"%h %h %h %h %h %h %h %h\n",clear_int,slot_int,control,b01,b2a1,a2,samples,expected);
   if(ret!=8)$fatal(1,"bad vector %0d",n);
   slot=slot_int;
   if(clear_int) begin @(negedge clk);while(!clear_ready) @(negedge clk);clear_slot=slot;clear_valid=1;
    @(negedge clk);clear_valid=0;end
   @(negedge clk);while(!req_ready) @(negedge clk);req_valid=1;
   @(negedge clk);req_valid=0;while(!rsp_valid) @(negedge clk);
   if(rsp_samples!==expected)$fatal(1,"case %0d expected %h got %h",n,expected,rsp_samples);
   for(i=0;i<(n&3);i=i+1) begin @(negedge clk);if(!rsp_valid || rsp_samples!==expected)$fatal(1,"response stall %0d",n);end
   rsp_ready=1;@(negedge clk);rsp_ready=0;
  end
  $display("PASS %0d stereo biquad requests vs TS/C++, 16 histories, clear, bypass, coefficient changes and stalls",count);$finish;
 end
 initial begin #100000000;$fatal(1,"timeout");end
endmodule
