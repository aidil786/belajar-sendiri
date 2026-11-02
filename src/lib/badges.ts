// Which badges does the learner have? Earned by finishing lessons, never by time spent.
export interface BadgeRule {
  id: string;
  lessons: string[];
}

export function earnedBadges(rules: BadgeRule[], completed: string[]): string[] {
  const done = new Set(completed);
  return rules.filter((r) => r.lessons.length > 0 && r.lessons.every((l) => done.has(l))).map((r) => r.id);
}
