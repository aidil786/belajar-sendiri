# The real Debian 13 machine for `npm run verify:linux` (scripts/verify-linux/index.ts).
# Plain Debian 13 plus the tools the Linux lessons teach, with systemd as PID 1 (so systemctl and
# journalctl are the real ones). Built once per run (Docker caches it).
#
# The apt catalog's packages (tree, htop, ncdu, jq, unzip and their libraries) wait as .deb files in
# /opt/fl-debs, not installed: a scenario's { install: 'tree' } step installs one with dpkg, so the
# checks need no network.
#
# In CI nothing special is needed. In a sandbox that only reaches the internet through an HTTPS
# proxy, the script passes the proxy as build args and the proxy's CA as a BuildKit secret:
# apt then uses https sources with that CA, and both are gone again after this step.
FROM mirror.gcr.io/library/debian:13

ARG http_proxy
ARG https_proxy
RUN --mount=type=secret,id=proxyca,target=/run/secrets/proxyca,mode=0444 \
    set -eu; \
    if [ -s /run/secrets/proxyca ]; then \
      cp /etc/apt/sources.list.d/debian.sources /tmp/debian.sources.orig; \
      sed -i 's#http://#https://#g' /etc/apt/sources.list.d/debian.sources; \
      echo 'Acquire::https::CaInfo "/run/secrets/proxyca";' > /etc/apt/apt.conf.d/99proxyca; \
    fi; \
    apt-get update; \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      systemd systemd-sysv dbus \
      procps psmisc iproute2 iputils-ping dnsutils curl less cron nginx openssh-client openssh-server sudo \
      ca-certificates netbase; \
    mkdir -p /opt/fl-debs; cd /opt/fl-debs; \
    apt-get download tree htop ncdu jq unzip libgpm2 libjq1 libonig5 2>&1 | grep -v unsandboxed || true; \
    ls /opt/fl-debs/tree_*.deb; cd /; \
    if [ -f /tmp/debian.sources.orig ]; then mv /tmp/debian.sources.orig /etc/apt/sources.list.d/debian.sources; fi; \
    rm -f /etc/apt/apt.conf.d/99proxyca; \
    rm -rf /var/lib/apt/lists/*

# The practice server has no IPv6 (a container often has none either): nginx listens on IPv4 only.
RUN sed -i 's/^\s*listen \[::\]:80 default_server;/#&/' /etc/nginx/sites-available/default

# The learner: "you", in the sudo group, with passwordless sudo like a cloud server's first user.
RUN useradd --create-home --shell /bin/bash --groups sudo you \
 && echo 'you ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/90-you \
 && chmod 0440 /etc/sudoers.d/90-you

STOPSIGNAL SIGRTMIN+3
CMD ["/lib/systemd/systemd"]
