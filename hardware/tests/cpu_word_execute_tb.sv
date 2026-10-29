`timescale 1ns/1ps
// The decode and execute owners are real; the frame/image numeric-read port
// and writeback consumer are independent variable-latency fixtures.
module cpu_word_execute_tb;
 reg clk=0;always #5 clk=~clk;
 reg reset_n=0,in_valid=0,wide=0,write_ready=0;
 reg [31:0] pc=0,prefix=0,body=0;
 wire in_ready,decoded,execute_ready,select;wire [5:0] op;wire [13:0] a;wire [14:0] b;
 wire [31:0] rkb,rkc;
 cpu_instruction_decode decode(.clk(clk),.reset_n(reset_n),.req_valid(in_valid),.req_ready(in_ready),
  .req_pc(pc),.req_prefix(prefix),.req_body(body),.req_wide(wide),.rsp_valid(decoded),.rsp_ready(execute_ready),
  .rsp_pc(),.rsp_next_pc(),.rsp_opcode(op),.rsp_a(a),.rsp_b(b),.rsp_c(),.rsp_bx(),.rsp_sbx(),
  .rsp_rkb(rkb),.rsp_rkc(rkc),.rsp_branch_target(),.rsp_disp(),.rsp_wide(),.rsp_nested_wide(),.rsp_reserved_memory());
 wire read_valid,read_ready,read_constant,read_rsp_ready,write_valid;wire [14:0] read_index;
 wire [13:0] write_index;wire [63:0] write_number;wire read_rsp_valid;wire [63:0] read_rsp_number;
 reg delayed_valid=0;reg [63:0] delayed_number=0;
 cpu_word_execute dut(.clk(clk),.reset_n(reset_n),.req_valid(decoded),.req_ready(execute_ready),.select(select),
  .req_opcode(op),.req_a(a),.req_b(b),.req_rkb(rkb),.req_rkc(rkc),.read_valid(read_valid),.read_ready(read_ready),
  .read_constant(read_constant),.read_index(read_index),.read_rsp_valid(read_rsp_valid),.read_rsp_ready(read_rsp_ready),
  .read_rsp_number(read_rsp_number),.write_valid(write_valid),.write_ready(write_ready),.write_index(write_index),.write_number(write_number));
 integer cycles=0,read_count=0,pending=0,delay_count=0,stalls=0,immediate=0;
 reg [63:0] next_response=0;reg [31:0] lb,li,rb,ri,ln,rn,eop,ea,eb,erkb,erkc,iw;
 reg [63:0] lv,rv,expected;assign read_ready=(cycles%7)!=0 && (cycles%11)!=0;
 wire immediate_response=read_valid && read_ready && (cycles%3)==0;
 assign read_rsp_valid=delayed_valid || immediate_response;
 assign read_rsp_number=immediate_response ? (read_count==0 ? (ln ? lv : 64'h7ff8000000000000) : (rn ? rv : 64'h7ff8000000000000)) : delayed_number;
 reg held_read=0,held_constant=0;reg [14:0] held_index=0;
 always @(posedge clk) if(reset_n)begin
  cycles<=cycles+1;
  if(held_read && (!read_valid || read_constant!==held_constant || read_index!==held_index))$fatal(1,"read request changed while stalled");
  held_read<=read_valid&&!read_ready;held_constant<=read_constant;held_index<=read_index;
  if(read_valid&&!read_ready)stalls<=stalls+1;
  if(read_valid&&read_ready)begin
   if(pending||delayed_valid)$fatal(1,"multiple outstanding numeric reads");
   if(read_count==0)begin
    if(read_constant!==lb[0]||read_index!==li[14:0])$fatal(1,"B read mismatch bank=%d/%d idx=%d/%d",read_constant,lb,read_index,li);
    next_response<=ln ? lv : 64'h7ff8000000000000;
   end else if(read_count==1 && eop!=34)begin
    if(read_constant!==rb[0]||read_index!==ri[14:0])$fatal(1,"C read mismatch bank=%d/%d idx=%d/%d",read_constant,rb,read_index,ri);
    next_response<=rn ? rv : 64'h7ff8000000000000;
   end else $fatal(1,"unexpected extra read");
   read_count<=read_count+1;
   if(immediate_response)begin
    if(!read_rsp_ready)$fatal(1,"same-cycle response not accepted");
    immediate<=immediate+1;
   end else begin pending<=1;delay_count<=(cycles%4)+1;end
  end
  if(pending)begin
   if(delay_count!=0)delay_count<=delay_count-1;
   else begin delayed_valid<=1;delayed_number<=next_response;pending<=0;end
  end
  if(delayed_valid && read_rsp_ready)delayed_valid<=0;
 end
 integer f,n,count,rc,i;integer seen_ops=0,constant_reads=0,unary_high_b=0,non_number=0;
 initial begin
  f=$fopen("build/tests/cpu-word-execute-vectors.txt","r");if(!f)$fatal(1,"vectors missing");
  rc=$fscanf(f,"%d\n",count);repeat(2)@(negedge clk);reset_n=1;
  for(n=0;n<count;n=n+1)begin
   rc=$fscanf(f,"%h %h %h %h %h %h %h %h %h %h %h %h %h %h %h %h %h %h\n",pc,prefix,body,iw,eop,ea,eb,erkb,erkc,lb,li,rb,ri,ln,lv,rn,rv,expected);
   if(rc!=18)$fatal(1,"vector %0d fieldcount=%0d",n,rc);wide=iw[0];read_count=0;
   @(negedge clk);while(!in_ready)@(negedge clk);in_valid=1;@(negedge clk);in_valid=0;
   while(!write_valid)@(negedge clk);
   if(write_index!==ea[13:0]||write_number!==expected)$fatal(1,"result %0d got %h:%h expected %h:%h",n,write_index,write_number,ea,expected);
   if(read_count!=(eop==34?1:2))$fatal(1,"wrong read count");
   for(i=0;i<(n&3);i=i+1)begin @(negedge clk);if(!write_valid||write_index!==ea[13:0]||write_number!==expected)$fatal(1,"writeback stall");end
   seen_ops=seen_ops|(1<<(n%6));constant_reads=constant_reads+lb+(eop==34?0:rb);
   if(eop==34 && eb>=16384)unary_high_b=unary_high_b+1;
   if(!ln || (eop!=34 && !rn))non_number=non_number+1;
   write_ready=1;@(negedge clk);write_ready=0;
  end
  if(seen_ops!=63||!constant_reads||!unary_high_b||!non_number||!stalls||!immediate)$fatal(1,"missing coverage");
  $display("PASS %0d actual TS/C++ decode/value vectors through decode, RK request, numeric response and word Number writeback; read stalls=%0d immediate responses=%0d BNOT high-register=%0d",count,stalls,immediate,unary_high_b);$finish;
 end
 initial begin #50000000;$fatal(1,"timeout");end
endmodule
