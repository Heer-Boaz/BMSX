`timescale 1ns/1ps
// Replay actual TS CPU vectors at full one-entry decoder throughput. Vary
// downstream readiness, retain all output fields under backpressure and
// verify simultaneous retire/admit including 32-bit PC/branch wrap.
module cpu_instruction_decode_stream_tb;
 reg clk=0;always #5 clk=~clk;reg reset_n=0,req_valid=0,rsp_ready=0;
 reg [31:0] pc=0,prefix=0,body=0;reg iw=0;
 wire req_ready,rsp_valid,wide,nested,reserved;wire [31:0] out_pc,next_pc,sbx,rkb,rkc,target;wire [5:0] op;wire [13:0] a;wire [14:0] b,c;wire [25:0] bx;wire [7:0] disp;
 cpu_instruction_decode dut(.clk(clk),.reset_n(reset_n),.req_valid(req_valid),.req_ready(req_ready),.req_pc(pc),.req_prefix(prefix),.req_body(body),.req_wide(iw),.rsp_valid(rsp_valid),.rsp_ready(rsp_ready),.rsp_pc(out_pc),.rsp_next_pc(next_pc),.rsp_opcode(op),.rsp_a(a),.rsp_b(b),.rsp_c(c),.rsp_bx(bx),.rsp_sbx(sbx),.rsp_rkb(rkb),.rsp_rkc(rkc),.rsp_branch_target(target),.rsp_disp(disp),.rsp_wide(wide),.rsp_nested_wide(nested),.rsp_reserved_memory(reserved));
 reg [31:0] v[0:15][0:16383];reg [31:0] t0,t1,t2,t3,t4,t5,t6,t7,t8,t9,t10,t11,t12,t13,t14,t15;integer f,n,rc,count,send=0,recv=0,cycles=0,stalls=0,duals=0;reg held=0;reg [278:0] prior;
 wire [278:0] allbits={out_pc,next_pc,op,a,b,c,bx,sbx,rkb,rkc,target,disp,wide,nested,reserved};
 initial begin
 f=$fopen("build/tests/cpu-instruction-decode-vectors.txt","r");if(!f)$fatal(1,"vectors");rc=$fscanf(f,"%d\n",count);
 for(n=0;n<count;n=n+1)begin rc=$fscanf(f,"%h %h %h %h %h %h %h %h %h %h %h %h %h %h %h %h\n",t0,t1,t2,t3,t4,t5,t6,t7,t8,t9,t10,t11,t12,t13,t14,t15);v[0][n]=t0;v[1][n]=t1;v[2][n]=t2;v[3][n]=t3;v[4][n]=t4;v[5][n]=t5;v[6][n]=t6;v[7][n]=t7;v[8][n]=t8;v[9][n]=t9;v[10][n]=t10;v[11][n]=t11;v[12][n]=t12;v[13][n]=t13;v[14][n]=t14;v[15][n]=t15;if(rc!=16)$fatal(1,"bad vector");if((n&15)==0)begin v[0][n]=32'hfffffffc;v[12][n]=v[0][n]+(v[3][n]?8:4)+(v[9][n]<<2);end end
 repeat(2)@(negedge clk);reset_n=1;
 while(recv<count)begin @(negedge clk);rsp_ready=(cycles%13)<7;
  if(!req_valid&&send<count)begin req_valid=1;pc=v[0][send];prefix=v[1][send];body=v[2][send];iw=v[3][send];end
 end
 if(stalls==0||duals<1000)$fatal(1,"missing stream stalls/replacement %0d/%0d",stalls,duals);
 $display("PASS %0d continuous decodes, %0d stalls and %0d simultaneous retire+admit, includes 32-bit wrap",recv,stalls,duals);$finish;
 end
 always @(posedge clk)if(reset_n)begin
 cycles=cycles+1;if(held&&(!rsp_valid||allbits!==prior))$fatal(1,"response not stable");held=rsp_valid&&!rsp_ready;prior=allbits;
 if(req_valid&&!req_ready)stalls=stalls+1;
 if(req_valid&&req_ready)begin send=send+1;req_valid<=0;end
 if(req_valid&&req_ready&&rsp_valid&&rsp_ready)duals=duals+1;
 if(rsp_valid&&rsp_ready)begin
  if(out_pc!==v[0][recv]||next_pc!==(v[0][recv]+(v[3][recv]?8:4))||op!==v[4][recv][5:0]||a!==v[5][recv][13:0]||b!==v[6][recv][14:0]||c!==v[7][recv][14:0]||bx!==v[8][recv][25:0]||sbx!==v[9][recv]||rkb!==v[10][recv]||rkc!==v[11][recv]||target!==v[12][recv]||disp!==v[13][recv][7:0]||reserved!==v[14][recv][0]||nested!==v[15][recv][0]||wide!==v[3][recv][0])$fatal(1,"mismatch %0d pc=%h target=%h exp=%h",recv,out_pc,target,v[12][recv]);
  recv=recv+1;
 end end
 initial begin #10000000;$fatal(1,"timeout");end
endmodule
