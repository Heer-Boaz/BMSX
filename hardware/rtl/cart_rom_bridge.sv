`timescale 1ns/1ps
// U1 owner of the existing 16-bit buffered cartridge bus. Aligned full-word ROM
// reads retain the original physical profile. Scalar accesses use the same
// pins with size metadata during the first address latch; the card owns its
// device decoding, installed-capacity checks and write commit.
// CAL_LO/HI pulse high for one clock; the card latches the full BYTE-address
// portions on their falling edges. Each halfword sends its own address (A,A+2).
// Address setup/hold are each one clock. U51 OE is disabled before DIR changes;
// a full additional clock precedes re-enabling it. CRD and CAL are registered
// pins, not combinational FSM strobes. CART_CLK is the qualified system clock.
//
// Selected-card READY is level-qualified through two flops. Before each read
// the previous READY must have returned high. A card presents data >=20 ns
// before READY falls, holds it through CRD rising, and releases READY/data
// within one clock afterward. Two release clocks precede another address.
// Ordinary waits are unbounded; diagnostics select a raw last wait counter.
// An absent card reads zero, without a physical transaction. A present card
// owns unpopulated-ROM/partial-tail zeros; there is no capacity side channel.
// Extended CBE during CAL_LO is 00/01/10 for 1/2/4 bytes. During data it is
// the normal active-low byte mask: 10 for one byte, 00 for two bytes. Four
// bytes use two data phases, low half first, with the original scalar byte
// address retained on the card. The peer may take arbitrary time to commit a
// write before READY. A timeout after its final sample cannot undo that commit.
//
// Studied Milkymist norflash16's halfword capture/whole-word acknowledgement;
// its Wishbone encoding and fixed flash access counter are not imported.
module cart_rom_bridge (
    input wire clk, reset_n, cancel,
    input wire req_valid,
    output wire req_ready,
    input wire [31:0] req_address,
    input wire req_write,
    input wire [2:0] req_size_bytes,
    input wire [31:0] req_wdata,
    input wire [7:0] req_bus_signals,
    input wire selected_socket,
    input wire req_data_timeout_enable,
    input wire [17:0] req_data_wait_last,
    output wire rsp_valid,
    output reg [31:0] rsp_data, rsp_fault_code,
    output reg rsp_timeout,
    inout wire [15:0] cad,
    input wire [1:0] cart_ready_n, cart_present_n,
    output wire cal_lo, cal_hi, cart_clk, crd_n, cwr_n,
    output wire [1:0] cbe_n, cs_cart_n,
    output wire cart_dir, cart_oe_n
);
    localparam [4:0] IDLE=0, LO_SETUP=1, LO_PULSE=2, LO_HOLD=3,
        HI_SETUP=4, HI_PULSE=5, HI_HOLD=6, TURN0=7, TURN1=8,
        WAIT_IDLE=9, READ=10, RELEASE0=11, RELEASE1=12, ADDR_TURN=13, DONE=14,
        EXT_PREPARE=15, EXT_WAIT=16, EXT_DATA=17, EXT_RELEASE0=18,
        EXT_RELEASE1=19;
    reg [4:0] phase;
    reg [1:0] reset_release;
    (* async_reg = "true" *) reg [1:0] ready_meta, ready_sync, present_meta, present_sync;
    reg [31:0] address_word;
    reg socket_word, high_half, timeout_enable;
    reg extended, write_word;
    reg [2:0] size_word;
    reg [31:0] write_data_word;
    reg [17:0] wait_count, wait_last;
    reg [15:0] cad_out;
    reg cad_oe, pin_cal_lo, pin_cal_hi, pin_rd_n, pin_wr_n, pin_dir, pin_oe_n;
    reg [1:0] pin_be_n, pin_cs_n;
    wire qualified = reset_release[1] && !cancel;
    wire request_socket = req_bus_signals[2] ? req_bus_signals[3] : selected_socket;
    assign req_ready = qualified && (phase==IDLE || phase==DONE);
    assign rsp_valid = qualified && phase==DONE;
    assign cad = qualified && cad_oe ? cad_out : 16'bz;
    assign cart_clk = clk;
    assign cal_lo = qualified && pin_cal_lo;
    assign cal_hi = qualified && pin_cal_hi;
    assign crd_n = !qualified || pin_rd_n;
    assign cwr_n = !qualified || pin_wr_n;
    assign cbe_n = qualified ? pin_be_n : 2'b11;
    assign cs_cart_n = qualified ? pin_cs_n : 2'b11;
    assign cart_dir = pin_dir;
    assign cart_oe_n = !qualified || pin_oe_n;

    always @(posedge clk or negedge reset_n) begin
        if(!reset_n) begin
            reset_release<=0;ready_meta<=3;ready_sync<=3;present_meta<=3;present_sync<=3;
        end else begin
            reset_release<={reset_release[0],1'b1};
            ready_meta<=cart_ready_n;ready_sync<=ready_meta;
            present_meta<=cart_present_n;present_sync<=present_meta;
        end
    end
    always @(posedge clk or negedge reset_n) begin
        if(!reset_n) begin
            phase<=IDLE;address_word<=0;socket_word<=0;high_half<=0;
            timeout_enable<=0;wait_count<=0;wait_last<=0;extended<=0;
            write_word<=0;size_word<=0;write_data_word<=0;
            rsp_data<=0;rsp_fault_code<=0;rsp_timeout<=0;
            cad_out<=0;cad_oe<=0;pin_cal_lo<=0;pin_cal_hi<=0;
            pin_rd_n<=1;pin_wr_n<=1;pin_dir<=1;pin_oe_n<=1;pin_be_n<=3;pin_cs_n<=3;
        end else if(cancel) begin
            phase<=IDLE;cad_oe<=0;pin_cal_lo<=0;pin_cal_hi<=0;
            pin_rd_n<=1;pin_wr_n<=1;pin_oe_n<=1;pin_be_n<=3;pin_cs_n<=3;
        end else if(reset_release[1]) case(phase)
            IDLE, DONE: if(req_valid) begin
                address_word<=req_address;socket_word<=request_socket;high_half<=0;
                extended<=req_write || req_size_bytes!=4 || req_address[1:0]!=0 ||
                    req_address<32'h10000000 || req_address>=32'h30000000;
                write_word<=req_write;size_word<=req_size_bytes;write_data_word<=req_wdata;
                timeout_enable<=req_data_timeout_enable;wait_last<=req_data_wait_last;
                wait_count<=0;rsp_data<=0;rsp_fault_code<=0;rsp_timeout<=0;
                if(present_sync[request_socket]) phase<=DONE;
                else begin
                    cad_out<=req_address[15:0];cad_oe<=1;pin_dir<=1;pin_oe_n<=0;
                    if(req_write || req_size_bytes!=4 || req_address[1:0]!=0 ||
                       req_address<32'h10000000 || req_address>=32'h30000000)
                        case(req_size_bytes)
                            1: pin_be_n<=0;
                            2: pin_be_n<=1;
                            4: pin_be_n<=2;
                        endcase
                    pin_cs_n<=request_socket ? 2'b01 : 2'b10;phase<=LO_SETUP;
                end
            end else phase<=IDLE;
            LO_SETUP: begin pin_cal_lo<=1;phase<=LO_PULSE;end
            LO_PULSE: begin pin_cal_lo<=0;phase<=LO_HOLD;end
            LO_HOLD: begin cad_out<=address_word[31:16];phase<=HI_SETUP;end
            HI_SETUP: begin pin_cal_hi<=1;phase<=HI_PULSE;end
            HI_PULSE: begin pin_cal_hi<=0;phase<=HI_HOLD;end
            HI_HOLD: begin
                pin_be_n<=3;wait_count<=0;
                if(extended && write_word) phase<=EXT_PREPARE;
                else begin pin_oe_n<=1;cad_oe<=0;phase<=TURN0;end
            end
            TURN0: begin pin_dir<=0;phase<=TURN1;end
            TURN1: begin pin_oe_n<=0;phase<=extended ? EXT_PREPARE : WAIT_IDLE;end
            WAIT_IDLE: begin
                if(ready_sync[socket_word]) begin pin_rd_n<=0;pin_be_n<=0;phase<=READ;end
                else if(timeout_enable && wait_count==wait_last) begin
                    rsp_timeout<=1;pin_oe_n<=1;phase<=RELEASE0;
                end else if(timeout_enable) wait_count<=wait_count+1'b1;
            end
            READ: begin
                if(!ready_sync[socket_word]) begin
                    if(high_half) rsp_data[31:16]<=cad;else rsp_data[15:0]<=cad;
                    pin_rd_n<=1;pin_be_n<=3;pin_oe_n<=1;phase<=RELEASE0;
                end else if(timeout_enable && wait_count==wait_last) begin
                    rsp_timeout<=1;pin_rd_n<=1;pin_be_n<=3;pin_oe_n<=1;phase<=RELEASE0;
                end else if(timeout_enable) wait_count<=wait_count+1'b1;
            end
            RELEASE0: phase<=RELEASE1;
            RELEASE1: if(!high_half && !rsp_timeout) begin
                high_half<=1;address_word<=address_word+32'd2;
                cad_out<=address_word[15:0]+16'd2;pin_dir<=1;phase<=ADDR_TURN;
            end else begin pin_cs_n<=3;phase<=DONE;end
            ADDR_TURN: begin cad_oe<=1;pin_oe_n<=0;phase<=LO_SETUP;end
            EXT_PREPARE: begin
                pin_be_n<=size_word==1 ? 2'b10 : 2'b00;
                if(write_word) cad_out<=high_half ? write_data_word[31:16] : write_data_word[15:0];
                phase<=EXT_WAIT;
            end
            EXT_WAIT: begin
                if(ready_sync[socket_word]) begin
                    if(write_word) pin_wr_n<=0; else pin_rd_n<=0;
                    wait_count<=0;phase<=EXT_DATA;
                end else if(timeout_enable && wait_count==wait_last) begin
                    rsp_timeout<=1;pin_oe_n<=1;phase<=EXT_RELEASE0;
                end else if(timeout_enable) wait_count<=wait_count+1'b1;
            end
            EXT_DATA: begin
                if(!ready_sync[socket_word]) begin
                    if(!write_word) begin
                        if(high_half) rsp_data[31:16]<=cad;
                        else if(size_word==1) rsp_data[7:0]<=cad[7:0];
                        else rsp_data[15:0]<=cad;
                    end
                    pin_rd_n<=1;pin_wr_n<=1;pin_be_n<=3;phase<=EXT_RELEASE0;
                end else if(timeout_enable && wait_count==wait_last) begin
                    rsp_timeout<=1;pin_rd_n<=1;pin_wr_n<=1;pin_be_n<=3;
                    pin_oe_n<=1;phase<=EXT_RELEASE0;
                end else if(timeout_enable) wait_count<=wait_count+1'b1;
            end
            EXT_RELEASE0: phase<=EXT_RELEASE1;
            EXT_RELEASE1: begin
                if(!high_half && size_word==4 && !rsp_timeout) begin
                    high_half<=1;wait_count<=0;phase<=EXT_PREPARE;
                end else begin
                    pin_cs_n<=3;pin_oe_n<=1;cad_oe<=0;phase<=DONE;
                end
            end
        endcase
    end
endmodule
