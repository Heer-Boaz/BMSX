FROM debian@sha256:3bbe51d205c8c0ea0473bb33fa6c18c836ca49ac3032c0bf71413cda8515354f

RUN printf '%s\n' \
	'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20251229T000000Z bullseye main' \
	'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian-security/20251229T000000Z bullseye-security main' \
	'deb [check-valid-until=no] http://snapshot.debian.org/archive/debian/20251229T000000Z bullseye-updates main' \
	> /etc/apt/sources.list \
	&& apt-get update \
	&& apt-get install -y --no-install-recommends \
	binutils-arm-linux-gnueabihf=2.35.2-2 \
	ca-certificates=20210119 \
	ccache=4.2-1 \
	cmake=3.18.4-2+deb11u1 \
	debootstrap=1.0.123+deb11u3 \
	file=1:5.39-3+deb11u1 \
	gawk=1:5.1.0-1 \
	g++-arm-linux-gnueabihf=4:10.2.1-1 \
	gcc-arm-linux-gnueabihf=4:10.2.1-1 \
	gcc-10-source=10.2.1-6 \
	libc-bin=2.31-13+deb11u13 \
	make=4.3-4.1 \
	ninja-build=1.10.1-1 \
	pkg-config=0.29.2-1 \
	python3=3.9.2-3 \
	qemu-user-static=1:5.2+dfsg-11+deb11u5 \
	util-linux=2.36.1-8+deb11u2 \
	xz-utils=5.2.5-2.1~deb11u1 \
	&& rm -rf /var/lib/apt/lists/*
