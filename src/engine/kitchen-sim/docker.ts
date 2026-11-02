// `docker <command>`: the dispatcher, management commands (docker container ls, docker image rm, ...)
// and the commands the practice kitchen only explains.
import { closest } from '../git-sim/output';
import { build } from './build';
import { compose } from './compose';
import * as ct from './containers';
import * as im from './imagecmds';
import { info, network, prune, system, version, volume } from './misc';
import { DOCKER_VERSION, fail, line, ok, out } from './state';
import type { Ctx, KitchenResult, KitchenState } from './types';

type Fn = (state: KitchenState, args: string[], ctx: Ctx) => KitchenResult;

export const DOCKER_COMMANDS: Record<string, Fn> = {
  run: ct.run,
  create: ct.create,
  start: ct.start,
  stop: ct.stop,
  restart: ct.restart,
  kill: ct.kill,
  pause: ct.pause,
  unpause: ct.unpause,
  rm: ct.rm,
  ps: ct.ps,
  logs: ct.logs,
  exec: ct.exec,
  port: ct.port,
  top: ct.top,
  stats: ct.stats,
  cp: ct.cp,
  wait: ct.wait,
  rename: ct.rename,
  images: im.images,
  pull: im.pull,
  push: im.push,
  tag: im.tag,
  rmi: im.rmi,
  history: im.history,
  login: im.login,
  logout: im.logout,
  inspect: (s, a) => im.inspect(s, a),
  build,
  volume,
  network,
  system,
  compose,
  version,
  info: (s) => info(s),
};

/** Real Docker commands the practice kitchen explains instead of running. */
export const DOCKER_EXPLAIN_ONLY = [
  'attach', 'commit', 'diff', 'export', 'import', 'load', 'save', 'search', 'events', 'update', 'scout', 'init', 'context',
  'swarm', 'service', 'stack', 'node', 'secret', 'config', 'trust', 'manifest', 'plugin', 'sbom', 'debug', 'desktop', 'bake', 'checkpoint', 'model', 'mcp', 'offload', 'ai',
];

const CONTAINER_SUB: Record<string, string> = {
  ls: 'ps', list: 'ps', ps: 'ps', run: 'run', create: 'create', start: 'start', stop: 'stop', restart: 'restart', kill: 'kill',
  pause: 'pause', unpause: 'unpause', rm: 'rm', remove: 'rm', logs: 'logs', exec: 'exec', port: 'port', top: 'top', stats: 'stats',
  cp: 'cp', inspect: 'inspect', wait: 'wait', rename: 'rename',
};
const IMAGE_SUB: Record<string, string> = { ls: 'images', list: 'images', pull: 'pull', push: 'push', tag: 'tag', rm: 'rmi', remove: 'rmi', history: 'history', inspect: 'inspect', build: 'build' };

const HELP = `
Usage:  docker [OPTIONS] COMMAND

A self-sufficient runtime for containers

Common Commands:
  run         Create and run a new container from an image
  exec        Execute a command in a running container
  ps          List containers
  build       Build an image from a Dockerfile
  bake        Build from a file
  pull        Download an image from a registry
  push        Upload an image to a registry
  images      List images
  login       Authenticate to a registry
  logout      Log out from a registry
  search      Search Docker Hub for images
  version     Show the Docker version information
  info        Display system-wide information

Management Commands:
  builder     Manage builds
  buildx*     Docker Buildx
  compose*    Docker Compose
  container   Manage containers
  image       Manage images
  network     Manage networks
  system      Manage Docker
  volume      Manage volumes

Run 'docker COMMAND --help' for more information on a command.`;

export function runDocker(state: KitchenState, args: string[], ctx: Ctx): KitchenResult {
  const [first, ...rest] = args;
  if (!first || first === '--help' || first === 'help') return ok(state, out(HELP.replace(/^\n/, '')), [], { key: 'sim.docker.explain.help' });
  if (first === '--version' || first === '-v') return ok(state, [line(`Docker version ${DOCKER_VERSION}, build a82e528`)], [], { key: 'sim.docker.explain.version' });
  if (!state.host.dockerUp && first !== 'version' && first !== 'compose') {
    return fail(state, out('Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?'), 'daemonDown', { key: 'sim.docker.err.daemonDown' });
  }
  if (rest[0] === '--help' || (rest.length && rest[rest.length - 1] === '--help' && !['run', 'exec', 'compose'].includes(first))) {
    return { ...ok(state, [line(`Usage:  ${ct.USAGE[first] ?? `docker ${first} [OPTIONS]`}`)], [], { key: 'sim.docker.explain.usage', params: { cmd: `docker ${first}` } }) };
  }
  // Management commands.
  if (first === 'container') {
    const sub = rest[0];
    if (sub === 'prune') return prune(state, 'container', rest.slice(1));
    if (sub === 'inspect') return im.inspect(state, rest.slice(1), 'container');
    const name = sub ? CONTAINER_SUB[sub] : undefined;
    if (!name) return mgmt(state, 'container', sub);
    return DOCKER_COMMANDS[name]!(state, rest.slice(1), ctx);
  }
  if (first === 'image') {
    const sub = rest[0];
    if (sub === 'prune') return prune(state, 'image', rest.slice(1));
    if (sub === 'inspect') return im.inspect(state, rest.slice(1), 'image');
    const name = sub ? IMAGE_SUB[sub] : undefined;
    if (!name) return mgmt(state, 'image', sub);
    return DOCKER_COMMANDS[name]!(state, rest.slice(1), ctx);
  }
  if (first === 'builder') {
    if (rest[0] === 'prune') return prune(state, 'builder', rest.slice(1));
    if (rest[0] === 'build') return build(state, rest.slice(1));
    return mgmt(state, 'builder', rest[0]);
  }
  if (first === 'buildx') {
    if (rest[0] === 'build' || rest[0] === 'b') return build(state, rest.slice(1));
    if (rest[0] === 'prune') return prune(state, 'builder', rest.slice(1));
    return explainOnly(state, `buildx ${rest[0] ?? ''}`.trim());
  }
  if (first === 'compose' && rest[0] === 'watch') return explainOnly(state, 'compose watch');
  const fn = DOCKER_COMMANDS[first];
  if (fn) return fn(state, rest, ctx);
  if (DOCKER_EXPLAIN_ONLY.includes(first)) return explainOnly(state, first);
  const suggestion = closest(first, [...Object.keys(DOCKER_COMMANDS), 'container', 'image', 'builder']);
  return fail(state, out(`docker: unknown command: docker ${first}\n\nRun 'docker --help' for more information`), 'unknownCommand', suggestion
    ? { key: 'sim.docker.err.unknownDidYouMean', params: { cmd: `docker ${first}`, suggestion: `docker ${suggestion}` } }
    : { key: 'sim.docker.err.unknownCommand', params: { cmd: `docker ${first}` } });
}

function mgmt(state: KitchenState, group: string, sub: string | undefined): KitchenResult {
  if (!sub) {
    return fail(state, out(`\nUsage:  docker ${group} COMMAND\n\nManage ${group === 'builder' ? 'builds' : `${group}s`}\n\nRun 'docker ${group} COMMAND --help' for more information on a command.`), 'usage', { key: 'sim.docker.err.needsSub', params: { cmd: `docker ${group}` } });
  }
  return fail(state, out(`docker: unknown command: docker ${group} ${sub}\n\nRun 'docker ${group} --help' for more information`), 'unknownCommand', { key: 'sim.docker.err.unknownCommand', params: { cmd: `docker ${group} ${sub}` } });
}

function explainOnly(state: KitchenState, cmd: string): KitchenResult {
  return {
    ...fail(state, out(`This practice kitchen doesn't run docker ${cmd}. The lesson shows what it does.`), 'explainOnly', { key: 'sim.docker.explain.notInSim', params: { cmd: `docker ${cmd}` } }),
    stopped: true,
  };
}
