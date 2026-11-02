// World K7 "Self-Driving" (GitOps) scenarios for the food-court engine (Kubernetes 1.37).
// The GitOps games (GitOpsMirror) need no scenario; these cover what K7 shows in the cluster
// itself: a manual change (drift), the Deployment's own heal loop, and a cluster that has
// never heard of a custom kind (no CRDs installed). `verify` lists run in the engine and, in
// CI, on a real kind cluster (see scripts/verify-k8s).
import type { KubeScenario } from '~/engine/foodcourt-sim';
import { SHOP_YAML } from './model';

/** An Argo CD Application (argoproj.io/v1alpha1). The practice cluster has no Argo CD CRDs. */
export const ARGO_APP_YAML = `apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: kedai-kancil
  namespace: argocd
spec:
  project: default
  source:
    repoURL: https://github.com/you/kedai-kancil.git
    path: apps
  destination:
    server: https://kubernetes.default.svc
    namespace: default
  syncPolicy:
    automated:
      selfHeal: true
`;

export const k7Scenarios: KubeScenario[] = [
  {
    // shop.yaml (from Git) says 3 trays. Someone scaled it to 1 by hand: drift.
    id: 'k7-drift',
    files: { 'shop.yaml': SHOP_YAML },
    steps: ['kubectl apply -f shop.yaml', { settle: true }, 'kubectl scale deployment shop --replicas=1'],
    verify: [
      ['kubectl get deployment shop', 'kubectl rollout history deployment/shop'],
      ['kubectl apply -f shop.yaml', 'kubectl rollout status deployment/shop --timeout=120s', 'kubectl get deployment shop'],
    ],
  },
  {
    // The boss: Git now says 5 trays, and the cluster has them.
    id: 'k7-boss',
    files: { 'shop.yaml': SHOP_YAML.replace('replicas: 3', 'replicas: 5') },
    steps: ['kubectl apply -f shop.yaml'],
    verify: [['kubectl delete pod {pod:app=shop}', 'kubectl get deployment shop']],
  },
  {
    // A plain cluster: no Argo CD, so no Application kind. kubectl's real error.
    id: 'k7-crd',
    files: { 'app.yaml': ARGO_APP_YAML },
    verify: [['kubectl apply -f app.yaml', 'kubectl get applications -n argocd']],
  },
];
