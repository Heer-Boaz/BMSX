`timescale 1ns/1ps
// Cartridge-local x16 ROM scalar reader. The source card supplies the original
// byte offset and 1/2/4-byte width. Missing bytes read as zero, without wrapping
// to the start of a smaller ROM. Word assembly is little endian; odd starts use
// up to three physical halfword reads. This owner supplies address/CE/OE only;
// ROM programming and card-level bus arbitration are outside its ownership.
// ADDRESS_WIDTH and CAPACITY_BYTES describe the actual fitted decoder: the
// physical address/bank pins must cover the installed capacity.
//
// SST39VF6401B-70 reference: tAA/tCE <=70 ns, tOHZ/tCHZ <=20 ns and
// reset-recovery tRHR >=50 ns. Four 33.8688 MHz clocks give 118 ns address/CE/OE
// before capture, followed by one released clock before changing address.
// Three reset-release samples provide at least two complete clocks of recovery.
// The shared physical reset must separately meet the 500 ns minimum assertion
// and the manufacturer's power-up requirements. Not board/die timing closure.
// Manufacturer: https://ww1.microchip.com/downloads/aemDocuments/documents/MPD/ProductDocuments/DataSheets/SST39VF6401B-SST39VF6402B-64-Mbit-x16-Multi-Purpose-Flash-Plus-20005008.pdf
// Ordinary reset withdraws unfinished reads and releases ROM CE/OE. There is no
// guessed maximum wait or software-visible timing reduction.
// Reference design pattern: Milkymist norflash16 separates address/CE timing
// and halfword capture, https://github.com/m-labs/milkymist.
module cart_rom_scalar #(
    parameter integer ADDRESS_WIDTH=22,
    parameter [32:0] CAPACITY_BYTES=33'd8388608
)(
    input wire clk, reset_n,
    input wire req_valid,
    output wire req_ready,
    input wire [31:0] req_offset,
    input wire [2:0] req_size_bytes,
    output wire rsp_valid,
    output reg [31:0] rsp_rdata,
    input wire [15:0] rom_data,
    output wire [ADDRESS_WIDTH-1:0] rom_address,
    output wire rom_ce_n, rom_oe_n
);
    localparam [1:0] IDLE=0, READ=1, RELEASE=2, RESPONSE=3;
    reg [1:0] state, read_clocks;
    reg [2:0] reset_release;
    reg [31:0] next_offset;
    reg [2:0] remaining, byte_index;
    wire [32:0] available = CAPACITY_BYTES - {1'b0,req_offset};
    wire [2:0] count = next_offset[0] || remaining==1 ? 1 : 2;
    wire [15:0] portion = next_offset[0] ? {8'b0,rom_data[15:8]} : rom_data;
    wire [31:0] bytes = count==1 ? {24'b0,portion[7:0]} : {16'b0,portion};
    assign req_ready=reset_release[2] && state==IDLE;
    assign rsp_valid=reset_release[2] && state==RESPONSE;
    assign rom_address=next_offset[ADDRESS_WIDTH:1];
    assign rom_ce_n=!(reset_n && reset_release[2] && state==READ);
    assign rom_oe_n=rom_ce_n;
    always @(posedge clk or negedge reset_n) begin
        if(!reset_n) reset_release<=0;
        else reset_release<={reset_release[1:0],1'b1};
    end
    always @(posedge clk or negedge reset_n) begin
        if(!reset_n) begin
            state<=IDLE;read_clocks<=0;next_offset<=0;remaining<=0;byte_index<=0;rsp_rdata<=0;
        end else case(state)
            IDLE: if(req_valid && req_ready) begin
                rsp_rdata<=0;byte_index<=0;read_clocks<=0;
                if({1'b0,req_offset}>=CAPACITY_BYTES) state<=RESPONSE;
                else begin
                    next_offset<=req_offset;
                    remaining<=available<req_size_bytes ? available[2:0] : req_size_bytes;
                    state<=READ;
                end
            end
            READ: if(read_clocks==3) begin
                rsp_rdata<=rsp_rdata | (bytes << (byte_index*8));
                read_clocks<=0;state<=RELEASE;
            end else read_clocks<=read_clocks+1'b1;
            RELEASE: if(remaining==count) state<=RESPONSE;
            else begin
                remaining<=remaining-count;next_offset<=next_offset+count;
                byte_index<=byte_index+count;state<=READ;
            end
            RESPONSE: state<=IDLE;
        endcase
    end
endmodule
