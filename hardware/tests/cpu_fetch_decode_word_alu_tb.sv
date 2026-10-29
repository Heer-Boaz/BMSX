`timescale 1ns/1ps
// Fetch + physical decode + word ALU; the numeric-value read and instruction
// memory are explicit fixtures. This is not yet a CPU register file or CP0.
module cpu_fetch_decode_word_alu_tb;
 reg clk=0;always #5 clk=~clk;reg reset_n=0,fetch_valid=0,rsp_ready=0;
 reg [31:0] pc=0,prefix=0,body=0;reg [63:0] left=0,right=0;reg [7:0] signals=8'h0c;
 wire fetch_ready,mem_valid,fetch_rsp_valid,fetch_rsp_ready,misaligned,bus_fault,fetch_wide;
 wire [31:0] mem_address,fetch_pc,fetch_next,fetch_prefix,fetch_body;wire [7:0] mem_signals;
 reg mem_rsp_valid=0;reg [31:0] mem_rsp_data=0;integer cycles=0;
 wire mem_ready=(cycles&3)!=0;
 cpu_instruction_fetch fetch(.clk(clk),.reset_n(reset_n),.req_valid(fetch_valid),.req_ready(fetch_ready),.req_pc(pc),.req_bus_signals(signals),
  .mem_valid(mem_valid),.mem_ready(mem_ready),.mem_address(mem_address),.mem_bus_signals(mem_signals),.mem_rsp_valid(mem_rsp_valid),.mem_rsp_data(mem_rsp_data),.mem_rsp_fault(32'd0),
  .rsp_valid(fetch_rsp_valid),.rsp_ready(fetch_rsp_ready),.rsp_pc(fetch_pc),.rsp_next_pc(fetch_next),.rsp_prefix(fetch_prefix),.rsp_body(fetch_body),
  .rsp_wide(fetch_wide),.rsp_misaligned(misaligned),.rsp_bus_fault(bus_fault));
 wire decode_req_ready,decode_valid,decode_ready;wire [5:0] opcode;wire [13:0] destination;
 assign fetch_rsp_ready=decode_req_ready;
 cpu_instruction_decode decode(.clk(clk),.reset_n(reset_n),.req_valid(fetch_rsp_valid && !misaligned && !bus_fault),.req_ready(decode_req_ready),
  .req_pc(fetch_pc),.req_prefix(fetch_prefix),.req_body(fetch_body),.req_wide(fetch_wide),
  .rsp_valid(decode_valid),.rsp_ready(decode_ready),.rsp_pc(),.rsp_next_pc(),.rsp_opcode(opcode),.rsp_a(destination),
  .rsp_b(),.rsp_c(),.rsp_bx(),.rsp_sbx(),.rsp_rkb(),.rsp_rkc(),.rsp_branch_target(),.rsp_disp(),.rsp_wide(),.rsp_nested_wide(),.rsp_reserved_memory());
 wire [5:0] operations={opcode==34,opcode==28,opcode==27,opcode==26,opcode==25,opcode==24};
 wire alu_valid;wire [13:0] alu_dest;wire [63:0] alu_result;
 cpu_word_alu alu(.clk(clk),.reset_n(reset_n),.req_valid(decode_valid),.req_ready(decode_ready),.req_operations(operations),.req_destination(destination),
  .req_left_number(left),.req_right_number(right),.rsp_valid(alu_valid),.rsp_ready(rsp_ready),.rsp_destination(alu_dest),.rsp_number(alu_result));
 function automatic [31:0] swap(input [31:0] x);swap={x[7:0],x[15:8],x[23:16],x[31:24]};endfunction
 always @(posedge clk)if(reset_n)begin
  cycles<=cycles+1;mem_rsp_valid<=mem_valid&&mem_ready;
  if(mem_valid&&mem_ready)begin
   if(mem_signals!==signals)$fatal(1,"lost cartridge execution-domain flags");
   if(mem_address===pc)mem_rsp_data<=swap(prefix);
   else if(mem_address===pc+32'd4)mem_rsp_data<=swap(body);
   else $fatal(1,"wrong memory request %h",mem_address);
  end
 end
 integer f,count,n,rc,opword,destword,op,i;reg [63:0] expected;
 initial begin
  f=$fopen("build/tests/cpu-word-alu-vectors.txt","r");if(!f)$fatal(1,"missing vectors");
  rc=$fscanf(f,"%d\n",count);repeat(2)@(negedge clk);reset_n=1;
  for(n=0;n<512;n=n+1)begin
   rc=$fscanf(f,"%h %h %h %h %h\n",opword,destword,left,right,expected);if(rc!=5)$fatal(1,"vector %0d",n);
   case(opword) 1:op=24;2:op=25;4:op=26;8:op=27;16:op=28;32:op=34;endcase
   pc=(32'h10000000+(n<<2))&32'hfffffffc;
   prefix=(destword>>8)<<12;body=((destword>>6)&3)<<30 | op<<18 | ((destword&63)<<12);
   @(negedge clk);while(!fetch_ready)@(negedge clk);fetch_valid=1;@(negedge clk);fetch_valid=0;
   while(!alu_valid)@(negedge clk);
   if(alu_dest!==destword[13:0]||alu_result!==expected)$fatal(1,"case %0d dest=%h/%h result=%h/%h",n,alu_dest,destword,alu_result,expected);
   for(i=0;i<(n&3);i=i+1)begin @(negedge clk);if(!alu_valid||alu_dest!==destword[13:0]||alu_result!==expected)$fatal(1,"output stall");end
   rsp_ready=1;@(negedge clk);rsp_ready=0;
  end
  $display("PASS 512 actual JS/C++ word-ALU vectors through WIDE fetch, physical decode and execution datapath; memory/RK inputs are fixtures");$finish;
 end
 initial begin #10000000;$fatal(1,"timeout");end
endmodule
