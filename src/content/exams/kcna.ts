// KCNA practice: an original question bank (docs/LEVEL-UP-PLAN.md §4). Shown at /<lang>/ship-it/exam/kcna/.
// Practice, not the real exam: never copy real exam questions. Write every question yourself,
// in EN and casual Malaysian Malay, with a one-line why and a link to a ready lesson.
// `src/content/exams/kcna.test.ts` checks every question (ids, domains, 4 options, one answer,
// EN/MS parity, the lesson exists and is ready, short sentences, Malaysian Malay) and the whole
// bank (160+ questions, domain shares within 3 points of the weights, no repeats, answer
// positions balanced).
// How to add one: docs/AUTHORING.md, "Exam practice and drill levels".

/** One language of a question. Options: exactly 4. `code` in backticks shows as code. */
export interface KcnaText {
  question: string;
  options: [string, string, string, string];
  /** One or two short sentences: why the answer is right. Shown after the answer. */
  why: string;
}

/**
 * The official KCNA domains and weights (Linux Foundation KCNA page, checked 2026-11-01).
 * A mock picks questions in about these shares when the bank is big enough.
 */
export const KCNA_DOMAINS = [
  { id: 'fundamentals', weight: 44, name: { en: 'Kubernetes Fundamentals', ms: 'Asas Kubernetes' } },
  { id: 'orchestration', weight: 28, name: { en: 'Container Orchestration', ms: 'Orkestrasi container' } },
  { id: 'delivery', weight: 16, name: { en: 'Cloud Native Application Delivery', ms: 'Penghantaran aplikasi cloud native' } },
  { id: 'architecture', weight: 12, name: { en: 'Cloud Native Architecture', ms: 'Seni bina cloud native' } },
] as const;

export type KcnaDomain = (typeof KCNA_DOMAINS)[number]['id'];

export interface KcnaQuestion {
  /** Unique and stable (saved attempts refer to it): kcna-<domain>-NNN. */
  id: string;
  domain: KcnaDomain;
  en: KcnaText;
  ms: KcnaText;
  /** Index of the right option (the same in both languages). */
  answer: 0 | 1 | 2 | 3;
  /** A ready lesson that teaches it (review link), e.g. k8s-k1-l04. */
  lesson: string;
}

/** The real exam: 90 minutes; our mock takes 60 questions, picked by domain weight from the bank. */
export const KCNA_MOCK_SIZE = 60;
export const KCNA_MINUTES = 90;
/** When the domains and the exam facts were last checked. */
export const KCNA_CHECKED = '2026-11-01';
export const KCNA_URL = 'https://training.linuxfoundation.org/certification/kubernetes-cloud-native-associate/';

export const kcnaQuestions: KcnaQuestion[] = [
  // ---------------------------------------------------------------- Kubernetes Fundamentals
  {
    id: 'kcna-fundamentals-001',
    domain: 'fundamentals',
    answer: 0,
    lesson: 'k8s-k1-l06',
    en: {
      question: "Which control plane part keeps all of the cluster's data?",
      options: ['`etcd`', '`kube-scheduler`', '`kubelet`', '`kube-proxy`'],
      why: 'etcd is the cluster’s memory. The API server reads and writes it.',
    },
    ms: {
      question: 'Bahagian control plane mana yang simpan semua data kluster?',
      options: ['`etcd`', '`kube-scheduler`', '`kubelet`', '`kube-proxy`'],
      why: 'etcd ialah ingatan kluster. API server baca dan tulis ke dalamnya.',
    },
  },
  {
    id: 'kcna-fundamentals-002',
    domain: 'fundamentals',
    answer: 1,
    lesson: 'k8s-k1-l06',
    en: {
      question: 'A new pod has no node yet. Which part picks a node for it?',
      options: ['`etcd`', '`kube-scheduler`', '`kubelet`', 'The container runtime'],
      why: 'The scheduler finds a stall with room. Then that node’s kubelet starts the pod.',
    },
    ms: {
      question: 'Pod baharu belum ada node. Bahagian mana yang pilih node untuknya?',
      options: ['`etcd`', '`kube-scheduler`', '`kubelet`', 'Container runtime'],
      why: 'Scheduler cari gerai yang ada ruang. Kemudian kubelet di node itu mulakan pod.',
    },
  },
  {
    id: 'kcna-fundamentals-003',
    domain: 'fundamentals',
    answer: 2,
    lesson: 'k8s-k1-l04',
    en: {
      question: 'A Deployment wants 3 pods. One pod is deleted. What happens next?',
      options: ['Nothing, until you run `kubectl apply` again', 'The Deployment is deleted too', 'A new pod is made, so there are 3 again', 'The other two pods restart'],
      why: 'A controller keeps comparing want and see. Want 3, see 2, make 1.',
    },
    ms: {
      question: 'Deployment mahu 3 pod. Satu pod dipadam. Apa jadi seterusnya?',
      options: ['Tiada apa-apa, sehingga anda jalankan `kubectl apply` lagi', 'Deployment itu turut dipadam', 'Pod baharu dibuat, jadi ada 3 semula', 'Dua pod yang lain mula semula'],
      why: 'Controller sentiasa banding apa yang dimahu dengan apa yang ada. Mahu 3, nampak 2, buat 1.',
    },
  },
  {
    id: 'kcna-fundamentals-004',
    domain: 'fundamentals',
    answer: 2,
    lesson: 'k8s-k1-l06',
    en: {
      question: 'kubectl, the scheduler and every kubelet talk to one part. Which one?',
      options: ['`etcd`', '`kube-proxy`', '`kube-apiserver`', '`coredns`'],
      why: 'The API server is the front counter. Only it reads and writes etcd.',
    },
    ms: {
      question: 'kubectl, scheduler dan setiap kubelet bercakap dengan satu bahagian. Yang mana?',
      options: ['`etcd`', '`kube-proxy`', '`kube-apiserver`', '`coredns`'],
      why: 'API server ialah kaunter depan. Hanya ia yang baca dan tulis etcd.',
    },
  },
  {
    id: 'kcna-fundamentals-005',
    domain: 'fundamentals',
    answer: 1,
    lesson: 'k8s-k1-l06',
    en: {
      question: 'Which agent runs on every node and starts the containers of its pods?',
      options: ['`kube-scheduler`', '`kubelet`', '`etcd`', '`kube-controller-manager`'],
      why: 'The kubelet is the stall supervisor. It asks the runtime to start each container.',
    },
    ms: {
      question: 'Ejen mana yang berjalan di setiap node dan mulakan container dalam podnya?',
      options: ['`kube-scheduler`', '`kubelet`', '`etcd`', '`kube-controller-manager`'],
      why: 'Kubelet ialah penyelia gerai. Ia minta runtime mulakan setiap container.',
    },
  },
  {
    id: 'kcna-fundamentals-006',
    domain: 'fundamentals',
    answer: 3,
    lesson: 'k8s-k1-l06',
    en: {
      question: 'Which control plane part runs many small loops, like the Deployment controller?',
      options: ['`etcd`', '`kubelet`', '`kube-proxy`', '`kube-controller-manager`'],
      why: 'One program runs many controllers. Each one compares what you want with what is there.',
    },
    ms: {
      question: 'Bahagian control plane mana yang jalankan banyak gelung kecil, seperti Deployment controller?',
      options: ['`etcd`', '`kubelet`', '`kube-proxy`', '`kube-controller-manager`'],
      why: 'Satu program jalankan banyak controller. Setiap satu banding apa yang dimahu dengan apa yang ada.',
    },
  },
  {
    id: 'kcna-fundamentals-007',
    domain: 'fundamentals',
    answer: 0,
    lesson: 'k8s-k1-l06',
    en: {
      question: 'Which part on each node sends Service traffic on to the right pods?',
      options: ['`kube-proxy`', '`etcd`', '`kube-scheduler`', '`kubectl`'],
      why: 'kube-proxy sets the node’s network rules. Then a Service address reaches a ready pod.',
    },
    ms: {
      question: 'Bahagian mana di setiap node yang hantar trafik Service ke pod yang betul?',
      options: ['`kube-proxy`', '`etcd`', '`kube-scheduler`', '`kubectl`'],
      why: 'kube-proxy tetapkan peraturan rangkaian node. Lalu alamat Service sampai ke pod yang sedia.',
    },
  },
  {
    id: 'kcna-fundamentals-008',
    domain: 'fundamentals',
    answer: 2,
    lesson: 'k8s-k1-l06',
    en: {
      question: 'The kubelet does not run containers itself. What does?',
      options: ['The API server', 'etcd', 'A container runtime, such as containerd', 'The scheduler'],
      why: 'The kubelet gives the orders. A runtime like containerd or CRI-O does the cooking.',
    },
    ms: {
      question: 'Kubelet tidak jalankan container sendiri. Siapa yang jalankannya?',
      options: ['API server', 'etcd', 'Container runtime, seperti containerd', 'Scheduler'],
      why: 'Kubelet beri arahan. Runtime seperti containerd atau CRI-O yang memasak.',
    },
  },
  {
    id: 'kcna-fundamentals-009',
    domain: 'fundamentals',
    answer: 1,
    lesson: 'k8s-k1-l06',
    en: {
      question: 'Through which standard plug does the kubelet talk to containerd or CRI-O?',
      options: ['CNI', 'CRI', 'CSI', 'OCI'],
      why: 'CRI is the Container Runtime Interface. Any runtime with that plug can serve the kubelet.',
    },
    ms: {
      question: 'Melalui palam standard mana kubelet bercakap dengan containerd atau CRI-O?',
      options: ['CNI', 'CRI', 'CSI', 'OCI'],
      why: 'CRI ialah Container Runtime Interface. Mana-mana runtime dengan palam itu boleh layan kubelet.',
    },
  },
  {
    id: 'kcna-fundamentals-010',
    domain: 'fundamentals',
    answer: 0,
    lesson: 'docker-d6-l05',
    en: {
      question: 'Kubernetes 1.24 removed dockershim. Do images made with `docker build` still run?',
      options: ['Yes. They are standard OCI images.', 'No. Rebuild them with another tool.', 'Only on nodes that still run Docker Engine', 'Only if you rename them'],
      why: '`docker build` makes standard images. containerd and CRI-O run them just fine.',
    },
    ms: {
      question: 'Kubernetes 1.24 buang dockershim. Adakah image yang dibuat dengan `docker build` masih boleh jalan?',
      options: ['Ya. Ia image OCI yang standard.', 'Tidak. Bina semula dengan alat lain.', 'Hanya pada node yang masih jalankan Docker Engine', 'Hanya jika anda tukar namanya'],
      why: '`docker build` hasilkan image standard. containerd dan CRI-O boleh jalankannya.',
    },
  },
  {
    id: 'kcna-fundamentals-011',
    domain: 'fundamentals',
    answer: 3,
    lesson: 'docker-d6-l05',
    en: {
      question: 'Which low-level tool sets up namespaces and cgroups, starts the app, then exits?',
      options: ['`dockerd`', '`kubectl`', '`containerd`', '`runc`'],
      why: 'runc builds the box and leaves. containerd stays to look after the container.',
    },
    ms: {
      question: 'Alat peringkat rendah mana yang sediakan namespaces dan cgroups, mulakan aplikasi, kemudian keluar?',
      options: ['`dockerd`', '`kubectl`', '`containerd`', '`runc`'],
      why: 'runc bina kotak itu lalu pergi. containerd kekal untuk jaga container itu.',
    },
  },
  {
    id: 'kcna-fundamentals-012',
    domain: 'fundamentals',
    answer: 1,
    lesson: 'docker-d0-l02',
    en: {
      question: 'What is the main difference between a container and a virtual machine?',
      options: ['Containers always run faster code', 'Containers share the host’s kernel. A VM has its own.', 'A VM cannot run Linux', 'Containers need no image'],
      why: 'A container is an isolated process on the host’s kernel. A VM boots a whole OS.',
    },
    ms: {
      question: 'Apakah beza utama antara container dan mesin maya (VM)?',
      options: ['Container sentiasa jalankan kod lebih laju', 'Container kongsi kernel hos. VM ada kernel sendiri.', 'VM tidak boleh jalankan Linux', 'Container tidak perlukan image'],
      why: 'Container ialah proses terasing atas kernel hos. VM pula hidupkan satu OS penuh.',
    },
  },
  {
    id: 'kcna-fundamentals-013',
    domain: 'fundamentals',
    answer: 2,
    lesson: 'docker-d1-l02',
    en: {
      question: 'What is the difference between an image and a container?',
      options: ['They are two names for one thing', 'A container is stored, and an image runs', 'An image is a read-only package. A container is a running copy.', 'An image only works on Windows'],
      why: 'One image can start many containers. Each container adds its own thin writable layer.',
    },
    ms: {
      question: 'Apakah beza antara image dan container?',
      options: ['Dua nama untuk benda yang sama', 'Container disimpan, dan image yang berjalan', 'Image ialah pakej baca sahaja. Container ialah salinan yang berjalan.', 'Image hanya berfungsi di Windows'],
      why: 'Satu image boleh mulakan banyak container. Setiap container tambah lapisan tulis yang nipis.',
    },
  },
  {
    id: 'kcna-fundamentals-014',
    domain: 'fundamentals',
    answer: 0,
    lesson: 'docker-d6-l02',
    en: {
      question: 'Which Linux feature controls what a container can see, like its own process list?',
      options: ['Namespaces', 'cgroups', 'Swap space', 'Cron'],
      why: 'Namespaces give the process its own view: processes, network, hostname and files.',
    },
    ms: {
      question: 'Ciri Linux mana yang kawal apa yang container nampak, seperti senarai prosesnya sendiri?',
      options: ['Namespaces', 'cgroups', 'Ruang swap', 'Cron'],
      why: 'Namespaces beri proses itu pandangan sendiri: proses, rangkaian, nama hos dan fail.',
    },
  },
  {
    id: 'kcna-fundamentals-015',
    domain: 'fundamentals',
    answer: 3,
    lesson: 'docker-d6-l03',
    en: {
      question: 'Which Linux feature caps how much CPU and memory a container may use?',
      options: ['Namespaces', 'Hostnames', 'File permissions', 'cgroups'],
      why: 'cgroups set the limits. Kubernetes turns a pod’s limits into cgroup settings.',
    },
    ms: {
      question: 'Ciri Linux mana yang hadkan berapa banyak CPU dan memori container boleh guna?',
      options: ['Namespaces', 'Nama hos', 'Kebenaran fail', 'cgroups'],
      why: 'cgroups tetapkan had. Kubernetes tukar limit pod menjadi tetapan cgroup.',
    },
  },
  {
    id: 'kcna-fundamentals-016',
    domain: 'fundamentals',
    answer: 1,
    lesson: 'docker-d5-l01',
    en: {
      question: 'A node needs an image it does not have. Where does it pull it from?',
      options: ['From etcd', 'From a container registry', 'From the API server', 'From another pod'],
      why: 'Images live in a registry, like Docker Hub or GHCR. The runtime pulls them from there.',
    },
    ms: {
      question: 'Node perlukan image yang belum ada padanya. Dari mana ia tarik image itu?',
      options: ['Dari etcd', 'Dari container registry', 'Dari API server', 'Dari pod lain'],
      why: 'Image disimpan dalam registry, seperti Docker Hub atau GHCR. Runtime tarik dari situ.',
    },
  },
  {
    id: 'kcna-fundamentals-017',
    domain: 'fundamentals',
    answer: 2,
    lesson: 'docker-d5-l03',
    en: {
      question: 'Why should production manifests avoid the `latest` tag?',
      options: ['It is slower to download', 'Kubernetes refuses it', 'It can point to a different image tomorrow', 'It only works on kind'],
      why: 'A tag can move. A fixed version or a digest makes every node run the same thing.',
    },
    ms: {
      question: 'Kenapa manifest production patut elak tag `latest`?',
      options: ['Ia lebih lambat dimuat turun', 'Kubernetes menolaknya', 'Ia mungkin tunjuk image lain esok', 'Ia hanya berfungsi di kind'],
      why: 'Tag boleh beralih. Versi tetap atau digest pastikan setiap node jalankan benda yang sama.',
    },
  },
  {
    id: 'kcna-fundamentals-018',
    domain: 'fundamentals',
    answer: 3,
    lesson: 'docker-d5-l04',
    en: {
      question: 'Which image reference can never change what it points to?',
      options: ['`shop:latest`', '`shop:1.4`', '`shop:stable`', '`shop@sha256:9f2c…`'],
      why: 'A digest is a fingerprint of the content. New content means a new digest.',
    },
    ms: {
      question: 'Rujukan image mana yang tidak boleh berubah daripada apa yang ditunjuknya?',
      options: ['`shop:latest`', '`shop:1.4`', '`shop:stable`', '`shop@sha256:9f2c…`'],
      why: 'Digest ialah cap jari kandungan. Kandungan baharu bermakna digest baharu.',
    },
  },
  {
    id: 'kcna-fundamentals-019',
    domain: 'fundamentals',
    answer: 0,
    lesson: 'docker-d2-l08',
    en: {
      question: 'Which Dockerfile trick keeps compilers and build tools out of the final image?',
      options: ['A multi-stage build', 'A bigger base image', 'More `RUN` lines', 'The `latest` tag'],
      why: 'Build in one stage. Then copy only the result into a small final stage.',
    },
    ms: {
      question: 'Helah Dockerfile mana yang pastikan compiler dan alat bina tiada dalam image akhir?',
      options: ['Multi-stage build', 'Base image yang lebih besar', 'Lebih banyak baris `RUN`', 'Tag `latest`'],
      why: 'Bina dalam satu peringkat. Kemudian salin hasilnya sahaja ke peringkat akhir yang kecil.',
    },
  },
  {
    id: 'kcna-fundamentals-020',
    domain: 'fundamentals',
    answer: 1,
    lesson: 'k8s-k1-l04',
    en: {
      question: 'You write what you want, and Kubernetes works out the steps. What is this style called?',
      options: ['Imperative', 'Declarative', 'Manual', 'Scripted'],
      why: 'You declare the desired state. Controllers keep moving the cluster towards it.',
    },
    ms: {
      question: 'Anda tulis apa yang anda mahu, dan Kubernetes fikirkan langkahnya. Apa nama gaya ini?',
      options: ['Imperatif', 'Deklaratif', 'Manual', 'Berskrip'],
      why: 'Anda isytiharkan desired state. Controller terus gerakkan kluster ke arahnya.',
    },
  },
  {
    id: 'kcna-fundamentals-021',
    domain: 'fundamentals',
    answer: 1,
    lesson: 'k8s-k1-l11',
    en: {
      question: 'In a manifest, which part do you write to say what you want?',
      options: ['`status`', '`spec`', '`kind`', '`apiVersion`'],
      why: 'You write `spec`. Kubernetes writes `status`: what is really there now.',
    },
    ms: {
      question: 'Dalam manifest, bahagian mana yang anda tulis untuk nyatakan apa yang anda mahu?',
      options: ['`status`', '`spec`', '`kind`', '`apiVersion`'],
      why: 'Anda tulis `spec`. Kubernetes tulis `status`: apa yang benar-benar ada sekarang.',
    },
  },
  {
    id: 'kcna-fundamentals-022',
    domain: 'fundamentals',
    answer: 3,
    lesson: 'k8s-k1-l11',
    en: {
      question: 'Which manifest field says what type of object you are making?',
      options: ['`metadata`', '`spec`', '`apiVersion`', '`kind`'],
      why: '`kind` names the type, like `Deployment` or `Service`.',
    },
    ms: {
      question: 'Medan manifest mana yang nyatakan jenis objek yang anda buat?',
      options: ['`metadata`', '`spec`', '`apiVersion`', '`kind`'],
      why: '`kind` namakan jenisnya, seperti `Deployment` atau `Service`.',
    },
  },
  {
    id: 'kcna-fundamentals-023',
    domain: 'fundamentals',
    answer: 0,
    lesson: 'k8s-k4-l12',
    en: {
      question: 'A Deployment starts with `apiVersion: apps/v1`. What is `apps` here?',
      options: ['The API group', 'The namespace', 'The app’s name', 'The cluster’s name'],
      why: 'Kinds live in API groups. `apps/v1` means group `apps`, version `v1`.',
    },
    ms: {
      question: 'Deployment bermula dengan `apiVersion: apps/v1`. Apakah `apps` di sini?',
      options: ['Kumpulan API (API group)', 'Namespace', 'Nama aplikasi', 'Nama kluster'],
      why: 'Setiap kind duduk dalam API group. `apps/v1` bermaksud group `apps`, versi `v1`.',
    },
  },
  {
    id: 'kcna-fundamentals-024',
    domain: 'fundamentals',
    answer: 2,
    lesson: 'k8s-k1-l12',
    en: {
      question: 'What is a label, like `app: shop`?',
      options: ['A comment that Kubernetes ignores', 'The object’s unique name', 'A key and value that selectors can match', 'A password for the object'],
      why: 'Labels are stickers. Services, Deployments and kubectl pick objects by them.',
    },
    ms: {
      question: 'Apakah label, seperti `app: shop`?',
      options: ['Komen yang Kubernetes abaikan', 'Nama unik objek itu', 'Kunci dan nilai yang selector boleh padankan', 'Kata laluan untuk objek itu'],
      why: 'Label ialah pelekat. Service, Deployment dan kubectl pilih objek melaluinya.',
    },
  },
  {
    id: 'kcna-fundamentals-025',
    domain: 'fundamentals',
    answer: 1,
    lesson: 'k8s-k1-l12',
    en: {
      question: 'Which command lists only the pods labelled `app=shop`?',
      options: ['`kubectl get pods app=shop`', '`kubectl get pods -l app=shop`', '`kubectl get pods --name=shop`', '`kubectl describe shop`'],
      why: '`-l` is a label selector. It filters by stickers, not by name.',
    },
    ms: {
      question: 'Arahan mana yang senaraikan hanya pod berlabel `app=shop`?',
      options: ['`kubectl get pods app=shop`', '`kubectl get pods -l app=shop`', '`kubectl get pods --name=shop`', '`kubectl describe shop`'],
      why: '`-l` ialah label selector. Ia tapis ikut pelekat, bukan ikut nama.',
    },
  },
  {
    id: 'kcna-fundamentals-026',
    domain: 'fundamentals',
    answer: 0,
    lesson: 'k8s-k1-l10',
    en: {
      question: 'Can two Deployments both be called `web` in one cluster?',
      options: ['Yes, if they are in different namespaces', 'No, names are unique in the whole cluster', 'Only if one of them is stopped', 'Only on different nodes'],
      why: 'A namespace is a zone. Names only need to be unique inside one zone.',
    },
    ms: {
      question: 'Bolehkah dua Deployment sama-sama bernama `web` dalam satu kluster?',
      options: ['Boleh, jika dalam namespace berlainan', 'Tidak, nama mesti unik dalam seluruh kluster', 'Hanya jika satu daripadanya berhenti', 'Hanya pada node berlainan'],
      why: 'Namespace ialah satu zon. Nama hanya perlu unik dalam satu zon.',
    },
  },
  {
    id: 'kcna-fundamentals-027',
    domain: 'fundamentals',
    answer: 3,
    lesson: 'k8s-k1-l10',
    en: {
      question: 'Which object does not belong to any namespace?',
      options: ['A Pod', 'A Service', 'A ConfigMap', 'A Node'],
      why: 'A node serves every zone. Nodes and namespaces belong to the whole cluster.',
    },
    ms: {
      question: 'Objek mana yang tidak tergolong dalam mana-mana namespace?',
      options: ['Pod', 'Service', 'ConfigMap', 'Node'],
      why: 'Node layan setiap zon. Node dan namespace milik seluruh kluster.',
    },
  },
  {
    id: 'kcna-fundamentals-028',
    domain: 'fundamentals',
    answer: 2,
    lesson: 'k8s-k1-l06',
    en: {
      question: 'Where do the cluster’s own helpers, like CoreDNS, usually run?',
      options: ['In `default`', 'In `kube-public`', 'In `kube-system`', 'Outside the cluster'],
      why: '`kube-system` holds the cluster’s own parts. Leave it alone unless you run the cluster.',
    },
    ms: {
      question: 'Di mana pembantu kluster sendiri, seperti CoreDNS, biasanya berjalan?',
      options: ['Dalam `default`', 'Dalam `kube-public`', 'Dalam `kube-system`', 'Di luar kluster'],
      why: '`kube-system` simpan bahagian kluster sendiri. Jangan usik kecuali anda yang jaga kluster.',
    },
  },
  {
    id: 'kcna-fundamentals-029',
    domain: 'fundamentals',
    answer: 1,
    lesson: 'k8s-k1-l09',
    en: {
      question: 'Your kubeconfig lists two clusters. What decides which one kubectl talks to?',
      options: ['The newest cluster', 'The current context', 'The fastest cluster', 'Your Git branch'],
      why: 'A context pairs a cluster, a user and a namespace. `kubectl config use-context` switches it.',
    },
    ms: {
      question: 'Kubeconfig anda senaraikan dua kluster. Apa yang tentukan kluster mana kubectl hubungi?',
      options: ['Kluster paling baharu', 'Context semasa', 'Kluster paling laju', 'Branch Git anda'],
      why: 'Context gabungkan kluster, pengguna dan namespace. `kubectl config use-context` menukarnya.',
    },
  },
  {
    id: 'kcna-fundamentals-030',
    domain: 'fundamentals',
    answer: 0,
    lesson: 'k8s-k1-l13',
    en: {
      question: 'You forgot the fields under a Deployment’s `spec`. Which command shows them?',
      options: ['`kubectl explain deployment.spec`', '`kubectl get deployment.spec`', '`kubectl logs deployment`', '`kubectl top deployment`'],
      why: '`kubectl explain` reads the field docs straight from the API server.',
    },
    ms: {
      question: 'Anda lupa medan di bawah `spec` sebuah Deployment. Arahan mana yang tunjukkannya?',
      options: ['`kubectl explain deployment.spec`', '`kubectl get deployment.spec`', '`kubectl logs deployment`', '`kubectl top deployment`'],
      why: '`kubectl explain` baca dokumentasi medan terus dari API server.',
    },
  },
  {
    id: 'kcna-fundamentals-031',
    domain: 'fundamentals',
    answer: 2,
    lesson: 'k8s-k1-l13',
    en: {
      question: 'Which flag prints the YAML kubectl would send, without creating anything?',
      options: ['`--force`', '`--watch`', '`--dry-run=client -o yaml`', '`--all-namespaces`'],
      why: 'A dry run is a rehearsal. Save the YAML, edit it, then apply it.',
    },
    ms: {
      question: 'Flag mana yang cetak YAML yang kubectl akan hantar, tanpa buat apa-apa?',
      options: ['`--force`', '`--watch`', '`--dry-run=client -o yaml`', '`--all-namespaces`'],
      why: 'Dry run ialah raptai. Simpan YAML itu, suntingnya, kemudian apply.',
    },
  },
  {
    id: 'kcna-fundamentals-032',
    domain: 'fundamentals',
    answer: 3,
    lesson: 'k8s-k1-l08',
    en: {
      question: 'Which command also shows the node and IP address of each pod?',
      options: ['`kubectl get pods --raw`', '`kubectl logs pods`', '`kubectl top pods`', '`kubectl get pods -o wide`'],
      why: '`-o wide` adds extra columns, like NODE and IP.',
    },
    ms: {
      question: 'Arahan mana yang turut tunjuk node dan alamat IP setiap pod?',
      options: ['`kubectl get pods --raw`', '`kubectl logs pods`', '`kubectl top pods`', '`kubectl get pods -o wide`'],
      why: '`-o wide` tambah lajur lain, seperti NODE dan IP.',
    },
  },
  {
    id: 'kcna-fundamentals-033',
    domain: 'fundamentals',
    answer: 0,
    lesson: 'k8s-k5-l10',
    en: {
      question: 'A pod is stuck. Which command shows its recent events at the bottom?',
      options: ['`kubectl describe pod shop`', '`kubectl get pod shop`', '`kubectl top pod shop`', '`kubectl explain pod`'],
      why: '`kubectl describe` shows the details, with an Events list at the end.',
    },
    ms: {
      question: 'Sebuah pod tersangkut. Arahan mana yang tunjuk event terkini di bahagian bawah?',
      options: ['`kubectl describe pod shop`', '`kubectl get pod shop`', '`kubectl top pod shop`', '`kubectl explain pod`'],
      why: '`kubectl describe` tunjuk butiran, dengan senarai Events di hujungnya.',
    },
  },
  {
    id: 'kcna-fundamentals-034',
    domain: 'fundamentals',
    answer: 1,
    lesson: 'k8s-k2-l01',
    en: {
      question: 'What is the smallest thing Kubernetes can schedule onto a node?',
      options: ['A container', 'A pod', 'A Deployment', 'A namespace'],
      why: 'Kubernetes places pods, not loose containers. A pod holds one or more containers.',
    },
    ms: {
      question: 'Apakah benda paling kecil yang Kubernetes boleh jadualkan ke atas node?',
      options: ['Container', 'Pod', 'Deployment', 'Namespace'],
      why: 'Kubernetes letak pod, bukan container yang berasingan. Pod ada satu atau lebih container.',
    },
  },
  {
    id: 'kcna-fundamentals-035',
    domain: 'fundamentals',
    answer: 3,
    lesson: 'k8s-k2-l01',
    en: {
      question: 'Two containers share one pod. How can one reach the other?',
      options: ['Through a Service only', 'By the other node’s IP', 'They cannot talk at all', 'On `localhost`'],
      why: 'Containers in a pod share one IP and one network. They talk over localhost.',
    },
    ms: {
      question: 'Dua container berkongsi satu pod. Bagaimana satu container sampai ke yang lain?',
      options: ['Melalui Service sahaja', 'Melalui IP node yang lain', 'Mereka langsung tak boleh berhubung', 'Di `localhost`'],
      why: 'Container dalam satu pod kongsi satu IP dan satu rangkaian. Mereka berhubung melalui localhost.',
    },
  },
  {
    id: 'kcna-fundamentals-036',
    domain: 'fundamentals',
    answer: 2,
    lesson: 'k8s-k2-l02',
    en: {
      question: 'When do init containers run?',
      options: ['After the app containers stop', 'Only when a probe fails', 'Before the app containers, one at a time, each to the end', 'At the same time as the app containers'],
      why: 'Init containers prepare the tray. The app starts only after every one finishes.',
    },
    ms: {
      question: 'Bilakah init container berjalan?',
      options: ['Selepas container aplikasi berhenti', 'Hanya bila probe gagal', 'Sebelum container aplikasi, satu demi satu, sampai habis', 'Serentak dengan container aplikasi'],
      why: 'Init container sediakan dulang. Aplikasi hanya bermula selepas setiap satu selesai.',
    },
  },
  {
    id: 'kcna-fundamentals-037',
    domain: 'fundamentals',
    answer: 0,
    lesson: 'k8s-k2-l02',
    en: {
      question: 'Which setting turns an init container into a native sidecar that keeps running?',
      options: ['`restartPolicy: Always`', '`replicas: 2`', '`hostNetwork: true`', '`imagePullPolicy: Always`'],
      why: 'It starts before the app and keeps running beside it, for the pod’s whole life.',
    },
    ms: {
      question: 'Tetapan mana yang jadikan init container sebagai sidecar asli yang terus berjalan?',
      options: ['`restartPolicy: Always`', '`replicas: 2`', '`hostNetwork: true`', '`imagePullPolicy: Always`'],
      why: 'Ia bermula sebelum aplikasi dan terus berjalan di sebelahnya, sepanjang hayat pod.',
    },
  },
  {
    id: 'kcna-fundamentals-038',
    domain: 'fundamentals',
    answer: 3,
    lesson: 'k8s-k2-l03',
    en: {
      question: 'What is the main job of a ReplicaSet?',
      options: ['Route traffic to pods', 'Store passwords', 'Pick a node for each pod', 'Keep a set number of identical pods running'],
      why: 'It counts the trays with its label. Too few? It makes more. Too many? It removes some.',
    },
    ms: {
      question: 'Apakah tugas utama ReplicaSet?',
      options: ['Halakan trafik ke pod', 'Simpan kata laluan', 'Pilih node untuk setiap pod', 'Kekalkan bilangan tetap pod yang serupa'],
      why: 'Ia kira dulang dengan labelnya. Kurang? Ia buat lagi. Lebih? Ia buang sebahagian.',
    },
  },
  {
    id: 'kcna-fundamentals-039',
    domain: 'fundamentals',
    answer: 1,
    lesson: 'k8s-k2-l05',
    en: {
      question: 'You change the image in a Deployment. What does the Deployment create?',
      options: ['A new namespace', 'A new ReplicaSet that grows while the old one shrinks', 'A new node', 'Nothing. The old pods change in place.'],
      why: 'Each pod template gets its own ReplicaSet. The old one stays, ready for an undo.',
    },
    ms: {
      question: 'Anda tukar image dalam Deployment. Apa yang Deployment itu buat?',
      options: ['Namespace baharu', 'ReplicaSet baharu yang membesar sementara yang lama mengecil', 'Node baharu', 'Tiada. Pod lama berubah di tempatnya.'],
      why: 'Setiap templat pod dapat ReplicaSet sendiri. Yang lama kekal, sedia untuk undo.',
    },
  },
  {
    id: 'kcna-fundamentals-040',
    domain: 'fundamentals',
    answer: 2,
    lesson: 'k8s-k2-l05',
    en: {
      question: 'What is the default update strategy of a Deployment?',
      options: ['`Recreate`', '`BlueGreen`', '`RollingUpdate`', '`Canary`'],
      why: 'New pods come up while old ones go down, a few at a time. The shop never closes.',
    },
    ms: {
      question: 'Apakah strategi kemas kini lalai bagi Deployment?',
      options: ['`Recreate`', '`BlueGreen`', '`RollingUpdate`', '`Canary`'],
      why: 'Pod baharu naik sementara pod lama turun, sedikit demi sedikit. Kedai tidak pernah tutup.',
    },
  },
  {
    id: 'kcna-fundamentals-041',
    domain: 'fundamentals',
    answer: 0,
    lesson: 'k8s-k2-l05',
    en: {
      question: 'During a rolling update, when are old pods removed?',
      options: ['Step by step, as new pods become ready', 'All at once, before new pods start', 'Never. You delete them by hand.', 'Only after one hour'],
      why: 'As new pods become ready, Kubernetes retires old ones, a few at a time.',
    },
    ms: {
      question: 'Semasa rolling update, bilakah pod lama dibuang?',
      options: ['Sedikit demi sedikit, bila pod baharu sudah sedia', 'Sekali gus, sebelum pod baharu bermula', 'Tidak pernah. Anda padam sendiri.', 'Hanya selepas satu jam'],
      why: 'Bila pod baharu sedia, Kubernetes bersarakan pod lama, sedikit demi sedikit.',
    },
  },
  {
    id: 'kcna-fundamentals-042',
    domain: 'fundamentals',
    answer: 3,
    lesson: 'k8s-k2-l04',
    en: {
      question: 'Which command changes the `shop` Deployment to 5 pods?',
      options: ['`kubectl run shop --count=5`', '`kubectl set pods shop 5`', '`kubectl top deployment shop`', '`kubectl scale deployment shop --replicas=5`'],
      why: '`kubectl scale` changes the wanted count. The ReplicaSet then adds or removes pods.',
    },
    ms: {
      question: 'Arahan mana yang tukar Deployment `shop` kepada 5 pod?',
      options: ['`kubectl run shop --count=5`', '`kubectl set pods shop 5`', '`kubectl top deployment shop`', '`kubectl scale deployment shop --replicas=5`'],
      why: '`kubectl scale` tukar bilangan yang dimahu. ReplicaSet lalu tambah atau buang pod.',
    },
  },
  {
    id: 'kcna-fundamentals-043',
    domain: 'fundamentals',
    answer: 1,
    lesson: 'k8s-k2-l04',
    en: {
      question: 'Which part of a Deployment describes the pods it makes?',
      options: ['`spec.replicas`', '`spec.template`', '`metadata.name`', '`status.conditions`'],
      why: 'The template is the pod recipe. Every pod the Deployment makes follows it.',
    },
    ms: {
      question: 'Bahagian mana dalam Deployment yang terangkan pod yang ia buat?',
      options: ['`spec.replicas`', '`spec.template`', '`metadata.name`', '`status.conditions`'],
      why: 'Templat ialah resepi pod. Setiap pod yang Deployment buat ikut resepi itu.',
    },
  },
  {
    id: 'kcna-fundamentals-044',
    domain: 'fundamentals',
    answer: 3,
    lesson: 'k8s-k2-l13',
    en: {
      question: 'Which `restartPolicy` may a Job not use?',
      options: ['`Never`', '`OnFailure`', 'Any value is fine for a Job', '`Always`'],
      why: 'A Job must be able to end. `Always` would restart it forever.',
    },
    ms: {
      question: '`restartPolicy` mana yang Job tidak boleh guna?',
      options: ['`Never`', '`OnFailure`', 'Apa-apa nilai pun boleh untuk Job', '`Always`'],
      why: 'Job mesti boleh tamat. `Always` akan mulakannya semula tanpa henti.',
    },
  },
  {
    id: 'kcna-fundamentals-045',
    domain: 'fundamentals',
    answer: 0,
    lesson: 'k8s-k2-l09',
    en: {
      question: 'A pod stays `Pending` with the event `Insufficient cpu`. What does it mean?',
      options: ['No node has enough free CPU for its requests', 'The app crashed', 'The image is missing', 'The pod finished'],
      why: 'The scheduler found no stall with room. Lower the requests, or add a node.',
    },
    ms: {
      question: 'Pod kekal `Pending` dengan event `Insufficient cpu`. Apa maksudnya?',
      options: ['Tiada node yang ada CPU kosong cukup untuk request-nya', 'Aplikasi itu crash', 'Image itu tiada', 'Pod itu sudah siap'],
      why: 'Scheduler tak jumpa gerai yang ada ruang. Kurangkan request, atau tambah node.',
    },
  },
  {
    id: 'kcna-fundamentals-046',
    domain: 'fundamentals',
    answer: 2,
    lesson: 'k8s-k2-l07',
    en: {
      question: 'A pod shows `ImagePullBackOff`. What is the most likely cause?',
      options: ['The node is out of memory', 'A readiness probe failed', 'A typo in the image name or tag, or the registry needs a login', 'The Service has no selector'],
      why: 'The node cannot fetch the image. It tries again, waiting longer each time.',
    },
    ms: {
      question: 'Pod tunjuk `ImagePullBackOff`. Apakah punca paling mungkin?',
      options: ['Node kehabisan memori', 'Readiness probe gagal', 'Salah taip nama atau tag image, atau registry perlukan log masuk', 'Service tiada selector'],
      why: 'Node tak dapat ambil image itu. Ia cuba lagi, dan tunggu lebih lama setiap kali.',
    },
  },
  {
    id: 'kcna-fundamentals-047',
    domain: 'fundamentals',
    answer: 1,
    lesson: 'k8s-k2-l09',
    en: {
      question: 'A container stops with the reason `OOMKilled`. What happened?',
      options: ['It ran out of disk', 'It used more memory than its limit', 'Its CPU limit was too low', 'Someone deleted it'],
      why: 'Memory cannot be squeezed. Cross the limit, and the kernel stops the container.',
    },
    ms: {
      question: 'Container berhenti dengan sebab `OOMKilled`. Apa yang berlaku?',
      options: ['Ia kehabisan ruang cakera', 'Ia guna memori lebih daripada limit-nya', 'Limit CPU-nya terlalu rendah', 'Seseorang memadamnya'],
      why: 'Memori tak boleh dihimpit. Lepas had, kernel hentikan container itu.',
    },
  },
  {
    id: 'kcna-fundamentals-048',
    domain: 'fundamentals',
    answer: 3,
    lesson: 'k8s-k2-l09',
    en: {
      question: 'A container reaches its CPU limit. What happens?',
      options: ['It is killed at once', 'The pod moves to another node', 'The node restarts', 'It is slowed down, but keeps running'],
      why: 'CPU is shared out in slices. Over the limit, the container just waits its turn.',
    },
    ms: {
      question: 'Container capai limit CPU-nya. Apa yang berlaku?',
      options: ['Ia terus dibunuh', 'Pod itu pindah ke node lain', 'Node itu mula semula', 'Ia diperlahankan, tetapi terus berjalan'],
      why: 'CPU dibahagi kepada hirisan. Lebih had, container itu tunggu gilirannya.',
    },
  },
  {
    id: 'kcna-fundamentals-049',
    domain: 'fundamentals',
    answer: 0,
    lesson: 'k8s-k2-l09',
    en: {
      question: 'What does the scheduler look at to decide if a pod fits on a node?',
      options: ['The pod’s resource requests', 'The pod’s real CPU use', 'The image size only', 'The pod’s name'],
      why: 'Requests are a booking. The scheduler adds up bookings, not what pods really use.',
    },
    ms: {
      question: 'Apa yang scheduler lihat untuk putuskan sama ada pod muat di sebuah node?',
      options: ['Request sumber pod itu', 'Penggunaan CPU sebenar pod itu', 'Saiz image sahaja', 'Nama pod itu'],
      why: 'Request ialah tempahan. Scheduler jumlahkan tempahan, bukan penggunaan sebenar pod.',
    },
  },
  {
    id: 'kcna-fundamentals-050',
    domain: 'fundamentals',
    answer: 2,
    lesson: 'k8s-k2-l08',
    en: {
      question: 'A liveness probe keeps failing. What does the kubelet do?',
      options: ['Removes the pod from the Service only', 'Moves the pod to a new node', 'Restarts the container', 'Deletes the Deployment'],
      why: 'Liveness asks: still awake? If not, a restart may bring the app back.',
    },
    ms: {
      question: 'Liveness probe asyik gagal. Apa yang kubelet buat?',
      options: ['Keluarkan pod daripada Service sahaja', 'Pindahkan pod ke node baharu', 'Mulakan semula container itu', 'Padam Deployment itu'],
      why: 'Liveness tanya: masih berjaga? Jika tidak, mula semula mungkin pulihkan aplikasi.',
    },
  },
  {
    id: 'kcna-fundamentals-051',
    domain: 'fundamentals',
    answer: 1,
    lesson: 'k8s-k2-l08',
    en: {
      question: 'A readiness probe fails, but the container is otherwise fine. What happens?',
      options: ['The container restarts', 'The pod gets no Service traffic until the probe passes', 'The node is drained', 'The image is pulled again'],
      why: 'Readiness asks: ready to serve? Not ready means no customers yet, but no restart.',
    },
    ms: {
      question: 'Readiness probe gagal, tetapi container itu sihat. Apa yang berlaku?',
      options: ['Container itu mula semula', 'Pod tak dapat trafik Service sehingga probe lulus', 'Node itu dikosongkan', 'Image ditarik semula'],
      why: 'Readiness tanya: sedia melayan? Belum sedia bermakna tiada pelanggan, tetapi tiada restart.',
    },
  },
  {
    id: 'kcna-fundamentals-052',
    domain: 'fundamentals',
    answer: 3,
    lesson: 'k8s-k2-l08',
    en: {
      question: 'An old app needs two minutes to warm up. Which probe stops early restarts?',
      options: ['A readiness probe', 'A liveness probe with a short timeout', 'No probe at all', 'A startup probe'],
      why: 'The other probes wait until the startup probe passes. Slow starters get their time.',
    },
    ms: {
      question: 'Aplikasi lama perlukan dua minit untuk panas. Probe mana yang elak restart awal?',
      options: ['Readiness probe', 'Liveness probe dengan timeout pendek', 'Tiada probe langsung', 'Startup probe'],
      why: 'Probe lain tunggu sehingga startup probe lulus. Aplikasi yang lambat dapat masanya.',
    },
  },
  {
    id: 'kcna-fundamentals-053',
    domain: 'fundamentals',
    answer: 0,
    lesson: 'k8s-k2-l10',
    en: {
      question: 'Every container sets CPU and memory requests equal to its limits. Which QoS class is the pod?',
      options: ['`Guaranteed`', '`Burstable`', '`BestEffort`', '`Critical`'],
      why: 'Everything is booked and pinned. These pods are evicted last.',
    },
    ms: {
      question: 'Setiap container tetapkan request CPU dan memori sama dengan limit-nya. Pod itu kelas QoS apa?',
      options: ['`Guaranteed`', '`Burstable`', '`BestEffort`', '`Critical`'],
      why: 'Semuanya ditempah dan dikunci. Pod ini dikeluarkan paling akhir.',
    },
  },
  {
    id: 'kcna-fundamentals-054',
    domain: 'fundamentals',
    answer: 2,
    lesson: 'k8s-k2-l10',
    en: {
      question: 'A node runs short of memory. Which pods does the kubelet evict first?',
      options: ['`Guaranteed` pods', 'Pods in `kube-system`', '`BestEffort` pods, with no requests or limits', 'The newest pods, whatever their class'],
      why: 'They booked nothing, so they leave first. Guaranteed pods leave last.',
    },
    ms: {
      question: 'Sebuah node kekurangan memori. Pod mana yang kubelet keluarkan dahulu?',
      options: ['Pod `Guaranteed`', 'Pod dalam `kube-system`', 'Pod `BestEffort`, tanpa request atau limit', 'Pod paling baharu, apa pun kelasnya'],
      why: 'Mereka tak tempah apa-apa, jadi mereka keluar dahulu. Pod Guaranteed keluar paling akhir.',
    },
  },
  {
    id: 'kcna-fundamentals-055',
    domain: 'fundamentals',
    answer: 1,
    lesson: 'k8s-k2-l11',
    en: {
      question: 'You need one log agent pod on every node, new nodes too. Which object fits?',
      options: ['Deployment', 'DaemonSet', 'Job', 'StatefulSet'],
      why: 'A DaemonSet runs one copy per node. A new node gets its copy by itself.',
    },
    ms: {
      question: 'Anda perlukan satu pod ejen log di setiap node, termasuk node baharu. Objek mana yang sesuai?',
      options: ['Deployment', 'DaemonSet', 'Job', 'StatefulSet'],
      why: 'DaemonSet jalankan satu salinan bagi setiap node. Node baharu dapat salinannya sendiri.',
    },
  },
  {
    id: 'kcna-fundamentals-056',
    domain: 'fundamentals',
    answer: 3,
    lesson: 'k8s-k2-l12',
    en: {
      question: 'Which object gives pods stable names like `db-0` and `db-1`, started in order?',
      options: ['Deployment', 'ReplicaSet', 'DaemonSet', 'StatefulSet'],
      why: 'A StatefulSet keeps each pod’s name and storage, even after a restart.',
    },
    ms: {
      question: 'Objek mana yang beri pod nama tetap seperti `db-0` dan `db-1`, dimulakan ikut turutan?',
      options: ['Deployment', 'ReplicaSet', 'DaemonSet', 'StatefulSet'],
      why: 'StatefulSet kekalkan nama dan storan setiap pod, walaupun selepas restart.',
    },
  },
  {
    id: 'kcna-fundamentals-057',
    domain: 'fundamentals',
    answer: 0,
    lesson: 'k8s-k2-l13',
    en: {
      question: 'A task must run once until it finishes, then stop. Which object fits?',
      options: ['Job', 'Deployment', 'DaemonSet', 'Service'],
      why: 'A Job runs pods until the task succeeds. Then it is marked Complete.',
    },
    ms: {
      question: 'Satu tugas mesti berjalan sekali sehingga siap, kemudian berhenti. Objek mana yang sesuai?',
      options: ['Job', 'Deployment', 'DaemonSet', 'Service'],
      why: 'Job jalankan pod sehingga tugas itu berjaya. Kemudian ia ditanda Complete.',
    },
  },
  {
    id: 'kcna-fundamentals-058',
    domain: 'fundamentals',
    answer: 2,
    lesson: 'k8s-k2-l13',
    en: {
      question: 'A CronJob reaches its scheduled time. What does it create?',
      options: ['A Deployment', 'A new node', 'A Job', 'A Service'],
      why: 'A CronJob is a timer. Each time it fires, it makes a Job, which runs the pod.',
    },
    ms: {
      question: 'CronJob sampai waktu jadualnya. Apa yang ia buat?',
      options: ['Deployment', 'Node baharu', 'Job', 'Service'],
      why: 'CronJob ialah pemasa. Setiap kali tiba masanya, ia buat Job, yang jalankan pod.',
    },
  },
  {
    id: 'kcna-fundamentals-059',
    domain: 'fundamentals',
    answer: 1,
    lesson: 'k8s-k5-l04',
    en: {
      question: 'A pod must only run on nodes labelled `disk=ssd`. What is the simplest way?',
      options: ['A taint on the pod', 'A `nodeSelector` in the pod spec', 'A NetworkPolicy', 'A bigger CPU request'],
      why: '`nodeSelector` lists labels the node must have. Other nodes are skipped.',
    },
    ms: {
      question: 'Pod mesti berjalan hanya pada node berlabel `disk=ssd`. Apakah cara paling mudah?',
      options: ['Taint pada pod', '`nodeSelector` dalam spec pod', 'NetworkPolicy', 'Request CPU yang lebih besar'],
      why: '`nodeSelector` senaraikan label yang node mesti ada. Node lain dilangkau.',
    },
  },
  {
    id: 'kcna-fundamentals-060',
    domain: 'fundamentals',
    answer: 3,
    lesson: 'k8s-k5-l04',
    en: {
      question: 'You would like the front zone, but any node is fine if it is full. Which rule fits?',
      options: ['A required node affinity rule', 'A `NoSchedule` taint', 'A `nodeName` field', 'A preferred node affinity rule'],
      why: 'Required rules filter nodes out. Preferred rules only add to a node’s score.',
    },
    ms: {
      question: 'Anda lebih suka zon depan, tetapi mana-mana node pun boleh jika ia penuh. Peraturan mana yang sesuai?',
      options: ['Peraturan node affinity jenis required', 'Taint `NoSchedule`', 'Medan `nodeName`', 'Peraturan node affinity jenis preferred'],
      why: 'Peraturan required tapis node. Peraturan preferred hanya tambah markah node.',
    },
  },
  {
    id: 'kcna-fundamentals-061',
    domain: 'fundamentals',
    answer: 0,
    lesson: 'k8s-k5-l04',
    en: {
      question: 'You want the three copies of a pod on three different nodes. What helps?',
      options: ['Pod anti-affinity', 'A ResourceQuota', 'A bigger image', 'A headless Service'],
      why: 'Anti-affinity keeps similar pods apart. Then one broken node hurts less.',
    },
    ms: {
      question: 'Anda mahu tiga salinan pod di tiga node berlainan. Apa yang membantu?',
      options: ['Pod anti-affinity', 'ResourceQuota', 'Image yang lebih besar', 'Service headless'],
      why: 'Anti-affinity jauhkan pod yang serupa. Jadi satu node rosak beri kesan lebih kecil.',
    },
  },
  {
    id: 'kcna-fundamentals-062',
    domain: 'fundamentals',
    answer: 2,
    lesson: 'k8s-k5-l05',
    en: {
      question: 'A node has the taint `gpu=yes:NoSchedule`. Which new pods may land there?',
      options: ['Any pod', 'Only pods in `kube-system`', 'Only pods with a matching toleration', 'No pod, ever'],
      why: 'A taint is a lock on the stall. A toleration is the key.',
    },
    ms: {
      question: 'Node ada taint `gpu=yes:NoSchedule`. Pod baharu mana yang boleh mendarat di situ?',
      options: ['Mana-mana pod', 'Hanya pod dalam `kube-system`', 'Hanya pod dengan toleration yang sepadan', 'Tiada pod, langsung'],
      why: 'Taint ialah kunci pada gerai. Toleration ialah anak kuncinya.',
    },
  },
  {
    id: 'kcna-fundamentals-063',
    domain: 'fundamentals',
    answer: 1,
    lesson: 'k8s-k5-l05',
    en: {
      question: 'A pod tolerates a node’s taint. Must it run on that node?',
      options: ['Yes, always', 'No. It may run there, but it is not pulled there.', 'Only if the node is empty', 'Only after a restart'],
      why: 'A toleration only unlocks the door. To steer the pod there, add affinity or a nodeSelector.',
    },
    ms: {
      question: 'Pod ada toleration untuk taint sebuah node. Mestikah ia berjalan di node itu?',
      options: ['Ya, sentiasa', 'Tidak. Ia boleh berjalan di situ, tetapi tidak ditarik ke situ.', 'Hanya jika node itu kosong', 'Hanya selepas restart'],
      why: 'Toleration hanya buka pintu. Untuk hantar pod ke situ, tambah affinity atau nodeSelector.',
    },
  },
  {
    id: 'kcna-fundamentals-064',
    domain: 'fundamentals',
    answer: 3,
    lesson: 'k8s-k5-l05',
    en: {
      question: 'Which taint effect also evicts running pods that have no matching toleration?',
      options: ['`NoSchedule`', '`PreferNoSchedule`', '`Ready`', '`NoExecute`'],
      why: '`NoSchedule` only guards the door. `NoExecute` also sends away pods already inside.',
    },
    ms: {
      question: 'Kesan taint mana yang turut keluarkan pod yang sedang berjalan tanpa toleration sepadan?',
      options: ['`NoSchedule`', '`PreferNoSchedule`', '`Ready`', '`NoExecute`'],
      why: '`NoSchedule` hanya jaga pintu. `NoExecute` juga halau pod yang sudah ada di dalam.',
    },
  },
  {
    id: 'kcna-fundamentals-065',
    domain: 'fundamentals',
    answer: 0,
    lesson: 'k8s-k5-l05',
    en: {
      question: 'You want a Deployment’s pods spread evenly across zones. Which field fits?',
      options: ['`topologySpreadConstraints`', '`restartPolicy`', '`imagePullSecrets`', '`terminationGracePeriodSeconds`'],
      why: 'It counts pods per zone or node. It keeps the gap within the `maxSkew` you set.',
    },
    ms: {
      question: 'Anda mahu pod sebuah Deployment tersebar sama rata merentas zon. Medan mana yang sesuai?',
      options: ['`topologySpreadConstraints`', '`restartPolicy`', '`imagePullSecrets`', '`terminationGracePeriodSeconds`'],
      why: 'Ia kira pod bagi setiap zon atau node. Ia kekalkan beza dalam had `maxSkew` anda.',
    },
  },
  {
    id: 'kcna-fundamentals-066',
    domain: 'fundamentals',
    answer: 2,
    lesson: 'k8s-k5-l04',
    en: {
      question: 'How does the scheduler choose a node for a pod?',
      options: ['It picks a random node', 'It always picks the first node', 'It filters out nodes that cannot fit, then scores the rest', 'It asks the pod’s owner'],
      why: 'Hard rules filter. Soft rules and free space give scores. The best score wins.',
    },
    ms: {
      question: 'Bagaimana scheduler pilih node untuk sebuah pod?',
      options: ['Ia pilih node secara rawak', 'Ia sentiasa pilih node pertama', 'Ia tapis node yang tak muat, kemudian beri markah kepada yang lain', 'Ia tanya pemilik pod'],
      why: 'Peraturan keras menapis. Peraturan lembut dan ruang kosong beri markah. Markah tertinggi menang.',
    },
  },
  {
    id: 'kcna-fundamentals-067',
    domain: 'fundamentals',
    answer: 1,
    lesson: 'k8s-k5-l07',
    en: {
      question: 'A team’s namespace may use at most 10 CPU in total. What sets that cap?',
      options: ['A LimitRange', 'A ResourceQuota', 'A PodDisruptionBudget', 'A NetworkPolicy'],
      why: 'A ResourceQuota caps the total for one namespace. A LimitRange sets sizes per container.',
    },
    ms: {
      question: 'Namespace sebuah pasukan boleh guna paling banyak 10 CPU semuanya. Apa yang tetapkan had itu?',
      options: ['LimitRange', 'ResourceQuota', 'PodDisruptionBudget', 'NetworkPolicy'],
      why: 'ResourceQuota hadkan jumlah untuk satu namespace. LimitRange tetapkan saiz bagi setiap container.',
    },
  },
  {
    id: 'kcna-fundamentals-068',
    domain: 'fundamentals',
    answer: 3,
    lesson: 'k8s-k5-l07',
    en: {
      question: 'Pods without requests should get default sizes in one namespace. What sets those defaults?',
      options: ['A ResourceQuota', 'A StorageClass', 'A PriorityClass', 'A LimitRange'],
      why: 'A LimitRange fills in default requests and limits. It can set a minimum and maximum too.',
    },
    ms: {
      question: 'Pod tanpa request patut dapat saiz lalai dalam satu namespace. Apa yang tetapkan nilai lalai itu?',
      options: ['ResourceQuota', 'StorageClass', 'PriorityClass', 'LimitRange'],
      why: 'LimitRange isi request dan limit lalai. Ia juga boleh tetapkan nilai minimum dan maksimum.',
    },
  },
  {
    id: 'kcna-fundamentals-069',
    domain: 'fundamentals',
    answer: 0,
    lesson: 'k8s-k5-l11',
    en: {
      question: 'A node needs maintenance. Which command safely moves its pods away first?',
      options: ['`kubectl drain`', '`kubectl delete node`', '`kubectl top node`', '`kubectl label node`'],
      why: '`kubectl drain` cordons the node, then evicts its pods. It respects PodDisruptionBudgets.',
    },
    ms: {
      question: 'Sebuah node perlu diselenggara. Arahan mana yang pindahkan pod-nya dengan selamat dahulu?',
      options: ['`kubectl drain`', '`kubectl delete node`', '`kubectl top node`', '`kubectl label node`'],
      why: '`kubectl drain` cordon node itu, kemudian keluarkan pod-nya. Ia hormati PodDisruptionBudget.',
    },
  },
  {
    id: 'kcna-fundamentals-070',
    domain: 'fundamentals',
    answer: 2,
    lesson: 'k8s-k5-l11',
    en: {
      question: 'What does `kubectl cordon dev-worker` do?',
      options: ['Deletes every pod on it', 'Upgrades its kubelet', 'Stops new pods from being scheduled there', 'Removes the node from the cluster'],
      why: 'Pods already there keep running. `kubectl uncordon` opens the node again.',
    },
    ms: {
      question: 'Apa yang `kubectl cordon dev-worker` buat?',
      options: ['Padam setiap pod di situ', 'Naik taraf kubelet-nya', 'Halang pod baharu dijadualkan ke situ', 'Buang node itu daripada kluster'],
      why: 'Pod yang sudah ada terus berjalan. `kubectl uncordon` buka node itu semula.',
    },
  },
  {
    id: 'kcna-fundamentals-071',
    domain: 'fundamentals',
    answer: 1,
    lesson: 'k8s-k5-l11',
    en: {
      question: 'You upgrade a cluster to a new minor version. What goes first?',
      options: ['The kubelets on every node', 'The control plane, API server first', 'kubectl on your laptop', 'The apps’ images'],
      why: 'A kubelet may not be newer than the API server. So the control plane leads.',
    },
    ms: {
      question: 'Anda naik taraf kluster ke versi minor baharu. Apa yang dahulu?',
      options: ['Kubelet di setiap node', 'Control plane, API server dahulu', 'kubectl di laptop anda', 'Image aplikasi'],
      why: 'Kubelet tidak boleh lebih baharu daripada API server. Jadi control plane mendahului.',
    },
  },
  {
    id: 'kcna-fundamentals-072',
    domain: 'fundamentals',
    answer: 3,
    lesson: 'k8s-k5-l11',
    en: {
      question: 'Your control plane runs 1.35. Can you upgrade it straight to 1.37?',
      options: ['Yes, newer is always fine', 'Yes, if you drain every node', 'Only on managed clusters', 'No. Go one minor at a time: 1.36, then 1.37.'],
      why: 'Minor versions must not be skipped. Each step keeps the API changes small.',
    },
    ms: {
      question: 'Control plane anda jalankan 1.35. Bolehkah anda naik taraf terus ke 1.37?',
      options: ['Ya, versi baharu sentiasa okey', 'Ya, jika anda drain setiap node', 'Hanya pada kluster terurus', 'Tidak. Naik satu minor demi satu: 1.36, kemudian 1.37.'],
      why: 'Versi minor tidak boleh dilangkau. Setiap langkah pastikan perubahan API kecil.',
    },
  },
  {
    id: 'kcna-fundamentals-073',
    domain: 'fundamentals',
    answer: 0,
    lesson: 'k8s-k5-l11',
    en: {
      question: 'How many minor versions does the Kubernetes project patch at one time?',
      options: ['The newest three', 'Only the newest one', 'The newest ten', 'Every version ever made'],
      why: 'Each minor gets about a year of patches. Older ones get no security fixes.',
    },
    ms: {
      question: 'Berapa banyak versi minor yang projek Kubernetes tampal pada satu masa?',
      options: ['Tiga yang terbaharu', 'Yang terbaharu sahaja', 'Sepuluh yang terbaharu', 'Setiap versi yang pernah dibuat'],
      why: 'Setiap minor dapat tampalan kira-kira setahun. Versi lebih lama tiada pembaikan keselamatan.',
    },
  },
  {
    id: 'kcna-fundamentals-074',
    domain: 'fundamentals',
    answer: 2,
    lesson: 'k8s-k4-l12',
    en: {
      question: '`kubectl apply` works but prints a deprecation warning. What does that mean?',
      options: ['The apply failed', 'The cluster is broken', 'It works now, but that API version goes away in a later release', 'You must reinstall kubectl'],
      why: 'Deprecations come early. Move your files to the newer version before the removal.',
    },
    ms: {
      question: '`kubectl apply` berjaya tetapi cetak amaran deprecation. Apa maksudnya?',
      options: ['apply itu gagal', 'Kluster itu rosak', 'Ia berfungsi sekarang, tetapi versi API itu hilang dalam keluaran akan datang', 'Anda mesti pasang semula kubectl'],
      why: 'Deprecation diumumkan awal. Pindahkan fail anda ke versi baharu sebelum ia dibuang.',
    },
  },
  {
    id: 'kcna-fundamentals-075',
    domain: 'fundamentals',
    answer: 1,
    lesson: 'k8s-k7-l08',
    en: {
      question: 'How do you teach a cluster a new kind of object, like `Backup`?',
      options: ['Edit etcd by hand', 'Install a CustomResourceDefinition (CRD)', 'Add a label to every node', 'Restart the API server with a new name'],
      why: 'A CRD adds a new word to the API. A controller can then act on it.',
    },
    ms: {
      question: 'Bagaimana anda ajar kluster satu kind objek baharu, seperti `Backup`?',
      options: ['Sunting etcd sendiri', 'Pasang CustomResourceDefinition (CRD)', 'Tambah label pada setiap node', 'Mula semula API server dengan nama baharu'],
      why: 'CRD tambah perkataan baharu kepada API. Controller kemudian boleh bertindak ke atasnya.',
    },
  },
  {
    id: 'kcna-fundamentals-076',
    domain: 'fundamentals',
    answer: 3,
    lesson: 'k8s-k7-l08',
    en: {
      question: 'What is an operator in Kubernetes?',
      options: ['A person with `cluster-admin`', 'A kind of node', 'A kubectl plugin for logs', 'A custom kind plus a controller that runs an app for you'],
      why: 'It packs expert know-how, like backups and failover, into a controller loop.',
    },
    ms: {
      question: 'Apakah operator dalam Kubernetes?',
      options: ['Orang yang ada `cluster-admin`', 'Sejenis node', 'Plugin kubectl untuk log', 'Kind tersuai serta controller yang jalankan aplikasi untuk anda'],
      why: 'Ia bungkus kepakaran, seperti backup dan failover, dalam gelung controller.',
    },
  },
  {
    id: 'kcna-fundamentals-077',
    domain: 'fundamentals',
    answer: 1,
    lesson: 'k8s-k5-l12',
    en: {
      question: 'With managed Kubernetes, like EKS, GKE or AKS, who runs the control plane?',
      options: ['You, on your own machines', 'The cloud provider', 'Each app team', 'Nobody. It is not needed.'],
      why: 'The landlord runs the office. You still look after your apps and pay for the machines.',
    },
    ms: {
      question: 'Dengan Kubernetes terurus, seperti EKS, GKE atau AKS, siapa jalankan control plane?',
      options: ['Anda, pada mesin anda sendiri', 'Penyedia cloud', 'Setiap pasukan aplikasi', 'Tiada siapa. Ia tak diperlukan.'],
      why: 'Tuan rumah jalankan pejabat. Anda masih jaga aplikasi dan bayar untuk mesin.',
    },
  },

  // ---------------------------------------------------------------- Container Orchestration
  {
    id: 'kcna-orchestration-001',
    domain: 'orchestration',
    answer: 3,
    lesson: 'k8s-k3-l02',
    en: {
      question: 'Pods come and go, and their IPs change. What gives them one steady address?',
      options: ['A ConfigMap', 'A namespace', 'A PersistentVolume', 'A Service'],
      why: 'A Service is one order number. It finds its pods by their labels.',
    },
    ms: {
      question: 'Pod datang dan pergi, dan IP mereka bertukar. Apa yang beri satu alamat tetap?',
      options: ['ConfigMap', 'Namespace', 'PersistentVolume', 'Service'],
      why: 'Service ialah satu nombor pesanan. Ia cari pod melalui label.',
    },
  },
  {
    id: 'kcna-orchestration-002',
    domain: 'orchestration',
    answer: 0,
    lesson: 'k8s-k2-l07',
    en: {
      question: 'A pod shows `CrashLoopBackOff`. What does that mean?',
      options: [
        'Its container keeps stopping, and the kubelet waits longer between restarts',
        'The image name has a typo',
        'No node has room for it',
        'The pod finished its job',
      ],
      why: 'The container starts, then exits again. Read its last run with `kubectl logs --previous`.',
    },
    ms: {
      question: 'Pod tunjuk `CrashLoopBackOff`. Apa maksudnya?',
      options: ['Container asyik berhenti, dan kubelet tunggu lebih lama sebelum mula semula', 'Nama image itu salah ejaan', 'Tiada node yang ada ruang untuknya', 'Pod itu dah siap kerjanya'],
      why: 'Container bermula, kemudian keluar lagi. Baca run terakhirnya dengan `kubectl logs --previous`.',
    },
  },
  {
    id: 'kcna-orchestration-003',
    domain: 'orchestration',
    answer: 1,
    lesson: 'k8s-k6-l02',
    en: {
      question: 'Your CI bot may only read pods in one namespace. What do you give it?',
      options: ['The `cluster-admin` ClusterRole', 'A Role and a RoleBinding in that namespace', 'A NetworkPolicy', 'A Secret with a password'],
      why: 'A Role lists what is allowed in one namespace. A RoleBinding hands it to the bot.',
    },
    ms: {
      question: 'Bot CI anda hanya boleh baca pod dalam satu namespace. Apa yang anda beri kepadanya?',
      options: ['ClusterRole `cluster-admin`', 'Role dan RoleBinding dalam namespace itu', 'NetworkPolicy', 'Secret dengan kata laluan'],
      why: 'Role senaraikan apa yang dibenarkan dalam satu namespace. RoleBinding serahkannya kepada bot itu.',
    },
  },
  {
    id: 'kcna-orchestration-004',
    domain: 'orchestration',
    answer: 1,
    lesson: 'k8s-k3-l01',
    en: {
      question: 'In the Kubernetes network model, what does every pod get?',
      options: ['A shared IP with its node', 'Its own IP, reachable from other pods without NAT', 'No IP until a Service is made', 'A public internet address'],
      why: 'Every tray has its own table number. Any pod can reach it directly.',
    },
    ms: {
      question: 'Dalam model rangkaian Kubernetes, apa yang setiap pod dapat?',
      options: ['IP yang dikongsi dengan node-nya', 'IP sendiri, yang pod lain boleh capai tanpa NAT', 'Tiada IP sehingga Service dibuat', 'Alamat internet awam'],
      why: 'Setiap dulang ada nombor meja sendiri. Mana-mana pod boleh capainya terus.',
    },
  },
  {
    id: 'kcna-orchestration-005',
    domain: 'orchestration',
    answer: 0,
    lesson: 'k8s-k3-l02',
    en: {
      question: 'You create a Service with no `type`. Which type does it get?',
      options: ['`ClusterIP`', '`NodePort`', '`LoadBalancer`', '`ExternalName`'],
      why: 'ClusterIP is the default. It gives one steady address that works inside the cluster.',
    },
    ms: {
      question: 'Anda buat Service tanpa `type`. Jenis apa yang ia dapat?',
      options: ['`ClusterIP`', '`NodePort`', '`LoadBalancer`', '`ExternalName`'],
      why: 'ClusterIP ialah lalai. Ia beri satu alamat tetap yang berfungsi di dalam kluster.',
    },
  },
  {
    id: 'kcna-orchestration-006',
    domain: 'orchestration',
    answer: 2,
    lesson: 'k8s-k3-l03',
    en: {
      question: 'Which Service type opens the same port on every node?',
      options: ['`ClusterIP`', 'Headless', '`NodePort`', '`ExternalName`'],
      why: 'A NodePort is a side window on every stall. The default range is 30000–32767.',
    },
    ms: {
      question: 'Jenis Service mana yang buka port yang sama di setiap node?',
      options: ['`ClusterIP`', 'Headless', '`NodePort`', '`ExternalName`'],
      why: 'NodePort ialah tingkap tepi di setiap gerai. Julat lalainya 30000–32767.',
    },
  },
  {
    id: 'kcna-orchestration-007',
    domain: 'orchestration',
    answer: 3,
    lesson: 'k8s-k3-l03',
    en: {
      question: 'On a cloud, which Service type asks for an outside load balancer?',
      options: ['`ClusterIP`', '`NodePort`', 'Headless', '`LoadBalancer`'],
      why: 'The cloud gives one outside address. Underneath, it builds on NodePort.',
    },
    ms: {
      question: 'Di cloud, jenis Service mana yang minta load balancer luar?',
      options: ['`ClusterIP`', '`NodePort`', 'Headless', '`LoadBalancer`'],
      why: 'Cloud beri satu alamat luar. Di bawahnya, ia dibina atas NodePort.',
    },
  },
  {
    id: 'kcna-orchestration-008',
    domain: 'orchestration',
    answer: 1,
    lesson: 'k8s-k3-l03',
    en: {
      question: 'A Service has `clusterIP: None`. What does a DNS lookup of its name return?',
      options: ['One virtual IP', 'The IP of each ready pod', 'The node’s IP', 'Nothing at all'],
      why: 'A headless Service has no single number. DNS lists each pod’s own address.',
    },
    ms: {
      question: 'Service ada `clusterIP: None`. Apa yang carian DNS untuk namanya pulangkan?',
      options: ['Satu IP maya', 'IP setiap pod yang sedia', 'IP node', 'Tiada apa-apa'],
      why: 'Service headless tiada satu nombor. DNS senaraikan alamat setiap pod.',
    },
  },
  {
    id: 'kcna-orchestration-009',
    domain: 'orchestration',
    answer: 0,
    lesson: 'k8s-k3-l04',
    en: {
      question: 'Which object lists the ready pod IPs behind a Service?',
      options: ['EndpointSlice', 'ConfigMap', 'NetworkPolicy', 'ReplicaSet'],
      why: 'Kubernetes keeps EndpointSlices up to date. kube-proxy reads them to send traffic.',
    },
    ms: {
      question: 'Objek mana yang senaraikan IP pod sedia di belakang sebuah Service?',
      options: ['EndpointSlice', 'ConfigMap', 'NetworkPolicy', 'ReplicaSet'],
      why: 'Kubernetes sentiasa kemas kini EndpointSlice. kube-proxy membacanya untuk hantar trafik.',
    },
  },
  {
    id: 'kcna-orchestration-010',
    domain: 'orchestration',
    answer: 2,
    lesson: 'k8s-k3-l04',
    en: {
      question: 'A Service has no endpoints, but its pods run. What should you check first?',
      options: ['The node’s disk space', 'The image tag', 'That the Service selector matches the pod labels', 'The cluster’s version'],
      why: 'A Service finds pods by labels. One typo in a label, and nobody answers.',
    },
    ms: {
      question: 'Service tiada endpoint, tetapi pod-nya berjalan. Apa yang patut anda semak dahulu?',
      options: ['Ruang cakera node', 'Tag image', 'Selector Service itu sepadan dengan label pod', 'Versi kluster'],
      why: 'Service cari pod melalui label. Satu salah taip pada label, dan tiada siapa menjawab.',
    },
  },
  {
    id: 'kcna-orchestration-011',
    domain: 'orchestration',
    answer: 3,
    lesson: 'k8s-k3-l05',
    en: {
      question: 'Service `shop` lives in namespace `kitchen`. What is its full DNS name?',
      options: ['`kitchen.shop.cluster`', '`shop.cluster.local`', '`shop.kitchen.pod`', '`shop.kitchen.svc.cluster.local`'],
      why: 'Service name, namespace, `svc`, then the cluster domain. That domain is usually `cluster.local`.',
    },
    ms: {
      question: 'Service `shop` berada dalam namespace `kitchen`. Apakah nama DNS penuhnya?',
      options: ['`kitchen.shop.cluster`', '`shop.cluster.local`', '`shop.kitchen.pod`', '`shop.kitchen.svc.cluster.local`'],
      why: 'Nama Service, namespace, `svc`, kemudian domain kluster. Domain itu biasanya `cluster.local`.',
    },
  },
  {
    id: 'kcna-orchestration-012',
    domain: 'orchestration',
    answer: 1,
    lesson: 'k8s-k3-l05',
    en: {
      question: 'A pod in `default` must call Service `shop` in `kitchen`. Which short name works?',
      options: ['`shop`', '`shop.kitchen`', '`kitchen`', '`default.shop`'],
      why: 'Plain `shop` only works inside `kitchen`. Add the namespace to cross zones.',
    },
    ms: {
      question: 'Pod dalam `default` perlu panggil Service `shop` dalam `kitchen`. Nama pendek mana yang berfungsi?',
      options: ['`shop`', '`shop.kitchen`', '`kitchen`', '`default.shop`'],
      why: '`shop` sahaja hanya berfungsi dalam `kitchen`. Tambah namespace untuk merentas zon.',
    },
  },
  {
    id: 'kcna-orchestration-013',
    domain: 'orchestration',
    answer: 0,
    lesson: 'k8s-k3-l05',
    en: {
      question: 'Which add-on answers DNS lookups inside most Kubernetes clusters?',
      options: ['CoreDNS', 'etcd', 'containerd', 'Helm'],
      why: 'CoreDNS turns Service names into addresses. It runs as pods in `kube-system`.',
    },
    ms: {
      question: 'Add-on mana yang jawab carian DNS dalam kebanyakan kluster Kubernetes?',
      options: ['CoreDNS', 'etcd', 'containerd', 'Helm'],
      why: 'CoreDNS tukar nama Service kepada alamat. Ia berjalan sebagai pod dalam `kube-system`.',
    },
  },
  {
    id: 'kcna-orchestration-014',
    domain: 'orchestration',
    answer: 2,
    lesson: 'k8s-k3-l06',
    en: {
      question: 'You want to test a pod from your laptop, without opening it to the world. What do you use?',
      options: ['A `LoadBalancer` Service', 'A public Gateway', '`kubectl port-forward`', 'A `NodePort` Service'],
      why: '`kubectl port-forward` opens a private tunnel from your laptop. Ctrl+C closes it.',
    },
    ms: {
      question: 'Anda mahu uji pod dari laptop, tanpa membukanya kepada dunia. Apa yang anda guna?',
      options: ['Service `LoadBalancer`', 'Gateway awam', '`kubectl port-forward`', 'Service `NodePort`'],
      why: '`kubectl port-forward` buka terowong peribadi dari laptop anda. Ctrl+C menutupnya.',
    },
  },
  {
    id: 'kcna-orchestration-015',
    domain: 'orchestration',
    answer: 3,
    lesson: 'k8s-k3-l08',
    en: {
      question: 'In Gateway API, which object sends `/menu` to the `menu` Service?',
      options: ['GatewayClass', 'Gateway', 'EndpointSlice', 'HTTPRoute'],
      why: 'The Gateway is the door. An HTTPRoute is the signboard that points paths to Services.',
    },
    ms: {
      question: 'Dalam Gateway API, objek mana yang hantar `/menu` ke Service `menu`?',
      options: ['GatewayClass', 'Gateway', 'EndpointSlice', 'HTTPRoute'],
      why: 'Gateway ialah pintu. HTTPRoute ialah papan tanda yang halakan laluan ke Service.',
    },
  },
  {
    id: 'kcna-orchestration-016',
    domain: 'orchestration',
    answer: 1,
    lesson: 'k8s-k3-l07',
    en: {
      question: 'Which Gateway API object names the controller that builds the doors?',
      options: ['HTTPRoute', 'GatewayClass', 'Service', 'Ingress'],
      why: 'The platform team installs the controller. A GatewayClass points Gateways at it.',
    },
    ms: {
      question: 'Objek Gateway API mana yang namakan controller yang bina pintu?',
      options: ['HTTPRoute', 'GatewayClass', 'Service', 'Ingress'],
      why: 'Pasukan platform pasang controller itu. GatewayClass halakan Gateway kepadanya.',
    },
  },
  {
    id: 'kcna-orchestration-017',
    domain: 'orchestration',
    answer: 0,
    lesson: 'k8s-k3-l07',
    en: {
      question: 'You apply a Gateway, but it never gets an address. What is likely missing?',
      options: ['A Gateway controller, like Envoy Gateway', 'A ConfigMap', 'A second namespace', 'A bigger node'],
      why: 'Gateway API is only words until a controller acts. The cluster needs one installed.',
    },
    ms: {
      question: 'Anda apply Gateway, tetapi ia tidak pernah dapat alamat. Apa yang mungkin tiada?',
      options: ['Controller Gateway, seperti Envoy Gateway', 'ConfigMap', 'Namespace kedua', 'Node yang lebih besar'],
      why: 'Gateway API hanya kata-kata sehingga controller bertindak. Kluster perlu ada satu.',
    },
  },
  {
    id: 'kcna-orchestration-018',
    domain: 'orchestration',
    answer: 2,
    lesson: 'k8s-k3-l09',
    en: {
      question: 'ingress-nginx retired in March 2026. Where should new HTTP routing go?',
      options: ['Back to NodePorts', 'A new version of ingress-nginx', 'Gateway API', 'Nowhere. Kubernetes dropped HTTP.'],
      why: 'The Ingress API still works, but new features land in Gateway API.',
    },
    ms: {
      question: 'ingress-nginx bersara pada Mac 2026. Ke mana penghalaan HTTP baharu patut pergi?',
      options: ['Balik kepada NodePort', 'Versi baharu ingress-nginx', 'Gateway API', 'Tiada. Kubernetes buang HTTP.'],
      why: 'API Ingress masih berfungsi, tetapi ciri baharu masuk ke Gateway API.',
    },
  },
  {
    id: 'kcna-orchestration-019',
    domain: 'orchestration',
    answer: 3,
    lesson: 'k8s-k3-l01',
    en: {
      question: 'Which kind of plugin gives each pod its network and IP address?',
      options: ['A CSI driver', 'A container registry', 'An admission webhook', 'A CNI plugin'],
      why: 'Kubernetes does not wire pods itself. A CNI plugin, like Calico or Cilium, does.',
    },
    ms: {
      question: 'Jenis plugin mana yang beri setiap pod rangkaian dan alamat IP?',
      options: ['Driver CSI', 'Container registry', 'Admission webhook', 'Plugin CNI'],
      why: 'Kubernetes tidak sambung pod sendiri. Plugin CNI, seperti Calico atau Cilium, yang buat.',
    },
  },
  {
    id: 'kcna-orchestration-020',
    domain: 'orchestration',
    answer: 1,
    lesson: 'k8s-k3-l11',
    en: {
      question: 'You apply a NetworkPolicy, but nothing is blocked. What is a likely cause?',
      options: ['NetworkPolicies need an etcd restart', 'The CNI plugin does not enforce policies', 'Policies only apply to Deployments', 'The pods have too many labels'],
      why: 'A policy is only words. The CNI plugin makes it real, and not every plugin does.',
    },
    ms: {
      question: 'Anda apply NetworkPolicy, tetapi tiada apa yang disekat. Apakah punca yang mungkin?',
      options: ['NetworkPolicy perlukan etcd dimulakan semula', 'Plugin CNI itu tidak kuatkuasakan polisi', 'Polisi hanya terpakai pada Deployment', 'Pod itu ada terlalu banyak label'],
      why: 'Polisi hanya kata-kata. Plugin CNI yang jadikannya nyata, dan bukan semua plugin buat begitu.',
    },
  },
  {
    id: 'kcna-orchestration-021',
    domain: 'orchestration',
    answer: 0,
    lesson: 'k8s-k3-l11',
    en: {
      question: 'No NetworkPolicy selects a pod. Which traffic may reach it?',
      options: ['All traffic', 'None at all', 'Only traffic from its own node', 'Only traffic from `kube-system`'],
      why: 'By default, every door is open. A policy that selects the pod starts a guest list.',
    },
    ms: {
      question: 'Tiada NetworkPolicy yang pilih sebuah pod. Trafik mana yang boleh sampai kepadanya?',
      options: ['Semua trafik', 'Tiada langsung', 'Hanya trafik dari node-nya sendiri', 'Hanya trafik dari `kube-system`'],
      why: 'Secara lalai, setiap pintu terbuka. Polisi yang pilih pod itu mulakan senarai tetamu.',
    },
  },
  {
    id: 'kcna-orchestration-022',
    domain: 'orchestration',
    answer: 2,
    lesson: 'k8s-k3-l11',
    en: {
      question: 'A policy has `podSelector: {}`, type `Ingress`, and no rules. What does it do?',
      options: ['Allows all traffic in', 'Blocks only outgoing traffic', 'Blocks incoming traffic to every pod in its namespace', 'Nothing, because it names no pods'],
      why: 'An empty selector picks every pod. No rules means nobody is on the guest list.',
    },
    ms: {
      question: 'Satu polisi ada `podSelector: {}`, jenis `Ingress`, dan tiada peraturan. Apa yang ia buat?',
      options: ['Benarkan semua trafik masuk', 'Sekat trafik keluar sahaja', 'Sekat trafik masuk ke setiap pod dalam namespace-nya', 'Tiada apa-apa, kerana ia tak namakan pod'],
      why: 'Selector kosong pilih setiap pod. Tiada peraturan bermakna tiada siapa dalam senarai tetamu.',
    },
  },
  {
    id: 'kcna-orchestration-023',
    domain: 'orchestration',
    answer: 3,
    lesson: 'k8s-k3-l10',
    en: {
      question: 'Which tool gets TLS certificates for you inside the cluster and renews them?',
      options: ['CoreDNS', 'kube-proxy', 'Kustomize', 'cert-manager'],
      why: 'cert-manager asks an issuer, like Let’s Encrypt, and renews before expiry.',
    },
    ms: {
      question: 'Alat mana yang dapatkan sijil TLS untuk anda dalam kluster dan memperbaharuinya?',
      options: ['CoreDNS', 'kube-proxy', 'Kustomize', 'cert-manager'],
      why: 'cert-manager minta daripada issuer, seperti Let’s Encrypt, dan perbaharui sebelum tamat.',
    },
  },
  {
    id: 'kcna-orchestration-024',
    domain: 'orchestration',
    answer: 1,
    lesson: 'k8s-k6-l01',
    en: {
      question: 'In what order does the API server check a request?',
      options: ['Admission, then authorization, then authentication', 'Authentication, then authorization, then admission', 'Authorization only', 'Admission only'],
      why: 'Who are you? May you do it? Is the object allowed? Fail any gate, and it stops.',
    },
    ms: {
      question: 'Dalam turutan apa API server periksa sesuatu permintaan?',
      options: ['Admission, kemudian authorization, kemudian authentication', 'Authentication, kemudian authorization, kemudian admission', 'Authorization sahaja', 'Admission sahaja'],
      why: 'Siapa anda? Boleh anda buat? Objek itu dibenarkan? Gagal mana-mana pintu, ia berhenti.',
    },
  },
  {
    id: 'kcna-orchestration-025',
    domain: 'orchestration',
    answer: 3,
    lesson: 'k8s-k6-l02',
    en: {
      question: 'A RoleBinding in namespace `shop` points to the ClusterRole `view`. Where can the user read?',
      options: ['In every namespace', 'Nowhere, since that mix is not allowed', 'Only on nodes', 'Only in namespace `shop`'],
      why: 'The binding decides the zone. A ClusterRole is just a reusable list of rights.',
    },
    ms: {
      question: 'RoleBinding dalam namespace `shop` merujuk ClusterRole `view`. Di mana pengguna itu boleh membaca?',
      options: ['Dalam setiap namespace', 'Tiada di mana-mana, kerana gabungan itu tak dibenarkan', 'Hanya pada node', 'Hanya dalam namespace `shop`'],
      why: 'Binding yang tentukan zon. ClusterRole hanyalah senarai hak yang boleh diguna semula.',
    },
  },
  {
    id: 'kcna-orchestration-026',
    domain: 'orchestration',
    answer: 2,
    lesson: 'k8s-k6-l02',
    en: {
      question: 'A monitoring tool must read nodes across the whole cluster. What do you give it?',
      options: ['A Role and a RoleBinding', 'A NetworkPolicy', 'A ClusterRole and a ClusterRoleBinding', 'The `cluster-admin` ClusterRole'],
      why: 'Nodes belong to no namespace. Reading them needs a cluster-wide binding, with read rights only.',
    },
    ms: {
      question: 'Alat pemantauan perlu baca node di seluruh kluster. Apa yang anda beri kepadanya?',
      options: ['Role dan RoleBinding', 'NetworkPolicy', 'ClusterRole dan ClusterRoleBinding', 'ClusterRole `cluster-admin`'],
      why: 'Node tidak tergolong dalam namespace. Membacanya perlukan binding seluruh kluster, dengan hak baca sahaja.',
    },
  },
  {
    id: 'kcna-orchestration-027',
    domain: 'orchestration',
    answer: 0,
    lesson: 'k8s-k6-l02',
    en: {
      question: 'An app in a pod calls the API server. Which identity does it use?',
      options: ['Its ServiceAccount', 'The node’s root user', 'Your personal kubeconfig', 'The image’s author'],
      why: 'People bring their own ID. Robots in pods wear a ServiceAccount badge.',
    },
    ms: {
      question: 'Aplikasi dalam pod panggil API server. Identiti mana yang ia guna?',
      options: ['ServiceAccount-nya', 'Pengguna root node', 'Kubeconfig peribadi anda', 'Pengarang image itu'],
      why: 'Manusia bawa ID sendiri. Robot dalam pod pakai lencana ServiceAccount.',
    },
  },
  {
    id: 'kcna-orchestration-028',
    domain: 'orchestration',
    answer: 1,
    lesson: 'k8s-k6-l03',
    en: {
      question: 'Which command checks if you may delete pods, before you try?',
      options: ['`kubectl delete pods --dry-run`', '`kubectl auth can-i delete pods`', '`kubectl get roles`', '`kubectl whoami delete`'],
      why: 'It answers yes or no. Add `--as` to ask on behalf of someone else.',
    },
    ms: {
      question: 'Arahan mana yang semak sama ada anda boleh padam pod, sebelum mencuba?',
      options: ['`kubectl delete pods --dry-run`', '`kubectl auth can-i delete pods`', '`kubectl get roles`', '`kubectl whoami delete`'],
      why: 'Ia jawab yes atau no. Tambah `--as` untuk bertanya bagi pihak orang lain.',
    },
  },
  {
    id: 'kcna-orchestration-029',
    domain: 'orchestration',
    answer: 0,
    lesson: 'k8s-k6-l04',
    en: {
      question: 'Which Pod Security Standard is the strictest?',
      options: ['Restricted', 'Baseline', 'Privileged', 'Default'],
      why: 'Privileged allows all. Baseline blocks known risks. Restricted follows hardening best practice.',
    },
    ms: {
      question: 'Pod Security Standard mana yang paling ketat?',
      options: ['Restricted', 'Baseline', 'Privileged', 'Default'],
      why: 'Privileged benarkan semua. Baseline sekat risiko yang diketahui. Restricted ikut amalan pengerasan terbaik.',
    },
  },
  {
    id: 'kcna-orchestration-030',
    domain: 'orchestration',
    answer: 2,
    lesson: 'k8s-k6-l04',
    en: {
      question: 'How do you switch on Pod Security checks for one namespace?',
      options: ['Install a new CNI plugin', 'Add a ServiceAccount', 'Add a `pod-security.kubernetes.io/enforce` label to it', 'Restart every pod'],
      why: 'One label on the zone turns the guard on. `enforce` refuses pods that break the level.',
    },
    ms: {
      question: 'Bagaimana anda hidupkan semakan Pod Security untuk satu namespace?',
      options: ['Pasang plugin CNI baharu', 'Tambah ServiceAccount', 'Tambah label `pod-security.kubernetes.io/enforce` padanya', 'Mula semula setiap pod'],
      why: 'Satu label pada zon hidupkan pengawal. `enforce` tolak pod yang langgar tahap itu.',
    },
  },
  {
    id: 'kcna-orchestration-031',
    domain: 'orchestration',
    answer: 3,
    lesson: 'k8s-k6-l05',
    en: {
      question: 'Which `securityContext` setting stops a container from running as root?',
      options: ['`privileged: true`', '`hostNetwork: true`', '`readOnly: false`', '`runAsNonRoot: true`'],
      why: 'The kubelet checks the user before the start. Root is refused.',
    },
    ms: {
      question: 'Tetapan `securityContext` mana yang halang container berjalan sebagai root?',
      options: ['`privileged: true`', '`hostNetwork: true`', '`readOnly: false`', '`runAsNonRoot: true`'],
      why: 'Kubelet semak pengguna sebelum bermula. Root ditolak.',
    },
  },
  {
    id: 'kcna-orchestration-032',
    domain: 'orchestration',
    answer: 1,
    lesson: 'k8s-k6-l05',
    en: {
      question: 'You set `runAsNonRoot: true`, but the image runs as root. What happens?',
      options: ['It runs as root anyway', 'The container never starts: `CreateContainerConfigError`', 'Kubernetes rebuilds the image', 'The node gets a taint'],
      why: 'The kubelet refuses to start it. Use a non-root image, or set `runAsUser`.',
    },
    ms: {
      question: 'Anda tetapkan `runAsNonRoot: true`, tetapi image itu berjalan sebagai root. Apa yang berlaku?',
      options: ['Ia tetap berjalan sebagai root', 'Container tak pernah bermula: `CreateContainerConfigError`', 'Kubernetes bina semula image itu', 'Node itu diberi taint'],
      why: 'Kubelet enggan memulakannya. Guna image bukan root, atau tetapkan `runAsUser`.',
    },
  },
  {
    id: 'kcna-orchestration-033',
    domain: 'orchestration',
    answer: 2,
    lesson: 'k8s-k4-l02',
    en: {
      question: 'Is the data in a plain Kubernetes Secret encrypted?',
      options: ['Yes, with AES by default', 'Yes, by the kubelet', 'No. It is only base64, which anyone can decode.', 'Only if its name ends in `-secret`'],
      why: 'base64 is a costume, not a lock. Limit who reads Secrets, and encrypt etcd.',
    },
    ms: {
      question: 'Adakah data dalam Secret Kubernetes biasa disulitkan?',
      options: ['Ya, dengan AES secara lalai', 'Ya, oleh kubelet', 'Tidak. Ia hanya base64, yang sesiapa boleh nyahkod.', 'Hanya jika namanya berakhir dengan `-secret`'],
      why: 'base64 hanya penyamaran, bukan kunci. Hadkan siapa boleh baca Secret, dan sulitkan etcd.',
    },
  },
  {
    id: 'kcna-orchestration-034',
    domain: 'orchestration',
    answer: 3,
    lesson: 'k8s-k4-l02',
    en: {
      question: 'How do you keep Secrets locked while they sit inside etcd?',
      options: ['Use longer Secret names', 'Store them in a ConfigMap', 'Base64 them twice', 'Turn on encryption at rest in the API server'],
      why: 'The API server then encrypts Secrets before saving them. A stolen etcd copy stays unreadable.',
    },
    ms: {
      question: 'Bagaimana anda pastikan Secret berkunci semasa disimpan dalam etcd?',
      options: ['Guna nama Secret yang lebih panjang', 'Simpan dalam ConfigMap', 'Base64 dua kali', 'Hidupkan encryption at rest dalam API server'],
      why: 'API server lalu sulitkan Secret sebelum menyimpannya. Salinan etcd yang dicuri tak boleh dibaca.',
    },
  },
  {
    id: 'kcna-orchestration-035',
    domain: 'orchestration',
    answer: 1,
    lesson: 'k8s-k4-l03',
    en: {
      question: 'Your team wants Secrets in Git, but safe from strangers. Which tool fits?',
      options: ['Plain Secret YAML in a private repo', 'Sealed Secrets, made with `kubeseal`', 'A ConfigMap', 'An emptyDir volume'],
      why: 'kubeseal locks the Secret with the cluster’s public key. Only the cluster can unlock it.',
    },
    ms: {
      question: 'Pasukan anda mahu Secret dalam Git, tetapi selamat daripada orang luar. Alat mana yang sesuai?',
      options: ['YAML Secret biasa dalam repo peribadi', 'Sealed Secrets, dibuat dengan `kubeseal`', 'ConfigMap', 'Volume emptyDir'],
      why: 'kubeseal kunci Secret dengan kunci awam kluster. Hanya kluster boleh membukanya.',
    },
  },
  {
    id: 'kcna-orchestration-036',
    domain: 'orchestration',
    answer: 0,
    lesson: 'k8s-k6-l07',
    en: {
      question: 'Which built-in object rejects new objects using a rule written in CEL?',
      options: ['`ValidatingAdmissionPolicy`', '`NetworkPolicy`', '`PodDisruptionBudget`', '`LimitRange`'],
      why: 'It is a house rule at the admission gate. No extra webhook server is needed.',
    },
    ms: {
      question: 'Objek terbina dalam mana yang tolak objek baharu dengan peraturan yang ditulis dalam CEL?',
      options: ['`ValidatingAdmissionPolicy`', '`NetworkPolicy`', '`PodDisruptionBudget`', '`LimitRange`'],
      why: 'Ia peraturan rumah di pintu admission. Tiada pelayan webhook tambahan diperlukan.',
    },
  },
  {
    id: 'kcna-orchestration-037',
    domain: 'orchestration',
    answer: 2,
    lesson: 'k8s-k6-l08',
    en: {
      question: 'Someone deleted a Deployment last night. Where do you find who did it?',
      options: ['In the pod’s logs', 'In `kubectl top`', 'In the API server’s audit log', 'In the container image'],
      why: 'The audit log records who asked, for what, and when. Ship it off the cluster.',
    },
    ms: {
      question: 'Seseorang padam Deployment malam tadi. Di mana anda cari siapa yang buat?',
      options: ['Dalam log pod', 'Dalam `kubectl top`', 'Dalam audit log API server', 'Dalam container image'],
      why: 'Audit log rekod siapa yang minta, apa, dan bila. Hantar ia keluar dari kluster.',
    },
  },
  {
    id: 'kcna-orchestration-038',
    domain: 'orchestration',
    answer: 3,
    lesson: 'k8s-k6-l10',
    en: {
      question: 'A pod sets `hostUsers: false`. What does that give it?',
      options: ['Access to the node’s users', 'Its own network', 'A faster start', 'Root inside the container is a normal user on the node'],
      why: 'The pod gets its own user IDs. Break out as root, and you are nobody on the node.',
    },
    ms: {
      question: 'Pod tetapkan `hostUsers: false`. Apa yang ia dapat?',
      options: ['Akses kepada pengguna node', 'Rangkaian sendiri', 'Mula lebih cepat', 'Root dalam container ialah pengguna biasa pada node'],
      why: 'Pod dapat ID pengguna sendiri. Terlepas keluar sebagai root, anda bukan sesiapa pada node.',
    },
  },
  {
    id: 'kcna-orchestration-039',
    domain: 'orchestration',
    answer: 1,
    lesson: 'k8s-k4-l04',
    en: {
      question: 'How long does an `emptyDir` volume keep its files?',
      options: ['Forever', 'As long as the pod lives', 'Until the next image pull', 'Until the namespace is renamed'],
      why: 'It is born with the pod and wiped with it. Containers in the pod can share it.',
    },
    ms: {
      question: 'Berapa lama volume `emptyDir` simpan fail-nya?',
      options: ['Selama-lamanya', 'Selagi pod itu hidup', 'Sehingga image ditarik lagi', 'Sehingga namespace ditukar nama'],
      why: 'Ia lahir bersama pod dan dipadam bersamanya. Container dalam pod itu boleh berkongsinya.',
    },
  },
  {
    id: 'kcna-orchestration-040',
    domain: 'orchestration',
    answer: 0,
    lesson: 'k8s-k4-l05',
    en: {
      question: 'An app needs 5 GiB that outlives its pods. Which object does the asking?',
      options: ['A PersistentVolumeClaim', 'A ConfigMap', 'An `emptyDir` volume', 'A ResourceQuota'],
      why: 'The claim is the request slip. A PersistentVolume is the locker it gets.',
    },
    ms: {
      question: 'Aplikasi perlukan 5 GiB yang kekal lebih lama daripada pod-nya. Objek mana yang membuat permintaan?',
      options: ['PersistentVolumeClaim', 'ConfigMap', 'Volume `emptyDir`', 'ResourceQuota'],
      why: 'Claim ialah slip permintaan. PersistentVolume ialah loker yang ia dapat.',
    },
  },
  {
    id: 'kcna-orchestration-041',
    domain: 'orchestration',
    answer: 2,
    lesson: 'k8s-k4-l06',
    en: {
      question: 'A claim arrives, and a new volume appears by itself. What made it?',
      options: ['The scheduler', 'The kubelet’s cache', 'A StorageClass, through dynamic provisioning', 'An init container'],
      why: 'A StorageClass is the locker maker. It builds a PV when a claim asks.',
    },
    ms: {
      question: 'Satu claim tiba, dan volume baharu muncul sendiri. Apa yang membuatnya?',
      options: ['Scheduler', 'Cache kubelet', 'StorageClass, melalui dynamic provisioning', 'Init container'],
      why: 'StorageClass ialah pembuat loker. Ia bina PV bila ada claim yang meminta.',
    },
  },
  {
    id: 'kcna-orchestration-042',
    domain: 'orchestration',
    answer: 3,
    lesson: 'k8s-k4-l06',
    en: {
      question: 'Pods on many nodes must write to one shared volume. Which access mode fits?',
      options: ['`ReadWriteOnce`', '`ReadOnlyMany`', '`ReadWriteOncePod`', '`ReadWriteMany`'],
      why: '`ReadWriteOnce` means one node at a time. Writers on many nodes need `ReadWriteMany`.',
    },
    ms: {
      question: 'Pod di banyak node perlu tulis ke satu volume yang dikongsi. Mod akses mana yang sesuai?',
      options: ['`ReadWriteOnce`', '`ReadOnlyMany`', '`ReadWriteOncePod`', '`ReadWriteMany`'],
      why: '`ReadWriteOnce` bermaksud satu node pada satu masa. Penulis di banyak node perlukan `ReadWriteMany`.',
    },
  },
  {
    id: 'kcna-orchestration-043',
    domain: 'orchestration',
    answer: 0,
    lesson: 'k8s-k4-l07',
    en: {
      question: 'How does each pod of a StatefulSet get its own volume?',
      options: ['`volumeClaimTemplates`', 'One shared `emptyDir`', 'A ConfigMap per pod', '`hostNetwork: true`'],
      why: 'Each pod gets its own claim, like `data-db-0`. It stays when the pod restarts.',
    },
    ms: {
      question: 'Bagaimana setiap pod StatefulSet dapat volume sendiri?',
      options: ['`volumeClaimTemplates`', 'Satu `emptyDir` yang dikongsi', 'Satu ConfigMap bagi setiap pod', '`hostNetwork: true`'],
      why: 'Setiap pod dapat claim sendiri, seperti `data-db-0`. Ia kekal bila pod mula semula.',
    },
  },
  {
    id: 'kcna-orchestration-044',
    domain: 'orchestration',
    answer: 2,
    lesson: 'k8s-k4-l01',
    en: {
      question: 'You edit a ConfigMap. Pods read it as env vars and as a mounted file. What updates?',
      options: ['Both update at once', 'Neither, until you delete the ConfigMap', 'The file catches up. The env vars stay old until a restart.', 'Only the env vars'],
      why: 'Env vars are read once, at start. Mounted files follow the note after a short wait.',
    },
    ms: {
      question: 'Anda sunting ConfigMap. Pod membacanya sebagai env var dan sebagai fail. Apa yang dikemas kini?',
      options: ['Kedua-duanya serta-merta', 'Tiada, sehingga anda padam ConfigMap', 'Fail itu menyusul. Env var kekal lama sehingga restart.', 'Env var sahaja'],
      why: 'Env var dibaca sekali, semasa mula. Fail yang dipasang ikut nota selepas seketika.',
    },
  },
  {
    id: 'kcna-orchestration-045',
    domain: 'orchestration',
    answer: 3,
    lesson: 'k8s-k5-l08',
    en: {
      question: 'Who writes events like `Scheduled`, `Pulled` and `Started`?',
      options: ['Your app', 'You, with kubectl', 'The container registry', 'Kubernetes parts, like the scheduler and the kubelet'],
      why: 'Events are the manager’s notice board. By default they fade after about an hour.',
    },
    ms: {
      question: 'Siapa yang tulis event seperti `Scheduled`, `Pulled` dan `Started`?',
      options: ['Aplikasi anda', 'Anda, dengan kubectl', 'Container registry', 'Bahagian Kubernetes, seperti scheduler dan kubelet'],
      why: 'Event ialah papan notis pengurus. Secara lalai, ia hilang selepas kira-kira sejam.',
    },
  },
  {
    id: 'kcna-orchestration-046',
    domain: 'orchestration',
    answer: 1,
    lesson: 'k8s-k5-l08',
    en: {
      question: 'Pod `kitchen` has two containers. How do you read the logs of the `cook` container?',
      options: ['`kubectl logs cook`', '`kubectl logs kitchen -c cook`', '`kubectl describe cook`', '`kubectl get logs kitchen`'],
      why: '`-c` picks one container in the pod. Without it, kubectl picks a default one.',
    },
    ms: {
      question: 'Pod `kitchen` ada dua container. Bagaimana anda baca log container `cook`?',
      options: ['`kubectl logs cook`', '`kubectl logs kitchen -c cook`', '`kubectl describe cook`', '`kubectl get logs kitchen`'],
      why: '`-c` pilih satu container dalam pod. Tanpanya, kubectl pilih satu secara lalai.',
    },
  },
  {
    id: 'kcna-orchestration-047',
    domain: 'orchestration',
    answer: 0,
    lesson: 'k8s-k5-l10',
    en: {
      question: 'An image has no shell and no tools. How can you look around inside the pod?',
      options: ['`kubectl debug` with a temporary toolbox container', '`kubectl exec -it` with `sh`', 'Rebuild the image on the node', '`kubectl port-forward`'],
      why: '`kubectl debug` adds a temporary container with tools. Your app keeps running.',
    },
    ms: {
      question: 'Image itu tiada shell dan tiada alat. Bagaimana anda boleh tinjau dalam pod?',
      options: ['`kubectl debug` dengan container alat sementara', '`kubectl exec -it` dengan `sh`', 'Bina semula image di node', '`kubectl port-forward`'],
      why: '`kubectl debug` tambah container sementara yang ada alat. Aplikasi anda terus berjalan.',
    },
  },
  {
    id: 'kcna-orchestration-048',
    domain: 'orchestration',
    answer: 2,
    lesson: 'k8s-k2-l08',
    en: {
      question: 'A pod shows `Running`, but READY says `0/1`. What does it mean?',
      options: ['The image is still downloading', 'The pod is about to be deleted', 'The container runs, but its readiness probe fails', 'The node is full'],
      why: 'Running means the process is up. Ready means it may get traffic.',
    },
    ms: {
      question: 'Pod tunjuk `Running`, tetapi READY kata `0/1`. Apa maksudnya?',
      options: ['Image masih dimuat turun', 'Pod itu akan dipadam', 'Container berjalan, tetapi readiness probe-nya gagal', 'Node itu penuh'],
      why: 'Running bermaksud proses hidup. Ready bermaksud ia boleh terima trafik.',
    },
  },
  {
    id: 'kcna-orchestration-049',
    domain: 'orchestration',
    answer: 1,
    lesson: 'k8s-k5-l06',
    en: {
      question: 'What does a PodDisruptionBudget protect against?',
      options: ['Crashes inside the app', 'Too many pods going down at once during a drain', 'Pods using too much CPU', 'Failed image pulls'],
      why: 'It limits planned disruptions. A drain waits rather than drop below your minimum.',
    },
    ms: {
      question: 'PodDisruptionBudget lindungi daripada apa?',
      options: ['Crash dalam aplikasi', 'Terlalu banyak pod turun serentak semasa drain', 'Pod guna terlalu banyak CPU', 'Tarikan image yang gagal'],
      why: 'Ia hadkan gangguan yang dirancang. Drain akan tunggu daripada jatuh bawah minimum anda.',
    },
  },

  // ---------------------------------------------------------------- Cloud Native Application Delivery
  {
    id: 'kcna-delivery-001',
    domain: 'delivery',
    answer: 0,
    lesson: 'k8s-k2-l05',
    en: {
      question: 'A new version is rolling out, and errors climb fast. What is the quickest way back?',
      options: ['`kubectl rollout undo deployment/shop`', '`kubectl delete deployment shop`', 'Delete the pods one by one', 'Wait for the errors to stop'],
      why: 'Every change is a revision. Undo goes back to the one before.',
    },
    ms: {
      question: 'Versi baharu sedang rollout, dan ralat naik dengan cepat. Apa cara paling cepat untuk undur?',
      options: ['`kubectl rollout undo deployment/shop`', '`kubectl delete deployment shop`', 'Padam pod satu demi satu', 'Tunggu ralat berhenti sendiri'],
      why: 'Setiap perubahan ialah satu revision. Undo kembali ke revision sebelumnya.',
    },
  },
  {
    id: 'kcna-delivery-002',
    domain: 'delivery',
    answer: 2,
    lesson: 'k8s-k7-l01',
    en: {
      question: 'In GitOps, where does the cluster get its desired state from?',
      options: ['Commands typed on a laptop', 'The newest pod', 'A Git repo', 'The container registry'],
      why: 'Git is the order board. A tool like Argo CD keeps the cluster matching it.',
    },
    ms: {
      question: 'Dalam GitOps, dari mana kluster dapat desired state?',
      options: ['Arahan yang ditaip di laptop', 'Pod yang paling baharu', 'Repo Git', 'Container registry'],
      why: 'Git ialah papan pesanan. Alat seperti Argo CD pastikan kluster sentiasa sama dengannya.',
    },
  },
  {
    id: 'kcna-delivery-003',
    domain: 'delivery',
    answer: 1,
    lesson: 'k8s-k4-l09',
    en: {
      question: 'Helm installs an app from a package. What is that package called?',
      options: ['An image', 'A chart', 'A manifest', 'A namespace'],
      why: 'A chart holds templates and values. Helm fills them in and sends them to the cluster.',
    },
    ms: {
      question: 'Helm pasang aplikasi daripada satu pakej. Apa nama pakej itu?',
      options: ['Image', 'Chart', 'Manifest', 'Namespace'],
      why: 'Chart ada templat dan values. Helm isi templat itu dan hantar ke kluster.',
    },
  },
  {
    id: 'kcna-delivery-004',
    domain: 'delivery',
    answer: 2,
    lesson: 'cicd-c1-l02',
    en: {
      question: 'What does continuous integration mean?',
      options: ['Shipping to production every hour', 'One person merges everyone’s code each month', 'Merging small changes often, each one tested by a robot', 'Running servers without containers'],
      why: 'CI catches problems while changes are small. Delivery and deployment build on it.',
    },
    ms: {
      question: 'Apakah maksud continuous integration?',
      options: ['Hantar ke production setiap jam', 'Seorang gabungkan kod semua orang setiap bulan', 'Gabungkan perubahan kecil dengan kerap, setiap satu diuji oleh robot', 'Jalankan pelayan tanpa container'],
      why: 'CI tangkap masalah semasa perubahan masih kecil. Delivery dan deployment dibina atasnya.',
    },
  },
  {
    id: 'kcna-delivery-005',
    domain: 'delivery',
    answer: 0,
    lesson: 'cicd-c1-l02',
    en: {
      question: 'Every change that passes the tests goes live, with no button. What is that called?',
      options: ['Continuous deployment', 'Continuous delivery', 'Continuous integration only', 'A manual release'],
      why: 'Delivery waits for a person to say go. Deployment does not, so it needs strong tests.',
    },
    ms: {
      question: 'Setiap perubahan yang lulus ujian terus live, tanpa butang. Apa namanya?',
      options: ['Continuous deployment', 'Continuous delivery', 'Continuous integration sahaja', 'Keluaran manual'],
      why: 'Delivery tunggu seseorang kata go. Deployment tidak tunggu, jadi ia perlukan ujian yang kuat.',
    },
  },
  {
    id: 'kcna-delivery-006',
    domain: 'delivery',
    answer: 3,
    lesson: 'cicd-c1-l06',
    en: {
      question: 'Why build the image once, then promote that same image to staging and production?',
      options: ['It makes the image smaller', 'Builds are not allowed twice', 'It skips the tests', 'What you tested is exactly what ships'],
      why: 'A rebuild can pull in new parts and differ. One image, many environments, no surprises.',
    },
    ms: {
      question: 'Kenapa bina image sekali, kemudian naikkan image yang sama ke staging dan production?',
      options: ['Ia buat image lebih kecil', 'Bina dua kali tidak dibenarkan', 'Ia langkau ujian', 'Apa yang anda uji ialah tepat apa yang dihantar'],
      why: 'Bina semula boleh tarik bahagian baharu dan jadi berbeza. Satu image, banyak persekitaran, tiada kejutan.',
    },
  },
  {
    id: 'kcna-delivery-007',
    domain: 'delivery',
    answer: 1,
    lesson: 'docker-d2-l07',
    en: {
      question: 'Which image tag tells you exactly which commit an image came from?',
      options: ['`latest`', 'A Git SHA tag, like `sha-3f2a9c1`', '`stable`', 'The build date only'],
      why: 'A SHA points to one commit. You can always trace the image back to its code.',
    },
    ms: {
      question: 'Tag image mana yang beritahu tepat commit mana image itu datang?',
      options: ['`latest`', 'Tag SHA Git, seperti `sha-3f2a9c1`', '`stable`', 'Tarikh bina sahaja'],
      why: 'SHA tunjuk kepada satu commit. Anda sentiasa boleh jejak image itu kembali ke kodnya.',
    },
  },
  {
    id: 'kcna-delivery-008',
    domain: 'delivery',
    answer: 2,
    lesson: 'k8s-k7-l01',
    en: {
      question: 'In GitOps, how do changes usually reach the cluster?',
      options: ['A developer runs `kubectl apply` from a laptop', 'The CI job holds admin keys and pushes', 'An agent in the cluster pulls them from Git', 'The registry sends them'],
      why: 'The agent watches Git and pulls. CI never needs the cluster’s keys.',
    },
    ms: {
      question: 'Dalam GitOps, bagaimana perubahan biasanya sampai ke kluster?',
      options: ['Pembangun jalankan `kubectl apply` dari laptop', 'Kerja CI pegang kunci admin dan tolak', 'Ejen dalam kluster tarik dari Git', 'Registry yang hantar'],
      why: 'Ejen itu pantau Git dan tarik. CI tidak perlukan kunci kluster.',
    },
  },
  {
    id: 'kcna-delivery-009',
    domain: 'delivery',
    answer: 0,
    lesson: 'k8s-k7-l02',
    en: {
      question: 'Which two tools are popular GitOps agents for Kubernetes?',
      options: ['Argo CD and Flux', 'Prometheus and Grafana', 'containerd and runc', 'CoreDNS and etcd'],
      why: 'Both are graduated CNCF projects. Both pull from Git and keep the cluster matching.',
    },
    ms: {
      question: 'Dua alat mana yang popular sebagai ejen GitOps untuk Kubernetes?',
      options: ['Argo CD dan Flux', 'Prometheus dan Grafana', 'containerd dan runc', 'CoreDNS dan etcd'],
      why: 'Kedua-duanya projek CNCF graduated. Kedua-duanya tarik dari Git dan pastikan kluster sepadan.',
    },
  },
  {
    id: 'kcna-delivery-010',
    domain: 'delivery',
    answer: 3,
    lesson: 'k8s-k7-l03',
    en: {
      question: 'Argo CD shows an app as `OutOfSync`. What does it mean?',
      options: ['The app is down', 'Argo CD has crashed', 'The image is too old', 'The cluster differs from what Git says'],
      why: 'Sync status compares with Git. Health is a separate question: is it working?',
    },
    ms: {
      question: 'Argo CD tunjuk aplikasi sebagai `OutOfSync`. Apa maksudnya?',
      options: ['Aplikasi itu mati', 'Argo CD crash', 'Image itu terlalu lama', 'Kluster berbeza daripada apa yang Git kata'],
      why: 'Status sync banding dengan Git. Health ialah soalan lain: adakah ia berfungsi?',
    },
  },
  {
    id: 'kcna-delivery-011',
    domain: 'delivery',
    answer: 1,
    lesson: 'k8s-k7-l03',
    en: {
      question: 'You delete a file from the GitOps repo. With `prune: true`, what happens?',
      options: ['Nothing. Removed files are ignored.', 'Its object is deleted from the cluster too', 'Git restores the file', 'The whole app is deleted'],
      why: 'Prune removes what Git no longer lists. In Argo CD, it is off by default.',
    },
    ms: {
      question: 'Anda padam satu fail daripada repo GitOps. Dengan `prune: true`, apa yang berlaku?',
      options: ['Tiada. Fail yang dibuang diabaikan.', 'Objeknya turut dipadam daripada kluster', 'Git pulihkan fail itu', 'Seluruh aplikasi dipadam'],
      why: 'Prune buang apa yang Git tidak senaraikan lagi. Dalam Argo CD, ia tutup secara lalai.',
    },
  },
  {
    id: 'kcna-delivery-012',
    domain: 'delivery',
    answer: 2,
    lesson: 'k8s-k7-l04',
    en: {
      question: 'Self-heal is on. Someone scales the app by hand with kubectl. What happens?',
      options: ['Git is changed to match', 'The app is deleted', 'The GitOps tool puts Git’s version back', 'Nothing until the next release'],
      why: 'A hand change is drift. Self-heal undoes it, so Git stays the truth.',
    },
    ms: {
      question: 'Self-heal hidup. Seseorang scale aplikasi secara manual dengan kubectl. Apa yang berlaku?',
      options: ['Git ditukar supaya sepadan', 'Aplikasi itu dipadam', 'Alat GitOps letak semula versi Git', 'Tiada apa sehingga keluaran seterusnya'],
      why: 'Perubahan manual ialah drift. Self-heal batalkannya, jadi Git kekal sebagai kebenaran.',
    },
  },
  {
    id: 'kcna-delivery-013',
    domain: 'delivery',
    answer: 0,
    lesson: 'k8s-k7-l01',
    en: {
      question: 'Your team uses GitOps. How should you change the number of replicas?',
      options: ['Change the file in Git, through a pull request', 'Run `kubectl scale` on the cluster', 'Edit the pod in a dashboard', 'Ask the agent to forget the app'],
      why: 'Git is the order board. Change the order, and the agent makes it so.',
    },
    ms: {
      question: 'Pasukan anda guna GitOps. Bagaimana anda patut tukar bilangan replica?',
      options: ['Tukar fail dalam Git, melalui pull request', 'Jalankan `kubectl scale` pada kluster', 'Sunting pod dalam dashboard', 'Minta ejen lupakan aplikasi itu'],
      why: 'Git ialah papan pesanan. Tukar pesanan itu, dan ejen akan laksanakannya.',
    },
  },
  {
    id: 'kcna-delivery-014',
    domain: 'delivery',
    answer: 3,
    lesson: 'k8s-k7-l06',
    en: {
      question: 'Staging runs version 1.5 well. How do you promote it to prod with GitOps?',
      options: ['Run `kubectl set image` on prod', 'Rebuild the image for prod', 'Copy the staging pods by hand', 'Open a pull request that changes the prod tag'],
      why: 'A teammate reviews the change. Merging it is the release.',
    },
    ms: {
      question: 'Staging jalankan versi 1.5 dengan baik. Bagaimana anda naikkan ke prod dengan GitOps?',
      options: ['Jalankan `kubectl set image` pada prod', 'Bina semula image untuk prod', 'Salin pod staging secara manual', 'Buka pull request yang tukar tag prod'],
      why: 'Rakan sepasukan semak perubahan itu. Merge pull request itulah keluarannya.',
    },
  },
  {
    id: 'kcna-delivery-015',
    domain: 'delivery',
    answer: 1,
    lesson: 'k8s-k7-l05',
    en: {
      question: 'A new image tag is pushed. How can GitOps pick it up without hand edits?',
      options: ['The registry edits the cluster', 'Image automation writes the new tag to Git', 'The kubelet pulls `latest` every hour', 'Helm guesses the newest tag'],
      why: 'A robot scans the registry, picks a tag by your rule, and commits it. Git stays the truth.',
    },
    ms: {
      question: 'Tag image baharu ditolak. Bagaimana GitOps boleh ambilnya tanpa suntingan manual?',
      options: ['Registry sunting kluster', 'Image automation tulis tag baharu ke Git', 'Kubelet tarik `latest` setiap jam', 'Helm teka tag terbaharu'],
      why: 'Robot imbas registry, pilih tag ikut peraturan anda, dan commit. Git kekal sebagai kebenaran.',
    },
  },
  {
    id: 'kcna-delivery-016',
    domain: 'delivery',
    answer: 2,
    lesson: 'k8s-k7-l07',
    en: {
      question: 'What is progressive delivery?',
      options: ['Shipping every change at midnight', 'Writing tests after the release', 'Moving traffic to a new version step by step, with automatic checks', 'Building images in many stages'],
      why: 'Tools like Argo Rollouts check metrics at each step. Bad numbers roll it back.',
    },
    ms: {
      question: 'Apakah progressive delivery?',
      options: ['Hantar setiap perubahan pada tengah malam', 'Tulis ujian selepas keluaran', 'Alih trafik ke versi baharu langkah demi langkah, dengan semakan automatik', 'Bina image dalam banyak peringkat'],
      why: 'Alat seperti Argo Rollouts semak metrik pada setiap langkah. Nombor buruk akan undurkannya.',
    },
  },
  {
    id: 'kcna-delivery-017',
    domain: 'delivery',
    answer: 0,
    lesson: 'cicd-c3-l01',
    en: {
      question: 'Which release style sends a small share of users to the new version first?',
      options: ['Canary', 'Recreate', 'Blue/green', 'Big bang'],
      why: 'A few users taste it first. If it looks good, the share grows.',
    },
    ms: {
      question: 'Gaya keluaran mana yang hantar sebahagian kecil pengguna ke versi baharu dahulu?',
      options: ['Canary', 'Recreate', 'Blue/green', 'Big bang'],
      why: 'Beberapa pengguna rasa dahulu. Jika nampak baik, bahagiannya bertambah.',
    },
  },
  {
    id: 'kcna-delivery-018',
    domain: 'delivery',
    answer: 3,
    lesson: 'cicd-c3-l01',
    en: {
      question: 'Which release style runs two full versions, then switches all traffic at once?',
      options: ['Canary', 'Rolling update', 'Recreate', 'Blue/green'],
      why: 'Green waits beside blue. One switch moves everyone, and one switch moves them back.',
    },
    ms: {
      question: 'Gaya keluaran mana yang jalankan dua versi penuh, kemudian alih semua trafik sekali gus?',
      options: ['Canary', 'Rolling update', 'Recreate', 'Blue/green'],
      why: 'Green menunggu di sebelah blue. Satu suis alih semua orang, satu suis bawa mereka balik.',
    },
  },
  {
    id: 'kcna-delivery-019',
    domain: 'delivery',
    answer: 1,
    lesson: 'cicd-c3-l02',
    en: {
      question: 'New code is live in production, but users cannot see it yet. What hides it?',
      options: ['A NetworkPolicy', 'A feature flag', 'A readiness probe', 'A Secret'],
      why: 'Deploy is not release. A flag lets you turn the feature on later, or off fast.',
    },
    ms: {
      question: 'Kod baharu sudah live dalam production, tetapi pengguna belum nampak. Apa yang sembunyikannya?',
      options: ['NetworkPolicy', 'Feature flag', 'Readiness probe', 'Secret'],
      why: 'Deploy bukan release. Flag biar anda hidupkan ciri itu kemudian, atau matikannya dengan cepat.',
    },
  },
  {
    id: 'kcna-delivery-020',
    domain: 'delivery',
    answer: 2,
    lesson: 'k8s-k4-l09',
    en: {
      question: 'In Helm, what is a release?',
      options: ['A new version of Helm itself', 'A chart stored in a registry', 'One installed copy of a chart in a cluster, with its own name', 'A Git tag'],
      why: 'Install the same chart twice with two names, and you get two releases.',
    },
    ms: {
      question: 'Dalam Helm, apakah release?',
      options: ['Versi baharu Helm itu sendiri', 'Chart yang disimpan dalam registry', 'Satu salinan chart yang dipasang dalam kluster, dengan nama sendiri', 'Tag Git'],
      why: 'Pasang chart yang sama dua kali dengan dua nama, dan anda dapat dua release.',
    },
  },
  {
    id: 'kcna-delivery-021',
    domain: 'delivery',
    answer: 0,
    lesson: 'k8s-k4-l09',
    en: {
      question: 'A Helm upgrade broke the shop. Which command goes back to revision 1?',
      options: ['`helm rollback shop 1`', '`helm uninstall shop`', '`helm install shop --revision 1`', '`kubectl delete release shop`'],
      why: 'Every upgrade adds a revision. Rollback copies an old one forward as a new revision.',
    },
    ms: {
      question: 'Satu upgrade Helm rosakkan shop. Arahan mana yang kembali ke revision 1?',
      options: ['`helm rollback shop 1`', '`helm uninstall shop`', '`helm install shop --revision 1`', '`kubectl delete release shop`'],
      why: 'Setiap upgrade tambah satu revision. Rollback salin revision lama ke depan sebagai revision baharu.',
    },
  },
  {
    id: 'kcna-delivery-022',
    domain: 'delivery',
    answer: 3,
    lesson: 'k8s-k4-l10',
    en: {
      question: 'How do you change a chart’s settings without editing its templates?',
      options: ['Fork the chart and rewrite it', 'Edit the pods after install', 'Change `Chart.yaml`', 'Give your own values, with `--set` or a values file'],
      why: 'Templates have holes. Values fill them, and your values beat the defaults.',
    },
    ms: {
      question: 'Bagaimana anda tukar tetapan chart tanpa sunting templatnya?',
      options: ['Fork chart itu dan tulis semula', 'Sunting pod selepas dipasang', 'Tukar `Chart.yaml`', 'Beri values sendiri, dengan `--set` atau fail values'],
      why: 'Templat ada lubang. Values mengisinya, dan values anda mengatasi nilai lalai.',
    },
  },
  {
    id: 'kcna-delivery-023',
    domain: 'delivery',
    answer: 1,
    lesson: 'k8s-k4-l08',
    en: {
      question: 'With Kustomize, how do you run one app in dev and prod with small differences?',
      options: ['Copy all YAML into two folders and edit both', 'One base, plus one overlay per environment', 'One Helm chart per environment', 'Two clusters with the same files'],
      why: 'The base holds what is shared. Each overlay patches only what differs.',
    },
    ms: {
      question: 'Dengan Kustomize, bagaimana anda jalankan satu aplikasi dalam dev dan prod dengan sedikit perbezaan?',
      options: ['Salin semua YAML ke dua folder dan sunting kedua-duanya', 'Satu base, serta satu overlay bagi setiap persekitaran', 'Satu chart Helm bagi setiap persekitaran', 'Dua kluster dengan fail yang sama'],
      why: 'Base simpan apa yang dikongsi. Setiap overlay ubah apa yang berbeza sahaja.',
    },
  },
  {
    id: 'kcna-delivery-024',
    domain: 'delivery',
    answer: 2,
    lesson: 'k8s-k4-l08',
    en: {
      question: 'Which command applies the Kustomize overlay in `overlays/prod`?',
      options: ['`kubectl get -k overlays/prod`', '`helm install overlays/prod`', '`kubectl apply -k overlays/prod`', '`kubectl kustomize apply prod`'],
      why: 'Kustomize is built into kubectl. `-k` builds the overlay, then applies it.',
    },
    ms: {
      question: 'Arahan mana yang apply overlay Kustomize dalam `overlays/prod`?',
      options: ['`kubectl get -k overlays/prod`', '`helm install overlays/prod`', '`kubectl apply -k overlays/prod`', '`kubectl kustomize apply prod`'],
      why: 'Kustomize terbina dalam kubectl. `-k` bina overlay itu, kemudian apply.',
    },
  },
  {
    id: 'kcna-delivery-025',
    domain: 'delivery',
    answer: 0,
    lesson: 'k8s-k2-l05',
    en: {
      question: 'Which command waits and tells you when a Deployment’s rollout is done?',
      options: ['`kubectl rollout status deployment/shop`', '`kubectl get events --watch`', '`kubectl rollout undo deployment/shop`', '`kubectl top deployment shop`'],
      why: 'It follows the rollout and exits when every new pod is ready. Pipelines use it too.',
    },
    ms: {
      question: 'Arahan mana yang tunggu dan beritahu bila rollout sebuah Deployment selesai?',
      options: ['`kubectl rollout status deployment/shop`', '`kubectl get events --watch`', '`kubectl rollout undo deployment/shop`', '`kubectl top deployment shop`'],
      why: 'Ia ikut rollout itu dan keluar bila setiap pod baharu sedia. Pipeline juga menggunakannya.',
    },
  },
  {
    id: 'kcna-delivery-026',
    domain: 'delivery',
    answer: 3,
    lesson: 'k8s-k2-l05',
    en: {
      question: 'During a rolling update, the new pods never become ready. What do the old pods do?',
      options: ['They are all deleted at once', 'They restart in a loop', 'They switch to the new image', 'They keep serving, and the rollout stalls'],
      why: 'The rollout waits for ready new pods before it removes more old ones. Then undo it calmly.',
    },
    ms: {
      question: 'Semasa rolling update, pod baharu tidak pernah sedia. Apa yang pod lama buat?',
      options: ['Semuanya dipadam sekali gus', 'Mereka restart berulang kali', 'Mereka tukar ke image baharu', 'Mereka terus melayan, dan rollout itu tersekat'],
      why: 'Rollout tunggu pod baharu sedia sebelum buang lebih banyak pod lama. Kemudian undurkannya dengan tenang.',
    },
  },
  {
    id: 'kcna-delivery-027',
    domain: 'delivery',
    answer: 1,
    lesson: 'cicd-c3-l10',
    en: {
      question: 'Right after a deploy, what quickly checks that the main paths still work?',
      options: ['A unit test from last week', 'A smoke test', 'A code review', 'A load test that runs for days'],
      why: 'A smoke test is a few fast checks on the live app. A fail can trigger a rollback.',
    },
    ms: {
      question: 'Sejurus selepas deploy, apa yang cepat semak laluan utama masih berfungsi?',
      options: ['Unit test dari minggu lepas', 'Smoke test', 'Semakan kod', 'Ujian beban yang berjalan berhari-hari'],
      why: 'Smoke test ialah beberapa semakan pantas pada aplikasi live. Jika gagal, ia boleh cetus rollback.',
    },
  },
  {
    id: 'kcna-delivery-028',
    domain: 'delivery',
    answer: 2,
    lesson: 'cicd-c3-l08',
    en: {
      question: 'How can a pipeline deploy to a cloud without storing a long-lived key?',
      options: ['Paste the key into the workflow file', 'Use the admin’s personal password', 'Use OIDC to swap for a short-lived token', 'Turn off login on the cloud account'],
      why: 'The cloud trusts the pipeline’s identity token. The access it gets expires soon.',
    },
    ms: {
      question: 'Bagaimana pipeline boleh deploy ke cloud tanpa simpan kunci jangka panjang?',
      options: ['Tampal kunci itu dalam fail workflow', 'Guna kata laluan peribadi admin', 'Guna OIDC untuk tukar kepada token jangka pendek', 'Matikan log masuk pada akaun cloud'],
      why: 'Cloud percaya token identiti pipeline itu. Akses yang ia dapat cepat tamat.',
    },
  },

  // ---------------------------------------------------------------- Cloud Native Architecture
  {
    id: 'kcna-architecture-001',
    domain: 'architecture',
    answer: 3,
    lesson: 'k8s-k5-l09',
    en: {
      question: 'Checkout is slow. You want each step of one order, with its time. What do you need?',
      options: ['A CPU metric', 'A ConfigMap', 'A bigger node', 'A trace'],
      why: 'A trace follows one request across services. It times every hop.',
    },
    ms: {
      question: 'Checkout lambat. Anda mahu setiap langkah satu pesanan, dengan masanya. Apa yang anda perlu?',
      options: ['Metrik CPU', 'ConfigMap', 'Node yang lebih besar', 'Trace'],
      why: 'Trace ikut satu permintaan merentas servis. Ia ukur masa setiap langkah.',
    },
  },
  {
    id: 'kcna-architecture-002',
    domain: 'architecture',
    answer: 0,
    lesson: 'k8s-k8-l06',
    en: {
      question: 'You found a good first issue in a Kubernetes repo. How do you claim it?',
      options: ['Comment `/assign` on the issue', 'Open a big PR without asking', 'Email a maintainer in private', 'Fork the repo and wait'],
      why: 'A bot reads `/assign` and gives you the issue. Everyone can see who is on it.',
    },
    ms: {
      question: 'Anda jumpa good first issue dalam repo Kubernetes. Macam mana nak ambilnya?',
      options: ['Komen `/assign` pada issue itu', 'Buka PR besar tanpa bertanya', 'E-mel maintainer secara peribadi', 'Fork repo itu dan tunggu'],
      why: 'Bot baca `/assign` dan beri issue itu kepada anda. Semua orang nampak siapa yang ambil.',
    },
  },
  {
    id: 'kcna-architecture-003',
    domain: 'architecture',
    answer: 2,
    lesson: 'k8s-k1-l03',
    en: {
      question: 'A tiny site has one container and few visitors. Is Kubernetes the best fit?',
      options: ['Yes, every app needs Kubernetes', 'Yes, it makes any site faster', 'Probably not. A simpler host is enough', 'Only if the site uses YAML'],
      why: 'Kubernetes shines with many containers. For one small site, the upkeep costs more than it gives.',
    },
    ms: {
      question: 'Laman kecil ada satu container dan sedikit pelawat. Adakah Kubernetes paling sesuai?',
      options: ['Ya, setiap aplikasi perlukan Kubernetes', 'Ya, ia buat mana-mana laman lebih laju', 'Mungkin tidak. Hos yang lebih ringkas sudah cukup', 'Hanya jika laman itu guna YAML'],
      why: 'Kubernetes hebat untuk banyak container. Untuk satu laman kecil, kos jaganya lebih besar daripada faedahnya.',
    },
  },
  {
    id: 'kcna-architecture-004',
    domain: 'architecture',
    answer: 1,
    lesson: 'k8s-k5-l02',
    en: {
      question: 'Lunch rush doubles the traffic. Which object adds pods when CPU use climbs?',
      options: ['VerticalPodAutoscaler', 'HorizontalPodAutoscaler', 'PodDisruptionBudget', 'ResourceQuota'],
      why: 'The HPA changes the replica count. Scaling out means more copies, not bigger ones.',
    },
    ms: {
      question: 'Waktu makan tengah hari, trafik berganda. Objek mana yang tambah pod bila penggunaan CPU naik?',
      options: ['VerticalPodAutoscaler', 'HorizontalPodAutoscaler', 'PodDisruptionBudget', 'ResourceQuota'],
      why: 'HPA tukar bilangan replica. Scale out bermaksud lebih banyak salinan, bukan salinan lebih besar.',
    },
  },
  {
    id: 'kcna-architecture-005',
    domain: 'architecture',
    answer: 3,
    lesson: 'k8s-k5-l02',
    en: {
      question: 'An HPA shows `cpu: <unknown>/50%`. What is the usual cause?',
      options: ['The Deployment has too many pods', 'The HPA is paused', 'The node is too big', 'The pods have no CPU request'],
      why: 'The target is a share of the request. With no request, there is nothing to compare.',
    },
    ms: {
      question: 'HPA tunjuk `cpu: <unknown>/50%`. Apakah punca biasa?',
      options: ['Deployment itu ada terlalu banyak pod', 'HPA itu dijeda', 'Node itu terlalu besar', 'Pod itu tiada request CPU'],
      why: 'Sasaran itu ialah peratus daripada request. Tanpa request, tiada apa untuk dibandingkan.',
    },
  },
  {
    id: 'kcna-architecture-006',
    domain: 'architecture',
    answer: 0,
    lesson: 'k8s-k5-l03',
    en: {
      question: 'A database needs more memory, not more copies. Which helper fits?',
      options: ['VerticalPodAutoscaler', 'HorizontalPodAutoscaler', 'A DaemonSet', 'A bigger Service'],
      why: 'A VPA changes a pod’s requests. It is an add-on, not built in.',
    },
    ms: {
      question: 'Pangkalan data perlukan lebih memori, bukan lebih banyak salinan. Pembantu mana yang sesuai?',
      options: ['VerticalPodAutoscaler', 'HorizontalPodAutoscaler', 'DaemonSet', 'Service yang lebih besar'],
      why: 'VPA tukar request sebuah pod. Ia add-on, bukan terbina dalam.',
    },
  },
  {
    id: 'kcna-architecture-007',
    domain: 'architecture',
    answer: 2,
    lesson: 'k8s-k5-l03',
    en: {
      question: 'Pods stay `Pending` because no node has room. What can add a node by itself?',
      options: ['The kubelet', 'A ResourceQuota', 'A node autoscaler, like Cluster Autoscaler or Karpenter', 'kube-proxy'],
      why: 'It watches for pods that cannot be scheduled. It plans by their requests.',
    },
    ms: {
      question: 'Pod kekal `Pending` kerana tiada node yang ada ruang. Apa yang boleh tambah node sendiri?',
      options: ['Kubelet', 'ResourceQuota', 'Node autoscaler, seperti Cluster Autoscaler atau Karpenter', 'kube-proxy'],
      why: 'Ia perhati pod yang tak dapat dijadualkan. Ia merancang ikut request pod itu.',
    },
  },
  {
    id: 'kcna-architecture-008',
    domain: 'architecture',
    answer: 1,
    lesson: 'k8s-k5-l01',
    en: {
      question: '`kubectl top pods` says metrics are not available. What is missing?',
      options: ['Prometheus', 'metrics-server', 'Grafana', 'A Gateway'],
      why: 'metrics-server reads live CPU and memory. Autoscalers and `kubectl top` use it.',
    },
    ms: {
      question: '`kubectl top pods` kata metrik tidak tersedia. Apa yang tiada?',
      options: ['Prometheus', 'metrics-server', 'Grafana', 'Gateway'],
      why: 'metrics-server baca CPU dan memori semasa. Autoscaler dan `kubectl top` menggunakannya.',
    },
  },
  {
    id: 'kcna-architecture-009',
    domain: 'architecture',
    answer: 3,
    lesson: 'k8s-k5-l02',
    en: {
      question: 'What is a core idea of serverless computing?',
      options: ['You must manage every server yourself', 'Apps run all day, even with no users', 'Containers are not allowed', 'You run code without managing servers, and it can scale to zero'],
      why: 'The platform starts copies when requests come. With no traffic, you may pay nothing.',
    },
    ms: {
      question: 'Apakah idea teras pengkomputeran serverless?',
      options: ['Anda mesti urus setiap pelayan sendiri', 'Aplikasi berjalan sepanjang hari, walaupun tiada pengguna', 'Container tidak dibenarkan', 'Anda jalankan kod tanpa urus pelayan, dan ia boleh scale ke sifar'],
      why: 'Platform mulakan salinan bila permintaan tiba. Tanpa trafik, anda mungkin tidak bayar apa-apa.',
    },
  },
  {
    id: 'kcna-architecture-010',
    domain: 'architecture',
    answer: 0,
    lesson: 'k8s-k5-l03',
    en: {
      question: 'Which CNCF project scales workloads by events, like the length of a queue?',
      options: ['KEDA', 'etcd', 'CoreDNS', 'Helm'],
      why: 'KEDA feeds event counts to the autoscaler. It can also scale to zero when idle.',
    },
    ms: {
      question: 'Projek CNCF mana yang scale beban kerja ikut event, seperti panjang barisan?',
      options: ['KEDA', 'etcd', 'CoreDNS', 'Helm'],
      why: 'KEDA salurkan kiraan event kepada autoscaler. Ia juga boleh scale ke sifar bila tiada kerja.',
    },
  },
  {
    id: 'kcna-architecture-011',
    domain: 'architecture',
    answer: 2,
    lesson: 'k8s-k7-l02',
    en: {
      question: 'CNCF projects move through maturity levels. Which list is in order?',
      options: ['Alpha, beta, stable', 'Bronze, silver, gold', 'Sandbox, incubating, graduated', 'Draft, review, final'],
      why: 'Graduated is the top level. Argo CD and Flux are both graduated projects.',
    },
    ms: {
      question: 'Projek CNCF melalui tahap kematangan. Senarai mana yang mengikut turutan?',
      options: ['Alpha, beta, stable', 'Gangsa, perak, emas', 'Sandbox, incubating, graduated', 'Draf, semakan, akhir'],
      why: 'Graduated ialah tahap tertinggi. Argo CD dan Flux kedua-duanya projek graduated.',
    },
  },
  {
    id: 'kcna-architecture-012',
    domain: 'architecture',
    answer: 1,
    lesson: 'docker-d6-l05',
    en: {
      question: 'In 2017, containerd joined the CNCF. What did that change?',
      options: ['It became closed source', 'A neutral foundation holds it, so many companies can shape it', 'It now only works with Docker', 'It started to cost money'],
      why: 'No single vendor owns it. That neutral home helps users and builders trust it.',
    },
    ms: {
      question: 'Pada 2017, containerd sertai CNCF. Apa yang berubah?',
      options: ['Ia jadi sumber tertutup', 'Yayasan neutral memegangnya, jadi banyak syarikat boleh membentuknya', 'Kini ia hanya berfungsi dengan Docker', 'Ia mula berbayar'],
      why: 'Tiada satu vendor yang memilikinya. Rumah neutral itu bantu pengguna dan pembina mempercayainya.',
    },
  },
  {
    id: 'kcna-architecture-013',
    domain: 'architecture',
    answer: 3,
    lesson: 'docker-d6-l05',
    en: {
      question: 'What does the Open Container Initiative (OCI) write?',
      options: ['The Kubernetes scheduler', 'A cloud price list', 'Helm charts', 'Open standards for container images and runtimes'],
      why: 'Think of standard tray sizes. Any tool that follows them can run the same image.',
    },
    ms: {
      question: 'Apakah yang Open Container Initiative (OCI) tulis?',
      options: ['Scheduler Kubernetes', 'Senarai harga cloud', 'Chart Helm', 'Standard terbuka untuk container image dan runtime'],
      why: 'Fikirkan saiz dulang standard. Mana-mana alat yang mengikutinya boleh jalankan image yang sama.',
    },
  },
  {
    id: 'kcna-architecture-014',
    domain: 'architecture',
    answer: 0,
    lesson: 'k8s-k3-l11',
    en: {
      question: 'Why does Kubernetes rely on the CNI standard for pod networking?',
      options: ['So any network plugin that follows it can be swapped in', 'So pods need no IP addresses', 'So Services become optional', 'So etcd can route packets'],
      why: 'Calico, Cilium and others fit the same plug. You choose by the features you need.',
    },
    ms: {
      question: 'Kenapa Kubernetes bergantung pada standard CNI untuk rangkaian pod?',
      options: ['Supaya mana-mana plugin rangkaian yang mengikutinya boleh ditukar masuk', 'Supaya pod tak perlukan alamat IP', 'Supaya Service jadi pilihan sahaja', 'Supaya etcd boleh halakan paket'],
      why: 'Calico, Cilium dan lain-lain muat pada palam yang sama. Anda pilih ikut ciri yang anda perlukan.',
    },
  },
  {
    id: 'kcna-architecture-015',
    domain: 'architecture',
    answer: 2,
    lesson: 'k8s-k4-l06',
    en: {
      question: 'Storage vendors write drivers that live outside Kubernetes’ own code. Which standard do they follow?',
      options: ['CNI', 'CRI', 'CSI', 'OCI'],
      why: 'CSI is the Container Storage Interface. A StorageClass then names the driver as its provisioner.',
    },
    ms: {
      question: 'Vendor storan tulis driver yang berada di luar kod Kubernetes sendiri. Standard mana yang mereka ikut?',
      options: ['CNI', 'CRI', 'CSI', 'OCI'],
      why: 'CSI ialah Container Storage Interface. StorageClass kemudian namakan driver itu sebagai provisioner-nya.',
    },
  },
  {
    id: 'kcna-architecture-016',
    domain: 'architecture',
    answer: 1,
    lesson: 'k8s-k7-l07',
    en: {
      question: 'What was the Service Mesh Interface (SMI) for?',
      options: ['Building container images', 'One shared Kubernetes API for common service mesh features', 'Storing Secrets in Git', 'Scheduling pods on GPUs'],
      why: 'Features like traffic splits worked the same across meshes. That work now continues in Gateway API.',
    },
    ms: {
      question: 'Untuk apakah Service Mesh Interface (SMI)?',
      options: ['Bina container image', 'Satu API Kubernetes yang dikongsi untuk ciri biasa service mesh', 'Simpan Secret dalam Git', 'Jadualkan pod pada GPU'],
      why: 'Ciri seperti traffic split berfungsi sama merentas mesh. Kerja itu kini diteruskan dalam Gateway API.',
    },
  },
  {
    id: 'kcna-architecture-017',
    domain: 'architecture',
    answer: 3,
    lesson: 'k8s-k5-l09',
    en: {
      question: 'How does Prometheus usually collect metrics from an app?',
      options: ['The app emails them daily', 'It reads etcd', 'It parses the app’s logs', 'It scrapes the app’s `/metrics` page on a timer'],
      why: 'Prometheus pulls. It stores each number with its time, so you can look back later.',
    },
    ms: {
      question: 'Bagaimana Prometheus biasanya kumpul metrik daripada aplikasi?',
      options: ['Aplikasi e-mel setiap hari', 'Ia baca etcd', 'Ia hurai log aplikasi', 'Ia scrape halaman `/metrics` aplikasi ikut pemasa'],
      why: 'Prometheus tarik sendiri. Ia simpan setiap nombor dengan masanya, jadi anda boleh lihat semula nanti.',
    },
  },
  {
    id: 'kcna-architecture-018',
    domain: 'architecture',
    answer: 0,
    lesson: 'k8s-k5-l09',
    en: {
      question: 'What is OpenTelemetry?',
      options: ['One vendor-neutral way to collect traces, metrics and logs', 'A dashboard tool', 'A container runtime', 'A GitOps agent'],
      why: 'Add it to your app once. Then send the data to whichever tool you choose.',
    },
    ms: {
      question: 'Apakah OpenTelemetry?',
      options: ['Satu cara neutral vendor untuk kumpul trace, metrik dan log', 'Alat dashboard', 'Container runtime', 'Ejen GitOps'],
      why: 'Tambah ke aplikasi anda sekali. Kemudian hantar data itu ke mana-mana alat pilihan anda.',
    },
  },
  {
    id: 'kcna-architecture-019',
    domain: 'architecture',
    answer: 2,
    lesson: 'k8s-k5-l08',
    en: {
      question: 'Where should a containerised app write its logs?',
      options: ['To a file inside the image', 'To etcd', 'To stdout and stderr', 'Nowhere. Logs slow apps down.'],
      why: 'The runtime keeps what the container prints. `kubectl logs` reads it, and agents can ship it.',
    },
    ms: {
      question: 'Ke mana aplikasi dalam container patut tulis log-nya?',
      options: ['Ke fail dalam image', 'Ke etcd', 'Ke stdout dan stderr', 'Tiada. Log perlahankan aplikasi.'],
      why: 'Runtime simpan apa yang container cetak. `kubectl logs` membacanya, dan ejen boleh menghantarnya.',
    },
  },
  {
    id: 'kcna-architecture-020',
    domain: 'architecture',
    answer: 1,
    lesson: 'k8s-k8-l01',
    en: {
      question: 'Who keeps the live service up, answers the 3 a.m. alert, and stops repeats?',
      options: ['A UX designer', 'A site reliability engineer (SRE)', 'A sales engineer', 'A database vendor'],
      why: 'SREs fix fast, write a review with no blame, then automate so it never repeats.',
    },
    ms: {
      question: 'Siapa jaga servis live, jawab amaran pukul 3 pagi, dan elak ia berulang?',
      options: ['Pereka UX', 'Site reliability engineer (SRE)', 'Jurutera jualan', 'Vendor pangkalan data'],
      why: 'SRE baiki dengan cepat, tulis semakan tanpa salahkan sesiapa, kemudian automasikan pembaikan.',
    },
  },
  {
    id: 'kcna-architecture-021',
    domain: 'architecture',
    answer: 3,
    lesson: 'k8s-k7-l09',
    en: {
      question: 'Ten teams each set up pipelines alone. Who builds them one self-service golden path?',
      options: ['A network technician', 'A data analyst', 'A help desk agent', 'A platform engineer'],
      why: 'The platform team builds the paved road once. Every team walks it in minutes.',
    },
    ms: {
      question: 'Sepuluh pasukan masing-masing sediakan pipeline sendiri. Siapa yang bina satu golden path layan diri untuk mereka?',
      options: ['Juruteknik rangkaian', 'Penganalisis data', 'Ejen meja bantuan', 'Platform engineer'],
      why: 'Pasukan platform bina jalan berturap sekali. Setiap pasukan melaluinya dalam beberapa minit.',
    },
  },
  {
    id: 'kcna-architecture-022',
    domain: 'architecture',
    answer: 0,
    lesson: 'k8s-k8-l07',
    en: {
      question: 'About how many Kubernetes minor releases come out each year?',
      options: ['About three', 'About twelve', 'One every five years', 'A new one every week'],
      why: 'Read the release blog for removals. You do not need to upgrade on day one.',
    },
    ms: {
      question: 'Kira-kira berapa banyak keluaran minor Kubernetes setiap tahun?',
      options: ['Kira-kira tiga', 'Kira-kira dua belas', 'Satu setiap lima tahun', 'Satu yang baharu setiap minggu'],
      why: 'Baca blog keluaran untuk perkara yang dibuang. Anda tidak perlu naik taraf pada hari pertama.',
    },
  },
];
