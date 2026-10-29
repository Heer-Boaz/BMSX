`timescale 1ns/1ps
// SRAM-bank regression: source publication at request admission or at the
// following context-lookup cycle must invalidate checkpoints without changing
// architecturally retained current/previous decoded PCM. Word memory is a fixture.
module apu_badp_bank_coincidence_tb;
 reg clk=0;always #5 clk=~clk;
 reg reset_n=0,bind_valid=0,req_valid=0,source_write_valid=0;reg [31:0] req_frame=0;reg req_reset=0;
 wire req_ready,rsp_valid,mem_valid;wire [31:0] rsp_samples;wire [16:0] mem_addr;
 reg mem_rsp=0;reg [31:0] mem_word=0;reg [31:0] mem[0:127];
 apu_badp_decoder dut(.clk(clk),.reset_n(reset_n),.bind_valid(bind_valid),.bind_voice(4'd0),
  .bind_source_base(19'd0),.bind_source_bytes(20'd4),.bind_data_offset(19'd64),.bind_frames(32'd8),
  .bind_channels(2'd1),.bind_seek_base(19'd0),.bind_seek_count(32'd0),.bind_loop_start(32'd0),.bind_loop_end(32'd8),
  .req_valid(req_valid),.req_ready(req_ready),.req_reset(req_reset),.req_voice(4'd0),.req_frame(req_frame),.rsp_valid(rsp_valid),.rsp_samples(rsp_samples),
  .source_write_valid(source_write_valid),.source_write_word(17'd17),.source_write_words(5'd1),
  .epoch_begin(1'b0),.epoch_active(1'b0),.epoch_change_valid(1'b0),.epoch_change_first(17'd0),.epoch_change_last(17'd0),
  .memory_req_valid(mem_valid),.memory_req_ready(1'b1),.memory_req_word_address(mem_addr),.memory_rsp_valid(mem_rsp),.memory_rsp_word(mem_word));
 always @(posedge clk)begin mem_rsp<=mem_valid;if(mem_valid)mem_word<=mem[mem_addr];end
 task automatic request(input bit rst,input [31:0] frame,input [31:0] expected,input bit check);
 begin @(negedge clk);while(!req_ready)@(negedge clk);req_reset=rst;req_frame=frame;req_valid=1;
  @(negedge clk);req_valid=0;while(!rsp_valid)@(negedge clk);
  if(check && rsp_samples!==expected)$fatal(1,"request %d got %h expected %h",frame,rsp_samples,expected);
 end endtask
 task automatic prepare;
 begin @(negedge clk);mem[17]=32'h00140064;bind_valid=1;@(negedge clk);bind_valid=0;
  request(1,0,0,0);request(0,0,32'h00760076,1);request(0,1,32'h00860086,1);request(0,2,32'h00950095,1);
  if(!dut.checkpoint_valid[0])$fatal(1,"checkpoint missing");
 end endtask
 task automatic mutation_retained(input bit stage);
 begin @(negedge clk);while(!req_ready)@(negedge clk);req_reset=0;req_frame=2;req_valid=1;
  if(!stage)begin source_write_valid=1;mem[17]=32'h001403e8;end
  @(negedge clk);req_valid=0;source_write_valid=0;
  if(stage)begin source_write_valid=1;mem[17]=32'h001403e8;end
  @(negedge clk);source_write_valid=0;
  while(!rsp_valid)@(negedge clk);
  if(rsp_samples!==32'h00950095)$fatal(1,"current sample erased stage=%d",stage);
  request(0,1,32'h00860086,1);request(0,0,32'h03fa03fa,1);
 end endtask
 integer i;
 initial begin
  for(i=0;i<128;i=i+1)mem[i]=0;mem[16]=32'h000c0008;mem[17]=32'h00140064;mem[18]=32'h11111111;
  repeat(2)@(negedge clk);reset_n=1;prepare();mutation_retained(0);prepare();mutation_retained(1);
  @(negedge clk);reset_n=0;@(negedge clk);reset_n=1;prepare();
  // Present request with bind and overlapping source write on the same edge.
  // The binding wins and request remains pending for next acceptance.
  @(negedge clk);mem[17]=32'h001403e8;source_write_valid=1;bind_valid=1;req_valid=1;req_frame=2;req_reset=0;
  #1;if(req_ready)$fatal(1,"request admitted alongside bind");
  @(negedge clk);bind_valid=0;source_write_valid=0;
  #1;if(!req_ready)$fatal(1,"pending request not admitted after bind");
  @(negedge clk);req_valid=0;while(!rsp_valid)@(negedge clk);
  if(rsp_samples!==32'h04190419)$fatal(1,"new binding mixed old rows %h",rsp_samples);
  // Reset during a read; no in-flight request may produce a response after
  // reset. Rebinding selects a clean row rather than prior SRAM payload.
  @(negedge clk);while(!req_ready)@(negedge clk);req_valid=1;req_reset=1;req_frame=0;
  @(negedge clk);req_valid=0;wait(mem_valid);@(negedge clk);reset_n=0;
  @(negedge clk);if(rsp_valid || req_ready)$fatal(1,"reset did not quiesce decoder");
  @(negedge clk);reset_n=1;req_reset=0;prepare();
  $display("PASS bind/rebind, source-write admission and lookup, retained PCM, simultaneous bind/write/request and in-flight reset");$finish;
 end
 initial begin #200000;$fatal(1,"timeout");end
endmodule
