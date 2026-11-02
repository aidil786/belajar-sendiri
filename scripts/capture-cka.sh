#!/usr/bin/env bash
# Record real node-side outputs for the K9 node shell (CKA pack) from a kind cluster made with
# scripts/verify-k8s/kind-dev.yaml (context kind-dev: dev-control-plane, dev-worker, dev-worker2).
# Run by .github/workflows/capture-cka.yml (manual). Locally: needs docker, kind's cluster "dev",
# kubectl and jq. It changes the cluster on purpose (stops a kubelet, breaks and fixes static pods,
# restores etcd), so use a throwaway cluster only.
#
#   scripts/capture-cka.sh cka-capture.json
#   npx tsx scripts/capture-cka/import.ts cka-capture.json   # → src/engine/foodcourt-sim/fixtures/cka.json
#
# Each output is saved under the same key as in fixtures/cka.json, with the node it ran on, that
# node's IP, the command, its exit code and "vars" (the paths and ids typed), so the engine can
# swap in its own.
set -euo pipefail

OUT="${1:-cka-capture.json}"
CTX="${K8S_TRUTH_CONTEXT:-kind-dev}"
CP=dev-control-plane
W1=dev-worker
W2=dev-worker2
TLS="--cacert=/etc/kubernetes/pki/etcd/ca.crt --cert=/etc/kubernetes/pki/etcd/server.crt --key=/etc/kubernetes/pki/etcd/server.key"
ETCD_EXEC="kubectl --context $CTX -n kube-system exec etcd-$CP --"
WORK="$(mktemp -d)"

case "$CTX" in
  kind-*) ;;
  *) echo "Refusing to touch context $CTX: this script only works on kind clusters." >&2; exit 1 ;;
esac

k() { kubectl --context "$CTX" "$@"; }

# cap KEY NODE VARS_JSON 'shell command'  — run it, keep stdout+stderr, the exit code and the command.
cap() {
  local key="$1" node="$2" vars="$3" cmd="$4" code=0
  echo "▸ $key: $cmd"
  bash -c "$cmd" >"$WORK/$key.txt" 2>&1 || code=$?
  printf '%s\n%s\n%s\n%s\n' "$node" "$code" "$cmd" "$vars" >"$WORK/$key.meta"
}

# capfile PATH NODE  — a file on a node.
capfile() {
  local path="$1" node="$2" name
  name="$(echo "$path" | tr '/' '_')"
  docker exec "$node" cat "$path" >"$WORK/file$name.txt"
  printf '%s\n%s\n' "$path" "$node" >"$WORK/file$name.fmeta"
}

wait_api() {
  for _ in $(seq 1 90); do
    if k get --raw /readyz >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  echo "API server did not come back" >&2
  return 1
}

wait_ready() { k wait --for=condition=Ready "node/$1" --timeout=180s; }

# ---------------------------------------------------------------- one JSON file (also after a failure: partial is useful)
write_json() {
  local json meta key node code cmd vars ip name path
  json="$(jq -n --arg date "$(date -u +%Y-%m-%dT%H:%M:%SZ)" --arg kind "$(kind version 2>/dev/null || echo unknown)" \
    --arg kubectl "$(kubectl version --client -o json | jq -r .clientVersion.gitVersion)" \
    --arg image "${KIND_NODE_IMAGE:-unknown}" \
    '{captured: $date, kind: $kind, kubectl: $kubectl, nodeImage: $image, outputs: {}, files: {}}')"
  for meta in "$WORK"/*.meta; do
    [ -e "$meta" ] || continue
    key="$(basename "$meta" .meta)"
    { read -r node; read -r code; read -r cmd; read -r vars; } <"$meta"
    ip=""
    if [ "$node" != "-" ]; then ip="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "$node" 2>/dev/null || true)"; fi
    json="$(jq --arg k "$key" --arg node "$node" --arg ip "$ip" --arg cmd "$cmd" --argjson exit "$code" --argjson vars "$vars" \
      --rawfile text "$WORK/$key.txt" \
      '.outputs[$k] = {source: "kind-capture", node: (if $node == "-" then null else $node end), ip: $ip, cmd: $cmd, exit: $exit, vars: $vars, text: ($text | sub("\n+$"; ""))}' <<<"$json")"
  done
  for meta in "$WORK"/*.fmeta; do
    [ -e "$meta" ] || continue
    name="$(basename "$meta" .fmeta)"
    { read -r path; read -r node; } <"$meta"
    json="$(jq --arg p "$path" --arg node "$node" --rawfile text "$WORK/$name.txt" '.files[$p] = {source: "kind-capture", node: $node, text: $text}' <<<"$json")"
  done
  printf '%s\n' "$json" >"$OUT"
  echo "Wrote $OUT: $(jq '.outputs | length' "$OUT") outputs, $(jq '.files | length' "$OUT") files."
}
trap 'write_json; rm -rf "$WORK"' EXIT


k get nodes -o wide

# ---------------------------------------------------------------- files the node shell shows
for f in /etc/kubernetes/manifests/etcd.yaml /etc/kubernetes/manifests/kube-apiserver.yaml \
  /etc/kubernetes/manifests/kube-controller-manager.yaml /etc/kubernetes/manifests/kube-scheduler.yaml \
  /etc/systemd/system/kubelet.service /etc/systemd/system/kubelet.service.d/10-kubeadm.conf \
  /etc/systemd/system/kubelet.service.d/11-kind.conf /var/lib/kubelet/config.yaml /var/lib/kubelet/kubeadm-flags.env; do
  capfile "$f" "$CP"
done

# ---------------------------------------------------------------- a healthy node
cap systemctl-status-active "$W1" '{}' "docker exec $W1 systemctl status kubelet --no-pager"
cap systemctl-unknown-unit "$W1" '{}' "docker exec $W1 systemctl status kubelett --no-pager"
cap journal-no-entries "$W1" '{}' "docker exec $W1 journalctl -u kubelett -n 5 --no-pager"
cap crictl-ps "$W1" '{}' "docker exec $W1 crictl ps -a"
cap crictl-pods "$W1" '{}' "docker exec $W1 crictl pods"
cap crictl-images "$W1" '{}' "docker exec $W1 crictl images"
cap crictl-logs-notfound "$W1" '{"id":"abc123"}' "docker exec $W1 crictl logs abc123"
cap command-not-found "$W1" '{}' "docker exec $W1 bash -ic 'etcdctl version'"
cap kubeadm-version "$CP" '{}' "docker exec $CP kubeadm version -o short"
cap kubeadm-certs-check-expiration "$CP" '{}' "docker exec $CP kubeadm certs check-expiration"
cap kubeadm-upgrade-plan "$CP" '{}' "docker exec $CP kubeadm upgrade plan"
# kind starts control-plane node containers with KUBECONFIG=/etc/kubernetes/admin.conf, workers with none.
cap kubectl-in-control-plane "$CP" '{}' "docker exec $CP kubectl get nodes"
cap kubectl-in-worker "$W1" '{}' "docker exec $W1 kubectl get nodes"
cap kubectl-in-worker-kubeconfig "$W1" '{"file":"/etc/kubernetes/admin.conf"}' "docker exec $W1 kubectl --kubeconfig /etc/kubernetes/admin.conf get nodes"
cap node-env-control-plane "$CP" '{}' "docker exec $CP printenv KUBECONFIG"
cap node-env-worker "$W1" '{}' "docker exec $W1 printenv KUBECONFIG"

# ---------------------------------------------------------------- the kubelet: restart (start lines)
docker exec "$W2" systemctl restart kubelet
sleep 8
cap journal-kubelet-start "$W2" '{}' "docker exec $W2 journalctl -u kubelet --no-pager -n 400"
cap systemctl-status-started "$W2" '{}' "docker exec $W2 systemctl status kubelet --no-pager"

# ---------------------------------------------------------------- stop the kubelet → NotReady → start
docker exec "$W1" systemctl stop kubelet
sleep 3
cap systemctl-status-stopped "$W1" '{}' "docker exec $W1 systemctl status kubelet --no-pager"
cap journal-kubelet-stop "$W1" '{}' "docker exec $W1 journalctl -u kubelet -n 8 --no-pager"
cap systemctl-is-active-stopped "$W1" '{}' "docker exec $W1 systemctl is-active kubelet"
sleep 60
cap kubectl-get-nodes-notready - '{}' "kubectl --context $CTX get nodes"
cap kubectl-describe-node-notready "$W1" '{}' "kubectl --context $CTX describe node $W1"
cap node-conditions-notready "$W1" '{}' "kubectl --context $CTX get node $W1 -o jsonpath={.status.conditions}"
cap node-taints-notready "$W1" '{}' "kubectl --context $CTX get node $W1 -o jsonpath={.spec.taints}"
cap crictl-ps-kubelet-stopped "$W1" '{}' "docker exec $W1 crictl ps"
docker exec "$W1" systemctl start kubelet
wait_ready "$W1"
cap kubectl-get-nodes-ready - '{}' "kubectl --context $CTX get nodes"

# ---------------------------------------------------------------- crictl on a crash-looping pod
cat >"$WORK/oven.yaml" <<'YAML'
apiVersion: v1
kind: Pod
metadata:
  name: oven
  labels:
    app: oven
spec:
  nodeSelector:
    kubernetes.io/hostname: dev-worker2
  containers:
    - name: oven
      image: busybox:1.37
      command: ["sh", "-c", "echo oven: no gas, cannot heat; exit 1"]
YAML
k apply -f "$WORK/oven.yaml"
sleep 45
cap crictl-ps-oven "$W2" '{}' "docker exec $W2 crictl ps -a --name oven"
cap crictl-pods-oven "$W2" '{}' "docker exec $W2 crictl pods --name oven"
OVEN_ID="$(docker exec "$W2" crictl ps -a -q --name oven | head -1)"
cap crictl-logs-oven "$W2" "{\"id\":\"$OVEN_ID\"}" "docker exec $W2 crictl logs $OVEN_ID"
k delete pod oven --wait=true

# ---------------------------------------------------------------- mirror pods
cap mirror-pod-yaml "$CP" '{}' "kubectl --context $CTX -n kube-system get pod kube-scheduler-$CP -o yaml"
cap mirror-pod-describe "$CP" '{}' "kubectl --context $CTX -n kube-system describe pod kube-scheduler-$CP"
k -n kube-system delete pod "kube-scheduler-$CP"
sleep 5
cap mirror-pod-recreated "$CP" '{}' "kubectl --context $CTX -n kube-system get pods -l component=kube-scheduler"

# ---------------------------------------------------------------- broken static pod manifests (scheduler)
docker exec "$CP" cp /etc/kubernetes/manifests/kube-scheduler.yaml /root/kube-scheduler.yaml.good
docker exec "$CP" sed -i 's#--kubeconfig=/etc/kubernetes/scheduler.conf#--kubeconfig=/etc/kubernetes/schedulr.conf#' /etc/kubernetes/manifests/kube-scheduler.yaml
sleep 45
cap kubectl-scheduler-crashloop "$CP" '{}' "kubectl --context $CTX -n kube-system get pods -l component=kube-scheduler"
cap component-crash-missing-file "$CP" '{"file":"/etc/kubernetes/schedulr.conf"}' "kubectl --context $CTX -n kube-system logs kube-scheduler-$CP"
docker exec "$CP" cp /root/kube-scheduler.yaml.good /etc/kubernetes/manifests/kube-scheduler.yaml
sleep 30
docker exec "$CP" sed -i 's#--bind-address=#--bind-adress=#' /etc/kubernetes/manifests/kube-scheduler.yaml
sleep 40
cap component-crash-unknown-flag "$CP" '{"flag":"--bind-adress"}' "kubectl --context $CTX -n kube-system logs kube-scheduler-$CP"
docker exec "$CP" cp /root/kube-scheduler.yaml.good /etc/kubernetes/manifests/kube-scheduler.yaml
sleep 30
docker exec "$CP" sed -i 's/^  containers:$/  containers/' /etc/kubernetes/manifests/kube-scheduler.yaml
sleep 30
cap kubectl-scheduler-missing "$CP" '{}' "kubectl --context $CTX -n kube-system get pods -l component=kube-scheduler"
cap kubelet-manifest-error "$CP" '{"file":"/etc/kubernetes/manifests/kube-scheduler.yaml"}' "docker exec $CP journalctl -u kubelet --no-pager -n 300"
docker exec "$CP" cp /root/kube-scheduler.yaml.good /etc/kubernetes/manifests/kube-scheduler.yaml
sleep 30
k -n kube-system wait --for=condition=Ready "pod/kube-scheduler-$CP" --timeout=180s

# ---------------------------------------------------------------- no API server
docker exec "$CP" mv /etc/kubernetes/manifests/kube-apiserver.yaml /root/
sleep 30
SERVER="$(k config view --minify -o jsonpath='{.clusters[0].cluster.server}' | sed 's#^https://##')"
cap kubectl-api-down - "{\"server\":\"$SERVER\"}" "kubectl --context $CTX get nodes"
cap kubectl-version-api-down - "{\"server\":\"$SERVER\"}" "kubectl --context $CTX version"
cap kubectl-in-control-plane-api-down "$CP" '{"server":"dev-control-plane:6443"}' "docker exec $CP kubectl get nodes"
docker exec "$CP" mv /root/kube-apiserver.yaml /etc/kubernetes/manifests/
wait_api

# ---------------------------------------------------------------- etcd: snapshot, status, restore (kind: kubectl exec into etcd)
cap etcdctl-version "$CP" '{}' "$ETCD_EXEC etcdctl version"
cap etcdutl-version "$CP" '{}' "$ETCD_EXEC etcdutl version"
cap etcdctl-endpoint-health "$CP" '{"endpoint":"https://127.0.0.1:2379"}' "$ETCD_EXEC etcdctl --endpoints=https://127.0.0.1:2379 $TLS endpoint health"
cap etcdctl-member-list "$CP" '{}' "$ETCD_EXEC etcdctl --endpoints=https://127.0.0.1:2379 $TLS member list -w table"
cap etcdctl-snapshot-save-hang "$CP" '{"file":"/var/lib/etcd/nocerts.db"}' "timeout 15 $ETCD_EXEC etcdctl snapshot save /var/lib/etcd/nocerts.db"
cap etcdctl-open-error "$CP" '{}' "$ETCD_EXEC etcdctl --endpoints=https://127.0.0.1:2379 --cacert=/etc/kubernetes/pki/ca.crt --cert=/etc/kubernetes/pki/etcd/server.crt --key=/etc/kubernetes/pki/etcd/server.key snapshot save /var/lib/etcd/x.db"
cap etcdctl-save-bad-dir "$CP" '{"file":"/nope/dir/f.db"}' "$ETCD_EXEC etcdctl --endpoints=https://127.0.0.1:2379 $TLS snapshot save /nope/dir/f.db"
cap etcdctl-save-no-arg "$CP" '{}' "$ETCD_EXEC etcdctl --endpoints=https://127.0.0.1:2379 $TLS snapshot save"

cat >"$WORK/shop.yaml" <<'YAML'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: shop
spec:
  replicas: 2
  selector:
    matchLabels:
      app: shop
  template:
    metadata:
      labels:
        app: shop
    spec:
      containers:
        - name: web
          image: nginx:1.29-alpine
YAML
k apply -f "$WORK/shop.yaml"
k rollout status deployment/shop --timeout=180s
cap etcdctl-snapshot-save "$CP" '{"file":"/var/lib/etcd/snapshot.db","endpoint":"https://127.0.0.1:2379"}' "$ETCD_EXEC etcdctl --endpoints=https://127.0.0.1:2379 $TLS snapshot save /var/lib/etcd/snapshot.db"
cap etcdctl-snapshot-save-no-endpoint "$CP" '{"file":"/var/lib/etcd/a.db"}' "$ETCD_EXEC etcdctl $TLS snapshot save /var/lib/etcd/a.db"
cap etcdutl-status-table "$CP" '{}' "$ETCD_EXEC etcdutl --write-out=table snapshot status /var/lib/etcd/snapshot.db"
cap etcdutl-status-simple "$CP" '{}' "$ETCD_EXEC etcdutl snapshot status /var/lib/etcd/snapshot.db"
cap etcdutl-status-json "$CP" '{}' "$ETCD_EXEC etcdutl --write-out=json snapshot status /var/lib/etcd/snapshot.db"
cap etcdutl-status-missing "$CP" '{}' "$ETCD_EXEC etcdutl --write-out=table snapshot status /var/lib/etcd/nope.db"
cap etcdctl-snapshot-usage "$CP" '{}' "$ETCD_EXEC etcdctl --write-out=table snapshot status /var/lib/etcd/snapshot.db"
cap etcdctl-unknown-data-dir "$CP" '{}' "$ETCD_EXEC etcdctl --data-dir /var/lib/etcd/restore2 snapshot restore /var/lib/etcd/snapshot.db"
k delete deployment shop --wait=true
cap kubectl-get-deploy-deleted - '{}' "kubectl --context $CTX get deployments"
cap etcdutl-restore "$CP" '{"file":"/var/lib/etcd/snapshot.db","dir":"/var/lib/etcd/restore"}' "$ETCD_EXEC etcdutl --data-dir /var/lib/etcd/restore snapshot restore /var/lib/etcd/snapshot.db"
cap etcdutl-restore-not-empty "$CP" '{}' "$ETCD_EXEC etcdutl --data-dir /var/lib/etcd/restore snapshot restore /var/lib/etcd/snapshot.db"
cap etcdutl-restore-missing "$CP" '{}' "$ETCD_EXEC etcdutl --data-dir /var/lib/etcd/r1 snapshot restore /var/lib/etcd/nope.db"
# Point etcd's data hostPath at the restored folder; the kubelet restarts etcd on it.
docker exec "$CP" sed -i 's#path: /var/lib/etcd$#path: /var/lib/etcd/restore#' /etc/kubernetes/manifests/etcd.yaml
sleep 20
wait_api
sleep 20
cap kubectl-get-deploy-restored - '{}' "kubectl --context $CTX get deployments"
cap kubeadm-certs-renew-all "$CP" '{}' "docker exec $CP kubeadm certs renew all"
echo "Done."
