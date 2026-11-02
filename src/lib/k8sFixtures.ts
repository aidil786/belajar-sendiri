// YamlDoctor practice manifests: each one broken in one common way, plus its fix.
// `real` is exactly what `kubectl apply -f <file>` printed for the broken file, captured from
// kubectl v1.37.2 against kube-apiserver v1.37.2 (Gateway API v1.6.1 CRDs installed) on 2026-10-31.
// Unit tests check that kubectlApply() prints the same; `npm run verify:manifests` checks every
// `fixed` manifest with kubeconform (Kubernetes 1.37 schemas).

export interface K8sFixture {
  id: string;
  file: string;
  /** What is wrong, in plain words (English, for tests and the dev page). */
  what: string;
  broken: string;
  fixed: string;
  /** Real kubectl 1.37.2 output for `broken` (exit code 1). */
  real: string;
}

export const K8S_FIXTURES: K8sFixture[] = [
  {
    id: 'tab',
    file: 'menu.yaml',
    what: 'A tab instead of spaces.',
    broken: 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: menu\ndata:\n\tSIZE: big\n',
    fixed: 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: menu\ndata:\n  SIZE: big\n',
    real: 'error: error parsing menu.yaml: error converting YAML to JSON: yaml: line 6: found character that cannot start any token',
  },
  {
    id: 'indent',
    file: 'tray.yaml',
    what: 'ports: is one space short.',
    broken:
      'apiVersion: v1\nkind: Pod\nmetadata:\n  name: tray\nspec:\n  containers:\n    - name: web\n      image: nginx:1.29-alpine\n     ports:\n        - containerPort: 80\n',
    fixed:
      'apiVersion: v1\nkind: Pod\nmetadata:\n  name: tray\nspec:\n  containers:\n    - name: web\n      image: nginx:1.29-alpine\n      ports:\n        - containerPort: 80\n',
    real: "error: error parsing tray.yaml: error converting YAML to JSON: yaml: line 8: did not find expected '-' indicator",
  },
  {
    id: 'colon-space',
    file: 'tray.yaml',
    what: 'No space after image:.',
    broken:
      'apiVersion: v1\nkind: Pod\nmetadata:\n  name: tray\nspec:\n  containers:\n    - name: web\n      image:nginx:1.29-alpine\n',
    fixed:
      'apiVersion: v1\nkind: Pod\nmetadata:\n  name: tray\nspec:\n  containers:\n    - name: web\n      image: nginx:1.29-alpine\n',
    real: "error: error parsing tray.yaml: error converting YAML to JSON: yaml: line 9: could not find expected ':'",
  },
  {
    id: 'old-api',
    file: 'shop.yaml',
    what: 'Deployment in an apiVersion that is gone.',
    broken:
      'apiVersion: extensions/v1beta1\nkind: Deployment\nmetadata:\n  name: shop\nspec:\n  replicas: 3\n  selector:\n    matchLabels:\n      app: shop\n  template:\n    metadata:\n      labels:\n        app: shop\n    spec:\n      containers:\n        - name: web\n          image: nginx:1.29-alpine\n',
    fixed:
      'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: shop\nspec:\n  replicas: 3\n  selector:\n    matchLabels:\n      app: shop\n  template:\n    metadata:\n      labels:\n        app: shop\n    spec:\n      containers:\n        - name: web\n          image: nginx:1.29-alpine\n',
    real: 'error: resource mapping not found for name: "shop" namespace: "" from "shop.yaml": no matches for kind "Deployment" in version "extensions/v1beta1"\nensure CRDs are installed first',
  },
  {
    id: 'typo',
    file: 'shop.yaml',
    what: 'containers is misspelt.',
    broken:
      'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: shop\nspec:\n  replicas: 3\n  selector:\n    matchLabels:\n      app: shop\n  template:\n    metadata:\n      labels:\n        app: shop\n    spec:\n      contianers:\n        - name: web\n          image: nginx:1.29-alpine\n',
    fixed:
      'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: shop\nspec:\n  replicas: 3\n  selector:\n    matchLabels:\n      app: shop\n  template:\n    metadata:\n      labels:\n        app: shop\n    spec:\n      containers:\n        - name: web\n          image: nginx:1.29-alpine\n',
    real: 'Error from server (BadRequest): error when creating "shop.yaml": Deployment in version "v1" cannot be handled as a Deployment: strict decoding error: unknown field "spec.template.spec.contianers"',
  },
  {
    id: 'selector',
    file: 'shop.yaml',
    what: 'The selector and the template labels differ.',
    broken:
      'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: shop\nspec:\n  replicas: 3\n  selector:\n    matchLabels:\n      app: shop\n  template:\n    metadata:\n      labels:\n        app: web\n    spec:\n      containers:\n        - name: web\n          image: nginx:1.29-alpine\n',
    fixed:
      'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: shop\nspec:\n  replicas: 3\n  selector:\n    matchLabels:\n      app: shop\n  template:\n    metadata:\n      labels:\n        app: shop\n    spec:\n      containers:\n        - name: web\n          image: nginx:1.29-alpine\n',
    real: 'The Deployment "shop" is invalid: spec.template.metadata.labels: Invalid value: {"app":"web"}: `selector` does not match template `labels`',
  },
  {
    id: 'missing-image',
    file: 'shop.yaml',
    what: 'The container has no image.',
    broken:
      'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: shop\nspec:\n  replicas: 3\n  selector:\n    matchLabels:\n      app: shop\n  template:\n    metadata:\n      labels:\n        app: shop\n    spec:\n      containers:\n        - name: web\n',
    fixed:
      'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: shop\nspec:\n  replicas: 3\n  selector:\n    matchLabels:\n      app: shop\n  template:\n    metadata:\n      labels:\n        app: shop\n    spec:\n      containers:\n        - name: web\n          image: nginx:1.29-alpine\n',
    real: 'The Deployment "shop" is invalid: spec.template.spec.containers[0].image: Required value',
  },
  {
    id: 'string-int',
    file: 'shop.yaml',
    what: 'replicas is text, not a number.',
    broken:
      'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: shop\nspec:\n  replicas: "3"\n  selector:\n    matchLabels:\n      app: shop\n  template:\n    metadata:\n      labels:\n        app: shop\n    spec:\n      containers:\n        - name: web\n          image: nginx:1.29-alpine\n',
    fixed:
      'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: shop\nspec:\n  replicas: 3\n  selector:\n    matchLabels:\n      app: shop\n  template:\n    metadata:\n      labels:\n        app: shop\n    spec:\n      containers:\n        - name: web\n          image: nginx:1.29-alpine\n',
    real: 'Error from server (BadRequest): error when creating "shop.yaml": Deployment in version "v1" cannot be handled as a Deployment: json: cannot unmarshal string into Go struct field DeploymentSpec.spec.replicas of type int32',
  },
  {
    id: 'service-protocol',
    file: 'service.yaml',
    what: 'protocol must be TCP in capitals.',
    broken:
      'apiVersion: v1\nkind: Service\nmetadata:\n  name: shop\nspec:\n  selector:\n    app: shop\n  ports:\n    - port: 80\n      targetPort: 8080\n      protocol: tcp\n',
    fixed:
      'apiVersion: v1\nkind: Service\nmetadata:\n  name: shop\nspec:\n  selector:\n    app: shop\n  ports:\n    - port: 80\n      targetPort: 8080\n      protocol: TCP\n',
    real: 'The Service "shop" is invalid: spec.ports[0].protocol: Unsupported value: "tcp": supported values: "SCTP", "TCP", "UDP"',
  },
  {
    id: 'yes-bool',
    file: 'menu.yaml',
    what: 'YAML reads yes as true, not text.',
    broken:
      'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: menu\ndata:\n  SIZE: big\n  SPICY: yes\n',
    fixed:
      'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: menu\ndata:\n  SIZE: big\n  SPICY: "yes"\n',
    real: 'Error from server (BadRequest): error when creating "menu.yaml": ConfigMap in version "v1" cannot be handled as a ConfigMap: json: cannot unmarshal bool into Go struct field ConfigMap.data of type string',
  },
  {
    id: 'secret-base64',
    file: 'secret.yaml',
    what: 'data: needs base64; stringData: takes plain text.',
    broken:
      'apiVersion: v1\nkind: Secret\nmetadata:\n  name: spice-box\ntype: Opaque\ndata:\n  password: kancil123\n',
    fixed:
      'apiVersion: v1\nkind: Secret\nmetadata:\n  name: spice-box\ntype: Opaque\nstringData:\n  password: kancil123\n',
    real: 'Error from server (BadRequest): error when creating "secret.yaml": Secret in version "v1" cannot be handled as a Secret: illegal base64 data at input byte 8',
  },
  {
    id: 'role-verbs',
    file: 'role.yaml',
    what: 'The rule says what, but not which verbs.',
    broken:
      'apiVersion: rbac.authorization.k8s.io/v1\nkind: Role\nmetadata:\n  name: deployer\n  namespace: shop\nrules:\n  - apiGroups: ["apps"]\n    resources: ["deployments"]\n',
    fixed:
      'apiVersion: rbac.authorization.k8s.io/v1\nkind: Role\nmetadata:\n  name: deployer\n  namespace: shop\nrules:\n  - apiGroups: ["apps"]\n    resources: ["deployments"]\n    verbs: ["get", "list", "patch"]\n',
    real: 'The Role "deployer" is invalid: rules[0].verbs: Required value',
  },
  {
    id: 'cron',
    file: 'cleanup.yaml',
    what: 'The schedule needs five cron fields.',
    broken:
      'apiVersion: batch/v1\nkind: CronJob\nmetadata:\n  name: cleanup\nspec:\n  schedule: "every night"\n  jobTemplate:\n    spec:\n      template:\n        spec:\n          restartPolicy: OnFailure\n          containers:\n            - name: clean\n              image: busybox:1.37\n',
    fixed:
      'apiVersion: batch/v1\nkind: CronJob\nmetadata:\n  name: cleanup\nspec:\n  schedule: "0 3 * * *"\n  jobTemplate:\n    spec:\n      template:\n        spec:\n          restartPolicy: OnFailure\n          containers:\n            - name: clean\n              image: busybox:1.37\n',
    real: 'The CronJob "cleanup" is invalid: spec.schedule: Invalid value: "every night": expected exactly 5 fields, found 2: [every night]',
  },
  {
    id: 'hpa-max',
    file: 'hpa.yaml',
    what: 'maxReplicas is smaller than minReplicas.',
    broken:
      'apiVersion: autoscaling/v2\nkind: HorizontalPodAutoscaler\nmetadata:\n  name: shop\nspec:\n  scaleTargetRef:\n    apiVersion: apps/v1\n    kind: Deployment\n    name: shop\n  minReplicas: 3\n  maxReplicas: 1\n',
    fixed:
      'apiVersion: autoscaling/v2\nkind: HorizontalPodAutoscaler\nmetadata:\n  name: shop\nspec:\n  scaleTargetRef:\n    apiVersion: apps/v1\n    kind: Deployment\n    name: shop\n  minReplicas: 3\n  maxReplicas: 10\n',
    real: 'The HorizontalPodAutoscaler "shop" is invalid: spec.maxReplicas: Invalid value: 1: must be greater than or equal to `minReplicas`',
  },
  {
    id: 'route-path',
    file: 'route.yaml',
    what: 'A path must start with /.',
    broken:
      'apiVersion: gateway.networking.k8s.io/v1\nkind: HTTPRoute\nmetadata:\n  name: shop\nspec:\n  parentRefs:\n    - name: entrance\n  rules:\n    - matches:\n        - path:\n            type: PathPrefix\n            value: api\n      backendRefs:\n        - name: api\n          port: 80\n',
    fixed:
      'apiVersion: gateway.networking.k8s.io/v1\nkind: HTTPRoute\nmetadata:\n  name: shop\nspec:\n  parentRefs:\n    - name: entrance\n  rules:\n    - matches:\n        - path:\n            type: PathPrefix\n            value: /api\n      backendRefs:\n        - name: api\n          port: 80\n',
    real: "The HTTPRoute \"shop\" is invalid: spec.rules[0].matches[0].path: Invalid value: value must be an absolute path and start with '/' when type one of ['Exact', 'PathPrefix']",
  },
];

export function fixture(id: string): K8sFixture {
  const f = K8S_FIXTURES.find((x) => x.id === id);
  if (!f) throw new Error(`Unknown Kubernetes fixture: ${id}`);
  return f;
}
