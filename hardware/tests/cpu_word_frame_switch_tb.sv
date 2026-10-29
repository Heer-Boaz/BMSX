`timescale 1ns/1ps
// Two frame banks are a fixture: the real frame scheduler must switch only
// after accepted writeback. The arithmetic/datapath and top owner are real.
module cpu_word_frame_switch_tb;
 reg clk=0;always #5 clk=~clk;
 reg reset_n=0, frame_load=0;reg [31:0] frame_load_top=0; wire [31:0] top;
 reg req_valid=0;wire req_ready,select;reg [5:0] op=0;reg [13:0] a=0;reg [14:0] b=0;reg [31:0] rkb=0,rkc=0;
 wire read_valid,read_ready,read_const,rsp_ready,write_valid;wire [14:0] read_idx;wire [13:0] write_idx;wire [63:0] write_num;
 reg read_en=0,write_ready=0,current=0;reg [63:0] r[0:31];reg tag[0:31];
 wire rsp_valid=read_valid && read_en;assign read_ready=read_en && rsp_ready;
 cpu_word_frame dut(.clk(clk),.reset_n(reset_n),.frame_load(frame_load),.frame_load_top(frame_load_top),.frame_top(top),.req_valid(req_valid),.req_ready(req_ready),.select(select),.req_opcode(op),.req_a(a),.req_b(b),.req_rkb(rkb),.req_rkc(rkc),.slot_read_valid(read_valid),.slot_read_ready(read_ready),.slot_read_constant(read_const),.slot_read_index(read_idx),.slot_rsp_valid(rsp_valid),.slot_rsp_ready(rsp_ready),.slot_rsp_is_number(tag[{current,read_idx[3:0]}]),.slot_rsp_payload(r[{current,read_idx[3:0]}]),.slot_write_valid(write_valid),.slot_write_ready(write_ready),.slot_write_index(write_idx),.slot_write_number(write_num));
 always @(posedge clk) if(write_valid && write_ready)begin r[{current,write_idx[3:0]}]<=write_num;tag[{current,write_idx[3:0]}]<=1;end
 task switch_frame(input bit id,input [31:0] new_top);begin @(negedge clk);current=id;frame_load_top=new_top;frame_load=1;@(negedge clk);frame_load=0;if(top!==new_top)$fatal(1,"load");end endtask
 task instruction(input [5:0] code,input [13:0] dst,input [14:0] src_b,input [31:0] rk_b,input [31:0] rk_c,input [63:0] result,input [31:0] final_top);
 begin
  @(negedge clk);op=code;a=dst;b=src_b;rkb=rk_b;rkc=rk_c;read_en=0;req_valid=1;#1;
  while(!req_ready)@(negedge clk);@(negedge clk);req_valid=0;
  repeat(3)@(negedge clk);if(!read_valid)$fatal(1,"read stall");read_en=1;
  while(!write_valid)@(negedge clk);
  if(write_num!==result||write_idx!==dst)$fatal(1,"precommit expected %h got %h",result,write_num);
  repeat(3)begin @(negedge clk);if(!write_valid||write_num!==result)$fatal(1,"write stall");end
  write_ready=1;@(negedge clk);write_ready=0;
  if(top!==final_top||!tag[{current,dst[3:0]}]||r[{current,dst[3:0]}]!==result)$fatal(1,"commit top=%d",top);
 end endtask
 initial begin
  repeat(2)@(negedge clk);reset_n=1;
  r[1]=64'h4014000000000000;r[2]=64'h4000000000000000;tag[1]=1;tag[2]=1;
  r[17]=64'h4008000000000000;r[18]=64'h4010000000000000;tag[17]=1;tag[18]=1;
  switch_frame(0,1);instruction(25,2,0,1,2,64'h401c000000000000,3); // 5 | 2 = 7, A=C
  switch_frame(1,9);instruction(25,1,0,1,2,64'h401c000000000000,9); // 3 | 4 = 7, A=B
  switch_frame(0,3);instruction(26,2,0,2,2,64'h0000000000000000,3); // R2 xor R2 = 0
  if(r[17]!==64'h401c000000000000||r[18]!==64'h4010000000000000)$fatal(1,"cross-frame corruption");
  $display("PASS frame switch at quiescent boundaries, alias A=B/A=C/B=C, stalled read/write, independent frame top and payload");$finish;
 end
 initial begin #100000;$fatal(1,"timeout state=%0d valid=%b rr=%b rv=%b top=%d",dut.execute.state,req_valid,read_ready,read_valid,top);end
endmodule
