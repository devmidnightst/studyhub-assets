FROM ubuntu:26.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      bash sudo curl ca-certificates nano git procps iproute2 iputils-ping less util-linux tini \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -m -s /bin/bash -G sudo user \
    && printf 'user ALL=(ALL) NOPASSWD:ALL\n' > /etc/sudoers.d/user
WORKDIR /home/user
ENTRYPOINT ["/usr/bin/tini","--"]
CMD ["sleep","infinity"]
