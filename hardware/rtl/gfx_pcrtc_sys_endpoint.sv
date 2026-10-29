`timescale 1ns/1ps
// PCRTC configuration/status-word endpoint on the multiplexed SYS bus. The bus
// transfers HEADER, ADDRESS, DATA and RESPONSE in distinct phases; a word
// write reaches the PCRTC owner only on the accepted DATA edge. The two
// configuration ranges are decoded independently, including every retained
// high word, including CSR and IMR. GPU command ports are separate owners and
// are not answered here. Withdrawal before DATA admission has no register side effect.
// The endpoint neither defines display-latch timing nor supplies clock CDC.
// Register transaction ownership follows the same separation used by the
// OpenTitan TL-UL register adapter:
// https://github.com/lowRISC/opentitan/blob/master/hw/ip/tlul/rtl/tlul_adapter_reg.sv
module gfx_pcrtc_sys_endpoint (
 input wire clk,reset_n,cs_pcrtc_n,
 input wire [31:0] bus_ad_in,
 input wire bus_as_n,bus_rd_n,bus_wr_n,
 input wire [3:0] bus_be_n,
 output wire [31:0] bus_ad_out,
 output wire bus_ad_oe,bus_ready_drive_low,
 output wire config_valid,config_write,
 output wire [4:0] config_index,
 output wire [31:0] config_write_word,
 input wire config_ready,
 input wire [31:0] config_read_word
);
 localparam [1:0] HEADER=0,ADDRESS=1,DATA=2,RESPONSE=3;
 reg [1:0] phase;
 reg [31:0] address_word,response_word;
 reg [3:0] byte_enables,operation;
 reg selected,data_seen;
 wire data_read=bus_as_n && !bus_rd_n && bus_wr_n;
 wire data_write=bus_as_n && bus_rd_n && !bus_wr_n;
 wire data_phase=phase==DATA && (data_read || data_write);
 wire response_phase=phase==RESPONSE && bus_as_n && !bus_rd_n && !bus_wr_n;
 wire full_word=address_word[1:0]==0 && byte_enables==0;
 wire normal=operation==4'hf;
 wire accept=reset_n && selected && data_phase && (!normal || !full_word || config_ready);
 assign config_valid=reset_n && selected && data_phase && normal && full_word;
 assign config_write=data_write;
 assign config_index=address_word<32'h080103ac ?
     (address_word-32'h08010354)>>2 : 5'd12+((address_word-32'h080103ac)>>2);
 assign config_write_word=bus_ad_in;
 assign bus_ready_drive_low=accept || reset_n && selected && response_phase;
 assign bus_ad_oe=reset_n && selected && (accept && data_read || response_phase);
 assign bus_ad_out=response_phase ? response_word : normal && full_word ? config_read_word : 32'd0;
 always @(posedge clk or negedge reset_n) begin
  if(!reset_n) begin
   phase<=HEADER;address_word<=0;response_word<=0;byte_enables<=4'hf;
   operation<=4'hf;selected<=0;data_seen<=0;
  end else case(phase)
   HEADER: if(!bus_as_n) begin operation<=bus_be_n;selected<=0;data_seen<=0;phase<=ADDRESS;end
   ADDRESS: begin
    address_word<=bus_ad_in;byte_enables<=bus_be_n;
    selected<=!cs_pcrtc_n && ((bus_ad_in>=32'h08010354 && bus_ad_in<32'h08010384) ||
                              (bus_ad_in>=32'h080103ac && bus_ad_in<32'h080103e4));
    phase<=DATA;
   end
   DATA: begin
    if(data_phase) data_seen<=1;
    if(accept) begin response_word<=normal ? (full_word ? 32'd0 : 32'd2) : 32'd1;phase<=RESPONSE;end
    else if(data_seen && bus_as_n && bus_rd_n && bus_wr_n) begin phase<=HEADER;selected<=0;end
   end
   RESPONSE: if(response_phase) begin phase<=HEADER;selected<=0;end
  endcase
 end
endmodule
