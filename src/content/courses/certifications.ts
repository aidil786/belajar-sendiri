// Certification map (docs/SHIP-IT-PLAN.md §12, docs/LEVEL-UP-PLAN.md §4): real exams, and the worlds
// that help with each. Ship It: KCNA, CKAD, GH-200, CKA (with the K9 pack), CKS. Level Up: LFCS,
// Prometheus Certified Associate, Terraform Associate (OpenTofu has no exam), AWS Cloud Practitioner
// and AWS Solutions Architect – Associate. Facts checked on 2026-11-01 on the official pages linked below
// (training.linuxfoundation.org, developer.hashicorp.com, aws.amazon.com, learn.microsoft.com).
// FahamLah is not affiliated with any exam. No logos. Prices change: the page says so.
// Shown at /<lang>/ship-it/certifications/. UI words live in i18n (`certs.*`).
import type { Bilingual } from '~/i18n';

/** A world in one of the courses (world id, not the code: K1 = kubernetes 1, Git World 7 = git 7). */
export interface CertWorld {
  course: 'git' | 'docker' | 'cicd' | 'kubernetes' | 'linux' | 'iac' | 'observability' | 'aws';
  world: number;
}

export interface Certification {
  id: 'kcna' | 'ckad' | 'gh-200' | 'cka' | 'cks' | 'lfcs' | 'pca' | 'terraform-associate' | 'aws-clf' | 'aws-saa';
  /** The family whose section lists it on the page. */
  family: 'ship-it' | 'level-up';
  /** Short name, the same in both languages. */
  code: string;
  /** The exam's own name (a product name, not translated). */
  name: string;
  /** Who runs it (a proper noun). */
  org: string;
  /** The official page. */
  url: string;
  format: Bilingual;
  /** USD before local taxes (70.5 shows as "USD 70.50"), or 'varies' when it depends on the country. */
  price: number | 'varies';
  /** Worlds whose lessons help with this exam. */
  covers: CertWorld[];
  /** What else it needs that the worlds above don't fully cover. */
  extra?: Bilingual;
  /** An exam you must hold first. */
  needs?: Bilingual;
  takeWhen: Bilingual;
  /** Our practice page for this exam, under /<lang>/ship-it/ (e.g. 'exam/kcna/'). */
  practice?: string;
}

/** When these facts were last checked (shown on the page). */
export const CERTS_CHECKED = '2026-11-01';

const k8s = (...ids: number[]): CertWorld[] => ids.map((world) => ({ course: 'kubernetes', world }));
const worldsOf = (course: CertWorld['course'], ...ids: number[]): CertWorld[] => ids.map((world) => ({ course, world }));

export const certifications: Certification[] = [
  {
    id: 'kcna',
    family: 'ship-it',
    code: 'KCNA',
    name: 'Kubernetes and Cloud Native Associate',
    org: 'The Linux Foundation',
    url: 'https://training.linuxfoundation.org/certification/kubernetes-cloud-native-associate/',
    format: {
      en: '90 minutes of multiple choice, online. One retake is included. It stays valid for 2 years.',
      ms: '90 minit soalan pilihan berganda, dalam talian. Termasuk satu cubaan semula. Sah selama 2 tahun.',
    },
    price: 250,
    covers: [{ course: 'docker', world: 6 }, ...k8s(1, 2, 3, 4, 5, 6, 7)],
    extra: {
      en: 'It asks about ideas, not hands-on tasks.',
      ms: 'Ia tanya tentang konsep, bukan tugasan praktikal.',
    },
    takeWhen: { en: 'After K4, as a confidence step.', ms: 'Selepas K4, sebagai langkah untuk yakin diri.' },
    practice: 'exam/kcna/',
  },
  {
    id: 'ckad',
    family: 'ship-it',
    code: 'CKAD',
    name: 'Certified Kubernetes Application Developer',
    org: 'The Linux Foundation',
    url: 'https://training.linuxfoundation.org/certification/certified-kubernetes-application-developer-ckad/',
    format: {
      en: '2 hours of hands-on tasks in a live cluster (Kubernetes 1.37). One retake and two practice simulator sessions are included.',
      ms: '2 jam tugasan praktikal dalam kluster sebenar (Kubernetes 1.37). Termasuk satu cubaan semula dan dua sesi simulator latihan.',
    },
    price: 445,
    covers: [{ course: 'docker', world: 2 }, ...k8s(1, 2, 3, 4, 5, 6)],
    extra: { en: 'Helm and Kustomize are in K4.', ms: 'Helm dan Kustomize ada dalam K4.' },
    takeWhen: { en: 'After capstone mission 5.', ms: 'Selepas misi capstone 5.' },
    practice: 'exam/ckad/',
  },
  {
    id: 'gh-200',
    family: 'ship-it',
    code: 'GH-200',
    name: 'GitHub Actions',
    org: 'Microsoft Learn',
    url: 'https://learn.microsoft.com/en-us/credentials/certifications/github-actions/',
    format: {
      en: 'A 100-minute exam with a proctor, through Pearson VUE. It stays valid for 2 years.',
      ms: 'Peperiksaan 100 minit dengan pengawas, melalui Pearson VUE. Sah selama 2 tahun.',
    },
    price: 'varies',
    covers: [{ course: 'git', world: 7 }, ...[1, 2, 3, 4].map((world) => ({ course: 'cicd' as const, world }))],
    takeWhen: { en: 'After C4.', ms: 'Selepas C4.' },
  },
  {
    id: 'cka',
    family: 'ship-it',
    code: 'CKA',
    name: 'Certified Kubernetes Administrator',
    org: 'The Linux Foundation',
    url: 'https://training.linuxfoundation.org/certification/certified-kubernetes-administrator-cka/',
    format: {
      en: '2 hours of hands-on tasks: you run and fix a live cluster (Kubernetes 1.37). One retake and two practice simulator sessions are included.',
      ms: '2 jam tugasan praktikal: anda urus dan baiki kluster sebenar (Kubernetes 1.37). Termasuk satu cubaan semula dan dua sesi simulator latihan.',
    },
    price: 445,
    covers: k8s(9, 1, 2, 3, 4, 5, 6),
    extra: {
      en: 'It also asks about kubeadm, upgrades, etcd backups and broken nodes. The K9 extra pack teaches those.',
      ms: 'Ia juga tanya tentang kubeadm, naik taraf, sandaran etcd dan node rosak. Pek tambahan K9 ajar topik itu.',
    },
    takeWhen: { en: 'After K9, with a few months of practice.', ms: 'Selepas K9, dengan beberapa bulan latihan.' },
  },
  {
    id: 'cks',
    family: 'ship-it',
    code: 'CKS',
    name: 'Certified Kubernetes Security Specialist',
    org: 'The Linux Foundation',
    url: 'https://training.linuxfoundation.org/certification/certified-kubernetes-security-specialist/',
    format: { en: 'Hands-on Kubernetes security tasks.', ms: 'Tugasan praktikal keselamatan Kubernetes.' },
    price: 445,
    covers: [{ course: 'docker', world: 5 }, { course: 'cicd', world: 4 }, ...k8s(6)],
    extra: { en: 'It goes deeper than this course.', ms: 'Ia lebih mendalam daripada kursus ini.' },
    needs: { en: 'You need a valid CKA first.', ms: 'Anda perlu CKA yang masih sah dahulu.' },
    takeWhen: { en: 'After CKA.', ms: 'Selepas CKA.' },
  },
  // --- Level Up (docs/LEVEL-UP-PLAN.md §4) ---
  {
    id: 'lfcs',
    family: 'level-up',
    code: 'LFCS',
    name: 'Linux Foundation Certified System Administrator',
    org: 'The Linux Foundation',
    url: 'https://training.linuxfoundation.org/certification/linux-foundation-certified-sysadmin-lfcs/',
    format: {
      en: '2 hours of hands-on tasks on a live Linux machine, online. One retake and two practice simulator sessions are included.',
      ms: '2 jam tugasan praktikal pada mesin Linux sebenar, dalam talian. Termasuk satu cubaan semula dan dua sesi simulator latihan.',
    },
    price: 445,
    covers: worldsOf('linux', 1, 2, 3, 4),
    extra: {
      en: 'Storage is a fifth of the exam: disks, mounts and LVM. This course only touches it.',
      ms: 'Storan ialah satu perlima peperiksaan: cakera, mount dan LVM. Kursus ini hanya sentuh sedikit.',
    },
    takeWhen: { en: 'After L4 and capstone mission 7.', ms: 'Selepas L4 dan misi capstone 7.' },
  },
  {
    id: 'pca',
    family: 'level-up',
    code: 'PCA',
    name: 'Prometheus Certified Associate',
    org: 'The Linux Foundation',
    url: 'https://training.linuxfoundation.org/certification/prometheus-certified-associate/',
    format: {
      en: '90 minutes of multiple choice, online. One retake is included. It stays valid for 2 years.',
      ms: '90 minit soalan pilihan berganda, dalam talian. Termasuk satu cubaan semula. Sah selama 2 tahun.',
    },
    price: 250,
    covers: worldsOf('observability', 1, 2, 3),
    extra: {
      en: 'It also asks how to add metrics to your own code. Read the official client library docs too.',
      ms: 'Ia juga tanya cara tambah metrik dalam kod anda sendiri. Baca juga dokumen rasmi client library.',
    },
    takeWhen: { en: 'After O3.', ms: 'Selepas O3.' },
  },
  {
    id: 'terraform-associate',
    family: 'level-up',
    code: 'Terraform',
    name: 'HashiCorp Certified: Terraform Associate (004)',
    org: 'HashiCorp',
    url: 'https://developer.hashicorp.com/certifications/terraform-associate',
    format: {
      en: 'A 1-hour multiple-choice exam, online with a proctor. It tests Terraform 1.12. No free retake.',
      ms: 'Peperiksaan pilihan berganda 1 jam, dalam talian dengan pengawas. Ia uji Terraform 1.12. Tiada cubaan semula percuma.',
    },
    price: 70.5,
    covers: worldsOf('iac', 1, 2, 3, 4),
    extra: {
      en: 'OpenTofu has no official exam. This one uses Terraform, the same language. It also asks about HCP Terraform, the paid online service.',
      ms: 'OpenTofu tiada peperiksaan rasmi. Yang ini guna Terraform, bahasa yang sama. Ia juga tanya tentang HCP Terraform, servis dalam talian berbayar.',
    },
    takeWhen: { en: 'After T4 and capstone mission 8.', ms: 'Selepas T4 dan misi capstone 8.' },
  },
  {
    id: 'aws-clf',
    family: 'level-up',
    code: 'CLF-C02',
    name: 'AWS Certified Cloud Practitioner',
    org: 'Amazon Web Services',
    url: 'https://aws.amazon.com/certification/certified-cloud-practitioner/',
    format: {
      en: '90 minutes, 65 multiple-choice questions. Take it at a test centre or online. It stays valid for 3 years.',
      ms: '90 minit, 65 soalan pilihan berganda. Ambil di pusat ujian atau dalam talian. Sah selama 3 tahun.',
    },
    price: 100,
    covers: worldsOf('aws', 1, 2, 3, 4),
    extra: { en: 'It asks about ideas and prices, not hands-on tasks.', ms: 'Ia tanya tentang konsep dan harga, bukan tugasan praktikal.' },
    takeWhen: { en: 'After A2, as a first cloud step.', ms: 'Selepas A2, sebagai langkah pertama cloud.' },
  },
  {
    id: 'aws-saa',
    family: 'level-up',
    code: 'SAA-C03',
    name: 'AWS Certified Solutions Architect – Associate',
    org: 'Amazon Web Services',
    url: 'https://aws.amazon.com/certification/certified-solutions-architect-associate/',
    format: {
      en: '130 minutes, 65 multiple-choice questions. Take it at a test centre or online. It stays valid for 3 years.',
      ms: '130 minit, 65 soalan pilihan berganda. Ambil di pusat ujian atau dalam talian. Sah selama 3 tahun.',
    },
    price: 150,
    covers: [...worldsOf('aws', 1, 2, 3, 4), ...worldsOf('linux', 3)],
    extra: {
      en: 'It goes deeper than this course. AWS suggests a year of hands-on work first.',
      ms: 'Ia lebih mendalam daripada kursus ini. AWS cadangkan setahun pengalaman praktikal dahulu.',
    },
    takeWhen: { en: 'After capstone mission 10, with real practice.', ms: 'Selepas misi capstone 10, dengan latihan sebenar.' },
  },
];
