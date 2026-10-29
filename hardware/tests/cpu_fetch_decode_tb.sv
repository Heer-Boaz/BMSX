`timescale 1ns/1ps
// R35 fetch connected directly to the physical field decoder. Bus data and
// stalls are a fixture; decoded expected values come from the actual TS CPU.
module cpu_fetch_decode_tb;
 reg clk=0;always #5 clk=~clk;reg reset_n=0,fetch_valid=0,dec_ready=0;
 reg [31:0] pc=0,source=0,body=0;reg [7:0] signals=8'h0c;
 wire fetch_ready,mem_valid,fetch_rsp_valid,fetch_rsp_ready,misaligned,bus_fault,fetch_wide;
 wire [31:0] mem_address,fetch_pc,fetch_next,fetch_prefix,fetch_body;wire [7:0] mem_signals;
 reg mem_rsp_valid=0;reg [31:0] mem_rsp_data=0;integer cycles=0;
 wire mem_ready=(cycles&3)!=0;
 cpu_instruction_fetch fetch(.clk(clk),.reset_n(reset_n),.req_valid(fetch_valid),.req_ready(fetch_ready),.req_pc(pc),.req_bus_signals(signals),
  .mem_valid(mem_valid),.mem_ready(mem_ready),.mem_address(mem_address),.mem_bus_signals(mem_signals),.mem_rsp_valid(mem_rsp_valid),.mem_rsp_data(mem_rsp_data),.mem_rsp_fault(32'd0),
  .rsp_valid(fetch_rsp_valid),.rsp_ready(fetch_rsp_ready),.rsp_pc(fetch_pc),.rsp_next_pc(fetch_next),.rsp_prefix(fetch_prefix),.rsp_body(fetch_body),.rsp_wide(fetch_wide),.rsp_misaligned(misaligned),.rsp_bus_fault(bus_fault));
 wire dec_valid,wide,nested,reserved;wire [31:0] out_pc,next_pc,sbx,rkb,rkc,target;wire [5:0] op;wire [13:0] a;wire [14:0] b,c;wire [25:0] bx;wire [7:0] disp;
 cpu_instruction_decode decode(.clk(clk),.reset_n(reset_n),.req_valid(fetch_rsp_valid && !misaligned && !bus_fault),.req_ready(fetch_rsp_ready),
  .req_pc(fetch_pc),.req_prefix(fetch_prefix),.req_body(fetch_body),.req_wide(fetch_wide),
  .rsp_valid(dec_valid),.rsp_ready(dec_ready),.rsp_pc(out_pc),.rsp_next_pc(next_pc),.rsp_opcode(op),.rsp_a(a),.rsp_b(b),.rsp_c(c),.rsp_bx(bx),
  .rsp_sbx(sbx),.rsp_rkb(rkb),.rsp_rkc(rkc),.rsp_branch_target(target),.rsp_disp(disp),.rsp_wide(wide),.rsp_nested_wide(nested),.rsp_reserved_memory(reserved));
 reg [31:0] selected;
 always @(posedge clk) begin
  if(!reset_n)begin cycles<=0;mem_rsp_valid<=0;end
  else begin cycles<=cycles+1;mem_rsp_valid<=mem_valid&&mem_ready;
   if(mem_valid&&mem_ready)begin
    if(mem_signals!==signals)$fatal(1,"lost domain");
    if(mem_address===pc)selected=source;else if(mem_address===(pc+4))selected=body;else $fatal(1,"bad fetch address");
    mem_rsp_data<={selected[7:0],selected[15:8],selected[23:16],selected[31:24]};
   end
  end
 end
 integer f,n,count,rc,i,iw,ires,inest;reg [31:0] eop,ea,eb,ec,ebx,esbx,erb,erc,etarget,edisp;
 initial begin
  f=$fopen("build/tests/cpu-instruction-decode-vectors.txt","r");if(!f)$fatal(1,"missing vectors");rc=$fscanf(f,"%d\n",count);
  repeat(2)@(negedge clk);reset_n=1;
  for(n=0;n<256;n=n+1)begin
   rc=$fscanf(f,"%h %h %h %h %h %h %h %h %h %h %h %h %h %h %h %h\n",pc,source,body,iw,eop,ea,eb,ec,ebx,esbx,erb,erc,etarget,edisp,ires,inest);
   if(rc!=16)$fatal(1,"bad vector");
   @(negedge clk);while(!fetch_ready)@(negedge clk);fetch_valid=1;@(negedge clk);fetch_valid=0;
   while(!dec_valid)@(negedge clk);
   if(out_pc!==pc||next_pc!==(pc+(iw?8:4))||op!==eop[5:0]||a!==ea[13:0]||b!==eb[14:0]||c!==ec[14:0]||bx!==ebx[25:0]||sbx!==esbx||rkb!==erb||rkc!==erc||target!==etarget||disp!==edisp[7:0]||wide!==iw[0]||reserved!==ires[0]||nested!==inest[0])$fatal(1,"fetch/decode mismatch %0d",n);
   for(i=0;i<(n&3);i=i+1)begin @(negedge clk);if(!dec_valid||out_pc!==pc)$fatal(1,"decode stall");end
   dec_ready=1;@(negedge clk);dec_ready=0;
  end
  $display("PASS 256 actual TS CPU vectors through physical fetch+decode, bus/domain and downstream stalls");$finish;
 end
 initial begin #10000000;$fatal(1,"timeout");end
endmodule
