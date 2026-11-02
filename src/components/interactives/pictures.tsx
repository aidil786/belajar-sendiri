// Original, simplified illustrations for Hotspots. No real screenshots, no logos.
// Coordinates in lessons are percentages of this 400 × 250 picture.
//
// "vscode": an editor with a Source Control panel. Useful spot positions:
//   activity bar source control icon (4, 30) · commit message box (13, 16)
//   commit button (31, 25) · "Staged Changes" list (22, 42) · "Changes" list (22, 61)
//   diff editor (66, 45) · branch name in the status bar (10, 96)
import './branch-lab.css';

export function VSCodePicture() {
  return (
    <svg viewBox="0 0 400 250" className="picture" aria-hidden="true">
      <rect x="0" y="0" width="400" height="250" rx="10" className="pic-frame" />
      {/* activity bar */}
      <rect x="0" y="0" width="28" height="238" className="pic-bar" />
      <rect x="7" y="20" width="14" height="14" rx="3" className="pic-icon" />
      <circle cx="14" cy="50" r="7" className="pic-icon" />
      <g transform="translate(14 75)" className="pic-icon-active">
        <circle cx="-4" cy="-6" r="3" />
        <circle cx="-4" cy="7" r="3" />
        <circle cx="5" cy="-2" r="3" />
        <path d="M-4 -3v7M5 1c0 3-6 3-9 3" fill="none" />
      </g>
      <rect x="7" y="96" width="14" height="14" rx="3" className="pic-icon" />
      {/* side panel */}
      <rect x="28" y="0" width="122" height="238" className="pic-panel" />
      <text x="36" y="18" className="pic-title">SOURCE CONTROL</text>
      <rect x="36" y="28" width="104" height="22" rx="4" className="pic-input" />
      <text x="42" y="43" className="pic-hint">Message</text>
      <rect x="36" y="54" width="104" height="18" rx="4" className="pic-button" />
      <text x="88" y="66.5" className="pic-button-text" textAnchor="middle">✓ Commit</text>
      <text x="36" y="92" className="pic-section">▾ Staged Changes</text>
      <rect x="36" y="98" width="104" height="14" rx="3" className="pic-row" />
      <text x="42" y="108.5" className="pic-file">index.html</text>
      <text x="130" y="108.5" className="pic-mark-a" textAnchor="end">A</text>
      <text x="36" y="134" className="pic-section">▾ Changes</text>
      <rect x="36" y="140" width="104" height="14" rx="3" className="pic-row" />
      <text x="42" y="150.5" className="pic-file">style.css</text>
      <text x="130" y="150.5" className="pic-mark-m" textAnchor="end">M</text>
      <rect x="36" y="156" width="104" height="14" rx="3" className="pic-row" />
      <text x="42" y="166.5" className="pic-file">about.html</text>
      <text x="130" y="166.5" className="pic-mark-u" textAnchor="end">U</text>
      {/* editor with a diff */}
      <rect x="150" y="0" width="250" height="238" className="pic-editor" />
      <rect x="150" y="0" width="110" height="16" className="pic-tab" />
      <text x="158" y="11.5" className="pic-file">index.html ↔</text>
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <rect key={i} x="164" y={34 + i * 18} width={[150, 110, 170, 90, 140, 120, 160, 80][i]} height="8" rx="3" className={i === 2 ? 'pic-del' : i === 3 || i === 4 ? 'pic-add' : 'pic-code'} />
      ))}
      {/* status bar */}
      <rect x="0" y="238" width="400" height="12" className="pic-status" />
      <text x="8" y="247.5" className="pic-status-text">⑂ main</text>
    </svg>
  );
}

// "vscode-merge": the same editor during a merge conflict (World 3). Useful spot positions:
//   buttons above the conflict (46, 22) · current change, HEAD (84, 30) · incoming change (84, 45)
//   "Resolve in Merge Editor" button (86, 88) · "Merge Changes" list in Source Control (21, 42)
export function VSCodeMergePicture() {
  return (
    <svg viewBox="0 0 400 250" className="picture" aria-hidden="true">
      <rect x="0" y="0" width="400" height="250" rx="10" className="pic-frame" />
      <rect x="0" y="0" width="28" height="238" className="pic-bar" />
      <rect x="7" y="20" width="14" height="14" rx="3" className="pic-icon" />
      <circle cx="14" cy="50" r="7" className="pic-icon" />
      <g transform="translate(14 75)" className="pic-icon-active">
        <circle cx="-4" cy="-6" r="3" />
        <circle cx="-4" cy="7" r="3" />
        <circle cx="5" cy="-2" r="3" />
        <path d="M-4 -3v7M5 1c0 3-6 3-9 3" fill="none" />
      </g>
      {/* side panel */}
      <rect x="28" y="0" width="122" height="238" className="pic-panel" />
      <text x="36" y="18" className="pic-title">SOURCE CONTROL</text>
      <rect x="36" y="28" width="104" height="22" rx="4" className="pic-input" />
      <text x="42" y="43" className="pic-hint">Message</text>
      <rect x="36" y="54" width="104" height="18" rx="4" className="pic-button" />
      <text x="88" y="66.5" className="pic-button-text" textAnchor="middle">✓ Commit</text>
      <text x="36" y="92" className="pic-section">▾ Merge Changes</text>
      <rect x="36" y="98" width="104" height="14" rx="3" className="pic-row pic-conflict-row" />
      <text x="42" y="108.5" className="pic-file">index.html</text>
      <text x="122" y="108.5" className="pic-plus" textAnchor="middle">+</text>
      <text x="132" y="108.5" className="pic-mark-c" textAnchor="middle">!</text>
      <text x="36" y="134" className="pic-section">▾ Changes</text>
      {/* editor */}
      <rect x="150" y="0" width="250" height="238" className="pic-editor" />
      <rect x="150" y="0" width="80" height="16" className="pic-tab" />
      <text x="158" y="11.5" className="pic-file">index.html !</text>
      <rect x="164" y="26" width="110" height="8" rx="3" className="pic-code" />
      <rect x="164" y="40" width="150" height="8" rx="3" className="pic-code" />
      <text x="158" y="58" className="pic-lens">Accept Current Change | Accept Incoming Change | Accept Both Changes</text>
      <rect x="154" y="63" width="242" height="12" className="pic-cur-head" />
      <text x="158" y="71.5" className="pic-mono">{'<<<<<<< HEAD (Current Change)'}</text>
      <rect x="154" y="75" width="242" height="14" className="pic-cur" />
      <rect x="164" y="78" width="140" height="8" rx="3" className="pic-code" />
      <text x="158" y="98" className="pic-mono">=======</text>
      <rect x="154" y="102" width="242" height="14" className="pic-inc" />
      <rect x="164" y="105" width="120" height="8" rx="3" className="pic-code" />
      <rect x="154" y="116" width="242" height="12" className="pic-inc-head" />
      <text x="158" y="124.5" className="pic-mono">{'>>>>>>> cake (Incoming Change)'}</text>
      {[0, 1, 2].map((i) => (
        <rect key={i} x="164" y={142 + i * 16} width={[130, 90, 160][i]} height="8" rx="3" className="pic-code" />
      ))}
      <rect x="290" y="210" width="104" height="18" rx="4" className="pic-button" />
      <text x="342" y="222" className="pic-button-text" textAnchor="middle">Resolve in Merge Editor</text>
      <rect x="0" y="238" width="400" height="12" className="pic-status" />
      <text x="8" y="247.5" className="pic-status-text">⑂ main</text>
    </svg>
  );
}

export const PICTURES: Record<string, () => React.JSX.Element> = { vscode: VSCodePicture, 'vscode-merge': VSCodeMergePicture };
