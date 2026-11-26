const EARLY_GRADE_RANK: Array<[RegExp, number]> = [
  [/^(play\s*group|pg)$/i, -40],
  [/^(nursery|nur)$/i, -30],
  [/^(kg|k\.g\.?|kindergarten|lkg)$/i, -20],
  [/^(prep|ukg|pre-?primary)$/i, -10],
]

function getGradeRank(value: string): number | null {
  const trimmed = value.trim()
  for (const [pattern, rank] of EARLY_GRADE_RANK) {
    if (pattern.test(trimmed)) return rank
  }
  const match = /^(?:class|grade|std|standard)?\s*(\d+)(?:st|nd|rd|th)?$/i.exec(trimmed)
  if (match) return Number(match[1])
  return null
}

/**
 * Compares school class/grade names in natural educational order
 * (e.g. Nursery, KG, Prep, 1, 2, ..., 9, 10) instead of lexicographical order.
 */
export function compareClassNames(left: string, right: string): number {
  const leftRank = getGradeRank(left)
  const rightRank = getGradeRank(right)
  if (leftRank !== null && rightRank !== null && leftRank !== rightRank) {
    return leftRank - rightRank
  }
  if (leftRank !== null && rightRank === null) return -1
  if (leftRank === null && rightRank !== null) return 1
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * Compares section or general labels using natural numeric collation.
 */
export function compareNaturalText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' })
}
