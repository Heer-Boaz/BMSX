`timescale 1ns/1ps
// Exhaust all rotating-owner and request-mask combinations; a held request
// survives new arrivals and an accepted read may respond on the same edge.
// This uses an ideal slot-memory interface, not a timing guarantee.
module cpu_value_store_rotor_tb;
reg clk=0;always #5 clk=~clk;reg reset_n=0;reg raw_valid=0,wr_valid=0,rd_valid=0,mem_ready=0;
wire raw_ready,wr_ready,rd_ready,raw_rsp_valid,rd_rsp_valid,mem_valid,mem_write,mem_rsp_ready;wire[31:0] mem_address;wire[67:0] mem_wdata;
wire mem_rsp_valid=mem_valid&&mem_ready&&!mem_write;
cpu_value_store d(.clk(clk),.reset_n(reset_n),.frame_base(32'd100),.constant_base(32'd200),
.slot_read_valid(rd_valid),.slot_read_ready(rd_ready),.slot_read_constant(1'b1),.slot_read_index(15'd3),.slot_rsp_valid(rd_rsp_valid),.slot_rsp_ready(1'b1),.slot_rsp_is_number(),.slot_rsp_payload(),
.slot_write_valid(wr_valid),.slot_write_ready(wr_ready),.slot_write_index(14'd2),.slot_write_number(64'h11),
.raw_valid(raw_valid),.raw_ready(raw_ready),.raw_write(1'b1),.raw_constant(1'b0),.raw_index(32'd1),.raw_kind(4'd8),.raw_payload(64'h22),.raw_rsp_valid(raw_rsp_valid),.raw_rsp_ready(1'b1),.raw_rsp_kind(),.raw_rsp_payload(),
.mem_valid(mem_valid),.mem_ready(mem_ready),.mem_write(mem_write),.mem_address(mem_address),.mem_wdata(mem_wdata),.mem_rsp_valid(mem_rsp_valid),.mem_rsp_ready(mem_rsp_ready),.mem_rsp_data(68'h3123456789abcdef0),.mem_fault_valid(1'b0),.raw_fault(),.slot_write_fault(),.slot_read_fault());
integer rot,mask,k,exp,n=0;reg [31:0] original_addr;reg [67:0] original_data;reg original_write;
initial begin
 for(rot=0;rot<3;rot=rot+1) for(mask=0;mask<8;mask=mask+1)begin
  @(negedge clk);reset_n=0;raw_valid=0;wr_valid=0;rd_valid=0;mem_ready=0;@(negedge clk);reset_n=1;
  if(rot==0)rd_valid=1;else if(rot==1)raw_valid=1;else wr_valid=1;
  mem_ready=1;@(negedge clk);raw_valid=0;wr_valid=0;rd_valid=0;mem_ready=0;#1;
  if(d.next_owner!==rot)$fatal(1,"bad rotor");
  raw_valid=mask[0];wr_valid=mask[1];rd_valid=mask[2];#1;
  if(mask==0)begin if(mem_valid)$fatal(1,"grant idle");end
  else begin
   exp=-1;for(k=0;k<3;k=k+1)if(exp<0 && ((mask >> ((rot+k)%3))&1))exp=(rot+k)%3;
   original_addr=mem_address;original_data=mem_wdata;original_write=mem_write;
   if(!mem_valid || (exp==0&&mem_address!=101) || (exp==1&&mem_address!=102) || (exp==2&&mem_address!=203))$fatal(1,"wrong grant rot=%d mask=%d exp=%d addr=%d",rot,mask,exp,mem_address);
   @(negedge clk);raw_valid=1;wr_valid=1;rd_valid=1;#1;
   if(!mem_valid || mem_address!==original_addr || mem_wdata!==original_data || mem_write!==original_write)$fatal(1,"held request changed");
   mem_ready=1;#1;
   if((exp==0&&!raw_ready)||(exp==1&&!wr_ready)||(exp==2&&!rd_ready))$fatal(1,"wrong held acceptance");
   if(exp==2 && (!rd_rsp_valid || !mem_rsp_ready))$fatal(1,"direct read response");
   @(negedge clk);#1;if(d.next_owner!==((exp+1)%3))$fatal(1,"wrong next rotor");n=n+1;
  end
 end
 $display("PASS %0d nonempty rotor/subset cases with inserted arrivals, held stable request and immediate response",n);$finish;
end
initial begin #100000;$fatal(1,"timeout");end
endmodule
