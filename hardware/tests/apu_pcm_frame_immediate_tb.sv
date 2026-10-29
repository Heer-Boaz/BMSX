`timescale 1ns/1ps
// Immediate-response and delayed-response word owners are both valid. Requests
// remain stable under stalls; a cross-word stereo PCM16 frame consumes two.
module apu_pcm_frame_immediate_tb;
 reg clk=0;always #5 clk=~clk;reg reset_n=0,req_valid=0,rsp_ready=0;
 reg [31:0] req_byte_address=32'h40000003,req_channels=2,req_bits_per_sample=16;
 wire req_ready,memory_req_valid,rsp_valid;wire [31:0] memory_req_address,rsp_samples;
 integer cycle=0,reads=0,stalls=0;reg held=0;reg [31:0] held_addr=0;
 wire memory_req_ready=(cycle%4)==0;
 wire memory_rsp_valid=memory_req_valid && memory_req_ready;
 wire [31:0] memory_rsp_word=memory_req_address==32'h40000000 ? 32'h44332211 : 32'h88776655;
 apu_pcm_frame dut(.clk(clk),.reset_n(reset_n),.req_valid(req_valid),.req_ready(req_ready),.req_byte_address(req_byte_address),
  .req_channels(req_channels),.req_bits_per_sample(req_bits_per_sample),.memory_req_valid(memory_req_valid),
  .memory_req_ready(memory_req_ready),.memory_req_address(memory_req_address),.memory_rsp_valid(memory_rsp_valid),
  .memory_rsp_word(memory_rsp_word),.rsp_valid(rsp_valid),.rsp_ready(rsp_ready),.rsp_samples(rsp_samples));
 always @(posedge clk) if(reset_n)begin cycle<=cycle+1;
  if(held && (!memory_req_valid||memory_req_address!==held_addr))$fatal(1,"memory request changed while stalled");
  held<=memory_req_valid&&!memory_req_ready;held_addr<=memory_req_address;
  if(memory_req_valid&&!memory_req_ready)stalls<=stalls+1;
  if(memory_req_valid&&memory_req_ready)begin
   if(memory_req_address!==(reads==0?32'h40000000:32'h40000004))$fatal(1,"word order");reads<=reads+1;end
 end
 initial begin repeat(2)@(negedge clk);reset_n=1;
  @(negedge clk);req_valid=1;@(negedge clk);req_valid=0;while(!rsp_valid)@(negedge clk);
  if(rsp_samples!==32'h77665544 || reads!=2 || !stalls)$fatal(1,"immediate result %h reads %0d stalls %0d",rsp_samples,reads,stalls);
  repeat(3)begin @(negedge clk);if(!rsp_valid||rsp_samples!==32'h77665544)$fatal(1,"response unstable");end
  rsp_ready=1;@(negedge clk);rsp_ready=0;
  $display("PASS same-edge two-word PCM response, ordered addresses and held output; memory stalls=%0d",stalls);$finish;
 end
 initial begin #10000;$fatal(1,"timeout");end
endmodule
