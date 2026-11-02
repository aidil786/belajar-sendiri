// Belajar Sendiri kitchen simulator (Docker Engine 29.x + Compose v5): public API.
//
//   const r = run(state, 'docker run -d --name web -p 8080:80 nginx:1.30-alpine');
//   r.state   → the new state (the old one is never changed)
//   r.output  → coloured lines that look like the real Docker CLI
//   r.events  → what happened, for animations and the state picture
//   r.explain → an i18n key (sim.docker.*) for the friendly one-line explanation
export * from './types';
export { run, runAll, promptOf } from './run';
export { createKitchenState, START_CLOCK, TICK, DOCKER_VERSION, COMPOSE_VERSION, findContainer, findImage } from './state';
export { buildKitchenScenario, kitchenStart, kitchenStep, type KitchenScenario, type KitchenStep } from './scenario';
export { checkKitchenGoal, type KitchenGoal, type GoalResult } from './goals';
export { kitchenPicture, type Picture, type PictureContainer, type PictureImage, type BoxState } from './picture';
export { DOCKER_COMMANDS, DOCKER_EXPLAIN_ONLY } from './docker';
export { HOST_COMMANDS } from './host';
export { CATALOG, catalogRefs } from './catalog';
export { parseDockerfile } from './build';
export { loadProject } from './compose';
export { containerJson, imageJson } from './inspect';
export { statusText, portsText } from './containers';
export { plain, toAnsi } from '../git-sim/output';
