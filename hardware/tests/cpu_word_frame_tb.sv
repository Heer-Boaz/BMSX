`timescale 1ns/1ps
// TS/C++ owner-generated vectors drive the real decoder, word execute, numeric
// frame access and top owner. Backing storage is an independent typed fixture;
// physical VM storage, allocator, GC and the CPU frame-switch protocol are not
// supplied by this test. Both immediate and delayed numeric reads are checked.
module cpu_word_frame_tb;
 reg clk=0; always #5 clk=~clk;
 reg reset_n=0,frame_load=0,in_valid=0,wide=0,slot_write_ready=0;
 reg [31:0] load_top=0,pc=0,prefix=0,body=0;
 wire [31:0] frame_top; wire in_ready,decoded,execute_ready,select;
 wire [5:0] op;wire [13:0] a;wire [14:0] b;wire [31:0] rkb,rkc;
 cpu_instruction_decode decode(.clk(clk),.reset_n(reset_n),.req_valid(in_valid),.req_ready(in_ready),
  .req_pc(pc),.req_prefix(prefix),.req_body(body),.req_wide(wide),.rsp_valid(decoded),.rsp_ready(execute_ready),
  .rsp_pc(),.rsp_next_pc(),.rsp_opcode(op),.rsp_a(a),.rsp_b(b),.rsp_c(),.rsp_bx(),.rsp_sbx(),
  .rsp_rkb(rkb),.rsp_rkc(rkc),.rsp_branch_target(),.rsp_disp(),.rsp_wide(),.rsp_nested_wide(),.rsp_reserved_memory());
 wire read_valid,read_ready,read_constant,rsp_valid,rsp_ready,rsp_is_number,write_valid;
 wire [14:0] read_index;wire [13:0] write_index;wire [63:0] rsp_payload,write_number;
 reg delayed_valid=0,delayed_is_number=0;reg [63:0] delayed_payload=0;
 cpu_word_frame dut(.clk(clk),.reset_n(reset_n),.frame_load(frame_load),.frame_load_top(load_top),.frame_top(frame_top),
  .req_valid(decoded),.req_ready(execute_ready),.select(select),.req_opcode(op),.req_a(a),.req_b(b),.req_rkb(rkb),.req_rkc(rkc),
  .slot_read_valid(read_valid),.slot_read_ready(read_ready),.slot_read_constant(read_constant),.slot_read_index(read_index),
  .slot_rsp_valid(rsp_valid),.slot_rsp_ready(rsp_ready),.slot_rsp_is_number(rsp_is_number),.slot_rsp_payload(rsp_payload),
  .slot_write_valid(write_valid),.slot_write_ready(slot_write_ready),.slot_write_index(write_index),.slot_write_number(write_number));
 integer cycles=0,read_count=0,pending=0,delay_count=0,stalls=0,immediate=0;
 reg [63:0] next_payload=0;reg next_is_number=0;
 reg [63:0] frame_payload[0:32767],constant_payload[0:16383];
 reg frame_number[0:32767],constant_number[0:16383];
 wire backing_number=read_constant ? constant_number[read_index] : frame_number[read_index];
 wire [63:0] backing_payload=read_constant ? constant_payload[read_index] : frame_payload[read_index];
 reg [31:0] lb,li,rb,ri,ln,rn,eop,ea,eb,erkb,erkc,iw;
 reg [63:0] lv,rv,expected;
 assign read_ready=(cycles%7)!=0 && (cycles%11)!=0;
 wire direct=read_valid && read_ready && (cycles%3)==0;
 assign rsp_valid=delayed_valid || direct;
 assign rsp_is_number=direct ? backing_number : delayed_is_number;
 assign rsp_payload=direct ? backing_payload : delayed_payload;
 always @(posedge clk) if(reset_n)begin
  cycles<=cycles+1;
  if(write_valid && slot_write_ready)begin frame_number[write_index]<=1;frame_payload[write_index]<=write_number;end
  if(read_valid&&!read_ready)stalls<=stalls+1;
  if(read_valid&&read_ready)begin
   if(pending||delayed_valid)$fatal(1,"multiple outstanding reads");
   if(read_count==0)begin
    if(read_constant!==lb[0]||read_index!==li[14:0])$fatal(1,"B owner/index mismatch");
    if(backing_number!==ln[0]||backing_payload!==lv)$fatal(1,"B stored slot mismatch");
    next_is_number<=backing_number;next_payload<=backing_payload;
   end else if(read_count==1&&eop!=34)begin
    if(read_constant!==rb[0]||read_index!==ri[14:0])$fatal(1,"C owner/index mismatch");
    if(backing_number!==rn[0]||backing_payload!==rv)$fatal(1,"C stored slot mismatch");
    next_is_number<=backing_number;next_payload<=backing_payload;
   end else $fatal(1,"extra read");
   read_count<=read_count+1;
   if(direct)begin if(!rsp_ready)$fatal(1,"direct response not accepted");immediate<=immediate+1;end
   else begin pending<=1;delay_count<=(cycles%4)+1;end
  end
  if(pending)begin if(delay_count!=0)delay_count<=delay_count-1;
   else begin delayed_valid<=1;delayed_payload<=next_payload;delayed_is_number<=next_is_number;pending<=0;end end
  if(delayed_valid&&rsp_ready)delayed_valid<=0;
 end
 integer f,n,count,rc,i;reg [31:0] expected_top,initial_top;integer increases=0,holds=0;
 initial begin
  f=$fopen("build/tests/cpu-word-execute-vectors.txt","r");if(!f)$fatal(1,"vectors missing");
  rc=$fscanf(f,"%d\n",count);repeat(2)@(negedge clk);reset_n=1;
  for(n=0;n<count;n=n+1)begin
   rc=$fscanf(f,"%h %h %h %h %h %h %h %h %h %h %h %h %h %h %h %h %h %h\n",pc,prefix,body,iw,eop,ea,eb,erkb,erkc,lb,li,rb,ri,ln,lv,rn,rv,expected);
   if(rc!=18)$fatal(1,"vector %0d fields=%0d",n,rc);
   if(lb)begin constant_number[li]=ln[0];constant_payload[li]=lv;end
   else begin frame_number[li]=ln[0];frame_payload[li]=lv;end
   if(eop!=34)begin
    if(rb)begin constant_number[ri]=rn[0];constant_payload[ri]=rv;end
    else begin frame_number[ri]=rn[0];frame_payload[ri]=rv;end
   end
   wide=iw[0];read_count=0;initial_top=(n&1)?ea+2:0;expected_top=ea+1>initial_top?ea+1:initial_top;
   @(negedge clk);frame_load=1;load_top=initial_top;@(negedge clk);frame_load=0;
   while(!in_ready)@(negedge clk);in_valid=1;@(negedge clk);in_valid=0;
   while(!write_valid)@(negedge clk);
   if(write_index!==ea[13:0]||write_number!==expected||frame_top!==initial_top)$fatal(1,"write precommit vector %0d",n);
   for(i=0;i<(n&3);i=i+1)begin @(negedge clk);
    if(!write_valid||write_index!==ea[13:0]||write_number!==expected||frame_top!==initial_top)$fatal(1,"stalled write changed state");end
   slot_write_ready=1;@(negedge clk);slot_write_ready=0;
   if(frame_top!==expected_top)$fatal(1,"top vector %0d expected=%h actual=%h",n,expected_top,frame_top);
   if(frame_number[ea]!==1 || frame_payload[ea]!==expected)$fatal(1,"Number writeback slot %0d",ea);
   if(expected_top>initial_top)increases=increases+1;else holds=holds+1;
  end
  if(!stalls||!immediate||!increases||!holds)$fatal(1,"coverage missing");
  $display("PASS %0d TS/C++ vectors through decode, typed numeric reads and accepted Number writeback with frame-top ownership; stalls=%0d direct=%0d",count,stalls,immediate);$finish;
 end
 initial begin #50000000;$fatal(1,"timeout");end
endmodule
