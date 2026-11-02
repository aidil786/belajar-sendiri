// Measured on Docker Engine 29.9.2 (containerd image store), linux/amd64, 2026-10-31.
// Generated from `docker image ls`, `docker image ls --tree`, `docker history --no-trunc` and the
// containerd content store. Do not edit by hand: re-measure instead (see docs/AUTHORING.md).
import type { CatalogEntry } from './types';

export const MEASURED: CatalogEntry[] = [
 {
  "ref": "hello-world:latest",
  "id": "c567b231f65614688711a75f31518a064258a51d442117a3e771a3a8fdba78ef",
  "manifest": "d1a8d0a4eeb63aff09f5f34d4d80505e0ba81905f36158cc3970d8e07179e59e",
  "created": "2026-03-23T21:33:59.562202219Z",
  "disk": "25.9kB",
  "content": "9.49kB",
  "platformDisk": "20.4kB",
  "platformContent": "4.01kB",
  "size": 20399,
  "layers": [
   [
    "4f55086f7dd096d48b0e49be066971a8ed996521c2e190aa21b2435a847198b4",
    2415
   ]
  ],
  "diffIds": [
   "897b3f2a7c1bc2f3d02432f7892fe31c6272c521ad4d70257df624504a3238b4"
  ],
  "platforms": [
   "linux/amd64",
   "linux/arm/v5",
   "linux/arm/v6",
   "linux/arm/v7",
   "linux/arm64/v8",
   "linux/386",
   "linux/ppc64le",
   "linux/riscv64",
   "linux/s390x",
   "windows/amd64",
   "windows/amd64"
  ],
  "config": {
   "Env": [
    "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
   ],
   "Cmd": [
    "/hello"
   ],
   "WorkingDir": "/"
  },
  "history": [
   [
    "CMD [\"/hello\"]",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-03-23T21:33:59Z"
   ],
   [
    "COPY hello / # buildkit",
    "16.4kB",
    "buildkit.dockerfile.v0",
    "2026-03-23T21:33:59Z"
   ]
  ]
 },
 {
  "ref": "alpine:3.22",
  "id": "2e0b81d60597f449baa56dc25d355367869d2dca4cd57e866f1e2b52af3eb55f",
  "manifest": "dc92f017beea8e7f43263073d717f7bc011228c95d5312e440deb4d035bb4eec",
  "created": "2026-10-21T20:47:08.545668189Z",
  "disk": "12.9MB",
  "content": "3.88MB",
  "platformDisk": "12.8MB",
  "platformContent": "3.8MB",
  "size": 12766230,
  "layers": [
   [
    "63e7e49699e8f5b93162e14c630db8294f87799bfec4376677160876bd6840dc",
    3794357
   ]
  ],
  "diffIds": [
   "be64570a34e4c5e361d1f5d9cb42b851e7f9a33a61f91c335b287c1c7868f921"
  ],
  "platforms": [
   "linux/amd64",
   "linux/arm/v6",
   "linux/arm/v7",
   "linux/arm64/v8",
   "linux/386",
   "linux/ppc64le",
   "linux/riscv64",
   "linux/s390x"
  ],
  "config": {
   "Env": [
    "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
   ],
   "Cmd": [
    "/bin/sh"
   ],
   "WorkingDir": "/"
  },
  "history": [
   [
    "CMD [\"/bin/sh\"]",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-21T20:47:08Z"
   ],
   [
    "ADD alpine-minirootfs-3.22.7-x86_64.tar.gz / # buildkit",
    "8.97MB",
    "buildkit.dockerfile.v0",
    "2026-10-21T20:47:08Z"
   ]
  ]
 },
 {
  "ref": "busybox:1.37",
  "id": "a7dbc319b1438115a207e11930dc4bb3e643dcb3ec0bdd694bb36cd8fad289ec",
  "manifest": "66a6306db78bf2dbf3487f293aa8d6990d8e506fdffab9cc43fe422becf886e4",
  "created": "2024-09-26T21:31:42Z",
  "disk": "6.77MB",
  "content": "2.22MB",
  "platformDisk": "6.77MB",
  "platformContent": "2.21MB",
  "size": 6767335,
  "layers": [
   [
    "68fe9bff2ad4ad46da3e58db03faa64eb73c0ff16d546b0c42539eaa9854cb7f",
    2211514
   ]
  ],
  "diffIds": [
   "5a9bfd996c6d49c6c3cb4ddfb76e8d09cf16b6b7cf6601d1f2dffbdbc3edb5d4"
  ],
  "platforms": [
   "linux/amd64",
   "linux/arm/v5",
   "linux/arm/v6",
   "linux/arm/v7",
   "linux/arm64/v8",
   "linux/386",
   "linux/ppc64le",
   "linux/riscv64",
   "linux/s390x"
  ],
  "config": {
   "Env": [
    "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
   ],
   "Cmd": [
    "sh"
   ]
  },
  "history": [
   [
    "BusyBox 1.37.0 (glibc), Debian 13",
    "4.55MB",
    "",
    "2024-09-26T21:31:42Z"
   ]
  ]
 },
 {
  "ref": "nginx:1.30-alpine",
  "id": "0e52bd054126cdc040b1276c0af347aeb02a41b9cfe305d6094767ac30e97949",
  "manifest": "84ed8c0dd296c188bfc24ed506f46589e9285fb0b11cf3a04d91d524d3067e11",
  "created": "2026-10-21T23:23:59.165417074Z",
  "disk": "93.5MB",
  "content": "27MB",
  "platformDisk": "92.6MB",
  "platformContent": "26.1MB",
  "size": 92643363,
  "layers": [
   [
    "7b229517ed222597277036d94892173207d01a731ab3a88eeb1de2e963a2c788",
    3853109
   ],
   [
    "9f0afb44f10e826253b342c0265e188067c2f0a30c782a52e329928a763adc60",
    1883253
   ],
   [
    "f19a2d3b695178ba0e57d473535f74f5d934f45e191de8334e730f83d2c62704",
    627
   ],
   [
    "885725a63a7cf1d4d5aac105944b35ece2b69a8c2cc6f7040f04727b7b8a63d2",
    964
   ],
   [
    "e125989d16f03d1e00b60afdd9abe46ed1437ed63b73926d036a5537f6be770a",
    403
   ],
   [
    "81b64ae234ef95f3cfc19b7f6c45a511eccbefa6148889ee33ed43c6c3f39939",
    1210
   ],
   [
    "bb658a2541968d2b90a8ee165ad08b7f71055c7f7832bdff98e2de2d8b90cf14",
    1397
   ],
   [
    "5b8cb54cfa408030aaa43d7bffa9141e0ae6f8a479df13c7aa152100cca358fb",
    20307133
   ]
  ],
  "diffIds": [
   "75c137aedfb2760f88629236cb7b797630aed0c3d91d626d1d1bb694878fc2ba",
   "5b91dba2fc11b3e6dab4d25e913db11e6e701065af717028e060dfb5ab8532e4",
   "a8a09d37d441c540c613402fa23c75308b04f4801e80f6d193316949f3df4b42",
   "d87f6628aa86314e48021285bd5dce15a2cf5166c1c80246d2e03dbb674abaf2",
   "313dac429378b98567656151706777045067624f9a6678873dd6fdc7ecf35545",
   "2ba21653acee34632d9eab26da39a5ff0cac12021817e6a5e9efac9507628575",
   "3212502c73d1691bd2b186efdda493ca750fc99795b6b0b85741af01b4e79aa4",
   "8ff2a17964b4a163c6ba0fa456ebd70ed12823a74324ba3b6f49d87bc25c1456"
  ],
  "platforms": [
   "linux/amd64",
   "linux/arm/v6",
   "linux/arm/v7",
   "linux/arm64/v8",
   "linux/386",
   "linux/ppc64le",
   "linux/riscv64",
   "linux/s390x"
  ],
  "config": {
   "ExposedPorts": {
    "80/tcp": {}
   },
   "Env": [
    "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "NGINX_VERSION=1.30.6",
    "PKG_RELEASE=1",
    "DYNPKG_RELEASE=1",
    "NJS_VERSION=1.0.2",
    "NJS_RELEASE=1",
    "ACME_VERSION=0.4.1"
   ],
   "Entrypoint": [
    "/docker-entrypoint.sh"
   ],
   "Cmd": [
    "nginx",
    "-g",
    "daemon off;"
   ],
   "WorkingDir": "/",
   "Labels": {
    "maintainer": "NGINX Docker Maintainers <docker-maint@nginx.com>"
   },
   "StopSignal": "SIGQUIT"
  },
  "history": [
   [
    "RUN /bin/sh -c set -x     && apkArch=\"$(cat /etc/apk/arch)\"     && nginxPackages=\"         nginx=${NGINX_VERSION}-r${PKG_RELEASE}         nginx-module-xslt=${NGINX_VERSION}-r${DYNPKG_RELEASE}         nginx-module-geoip=${NGINX_VERSION}-r${DYNPKG_RELEASE}         nginx-module-image-filter=${NGINX_VE…",
    "51.8MB",
    "buildkit.dockerfile.v0",
    "2026-10-21T23:23:59Z"
   ],
   [
    "ENV ACME_VERSION=0.4.1",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-21T23:23:59Z"
   ],
   [
    "ENV NJS_RELEASE=1",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-21T23:23:59Z"
   ],
   [
    "ENV NJS_VERSION=1.0.2",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-21T23:23:59Z"
   ],
   [
    "CMD [\"nginx\" \"-g\" \"daemon off;\"]",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:47:26Z"
   ],
   [
    "STOPSIGNAL SIGQUIT",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:47:26Z"
   ],
   [
    "EXPOSE map[80/tcp:{}]",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:47:26Z"
   ],
   [
    "ENTRYPOINT [\"/docker-entrypoint.sh\"]",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:47:26Z"
   ],
   [
    "COPY 30-tune-worker-processes.sh /docker-entrypoint.d # buildkit",
    "16.4kB",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:47:26Z"
   ],
   [
    "COPY 20-envsubst-on-templates.sh /docker-entrypoint.d # buildkit",
    "12.3kB",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:47:25Z"
   ],
   [
    "COPY 15-local-resolvers.envsh /docker-entrypoint.d # buildkit",
    "12.3kB",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:47:25Z"
   ],
   [
    "COPY 10-listen-on-ipv6-by-default.sh /docker-entrypoint.d # buildkit",
    "12.3kB",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:47:25Z"
   ],
   [
    "COPY docker-entrypoint.sh / # buildkit",
    "8.19kB",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:47:25Z"
   ],
   [
    "RUN /bin/sh -c set -x     && addgroup -g 101 -S nginx     && adduser -S -D -H -u 101 -h /var/cache/nginx -s /sbin/nologin -G nginx -g nginx nginx     && apkArch=\"$(cat /etc/apk/arch)\"     && nginxPackages=\"         nginx=${NGINX_VERSION}-r${PKG_RELEASE}     \"     && apk add --no-cache --virtual .ch…",
    "5.62MB",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:47:25Z"
   ],
   [
    "ENV DYNPKG_RELEASE=1",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:47:25Z"
   ],
   [
    "ENV PKG_RELEASE=1",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:47:25Z"
   ],
   [
    "ENV NGINX_VERSION=1.30.6",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:47:25Z"
   ],
   [
    "LABEL maintainer=NGINX Docker Maintainers <docker-maint@nginx.com>",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:47:25Z"
   ],
   [
    "CMD [\"/bin/sh\"]",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:37:22Z"
   ],
   [
    "ADD alpine-minirootfs-3.24.3-x86_64.tar.gz / # buildkit",
    "9.08MB",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:37:22Z"
   ]
  ]
 },
 {
  "ref": "nginx:latest",
  "id": "5ab5b0b01097420873a3f3330f44248e34a3c2a3e8d5ee30658aeae8cb7435da",
  "manifest": "8e0328743c8e52ead9fac9c198d0893d63cd38e41b1d9ea629e092a8ac229a93",
  "created": "2026-10-28T01:18:26.456773598Z",
  "disk": "243MB",
  "content": "66.8MB",
  "platformDisk": "241MB",
  "platformContent": "63.9MB",
  "size": 240521728,
  "layers": [
   [
    "6fc242d221a673263eabd14a9ad9584d3177c96e5cb504c891497338e2f912f5",
    29855236
   ],
   [
    "a071113ac575190a0fee0c046bcf51632356f07419bdffaa55798f54e5b2e23b",
    34051465
   ],
   [
    "9f604dae09b216f6c87919d0e59d5a4ddc4387ef071cf63c645628f93808e37b",
    628
   ],
   [
    "6e2ab1f3ef4e0ea3bbe1d208dfa048969199e3dab99e93c051b7c2d09c8efb3e",
    964
   ],
   [
    "c139fe92686de21a8c49d9cb40415d1dddd95fbbee4d696cebe37693236fe6d4",
    404
   ],
   [
    "d322f1bf41d8e99dc47f550cbf85e79ca18bc45db12fd1b7a8b34bf79cbd7d5a",
    1211
   ],
   [
    "a670537bed7086aeb8b663aad5e09cd584e19c6598cd2b6d905c5f2f2513938b",
    1398
   ]
  ],
  "diffIds": [
   "a5d6d345f6afa08d7c31272055746d60a838b290bfcc82c0a23e8e984d61a933",
   "0f8aa8b9d01b6ee1fbea0e959a52d0365a7397823100ff426be5269f65c6fc15",
   "b31212536f778905017ce3a989cfcebe8eebd4f43cb24da36ab432d3ffd66683",
   "4b83113ae8458025d898927706a809b97944b04f90237a8a0b0e38b57f1c7d9f",
   "8f1552f1cadb0b53bdb7e4a56871689a176eb1964ea40e9a8be108c136351a32",
   "4f25eadc4d7099657e4445abebea06ca26b09b29f760363c69e6b70f0bbe730d",
   "7f42da0fc0b819a1f67671eb3e711878318d943666187cdfe546508ee01dc175"
  ],
  "platforms": [
   "linux/amd64",
   "linux/arm/v5",
   "linux/arm/v7",
   "linux/arm64/v8",
   "linux/386",
   "linux/ppc64le",
   "linux/riscv64",
   "linux/s390x"
  ],
  "config": {
   "ExposedPorts": {
    "80/tcp": {}
   },
   "Env": [
    "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "NGINX_VERSION=1.31.8",
    "NJS_VERSION=1.0.2",
    "NJS_RELEASE=1~trixie",
    "ACME_VERSION=0.4.1",
    "PKG_RELEASE=1~trixie",
    "DYNPKG_RELEASE=1~trixie"
   ],
   "Entrypoint": [
    "/docker-entrypoint.sh"
   ],
   "Cmd": [
    "nginx",
    "-g",
    "daemon off;"
   ],
   "Labels": {
    "maintainer": "NGINX Docker Maintainers <docker-maint@nginx.com>"
   },
   "StopSignal": "SIGQUIT"
  },
  "history": [
   [
    "CMD [\"nginx\" \"-g\" \"daemon off;\"]",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-28T01:18:26Z"
   ],
   [
    "STOPSIGNAL SIGQUIT",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-28T01:18:26Z"
   ],
   [
    "EXPOSE map[80/tcp:{}]",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-28T01:18:26Z"
   ],
   [
    "ENTRYPOINT [\"/docker-entrypoint.sh\"]",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-28T01:18:26Z"
   ],
   [
    "COPY 30-tune-worker-processes.sh /docker-entrypoint.d # buildkit",
    "16.4kB",
    "buildkit.dockerfile.v0",
    "2026-10-28T01:18:26Z"
   ],
   [
    "COPY 20-envsubst-on-templates.sh /docker-entrypoint.d # buildkit",
    "12.3kB",
    "buildkit.dockerfile.v0",
    "2026-10-28T01:18:26Z"
   ],
   [
    "COPY 15-local-resolvers.envsh /docker-entrypoint.d # buildkit",
    "12.3kB",
    "buildkit.dockerfile.v0",
    "2026-10-28T01:18:26Z"
   ],
   [
    "COPY 10-listen-on-ipv6-by-default.sh /docker-entrypoint.d # buildkit",
    "12.3kB",
    "buildkit.dockerfile.v0",
    "2026-10-28T01:18:26Z"
   ],
   [
    "COPY docker-entrypoint.sh / # buildkit",
    "8.19kB",
    "buildkit.dockerfile.v0",
    "2026-10-28T01:18:26Z"
   ],
   [
    "RUN /bin/sh -c set -x     && groupadd --system --gid 101 nginx     && useradd --system --gid nginx --no-create-home --home /nonexistent --comment \"nginx user\" --shell /bin/false --uid 101 nginx     && apt-get update     && apt-get install --no-install-recommends --no-install-suggests -y gnupg1 ca-c…",
    "88.8MB",
    "buildkit.dockerfile.v0",
    "2026-10-28T01:18:26Z"
   ],
   [
    "ENV DYNPKG_RELEASE=1~trixie",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-28T01:18:26Z"
   ],
   [
    "ENV PKG_RELEASE=1~trixie",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-28T01:18:26Z"
   ],
   [
    "ENV ACME_VERSION=0.4.1",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-28T01:18:26Z"
   ],
   [
    "ENV NJS_RELEASE=1~trixie",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-28T01:18:26Z"
   ],
   [
    "ENV NJS_VERSION=1.0.2",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-28T01:18:26Z"
   ],
   [
    "ENV NGINX_VERSION=1.31.8",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-28T01:18:26Z"
   ],
   [
    "LABEL maintainer=NGINX Docker Maintainers <docker-maint@nginx.com>",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-28T01:18:26Z"
   ],
   [
    "# debian.sh --arch 'amd64' out/ 'trixie' '@1793059200'",
    "87.7MB",
    "debuerreotype 0.17",
    "2026-10-27T00:00:00Z"
   ]
  ]
 },
 {
  "ref": "node:24-alpine",
  "id": "8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85",
  "manifest": "4eefa1bfce4197942661ef9148247d779ddf1bb0ee006d3294a467609de60724",
  "created": "2026-10-28T20:56:06.40936005Z",
  "disk": "244MB",
  "content": "62.8MB",
  "platformDisk": "244MB",
  "platformContent": "62.5MB",
  "size": 243601810,
  "layers": [
   [
    "7b229517ed222597277036d94892173207d01a731ab3a88eeb1de2e963a2c788",
    3853109
   ],
   [
    "522ca12b284b13dae3ba08b8844e02c8249c122f46e85fbedfce81c653309b16",
    57376882
   ],
   [
    "ef0ad2fdf0fde194f8e7968d73408f7b374c2dc59e5ad0757772f1e11c450894",
    1262442
   ],
   [
    "c728384fb906e639c501cc4eb9e531aadf108c420d32d36ed322a512050855cb",
    441
   ]
  ],
  "diffIds": [
   "75c137aedfb2760f88629236cb7b797630aed0c3d91d626d1d1bb694878fc2ba",
   "60bd9d2f4730a6e88dc76690b7365cf7110e0874b02e6280eab51f005e88d0de",
   "593de0610faaafca8df2a031200415501e7ae657c22c6a069b46e66ff89ce71e",
   "c5462dd18906793ff52ede1f6c13cd94f643e549ddfc2b0bed9f865fa1911f6f"
  ],
  "platforms": [
   "linux/amd64",
   "linux/arm64/v8",
   "linux/s390x"
  ],
  "config": {
   "Env": [
    "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "NODE_VERSION=24.22.2",
    "YARN_VERSION=1.22.22"
   ],
   "Entrypoint": [
    "docker-entrypoint.sh"
   ],
   "Cmd": [
    "node"
   ],
   "WorkingDir": "/"
  },
  "history": [
   [
    "CMD [\"node\"]",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-28T20:56:06Z"
   ],
   [
    "ENTRYPOINT [\"docker-entrypoint.sh\"]",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-28T20:56:06Z"
   ],
   [
    "COPY docker-entrypoint.sh /usr/local/bin/ # buildkit",
    "20.5kB",
    "buildkit.dockerfile.v0",
    "2026-10-28T20:56:06Z"
   ],
   [
    "RUN /bin/sh -c apk add --no-cache --virtual .build-deps-yarn curl gnupg tar   && export GNUPGHOME=\"$(mktemp -d)\"   && for key in     6A010C5166006599AA17F08146C2130DFD2497F5   ; do     { gpg --batch --keyserver hkps://keys.openpgp.org --recv-keys \"$key\" && gpg --batch --fingerprint \"$key\"; } ||    …",
    "5.48MB",
    "buildkit.dockerfile.v0",
    "2026-10-28T20:56:06Z"
   ],
   [
    "ENV YARN_VERSION=1.22.22",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-28T20:56:02Z"
   ],
   [
    "RUN /bin/sh -c addgroup -g 1000 node     && adduser -u 1000 -G node -s /bin/sh -D node     && apk add --no-cache         libatomic         libstdc++     && apk add --no-cache --virtual .build-deps         gnupg         curl     && ARCH= OPENSSL_ARCH='linux*' && alpineArch=\"$(apk --print-arch)\"     …",
    "167MB",
    "buildkit.dockerfile.v0",
    "2026-10-28T20:56:02Z"
   ],
   [
    "ENV NODE_VERSION=24.22.2",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-28T20:56:02Z"
   ],
   [
    "CMD [\"/bin/sh\"]",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:37:22Z"
   ],
   [
    "ADD alpine-minirootfs-3.24.3-x86_64.tar.gz / # buildkit",
    "9.08MB",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:37:22Z"
   ]
  ]
 },
 {
  "ref": "python:3.13-slim",
  "id": "2d44738ebf4ce5f63b9d9ea871e9c7cfdc0426f7b0c97cac915fd88ded1d86bb",
  "manifest": "aaf08c5490d52cd92bc27142a5215b1e47355a5eaf9adfad2a0fbc022d0b5490",
  "created": "2026-10-28T02:04:41.834266298Z",
  "disk": "178MB",
  "content": "45.3MB",
  "platformDisk": "176MB",
  "platformContent": "43.1MB",
  "size": 176192449,
  "layers": [
   [
    "6fc242d221a673263eabd14a9ad9584d3177c96e5cb504c891497338e2f912f5",
    29855236
   ],
   [
    "789960dca7c613e9d8872d4790f2ec423b8fe17f52989c6225982f28696e7315",
    1289759
   ],
   [
    "7d824d9f832184c4084576664b622717cb0eb579b504f2079d3b4ac36454761f",
    11923889
   ],
   [
    "6f058ad03f0cab30c01926ad20e38348fe53783080f5309e4bfc4d2709c5fbaf",
    251
   ]
  ],
  "diffIds": [
   "a5d6d345f6afa08d7c31272055746d60a838b290bfcc82c0a23e8e984d61a933",
   "b9baa14e993c683240d519adebb39657df4d2b973dc2f3fee23cd51367806e2b",
   "1217eb836a36d0c4be6a310113a777ecb9d7e9c24197a407665c8884cc5369a4",
   "3929d22d8aa43d69f436bbc47ef472db875440b850dbc4e80dd272a3adf673d2"
  ],
  "platforms": [
   "linux/amd64",
   "linux/arm/v5",
   "linux/arm/v7",
   "linux/arm64/v8",
   "linux/386",
   "linux/ppc64le",
   "linux/riscv64",
   "linux/s390x"
  ],
  "config": {
   "Env": [
    "PATH=/usr/local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "LANG=C.UTF-8",
    "GPG_KEY=7169605F62C751356D054A26A821E680E5FA6305",
    "PYTHON_VERSION=3.13.18",
    "PYTHON_SHA256=abb0102e6d4ae027509bcb82327d9dd85515b44a3ba8ad538cfc5e9847029f68"
   ],
   "Cmd": [
    "python3"
   ]
  },
  "history": [
   [
    "CMD [\"python3\"]",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-28T02:04:41Z"
   ],
   [
    "RUN /bin/sh -c set -eux;  for src in idle3 pip3 pydoc3 python3 python3-config; do   dst=\"$(echo \"$src\" | tr -d 3)\";   [ -s \"/usr/local/bin/$src\" ];   [ ! -e \"/usr/local/bin/$dst\" ];   ln -svT \"$src\" \"/usr/local/bin/$dst\";  done # buildkit",
    "16.4kB",
    "buildkit.dockerfile.v0",
    "2026-10-28T02:04:41Z"
   ],
   [
    "RUN /bin/sh -c set -eux;   savedAptMark=\"$(apt-mark showmanual)\";  apt-get update;  apt-get install -y --no-install-recommends   dpkg-dev   g++   gcc   gnupg   libbluetooth-dev   libbz2-dev   libc6-dev   libdb-dev   libffi-dev   libgdbm-dev   liblzma-dev   libncursesw5-dev   libreadline-dev   libsq…",
    "40.5MB",
    "buildkit.dockerfile.v0",
    "2026-10-28T02:04:41Z"
   ],
   [
    "ENV PYTHON_SHA256=abb0102e6d4ae027509bcb82327d9dd85515b44a3ba8ad538cfc5e9847029f68",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-28T01:54:21Z"
   ],
   [
    "ENV PYTHON_VERSION=3.13.18",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-28T01:54:21Z"
   ],
   [
    "ENV GPG_KEY=7169605F62C751356D054A26A821E680E5FA6305",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-28T01:54:21Z"
   ],
   [
    "RUN /bin/sh -c set -eux;  apt-get update;  apt-get install -y --no-install-recommends   ca-certificates   netbase   tzdata  ;  apt-get dist-clean # buildkit",
    "4.93MB",
    "buildkit.dockerfile.v0",
    "2026-10-28T01:54:21Z"
   ],
   [
    "ENV LANG=C.UTF-8",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-28T01:54:21Z"
   ],
   [
    "ENV PATH=/usr/local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-28T01:54:21Z"
   ],
   [
    "# debian.sh --arch 'amd64' out/ 'trixie' '@1793059200'",
    "87.7MB",
    "debuerreotype 0.17",
    "2026-10-27T00:00:00Z"
   ]
  ]
 },
 {
  "ref": "postgres:18-alpine",
  "id": "10a5c69a83035ab5239f5620d708520e8b28f5aa1f2b20143e6024532edadfb5",
  "manifest": "3b0ef735388b2cb097fc29b8bb421d86d57d0ddbe7aa1fbd6493e06d65028503",
  "created": "2026-10-21T22:56:40.8228104Z",
  "disk": "433MB",
  "content": "121MB",
  "platformDisk": "433MB",
  "platformContent": "120MB",
  "size": 432741923,
  "layers": [
   [
    "7b229517ed222597277036d94892173207d01a731ab3a88eeb1de2e963a2c788",
    3853109
   ],
   [
    "9b7e1e6003c93d7d6d29ceddd88f54da5af3ef40c9a7c117ba25feeddefdde90",
    969
   ],
   [
    "c636fe474156f1a3e19326edfd3bcc4dbdf4ce2ef649704ae14929fd948977c5",
    900002
   ],
   [
    "8a06bdb27c21d9177c4cc4d01ae0013d5e35c73466587536174120bb368b2445",
    116
   ],
   [
    "242c5d565900091c2cf94a3d5525d2de099cad11e58238fce17558da98a9da5d",
    115266573
   ],
   [
    "f0f97016fb12c736e2b2854c567c4020620205ce50c3c5f5513ae151de385520",
    19007
   ],
   [
    "ca102eb59e0eb094f714b42cebd5a63a12dd83bea4de64f34f8682ff96f66a92",
    129
   ],
   [
    "13930ab5cb14dd8cb804d951d341d54a3df5d9b4700545c3b9e60d8cbcb9d768",
    6110
   ],
   [
    "04d6f1f64405f4ef0b1742cd875f748658159e2ab86ec4ee2c59564bdf2e7d99",
    184
   ]
  ],
  "diffIds": [
   "75c137aedfb2760f88629236cb7b797630aed0c3d91d626d1d1bb694878fc2ba",
   "4d0273c37bdc514fffff95149ce8785621655581d2c069a31cf3038e08c308fa",
   "364b86e7bc378a980468461c9c7fa8f825d173bbd7b512ad62757fee133eb7e6",
   "81000a837ae268cccacb50c4ac69341aa6eaf11dbc1baba83ebb829c87299ae2",
   "d948599f0e747cf5ceeb3302b4a67fde5edd06abbe9f61fd4d4e2fe4e4980294",
   "26a545bd361b13e34447f803d18a6244c5bfcbb929135528c39d55c90e22d75b",
   "7ca201ad0f726c7eaf249399e04994c30e26d3c9e06e43d6b371e3b25f8630bc",
   "2343fb8f16ceba7c1a809c8517142814afe99462036a7aa83ef784bbb3312ad4",
   "ac355b2037545737428ed497d5706127f23722edfa2f5f6d9ac7a75fd30d75c6"
  ],
  "platforms": [
   "linux/amd64",
   "linux/arm/v6",
   "linux/arm/v7",
   "linux/arm64/v8",
   "linux/386",
   "linux/ppc64le",
   "linux/riscv64",
   "linux/s390x"
  ],
  "config": {
   "ExposedPorts": {
    "5432/tcp": {}
   },
   "Env": [
    "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "GOSU_VERSION=1.19",
    "LANG=en_US.utf8",
    "PG_MAJOR=18",
    "PG_VERSION=18.6",
    "PG_SHA256=555610c24d53e4316da5b7d3fc25c279d96856d5e0e23ee308c328c5fa881d9f",
    "DOCKER_PG_LLVM_DEPS=llvm21-dev \t\tclang21",
    "PGDATA=/var/lib/postgresql/18/docker"
   ],
   "Entrypoint": [
    "docker-entrypoint.sh"
   ],
   "Cmd": [
    "postgres"
   ],
   "Volumes": {
    "/var/lib/postgresql": {}
   },
   "WorkingDir": "/",
   "StopSignal": "SIGINT"
  },
  "history": [
   [
    "CMD [\"postgres\"]",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:56:40Z"
   ],
   [
    "EXPOSE map[5432/tcp:{}]",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:56:40Z"
   ],
   [
    "STOPSIGNAL SIGINT",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:56:40Z"
   ],
   [
    "ENTRYPOINT [\"docker-entrypoint.sh\"]",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:56:40Z"
   ],
   [
    "RUN /bin/sh -c ln -sT docker-ensure-initdb.sh /usr/local/bin/docker-enforce-initdb.sh # buildkit",
    "16.4kB",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:56:40Z"
   ],
   [
    "COPY docker-entrypoint.sh docker-ensure-initdb.sh /usr/local/bin/ # buildkit",
    "36.9kB",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:56:40Z"
   ],
   [
    "VOLUME [/var/lib/postgresql]",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:56:40Z"
   ],
   [
    "ENV PGDATA=/var/lib/postgresql/18/docker",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:56:40Z"
   ],
   [
    "RUN /bin/sh -c install --verbose --directory --owner postgres --group postgres --mode 3777 /var/run/postgresql # buildkit",
    "12.3kB",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:56:40Z"
   ],
   [
    "RUN /bin/sh -c set -eux;  cp -v /usr/local/share/postgresql/postgresql.conf.sample /usr/local/share/postgresql/postgresql.conf.sample.orig;  sed -ri \"s!^#?(listen_addresses)\\s*=\\s*\\S+.*!\\1 = '*'!\" /usr/local/share/postgresql/postgresql.conf.sample;  grep -F \"listen_addresses = '*'\" /usr/local/share…",
    "86kB",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:56:40Z"
   ],
   [
    "RUN /bin/sh -c set -eux;   wget -O postgresql.tar.bz2 \"https://ftp.postgresql.org/pub/source/v$PG_VERSION/postgresql-$PG_VERSION.tar.bz2\";  echo \"$PG_SHA256 *postgresql.tar.bz2\" | sha256sum -c -;  mkdir -p /usr/src/postgresql;  tar   --extract   --file postgresql.tar.bz2   --directory /usr/src/post…",
    "301MB",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:56:40Z"
   ],
   [
    "ENV DOCKER_PG_LLVM_DEPS=llvm21-dev   clang21",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:54:31Z"
   ],
   [
    "ENV PG_SHA256=555610c24d53e4316da5b7d3fc25c279d96856d5e0e23ee308c328c5fa881d9f",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:54:31Z"
   ],
   [
    "ENV PG_VERSION=18.6",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:54:31Z"
   ],
   [
    "ENV PG_MAJOR=18",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:54:31Z"
   ],
   [
    "RUN /bin/sh -c mkdir /docker-entrypoint-initdb.d # buildkit",
    "8.19kB",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:54:31Z"
   ],
   [
    "ENV LANG=en_US.utf8",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:54:31Z"
   ],
   [
    "RUN /bin/sh -c set -eux;   apk add --no-cache --virtual .gosu-deps   ca-certificates   dpkg   gnupg  ;   dpkgArch=\"$(dpkg --print-architecture | awk -F- '{ print $NF }')\";  wget -O /usr/local/bin/gosu \"https://github.com/tianon/gosu/releases/download/$GOSU_VERSION/gosu-$dpkgArch\";  wget -O /usr/loc…",
    "2.05MB",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:54:31Z"
   ],
   [
    "ENV GOSU_VERSION=1.19",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:54:31Z"
   ],
   [
    "RUN /bin/sh -c set -eux;  addgroup -g 70 -S postgres;  adduser -u 70 -S -D -G postgres -H -h /var/lib/postgresql -s /bin/sh postgres;  install --verbose --directory --owner postgres --group postgres --mode 1777 /var/lib/postgresql # buildkit",
    "45.1kB",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:54:28Z"
   ],
   [
    "CMD [\"/bin/sh\"]",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:37:22Z"
   ],
   [
    "ADD alpine-minirootfs-3.24.3-x86_64.tar.gz / # buildkit",
    "9.08MB",
    "buildkit.dockerfile.v0",
    "2026-10-21T22:37:22Z"
   ]
  ]
 },
 {
  "ref": "redis:8-alpine",
  "id": "21090af93f8324db2f0f0f4f38a7c60369d47d917e000c3423d89d2ae2883537",
  "manifest": "be7c1cada5a6eb1656adfa2635b99296af725881301b21f84f35a71fac072c7f",
  "created": "2026-10-26T16:42:40.352300269Z",
  "disk": "162MB",
  "content": "40MB",
  "platformDisk": "161MB",
  "platformContent": "39.5MB",
  "size": 161231353,
  "layers": [
   [
    "5e9b4a97f6395abf54a5c584be133078deb2295e280dd0b9e77638874d07b637",
    3852227
   ],
   [
    "cea19da2b3611b8db9be40ed38877a1d91f4e0ec448f76661cd3080c88899581",
    950
   ],
   [
    "bc92976dd0707c02ee18cfd6acd7a0ac99bf4c85c0d20389abd41f10b2be74b5",
    201033
   ],
   [
    "7379ba8f71f2bb8ae1608020c9d37d7b372d046a955a1bc48008ff974ba2bcff",
    35465386
   ],
   [
    "232fbf3af8e0ed6a935d282e004fd75d8d5daecd470b4495d8fbce34b02f20b2",
    100
   ],
   [
    "4f4fb700ef54461cfa02571ae0db9a0dc1e0cdb5577484a6d75e68dc38e8acc1",
    32
   ],
   [
    "74c3c7a694d3cbacd93171791aa8e2911653f0a1514be5af223bf457a2d4e02a",
    2100
   ]
  ],
  "diffIds": [
   "54ea9baa1bbd7651dbda5c61569dad60fa601c73e5b784e154e8ba0f314e84fd",
   "18810e425786d1eda4971b94f387d5c6e6fa74d4a01686e59a4ec512bebb6953",
   "59db1e07581bc00a1807ba50cba6d7f05b39998bada27ad7a8c4912bfc14e9c5",
   "79a44fe381a9b1674fc69c82d639dfe72749d6a4a157d9ec4b523e6f356dc9d4",
   "02815924790af2ab4412bece287faed1e9b573ba692a95eb7ea7133fc33c8777",
   "5f70bf18a086007016e948b04aed3b82103a36bea41755b6cddfaf10ace3c6ef",
   "12a792fcbb54865f7613b539b364bd8040e19f7d9d0065ec90f7587c948b43c1"
  ],
  "platforms": [
   "linux/amd64",
   "linux/arm/v6",
   "linux/arm/v7",
   "linux/arm64/v8",
   "linux/386",
   "linux/ppc64le",
   "linux/riscv64",
   "linux/s390x"
  ],
  "config": {
   "ExposedPorts": {
    "6379/tcp": {}
   },
   "Env": [
    "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    "REDIS_VERSION=8.10.3"
   ],
   "Entrypoint": [
    "docker-entrypoint.sh"
   ],
   "Cmd": [
    "redis-server"
   ],
   "WorkingDir": "/data"
  },
  "history": [
   [
    "CMD [\"redis-server\"]",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-26T16:42:40Z"
   ],
   [
    "EXPOSE map[6379/tcp:{}]",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-26T16:42:40Z"
   ],
   [
    "ENTRYPOINT [\"docker-entrypoint.sh\"]",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-26T16:42:40Z"
   ],
   [
    "COPY docker-entrypoint.sh /usr/local/bin/ # buildkit",
    "24.6kB",
    "buildkit.dockerfile.v0",
    "2026-10-26T16:42:40Z"
   ],
   [
    "WORKDIR /data",
    "4.1kB",
    "buildkit.dockerfile.v0",
    "2026-10-26T16:42:40Z"
   ],
   [
    "RUN |2 REDIS_DOWNLOAD_URL=https://github.com/redis/redis/releases/download/8.10.3/redis-full.tar.gz REDIS_DOWNLOAD_SHA=5e0c00ed77f789fb1a4a30f1fbb58a793cc88c41c0f11f0e38e1b4f192991188 /bin/sh -c mkdir /data && chown redis:redis /data # buildkit",
    "8.19kB",
    "buildkit.dockerfile.v0",
    "2026-10-26T16:42:40Z"
   ],
   [
    "RUN |2 REDIS_DOWNLOAD_URL=https://github.com/redis/redis/releases/download/8.10.3/redis-full.tar.gz REDIS_DOWNLOAD_SHA=5e0c00ed77f789fb1a4a30f1fbb58a793cc88c41c0f11f0e38e1b4f192991188 /bin/sh -c set -eux;   apk add --no-cache --virtual .build-deps   coreutils   dpkg-dev dpkg   gcc   linux-headers  …",
    "111MB",
    "buildkit.dockerfile.v0",
    "2026-10-26T16:42:40Z"
   ],
   [
    "ARG REDIS_DOWNLOAD_SHA=5e0c00ed77f789fb1a4a30f1fbb58a793cc88c41c0f11f0e38e1b4f192991188",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-26T16:42:40Z"
   ],
   [
    "ARG REDIS_DOWNLOAD_URL=https://github.com/redis/redis/releases/download/8.10.3/redis-full.tar.gz",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-26T16:42:40Z"
   ],
   [
    "ENV REDIS_VERSION=8.10.3",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-26T16:42:40Z"
   ],
   [
    "RUN /bin/sh -c set -eux;  apk add --no-cache   tzdata   setpriv  ; # buildkit",
    "1.75MB",
    "buildkit.dockerfile.v0",
    "2026-10-26T16:33:24Z"
   ],
   [
    "RUN /bin/sh -c set -eux;  addgroup -S -g 1000 redis;  adduser -S -G redis -u 999 redis # buildkit",
    "41kB",
    "buildkit.dockerfile.v0",
    "2026-10-26T16:33:24Z"
   ],
   [
    "CMD [\"/bin/sh\"]",
    "0B",
    "buildkit.dockerfile.v0",
    "2026-10-21T20:46:55Z"
   ],
   [
    "ADD alpine-minirootfs-3.23.7-x86_64.tar.gz / # buildkit",
    "9.08MB",
    "buildkit.dockerfile.v0",
    "2026-10-21T20:46:55Z"
   ]
  ]
 }
];
