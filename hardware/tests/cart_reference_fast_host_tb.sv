`timescale 1ns/1ps
// Independent pin-level host drives the reference cartridge faster than the
// console's CAD bridge so a new transfer overlaps a previous physical drain.
// READY remains the only host completion handshake; no owner state is forced.
module cart_reference_fast_host_tb;
 reg clk=0;always #14.76285 clk=!clk;
 reg power_reset_n=0,reset_n=0,cs_n=1,cal_lo=0,cal_hi=0,rd_n=1,wr_n=1;
 reg [1:0] be_n=3;reg host_oe=0;reg [15:0] host_data=0;
 tri [15:0] cad,ram_data,rom_data;
 assign cad=host_oe ? host_data : 16'hzzzz;
 wire ready_n,irq_n,dreq_read,dreq_write;
 wire [3:0] rom_address,ram_address;wire rom_ce_n,rom_oe_n,ram_ce_n,ram_oe_n,ram_we_n;
 wire [1:0] ram_be_n;wire part_drive;
 wire [7:0] rom_lo=8'h10+{rom_address,1'b0}, rom_hi=8'h11+{rom_address,1'b0};
 assign #(70,70,20) rom_data=!rom_ce_n && !rom_oe_n ? {rom_hi,rom_lo} : 16'hzzzz;
 cart_reference_card #(.ROM_ADDRESS_WIDTH(4),.ROM_BYTES(13),.RAM_ADDRESS_WIDTH(4),.RAM_BYTES(13)) card(.*);
 issi_bll_pin_model #(.ADDRESS_WIDTH(4)) memory(.address(ram_address),.data(ram_data),.ce_n(ram_ce_n),.oe_n(ram_oe_n),.we_n(ram_we_n),.be_n(ram_be_n),.drive_active(part_drive));
 integer write_pulses=0,rom_accepts=0,ram_overlap=0,rom_withdrawn=0;
 always @(negedge ram_we_n) if(power_reset_n) write_pulses=write_pulses+1;
 always @(posedge clk) begin
  if(card.rom.req_valid && card.rom_ready) rom_accepts=rom_accepts+1;
  if(card.phase==3 && card.ram_busy && card.request_strobe) ram_overlap=ram_overlap+1;
  if(card.phase==1 && card.rom_ready && !card.read_strobe && !cs_n) rom_withdrawn=rom_withdrawn+1;
  if(host_oe && !cs_n && !rd_n && !ready_n) $fatal(1,"host and card drive CAD together");
 end
 task automatic address(input [31:0] a,input [1:0] width);
  begin
   @(negedge clk);cs_n=0;host_oe=1;host_data=a[15:0];be_n=width;cal_lo=1;
   @(negedge clk);cal_lo=0;
   @(negedge clk);host_data=a[31:16];cal_hi=1;
   @(negedge clk);cal_hi=0;
   @(negedge clk);be_n=0;
  end
 endtask
 task automatic idle_bus;
  begin @(negedge clk);cs_n=1;rd_n=1;wr_n=1;host_oe=0;be_n=3;end
 endtask
 task automatic read_byte(input [31:0] a,input [7:0] expected);
  begin
   address(a,0);host_oe=0;rd_n=0;
   wait(!ready_n);#1;if(cad[7:0]!==expected) $fatal(1,"read %h got %h expected %h",a,cad,expected);
   idle_bus();
  end
 endtask
 integer before_pulses,before_accepts;
 initial begin #100000;$fatal(1,"timeout");end
 initial begin
  repeat(3) @(negedge clk);power_reset_n=1;reset_n=1;wait(card.ram_init);repeat(3) @(negedge clk);
  // Write odd U32 in two CAD halfwords, withdraw once SRAM has accepted it.
  before_pulses=write_pulses;address(32'h30000001,2);host_data=16'h3344;wr_n=0;
  wait(!ready_n);@(negedge clk);wr_n=1;wait(ready_n);@(negedge clk);host_data=16'h1122;wr_n=0;
  wait(!ram_we_n);idle_bus();
  // New read arrives while the accepted three-pulse write drains.
  read_byte(32'h30000001,8'h44);
  if(ram_overlap==0 || write_pulses-before_pulses!=3) $fatal(1,"fast host did not overlap full write drain");
  read_byte(32'h30000002,8'h33);read_byte(32'h30000003,8'h22);read_byte(32'h30000004,8'h11);
  // Start a slow odd U32 ROM read and withdraw after OE goes active.
  address(32'h10000001,2);host_oe=0;rd_n=0;wait(!rom_oe_n);idle_bus();
  // Offer another read during the previous ROM operation. Withdraw precisely
  // after its owner returns ready but before the next accepting clock edge.
  address(32'h10000005,0);host_oe=0;rd_n=0;
  wait(card.phase==1 && !card.rom_ready);before_accepts=rom_accepts;
  wait(card.rom_ready);#1;rd_n=1;
  @(posedge clk);#1;if(rom_withdrawn!=1 || rom_accepts!=before_accepts) $fatal(1,"withdrawn ROM request was accepted");
  idle_bus();repeat(4) @(negedge clk);
  read_byte(32'h10000005,8'h15);
  if(rom_accepts!=before_accepts+1) $fatal(1,"unexpected ROM request count");
  $display("PASS reference card fast-host: read during 3-pulse SRAM drain and ROM withdrawal at ready without stale completion");$finish;
 end
endmodule
