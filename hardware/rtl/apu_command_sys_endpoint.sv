`timescale 1ns/1ps
// U4 SYS transport for the command ingress owned by APU control.
// Other APU register addresses belong to their own endpoint and are not
// acknowledged here. HEADER and ADDRESS are captured from the actual SYS pins;
// the data owner is invoked exactly once, and its registered response is held
// until the initiating DATA strobe is acknowledged. RESPONSE returns the raw
// fault word. The ingress timeline gate applies only to CMD writes.
//
// A timed initiator may withdraw DATA before READY. Before owner acceptance
// this removes the request; after owner acceptance the operation is not rolled
// back, even if the initiator times out. The owner's one-cycle response is
// drained before this endpoint accepts the next packet. This does not replace
// the missing APU scheduler, source binder, fault latch or selected-slot bank.
// Reference protocol ownership: OpenTitan TL-UL register adapter retains each
// accepted register operation separately from its response.
// https://github.com/lowRISC/opentitan/blob/master/hw/ip/tlul/rtl/tlul_adapter_reg.sv
module apu_command_sys_endpoint (
    input wire clk,reset_n,cs_apu_n,
    input wire [31:0] bus_ad_in,
    input wire bus_as_n,bus_rd_n,bus_wr_n,
    input wire [3:0] bus_be_n,
    output wire [31:0] bus_ad_out,
    output wire bus_ad_oe,bus_ready_drive_low,
    output wire local_valid,local_write,output wire [4:0] local_index,
    output wire [31:0] local_wdata,input wire local_ready,local_response_valid,
    input wire [31:0] local_response_data
);
    localparam [2:0] HEADER=0,ADDRESS=1,DATA=2,WAIT_LOCAL=3,ACK=4,RESPONSE=5;
    reg [2:0] phase;
    reg [31:0] address_word,read_word,response_word;
    reg [3:0] byte_enables,operation;
    reg selected,data_seen;
    wire data_read=bus_as_n && !bus_rd_n && bus_wr_n;
    wire data_write=bus_as_n && bus_rd_n && !bus_wr_n;
    wire data_active=data_read || data_write;
    wire full_word=address_word[1:0]==0 && byte_enables==0;
    wire access_normal=operation==4'hf && full_word;
    assign local_valid=reset_n && selected && phase==DATA && data_active && access_normal;
    assign local_write=data_write;
    assign local_index=(address_word-32'h08000120)>>2;
    assign local_wdata=bus_ad_in;
    wire immediate=selected && phase==DATA && data_active && !access_normal;
    wire ack=immediate || selected && phase==ACK && data_active;
    wire response=selected && phase==RESPONSE && bus_as_n && !bus_rd_n && !bus_wr_n;
    assign bus_ready_drive_low=reset_n && (ack || response);
    assign bus_ad_oe=reset_n && (response || ack && data_read);
    assign bus_ad_out=response ? response_word : phase==ACK ? read_word : 32'd0;
    always @(posedge clk or negedge reset_n) begin
        if(!reset_n) begin
            phase<=HEADER;address_word<=0;read_word<=0;response_word<=0;
            byte_enables<=4'hf;operation<=4'hf;selected<=0;data_seen<=0;
        end else case(phase)
            HEADER: if(!bus_as_n) begin
                operation<=bus_be_n;selected<=0;data_seen<=0;phase<=ADDRESS;
            end
            ADDRESS: begin
                address_word<=bus_ad_in;byte_enables<=bus_be_n;
                selected<=!cs_apu_n && bus_ad_in>=32'h08000120 && bus_ad_in<32'h08000178;
                phase<=DATA;
            end
            DATA: begin
                if(data_active) data_seen<=1;
                if(immediate) begin
                    response_word<=operation!=4'hf ? 32'd1 : 32'd2;phase<=RESPONSE;
                end else if(local_valid && local_ready) phase<=WAIT_LOCAL;
                else if(data_seen && !data_active) begin phase<=HEADER;selected<=0;end
            end
            WAIT_LOCAL: if(local_response_valid) begin
                read_word<=local_response_data;response_word<=0;
                if(data_active) phase<=ACK;
                else begin phase<=HEADER;selected<=0;end
            end
            ACK: if(data_active) phase<=RESPONSE;
                 else begin phase<=HEADER;selected<=0;end
            RESPONSE: if(response) begin phase<=HEADER;selected<=0;end
        endcase
    end
endmodule
