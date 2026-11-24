`timescale 1ns/1ps
module cpu_instruction_decode_tb;
 reg clk=0;always #5 clk=~clk;
 reg reset_n=0,req_valid=0,rsp_ready=0,req_wide=0;reg [31:0] pc=0,prefix=0,body=0;
 wire req_ready,rsp_valid,wide,nested,reserved;wire [31:0] out_pc,next_pc,sbx,rkb,rkc,target;
 wire [5:0] op;wire [13:0] a;wire [14:0] b,c;wire [25:0] bx;wire [7:0] operand_byte;
 cpu_instruction_decode dut(.clk(clk),.reset_n(reset_n),.req_valid(req_valid),.req_ready(req_ready),.req_pc(pc),.req_prefix(prefix),.req_body(body),.req_wide(req_wide),
  .rsp_valid(rsp_valid),.rsp_ready(rsp_ready),.rsp_pc(out_pc),.rsp_next_pc(next_pc),.rsp_opcode(op),.rsp_a(a),.rsp_b(b),.rsp_c(c),.rsp_bx(bx),
  .rsp_sbx(sbx),.rsp_rkb(rkb),.rsp_rkc(rkc),.rsp_branch_target(target),.rsp_operand_byte(operand_byte),.rsp_wide(wide),.rsp_nested_wide(nested),.rsp_reserved_memory(reserved));
 integer f,n,count,rc,i,iw,ires,inest,wide_count=0,nested_count=0,reserved_count=0,field_hint_count=0;
 reg [63:0] opcode_seen=0;reg [31:0] eop,ea,eb,ec,ebx,esbx,erb,erc,etarget,expected_byte;
 initial begin
  f=$fopen("build/tests/cpu-instruction-decode-vectors.txt","r");if(!f)$fatal(1,"no vectors");
  rc=$fscanf(f,"%d\n",count);repeat(2)@(negedge clk);reset_n=1;
  for(n=0;n<count;n=n+1) begin
   rc=$fscanf(f,"%h %h %h %h %h %h %h %h %h %h %h %h %h %h %h %h\n",pc,prefix,body,iw,eop,ea,eb,ec,ebx,esbx,erb,erc,etarget,expected_byte,ires,inest);
   if(rc!=16)$fatal(1,"vector %0d",n);req_wide=iw;
   @(negedge clk);while(!req_ready)@(negedge clk);req_valid=1;
   @(negedge clk);req_valid=0;
   if(!rsp_valid||out_pc!==pc||next_pc!==(pc+(iw?8:4))||op!==eop[5:0]||a!==ea[13:0]||b!==eb[14:0]||c!==ec[14:0]||bx!==ebx[25:0]||sbx!==esbx||rkb!==erb||rkc!==erc||target!==etarget||operand_byte!==expected_byte[7:0]||wide!==iw[0]||reserved!==ires[0]||nested!==inest[0])$fatal(1,"decode mismatch %0d op=%h a=%h/%h b=%h/%h c=%h/%h bx=%h/%h sbx=%h/%h",n,op,a,ea,b,eb,c,ec,bx,ebx,sbx,esbx);
   opcode_seen[op]=1;wide_count=wide_count+wide;nested_count=nested_count+nested;reserved_count=reserved_count+reserved;
   if(op==6'h3d && operand_byte!=0)field_hint_count=field_hint_count+1;
   for(i=0;i<(n&3);i=i+1)begin
    @(negedge clk);if(!rsp_valid||out_pc!==pc||a!==ea[13:0]||operand_byte!==expected_byte[7:0])$fatal(1,"stall");
   end
   rsp_ready=1;@(negedge clk);rsp_ready=0;
  end
  if(opcode_seen!==64'hffffffffffffffff || wide_count==0 || nested_count==0 || reserved_count==0 || field_hint_count==0)
   $fatal(1,"missing opcode/width/reserved/nested/field hint coverage");
  $display("PASS %0d CPU word decodes vs actual TS CPU and C++ disassembler, %0d SETFIELD hints, stalls",count,field_hint_count);$finish;
 end
 initial begin #100000000;$fatal(1,"timeout");end
endmodule
