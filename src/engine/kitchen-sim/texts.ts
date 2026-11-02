// Exact program outputs, copied from the real images on Docker Engine 29.9.2 (2026-10-31).
// Placeholders: {t} = a timestamp, {pid} = a process id.

export const HELLO = `
Hello from Docker!
This message shows that your installation appears to be working correctly.

To generate this message, Docker took the following steps:
 1. The Docker client contacted the Docker daemon.
 2. The Docker daemon pulled the "hello-world" image from the Docker Hub.
    (amd64)
 3. The Docker daemon created a new container from that image which runs the
    executable that produces the output you are currently reading.
 4. The Docker daemon streamed that output to the Docker client, which sent it
    to your terminal.

To try something more ambitious, you can run an Ubuntu container with:
 $ docker run -it ubuntu bash

Share images, automate workflows, and more with a free Docker ID:
 https://hub.docker.com/

For more examples and ideas, visit:
 https://docs.docker.com/get-started/
`;

export const NGINX_ENTRY = [
  '/docker-entrypoint.sh: /docker-entrypoint.d/ is not empty, will attempt to perform configuration',
  '/docker-entrypoint.sh: Looking for shell scripts in /docker-entrypoint.d/',
  '/docker-entrypoint.sh: Launching /docker-entrypoint.d/10-listen-on-ipv6-by-default.sh',
  'IPV6',
  '/docker-entrypoint.sh: Sourcing /docker-entrypoint.d/15-local-resolvers.envsh',
  '/docker-entrypoint.sh: Launching /docker-entrypoint.d/20-envsubst-on-templates.sh',
  '/docker-entrypoint.sh: Launching /docker-entrypoint.d/30-tune-worker-processes.sh',
  '/docker-entrypoint.sh: Configuration complete; ready for start up',
];

export const NGINX_IPV6_OFF = '10-listen-on-ipv6-by-default.sh: info: ipv6 not available';
export const NGINX_IPV6_ON = [
  '10-listen-on-ipv6-by-default.sh: info: Getting the checksum of /etc/nginx/conf.d/default.conf',
  '10-listen-on-ipv6-by-default.sh: info: Enabled listen on IPv6 in /etc/nginx/conf.d/default.conf',
];

export const NGINX_404 = (version: string) => `<html>
<head><title>404 Not Found</title></head>
<body>
<center><h1>404 Not Found</h1></center>
<hr><center>nginx/${version}</center>
</body>
</html>
`;

export const NGINX_403 = (version: string) => `<html>
<head><title>403 Forbidden</title></head>
<body>
<center><h1>403 Forbidden</h1></center>
<hr><center>nginx/${version}</center>
</body>
</html>
`;

export const PG_NO_PASSWORD = `Error: Database is uninitialized and superuser password is not specified.
       You must specify POSTGRES_PASSWORD to a non-empty value for the
       superuser. For example, "-e POSTGRES_PASSWORD=password" on "docker run".

       You may also use "POSTGRES_HOST_AUTH_METHOD=trust" to allow all
       connections without a password. This is *not* recommended.

       See PostgreSQL documentation about "trust":
       https://www.postgresql.org/docs/current/auth-trust.html`;

export const PG_OLD_PATH = `Error: in 18+, these Docker images are configured to store database data in a
       format which is compatible with "pg_ctlcluster" (specifically, using
       major-version-specific directory names).  This better reflects how
       PostgreSQL itself works, and how upgrades are to be performed.

       See also https://github.com/docker-library/postgres/pull/1259

       Counter to that, there appears to be PostgreSQL data in:
         /var/lib/postgresql/data (unused mount/volume)

       This is usually the result of upgrading the Docker image without
       upgrading the underlying database using "pg_upgrade" (which requires both
       versions).

       The suggested container configuration for 18+ is to place a single mount
       at /var/lib/postgresql which will then place PostgreSQL data in a
       subdirectory, allowing usage of "pg_upgrade --link" without mount point
       boundary issues.

       See https://github.com/docker-library/postgres/issues/37 for a (long)
       discussion around this process, and suggestions for how to do so.`;

/** First start: stdout part of initdb. */
export const PG_INIT_OUT = `The files belonging to this database system will be owned by user "postgres".
This user must also own the server process.

The database cluster will be initialized with locale "en_US.utf8".
The default database encoding has accordingly been set to "UTF8".
The default text search configuration will be set to "english".

Data page checksums are enabled.

fixing permissions on existing directory /var/lib/postgresql/18/docker ... ok
creating subdirectories ... ok
selecting dynamic shared memory implementation ... posix
selecting default "max_connections" ... 100
selecting default "shared_buffers" ... 128MB
selecting default time zone ... UTC
creating configuration files ... ok
running bootstrap script ... ok
performing post-bootstrap initialization ... ok
syncing data to disk ... ok


Success. You can now start the database server using:

    pg_ctl -D /var/lib/postgresql/18/docker -l logfile start
`;

export const PG_INIT_ERR = [
  'sh: locale: not found',
  '{t} UTC [40] WARNING:  no usable system locales were found',
  'initdb: warning: enabling "trust" authentication for local connections',
  'initdb: hint: You can change this by editing pg_hba.conf or using the option -A, or --auth-local and --auth-host, the next time you run initdb.',
];

export const PG_STARTUP = (t: string, ipv6: boolean) => [
  `${t} UTC [1] LOG:  starting PostgreSQL 18.6 on x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit`,
  `${t} UTC [1] LOG:  listening on IPv4 address "0.0.0.0", port 5432`,
  ipv6
    ? `${t} UTC [1] LOG:  listening on IPv6 address "::", port 5432`
    : `${t} UTC [1] LOG:  could not create IPv6 socket for address "::": Address family not supported by protocol`,
  `${t} UTC [1] LOG:  listening on Unix socket "/var/run/postgresql/.s.PGSQL.5432"`,
];

export const PG_SHUTDOWN = (t: string) => [
  `${t} UTC [1] LOG:  received fast shutdown request`,
  `${t} UTC [1] LOG:  aborting any active transactions`,
  `${t} UTC [1] LOG:  background worker "logical replication launcher" (PID 35) exited with exit code 1`,
  `${t} UTC [30] LOG:  shutting down`,
  `${t} UTC [30] LOG:  checkpoint starting: shutdown immediate`,
  `${t} UTC [30] LOG:  checkpoint complete: wrote 0 buffers (0.0%), wrote 0 SLRU buffers; 0 WAL file(s) added, 0 removed, 0 recycled; write=0.005 s, sync=0.001 s, total=0.020 s; sync files=0, longest=0.000 s, average=0.000 s; distance=0 kB, estimate=0 kB; lsn=0/1766098, redo lsn=0/1766098`,
  `${t} UTC [1] LOG:  database system is shut down`,
];

export const NODE_MISSING = (path: string, version: string) => `node:internal/modules/cjs/loader:1568
  throw err;
  ^

Error: Cannot find module '${path}'
    at Module._resolveFilename (node:internal/modules/cjs/loader:1564:15)
    at wrapResolveFilename (node:internal/modules/cjs/loader:1118:27)
    at defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1142:10)
    at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1169:12)
    at Module._load (node:internal/modules/cjs/loader:1341:5)
    at wrapModuleLoad (node:internal/modules/cjs/loader:261:19)
    at Module.executeUserEntryPoint [as runMain] (node:internal/modules/run_main:154:5)
    at node:internal/main/run_main_module:33:47 {
  code: 'MODULE_NOT_FOUND',
  requireStack: []
}

Node.js ${version}`;

/** A `require('express')` that isn't installed (no npm ci). */
export const NODE_MISSING_PACKAGE = (pkg: string, from: string, version: string) => `node:internal/modules/cjs/loader:1568
  throw err;
  ^

Error: Cannot find module '${pkg}'
Require stack:
- ${from}
    at Module._resolveFilename (node:internal/modules/cjs/loader:1564:15)
    at wrapResolveFilename (node:internal/modules/cjs/loader:1118:27)
    at defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1142:10)
    at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1169:12)
    at Module._load (node:internal/modules/cjs/loader:1341:5)
    at wrapModuleLoad (node:internal/modules/cjs/loader:261:19)
    at Module.require (node:internal/modules/cjs/loader:1590:12)
    at require (node:internal/modules/helpers:153:16)
    at Object.<anonymous> (${from}:1:17)
    at Module._compile (node:internal/modules/cjs/loader:1812:14) {
  code: 'MODULE_NOT_FOUND',
  requireStack: [ '${from}' ]
}

Node.js ${version}`;

export const PY_ZERO = `Traceback (most recent call last):
  File "<string>", line 1, in <module>
    print(1/0)
          ~^~
ZeroDivisionError: division by zero`;
