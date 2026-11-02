// ASCII history graph for `git log --graph`: a port of Git's graph.c
// (the 2.25+ layout). Supports merges with two parents; octopus merges can't
// be made in the simulator.
import type { Color, Seg } from './types';

type State = 'padding' | 'skip' | 'commit' | 'postMerge' | 'collapsing';

interface Column {
  commit: string;
  color: number;
}

const COLORS: Color[] = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan'];
const MERGE_CHARS = ['/', '|', '\\'];

export class GitGraph {
  private commit: string | null = null;
  private numParents = 0;
  private width = 0;
  private state: State = 'padding';
  private prevState: State = 'padding';
  private commitIndex = 0;
  private prevCommitIndex = 0;
  private mergeLayout = 0;
  private edgesAdded = 0;
  private prevEdgesAdded = 0;
  private columns: Column[] = [];
  private newColumns: Column[] = [];
  private mapping: number[] = [];
  private oldMapping: number[] = [];
  private mappingSize = 0;
  private defaultColor = COLORS.length - 1;

  constructor(
    private readonly interesting: (id: string) => boolean,
    private readonly parentsOf: (id: string) => string[],
  ) {}

  private parents(): string[] {
    return this.commit ? this.parentsOf(this.commit).filter((p) => this.interesting(p)) : [];
  }

  private findCommitColor(id: string): number {
    const col = this.columns.find((c) => c.commit === id);
    return col ? col.color : this.defaultColor;
  }

  private incrementColor(): void {
    this.defaultColor = (this.defaultColor + 1) % COLORS.length;
  }

  private findNewColumn(id: string): number {
    return this.newColumns.findIndex((c) => c.commit === id);
  }

  private insertIntoNewColumns(id: string, idx: number): void {
    let i = this.findNewColumn(id);
    let mappingIdx: number;
    if (i < 0) {
      i = this.newColumns.length;
      this.newColumns.push({ commit: id, color: this.findCommitColor(id) });
    }
    if (this.numParents > 1 && idx > -1 && this.mergeLayout === -1) {
      const dist = idx - i;
      const shift = dist > 1 ? 2 * dist - 3 : 1;
      this.mergeLayout = dist > 0 ? 0 : 1;
      this.edgesAdded = this.numParents + this.mergeLayout - 2;
      mappingIdx = this.width + (this.mergeLayout - 1) * shift;
      this.width += 2 * this.mergeLayout;
    } else if (this.edgesAdded > 0 && i === this.mapping[this.width - 2]) {
      mappingIdx = this.width - 2;
      this.edgesAdded = -1;
    } else {
      mappingIdx = this.width;
      this.width += 2;
    }
    this.mapping[mappingIdx] = i;
  }

  private updateColumns(): void {
    this.columns = this.newColumns;
    this.newColumns = [];
    const maxNew = this.columns.length + this.numParents;
    this.mappingSize = 2 * maxNew;
    this.mapping = new Array<number>(this.mappingSize).fill(-1);
    this.width = 0;
    this.prevEdgesAdded = this.edgesAdded;
    this.edgesAdded = 0;
    let seenThis = false;
    let inColumns = true;
    for (let i = 0; i <= this.columns.length; i++) {
      let colCommit: string;
      if (i === this.columns.length) {
        if (seenThis) break;
        inColumns = false;
        colCommit = this.commit!;
      } else colCommit = this.columns[i]!.commit;
      if (colCommit === this.commit) {
        seenThis = true;
        this.commitIndex = i;
        this.mergeLayout = -1;
        for (const p of this.parents()) {
          if (this.numParents > 1 || !inColumns) this.incrementColor();
          this.insertIntoNewColumns(p, i);
        }
        if (this.width === 0) this.width = 2;
      } else this.insertIntoNewColumns(colCommit, -1);
    }
    while (this.mappingSize > 1 && (this.mapping[this.mappingSize - 1] ?? -1) < 0) this.mappingSize--;
  }

  /** Start drawing a new commit. */
  update(id: string): void {
    this.commit = id;
    this.numParents = this.parents().length;
    this.prevCommitIndex = this.commitIndex;
    this.updateColumns();
    if (this.state !== 'padding') this.state = 'skip';
    else this.state = 'commit';
  }

  private setState(s: State): void {
    this.prevState = this.state;
    this.state = s;
  }

  private mappingCorrect(): boolean {
    for (let i = 0; i < this.mappingSize; i++) {
      const target = this.mapping[i] ?? -1;
      if (target < 0) continue;
      if (target === Math.floor(i / 2)) continue;
      return false;
    }
    return true;
  }

  isFinished(): boolean {
    return this.state === 'padding';
  }

  /** The next row of the graph. `commitLine` is true for the row with the `*`. */
  nextLine(): { segs: Seg[]; commitLine: boolean } {
    const out = new Row();
    let commitLine = false;
    switch (this.state) {
      case 'padding':
        for (const col of this.newColumns) out.col(col, '|').ch(' ');
        break;
      case 'skip':
        out.ch('...');
        this.setState('commit');
        break;
      case 'commit':
        this.commitRow(out);
        commitLine = true;
        break;
      case 'postMerge':
        this.postMergeRow(out);
        break;
      case 'collapsing':
        this.collapsingRow(out);
        break;
    }
    out.pad(this.width);
    return { segs: out.segs, commitLine };
  }

  /** A padding row (between commits in the long format). */
  paddingLine(): Seg[] {
    if (this.state !== 'commit') return this.nextLine().segs;
    const out = new Row();
    for (const col of this.columns) out.col(col, '|').ch(' ');
    out.pad(this.width);
    this.prevState = 'padding';
    return out.segs;
  }

  private commitRow(out: Row): void {
    let seenThis = false;
    for (let i = 0; i <= this.columns.length; i++) {
      let col: Column;
      if (i === this.columns.length) {
        if (seenThis) break;
        col = { commit: this.commit!, color: 0 };
      } else col = this.columns[i]!;
      if (col.commit === this.commit) {
        seenThis = true;
        out.ch('*');
      } else if (seenThis && this.edgesAdded > 1) out.col(col, '\\');
      else if (seenThis && this.edgesAdded === 1) {
        if (this.prevState === 'postMerge' && this.prevEdgesAdded > 0 && this.prevCommitIndex < i) out.col(col, '\\');
        else out.col(col, '|');
      } else if (this.prevState === 'collapsing' && this.oldMapping[2 * i + 1] === i && (this.mapping[2 * i] ?? -1) < i) {
        out.col(col, '/');
      } else out.col(col, '|');
      out.ch(' ');
    }
    if (this.numParents > 1) this.setState('postMerge');
    else if (this.mappingCorrect()) this.setState('padding');
    else this.setState('collapsing');
  }

  private postMergeRow(out: Row): void {
    let seenThis = false;
    const parents = this.parents();
    const firstParent = parents[0];
    let parentCol: Column | null = null;
    for (let i = 0; i <= this.columns.length; i++) {
      let col: Column;
      if (i === this.columns.length) {
        if (seenThis) break;
        col = { commit: this.commit!, color: 0 };
      } else col = this.columns[i]!;
      if (col.commit === this.commit) {
        seenThis = true;
        let idx = this.mergeLayout;
        parents.forEach((p, j) => {
          const par = this.newColumns[this.findNewColumn(p)]!;
          out.col(par, MERGE_CHARS[idx]!);
          if (idx === 2) {
            if (this.edgesAdded > 0 || j < this.numParents - 1) out.ch(' ');
          } else idx++;
        });
        if (this.edgesAdded === 0) out.ch(' ');
      } else if (seenThis) {
        out.col(col, this.edgesAdded > 0 ? '\\' : '|');
        out.ch(' ');
      } else {
        out.col(col, '|');
        if (this.mergeLayout !== 0 || i !== this.commitIndex - 1) {
          if (parentCol) out.col(parentCol, '_');
          else out.ch(' ');
        }
      }
      if (col.commit === firstParent) parentCol = col;
    }
    if (this.mappingCorrect()) this.setState('padding');
    else this.setState('collapsing');
  }

  private collapsingRow(out: Row): void {
    let usedHorizontal = false;
    let horizontalEdge = -1;
    let horizontalTarget = -1;
    this.oldMapping = this.mapping;
    this.mapping = new Array<number>(this.oldMapping.length).fill(-1);
    for (let i = 0; i < this.mappingSize; i++) {
      const target = this.oldMapping[i] ?? -1;
      if (target < 0) continue;
      if (target * 2 === i) this.mapping[i] = target;
      else if ((this.mapping[i - 1] ?? -1) < 0) {
        this.mapping[i - 1] = target;
        if (horizontalEdge === -1) {
          horizontalEdge = i;
          horizontalTarget = target;
          for (let j = target * 2 + 3; j < i - 2; j += 2) this.mapping[j] = target;
        }
      } else if (this.mapping[i - 1] === target) {
        // Joins the branch line to its left.
      } else {
        this.mapping[i - 2] = target;
        if (horizontalEdge === -1) {
          horizontalTarget = target;
          horizontalEdge = i - 1;
          for (let j = target * 2 + 3; j < i - 2; j += 2) this.mapping[j] = target;
        }
      }
    }
    this.oldMapping = [...this.mapping];
    if ((this.mapping[this.mappingSize - 1] ?? -1) < 0) this.mappingSize--;
    for (let i = 0; i < this.mappingSize; i++) {
      const target = this.mapping[i] ?? -1;
      if (target < 0) out.ch(' ');
      else if (target * 2 === i) out.col(this.newColumns[target]!, '|');
      else if (target === horizontalTarget && i !== horizontalEdge - 1) {
        if (i !== target * 2 + 3) this.mapping[i] = -1;
        usedHorizontal = true;
        out.col(this.newColumns[target]!, '_');
      } else {
        if (usedHorizontal && i < horizontalEdge) this.mapping[i] = -1;
        out.col(this.newColumns[target]!, '/');
      }
    }
    if (this.mappingCorrect()) this.setState('padding');
  }
}

class Row {
  segs: Seg[] = [];
  width = 0;

  ch(t: string): this {
    this.segs.push({ t });
    this.width += t.length;
    return this;
  }

  col(col: Column, t: string): this {
    this.segs.push({ t, c: COLORS[col.color % COLORS.length]! });
    this.width += t.length;
    return this;
  }

  pad(width: number): void {
    if (this.width < width) this.ch(' '.repeat(width - this.width));
  }
}

/**
 * Lay out a whole log: for each commit, the graph rows to print before its first
 * text line, the prefix for that line, and a function for following lines.
 */
export interface GraphPrinter {
  /** Rows before the commit line plus the commit-line prefix. */
  start(id: string): { before: Seg[][]; prefix: Seg[] };
  /** Prefix for the next text line of the same commit. */
  next(): Seg[];
  /** Separator row between commits (long format). */
  padding(): Seg[];
  /** Rows still needed after the commit's text. */
  remainder(): Seg[][];
}

export function graphPrinter(interesting: (id: string) => boolean, parentsOf: (id: string) => string[]): GraphPrinter & { update(id: string): void } {
  const g = new GitGraph(interesting, parentsOf);
  return {
    update: (id) => g.update(id),
    start(id) {
      void id;
      const before: Seg[][] = [];
      for (;;) {
        const { segs, commitLine } = g.nextLine();
        if (commitLine) return { before, prefix: segs };
        before.push(segs);
      }
    },
    next: () => g.nextLine().segs,
    padding: () => g.paddingLine(),
    remainder() {
      const rows: Seg[][] = [];
      while (!g.isFinished()) rows.push(g.nextLine().segs);
      return rows;
    },
  };
}
