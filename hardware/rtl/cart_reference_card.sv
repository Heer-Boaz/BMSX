`timescale 1ns/1ps
// Reference card endpoint: one CAD transaction owner, one physical ROM
// reader, one exclusive x16 SRAM scalar owner and the optional mailbox. The
// console presents the original byte address in CAL_LO/CAL_HI. CBE_N on the
// first CAL_LO distinguishes scalar width or the legacy halfword ROM profile.
// No queue or second SRAM pin driver exists; a new RAM operation waits for the
// SRAM owner, including the drain of a previously accepted write after reset.
//
// The flash pins target an SST39VF6401B-70 reference; its RESET_N, WE_N, WP_N,
// supply and package wiring remain card design responsibilities. 8 MiB is one
// reference chip, not a reduction of the 512 MiB public ROM window. A larger
// card supplies an appropriately sized/banked physical ROM interface.
// ASIC pad delays, card/board SI, power-on and reset waveforms need closure.
module cart_reference_card #(
    parameter integer ROM_ADDRESS_WIDTH=22,
    parameter [32:0] ROM_BYTES=33'd8388608,
    parameter integer RAM_ADDRESS_WIDTH=18,
    parameter [32:0] RAM_BYTES=33'd524288,
    parameter MAILBOX_PRESENT=1'b1
)(
    input wire clk,power_reset_n,reset_n,cs_n,cal_lo,cal_hi,rd_n,wr_n,
    input wire [1:0] be_n,
    inout wire [15:0] cad,
    output wire ready_n,irq_n,dreq_read,dreq_write,
    input wire [15:0] rom_data,
    output wire [ROM_ADDRESS_WIDTH-1:0] rom_address,
    output wire rom_ce_n,rom_oe_n,
    inout wire [15:0] ram_data,
    output wire [RAM_ADDRESS_WIDTH-1:0] ram_address,
    output wire ram_ce_n,ram_oe_n,ram_we_n,
    output wire [1:0] ram_be_n
);
    localparam [3:0] WAIT_HOST=0, ROM_REQUEST=1, ROM_WAIT=2, RAM_REQUEST=3,
        RAM_WAIT=4, READ_SETUP=5, READ_ACK=6, WRITE_ACK=7;
    reg [3:0] phase;
    reg cal_lo_previous,cal_hi_previous,legacy,half,request_write;
    reg [31:0] address,write_value,read_value,mail_data,mail_control;
    reg [2:0] size_bytes;
    reg pending;
    wire rom_ready,rom_rsp,ram_ready,ram_rsp,ram_init,ram_busy;
    wire [31:0] rom_result,ram_result;
    wire selected = power_reset_n && reset_n && !cs_n;
    wire read_strobe = selected && !rd_n && wr_n;
    wire write_strobe = selected && rd_n && !wr_n;
    wire request_strobe = request_write ? write_strobe : read_strobe;
    wire [31:0] mmio_offset = address-32'h30f00000;
    reg [31:0] mmio_read;
    always @* begin
        case(mmio_offset[31:2])
            0: mmio_read=mail_data;
            1: mmio_read=mail_control;
            2: mmio_read={31'b0,pending};
            default: mmio_read=0;
        endcase
    end
    assign ready_n=!(selected && ((phase==READ_ACK && read_strobe) ||
                                 (phase==WRITE_ACK && write_strobe)));
    assign cad=selected && (phase==READ_SETUP || phase==READ_ACK) && read_strobe ?
        (half ? read_value[31:16] : read_value[15:0]) : 16'bz;
    assign irq_n=!pending;
    assign dreq_read=mail_control[1];
    assign dreq_write=mail_control[2];
    cart_rom_scalar #(.ADDRESS_WIDTH(ROM_ADDRESS_WIDTH),.CAPACITY_BYTES(ROM_BYTES)) rom (
        .clk(clk),.reset_n(reset_n && power_reset_n),
        .req_valid(phase==ROM_REQUEST && read_strobe),.req_ready(rom_ready),
        .req_offset(address-32'h10000000),.req_size_bytes(size_bytes),
        .rsp_valid(rom_rsp),.rsp_rdata(rom_result),.rom_data(rom_data),
        .rom_address(rom_address),.rom_ce_n(rom_ce_n),.rom_oe_n(rom_oe_n)
    );
    cart_ram_scalar #(.ADDRESS_WIDTH(RAM_ADDRESS_WIDTH),.CAPACITY_BYTES(RAM_BYTES)) ram (
        .clk(clk),.power_reset_n(power_reset_n),.reset_n(reset_n),
        .req_valid(phase==RAM_REQUEST && request_strobe),.req_ready(ram_ready),
        .req_write(request_write),.req_offset(address-32'h30000000),
        .req_size_bytes(size_bytes),.req_wdata(write_value),
        .rsp_valid(ram_rsp),.rsp_rdata(ram_result),.init_done(ram_init),.busy(ram_busy),
        .mem_data(ram_data),.mem_address(ram_address),.mem_ce_n(ram_ce_n),
        .mem_oe_n(ram_oe_n),.mem_we_n(ram_we_n),.mem_be_n(ram_be_n)
    );
    wire card_reset_n=power_reset_n && reset_n;
    always @(posedge clk or negedge card_reset_n) begin
        if(!card_reset_n) begin
            phase<=WAIT_HOST;cal_lo_previous<=0;cal_hi_previous<=0;legacy<=0;half<=0;
            request_write<=0;address<=0;write_value<=0;read_value<=0;size_bytes<=0;
            mail_data<=0;mail_control<=0;pending<=0;
        end else begin
            cal_lo_previous<=cal_lo;cal_hi_previous<=cal_hi;
            if(!cs_n && cal_lo_previous && !cal_lo) begin
                address[15:0]<=cad;half<=0;legacy<=be_n==2'b11;
                case(be_n)
                    0:size_bytes<=1;
                    1:size_bytes<=2;
                    2:size_bytes<=4;
                    3:size_bytes<=2;
                endcase
            end
            if(!cs_n && cal_hi_previous && !cal_hi) address[31:16]<=cad;
            if(cs_n) begin phase<=WAIT_HOST;half<=0;end
            else case(phase)
                WAIT_HOST: if(read_strobe) begin
                    if(half) phase<=READ_SETUP;
                    else if(address<32'h30000000) phase<=ROM_REQUEST;
                    else if(address<32'h30f00000) begin request_write<=0;phase<=RAM_REQUEST;end
                    else begin
                        if(!MAILBOX_PRESENT) read_value<=0;
                        else case(size_bytes)
                            1: read_value<=(mmio_read >> (address[1:0]*8)) & 32'hff;
                            2: read_value<=(mmio_read >> (address[1]*16)) & 32'hffff;
                            4: read_value<=mmio_read;
                        endcase
                        phase<=READ_SETUP;
                    end
                end else if(write_strobe) begin
                    if(size_bytes==4 && !half) begin
                        write_value[15:0]<=cad;phase<=WRITE_ACK;
                    end else begin
                        case(size_bytes)
                            1: write_value<={24'b0,cad[7:0]};
                            2: write_value<={16'b0,cad};
                            4: write_value[31:16]<=cad;
                        endcase
                        if(address>=32'h30000000 && address<32'h30f00000) begin
                            request_write<=1;phase<=RAM_REQUEST;
                        end else begin
                            if(MAILBOX_PRESENT && size_bytes==4 && address>=32'h30f00000) begin
                                case(mmio_offset)
                                    0: mail_data<={cad,write_value[15:0]};
                                    4: begin
                                        mail_control<={cad,write_value[15:1],1'b0};
                                        if(write_value[0]) pending<=1;
                                    end
                                    12: if({cad,write_value[15:0]}!=0) pending<=0;
                                endcase
                            end
                            phase<=WRITE_ACK;
                        end
                    end
                end
                ROM_REQUEST: if(!read_strobe) begin phase<=WAIT_HOST;half<=0;end
                    else if(rom_ready) phase<=ROM_WAIT;
                ROM_WAIT: if(rom_rsp) begin read_value<=rom_result;phase<=READ_SETUP;end
                RAM_REQUEST: if(!request_strobe) begin phase<=WAIT_HOST;half<=0;end
                    else if(ram_ready) phase<=RAM_WAIT;
                RAM_WAIT: if(ram_rsp) begin
                    if(request_write) phase<=WRITE_ACK;
                    else begin read_value<=ram_result;phase<=READ_SETUP;end
                end
                READ_SETUP: phase<=READ_ACK;
                READ_ACK: if(!read_strobe) begin
                    if(!legacy && size_bytes==4 && !half) half<=1;
                    else half<=0;
                    phase<=WAIT_HOST;
                end
                WRITE_ACK: if(!write_strobe) begin
                    if(size_bytes==4 && !half) half<=1;
                    else half<=0;
                    phase<=WAIT_HOST;
                end
            endcase
        end
    end
endmodule
