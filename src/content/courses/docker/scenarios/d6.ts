// World D6 "Under the Hood": a container is a Linux process with switches on.
// Each `verify` list runs in the engine and on a real Docker daemon (`npm run verify:docker`).
// Not in verify lists on purpose (they differ on every machine, real or not): PIDs (`docker inspect
// -f {{.State.Pid}}`, `ps` inside), `uname -r` and `docker info`. Their shape was checked by hand on
// Docker Engine 29.9.2 (2026-10-31).
import type { KitchenScenario } from '~/engine/kitchen-sim';

export const d6: KitchenScenario[] = [
  {
    // L01, L02, L05, boss: nginx runs as web. Look at it from the laptop and from inside.
    id: 'd6-web',
    images: ['nginx:1.30-alpine'],
    steps: ['docker run -d --name web -p 8080:80 nginx:1.30-alpine'],
    verify: [
      ['docker top web', 'ps aux', 'docker exec web hostname', 'hostname', 'curl -s localhost:8080'],
      ['docker run -d --name web2 nginx:1.30-alpine', 'docker exec web2 hostname', 'docker ps', 'docker rm -f web2'],
    ],
  },
  {
    // L03: cgroup limits. --memory, --cpus and --pids-limit show in inspect and stats.
    id: 'd6-limits',
    images: ['nginx:1.30-alpine', 'node:24-alpine', 'alpine:3.22'],
    steps: [],
    verify: [
      ['docker run -d --name web --memory 256m nginx:1.30-alpine', 'docker stats --no-stream', 'docker inspect -f {{.HostConfig.Memory}} web'],
      ['docker run -d --name api --cpus 0.5 --pids-limit 100 node:24-alpine sleep 1000', "docker inspect -f '{{.HostConfig.NanoCpus}} {{.HostConfig.PidsLimit}}' api", 'docker rm -f api'],
      ['docker run --rm --memory 2m alpine:3.22 true', 'docker run --rm --memory 1g alpine:3.22 echo ok'],
    ],
  },
  {
    // L04: two lunchboxes from one image. Each has its own thin writable layer on top.
    id: 'd6-two-boxes',
    images: ['alpine:3.22'],
    steps: ['docker run -d --name box1 alpine:3.22 sleep 1000', 'docker run -d --name box2 alpine:3.22 sleep 1000'],
    verify: [
      ['docker exec box1 sh -c "echo hi > /root/note.txt"', 'docker exec box1 cat /root/note.txt', 'docker exec box2 cat /root/note.txt', 'docker exec box2 ls /root'],
      ['docker exec box1 touch /tmp/hi', 'docker exec box1 ls /tmp', 'docker exec box2 ls /tmp', 'docker rm -f box1', 'docker run -d --name box1 alpine:3.22 sleep 1000', 'docker exec box1 ls /tmp'],
    ],
  },
  {
    // Rescue Center (Docker flows): the commands they give, checked on the real daemon too.
    id: 'd6-rescue',
    images: ['nginx:1.30-alpine', 'alpine:3.22', 'redis:8-alpine'],
    steps: [],
    verify: [
      // Port already allocated: who has it, remove the half-made container, pick another port.
      // (`docker ps --filter publish=8080` was checked by hand: the port shift here can't map it.)
      ['docker run -d --name web -p 8080:80 nginx:1.30-alpine', 'docker run -d --name web2 -p 8080:80 nginx:1.30-alpine', 'docker ps -a', 'docker rm web2', 'docker run -d --name web2 -p 8081:80 nginx:1.30-alpine', 'docker port web2'],
      // Exits right away: a plain OS image has nothing to do. Read the status, code and logs.
      ['docker run -d --name box alpine:3.22', 'docker ps -a --filter name=box', "docker inspect -f '{{.State.ExitCode}}' box", 'docker logs box', 'docker rm box'],
      // Permission denied on a fresh named volume: a non-root user can't write; chown the volume once.
      ['docker run --rm --user 1000:1000 -v appdata:/data alpine:3.22 touch /data/x', 'docker run --rm -v appdata:/data alpine:3.22 chown 1000:1000 /data', 'docker run --rm --user 1000:1000 -v appdata:/data alpine:3.22 touch /data/x'],
      // Names don't resolve on the default bridge; they do on your own network.
      ['docker run -d --name cache redis:8-alpine', 'docker run --rm alpine:3.22 ping -c 1 cache', 'docker network create shopnet', 'docker network connect shopnet cache', 'docker run --rm --network shopnet redis:8-alpine redis-cli -h cache ping', 'docker run --rm --network shopnet redis:8-alpine redis-cli -h localhost ping'],
      // Wrong CPU type: which platform is the image?
      ["docker image inspect -f '{{.Os}}/{{.Architecture}}' alpine:3.22", 'docker system df'],
    ],
  },
];
