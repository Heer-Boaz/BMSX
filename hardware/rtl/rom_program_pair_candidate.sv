`timescale 1ns/1ps
// Candidate native-interpreter store sharing U33's address/data conductors.
// HEADER BE_N=C selects the private native-code device; normal HEADER BE_N=F
// selects the existing guest system ROM. The SYS master must generate C only
// for native fetches, never from a BLua32 address or guest-controlled metadata.
// Both stores contain up to 8 MiB and are otherwise addressed identically.
// The existing endpoint still supplies guest zero-region, faults and timing.
// The two physical pads currently named ROM_CE_N and ROM_OE_N become active-
// low per-device chip selects; both flash OE_N pins are tied low in this ECO.
// The endpoint deasserts CE for each halfword release. Its one-system-clock
// release exceeds the specified 20 ns output-disable time nominally. Pad,
// PCB, flash loading, physical timing and reset/PLL startup are unqualified.
// This is not connected to a native CPU or a schematic/board ECO. Isolation
// from guest, DMA and APU requires a native-only HEADER producer; it is not
// proven here. No programmer-visible map change is proposed.
// Analogous conventional shared async memory with separate chip selects and
// explicit turnaround: TI TMS320DSC24, SPRU574 section 5.3.
module rom_program_pair_candidate (
 input wire clk,reset_n,cs_rom_n,
 input wire [31:0] bus_ad_in,
 input wire bus_as_n,bus_rd_n,bus_wr_n,
 input wire [3:0] bus_be_n,
 output wire [31:0] bus_ad_out,
 output wire bus_ad_oe,bus_ready_drive_low,
 input wire [15:0] flash_data,
 output wire [21:0] flash_address,
 output wire guest_ce_n,native_ce_n
);
 reg previous_as_n,native_select;
 wire access_ce_n,unused_oe_n;
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin previous_as_n<=1;native_select<=0;end
  else begin
   previous_as_n<=bus_as_n;
   if(previous_as_n && !bus_as_n) native_select<=bus_be_n==4'hc;
  end
 end
 rom_sys_endpoint endpoint(.clk(clk),.reset_n(reset_n),.cs_rom_n(cs_rom_n),
  .bus_ad_in(bus_ad_in),.bus_as_n(bus_as_n),.bus_rd_n(bus_rd_n),.bus_wr_n(bus_wr_n),
  .bus_be_n(bus_be_n),.bus_ad_out(bus_ad_out),.bus_ad_oe(bus_ad_oe),
  .bus_ready_drive_low(bus_ready_drive_low),.flash_data(flash_data),.flash_address(flash_address),
  .flash_ce_n(access_ce_n),.flash_oe_n(unused_oe_n));
 assign guest_ce_n=access_ce_n || native_select;
 assign native_ce_n=access_ce_n || !native_select;
endmodule
