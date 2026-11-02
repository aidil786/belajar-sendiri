// Belajar Sendiri food-court simulator (Kubernetes 1.37): public API.
//
//   const s = buildScenario(scenario);
//   const r = run(s, 'kubectl delete pod shop-7d9c8b6f5d-x2b4k');
//   r.state   → the new state (the old one is never changed)
//   r.output  → lines that look like real kubectl 1.37
//   r.events  → what happened (podDeleted, reconcile want/see/do, podReplaced …) for animations
//   r.explain → an i18n key (kube.explain.* / kube.err.*) for the friendly one-line explanation
//   tick(s, 1) → one simulated second passes (kubelets pull, start, probe, restart …)
export * from './types';
export { run, runAll, prompt, promptParts, SHELL } from './run';
export { tick, settle, reconcileAll, signature } from './clock';
export { injectFault, type Fault } from './faults';
export { checkGoal, GOAL_KEYS, parseRef, type KubeGoal, type GoalResult, type ObjRef } from './goals';
export { buildScenario, buildScenarioCached, scenarioStart, scenarioStep, type KubeScenario, type KubeStep } from './scenario';
export { addCluster, emptyState, type ClusterSetup, type NodeSetup } from './cluster';
export { picture, board, boardEvents, whereAmI, toTray, trayState, type Picture, type Stall, type Tray, type TrayState, type OrderNumber, type Entrance, type Board } from './views';
export { currentCluster, currentContext, currentNamespace, getObj, listObjs, podStatusText, readyText, restartCount, podReady } from './store';
export { KUBECTL_COMMANDS, KUBECTL_EXPLAIN_ONLY } from './kubectl';
export { RESOURCES, findResource } from './resources';
export { toYaml, parseManifests } from './yaml';
export { NODE_GRACE, EVICTION_DELAY } from './controllers/misc';
export { plain, toAnsi } from '../git-sim/output';
// K9 node shell (ssh / docker exec into a kind node): see node/ and fixtures/cka.json.
export { NODE_COMMANDS, nodePrompt } from './node/shell';
export { CKA, fx } from './node/fixtures';
export { controlPlane, componentServing, cpNode, ensureOs, staticFromManifest, MANIFESTS, NOTICE, FILE_CHECK } from './node/os';
export { takeSnapshot } from './node/etcd';
