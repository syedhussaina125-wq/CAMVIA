import type { NewStudent, Student } from '../studentData'

export type DuplicateRuleType = 'student_id' | 'roll_number' | 'identity'

export type DuplicateMatch = {
  isDuplicate: boolean
  rule?: DuplicateRuleType
  message?: string
  matchedStudentId?: string
}

export type StudentCandidate = {
  id?: string
  studentId: string
  firstName: string
  lastName: string
  className: string
  section: string
  rollNumber?: string | null
  dateOfBirth?: string | null
}

const normalize = (value?: string | null): string => (value ?? '').trim().toLowerCase()

/**
 * Checks a single candidate student against a collection of existing students
 * within the same school according to the 3 mandatory CAMVIA duplicate rules:
 *
 * 1. Student ID / student_code:
 *    Matches if candidate.studentId === existing.studentId
 *    Error: "Student ID already exists."
 *
 * 2. Roll number in same class + section:
 *    Applies only when candidate rollNumber is provided.
 *    Matches if rollNumber, className, and section all match an existing student.
 *    Error: "Roll number already exists in Class 10-A." (using className-section)
 *
 * 3. Likely duplicate student identity:
 *    Matches if first name, last name, date of birth, class, and section all match.
 *    Error: "Possible duplicate student found. Review before creating."
 *
 * Note: Students with the same name are NOT blocked if their Student ID and other
 * identifying details are different.
 */
export function checkStudentDuplicate(
  candidate: StudentCandidate,
  existingList: readonly StudentCandidate[],
  excludeId?: string,
): DuplicateMatch {
  const candStudentId = normalize(candidate.studentId)
  const candRoll = normalize(candidate.rollNumber)
  const candClass = normalize(candidate.className)
  const candSection = normalize(candidate.section)
  const candFirst = normalize(candidate.firstName)
  const candLast = normalize(candidate.lastName)
  const candDob = (candidate.dateOfBirth ?? '').trim()

  for (const existing of existingList) {
    if (excludeId && existing.id === excludeId) continue

    const exStudentId = normalize(existing.studentId)
    const exRoll = normalize(existing.rollNumber)
    const exClass = normalize(existing.className)
    const exSection = normalize(existing.section)
    const exFirst = normalize(existing.firstName)
    const exLast = normalize(existing.lastName)
    const exDob = (existing.dateOfBirth ?? '').trim()

    // Rule 1: Student ID match
    if (candStudentId && exStudentId && candStudentId === exStudentId) {
      return {
        isDuplicate: true,
        rule: 'student_id',
        message: 'Student ID already exists.',
        matchedStudentId: existing.studentId,
      }
    }

    // Rule 2: Roll number within the same class + section (only when roll number is provided)
    if (
      candRoll &&
      exRoll &&
      candRoll === exRoll &&
      candClass === exClass &&
      candSection === exSection
    ) {
      const classLabel = candidate.className.trim()
      const sectionLabel = candidate.section.trim()
      return {
        isDuplicate: true,
        rule: 'roll_number',
        message: `Roll number already exists in ${classLabel}-${sectionLabel}.`,
        matchedStudentId: existing.studentId,
      }
    }

    // Rule 3: Likely duplicate student identity (first name, last name, DOB, class, section)
    if (
      candFirst &&
      candLast &&
      candDob &&
      candClass &&
      candSection &&
      candFirst === exFirst &&
      candLast === exLast &&
      candDob === exDob &&
      candClass === exClass &&
      candSection === exSection
    ) {
      return {
        isDuplicate: true,
        rule: 'identity',
        message: 'Possible duplicate student found. Review before creating.',
        matchedStudentId: existing.studentId,
      }
    }
  }

  return { isDuplicate: false }
}

export type CsvSkippedRow = {
  rowNumber: number
  student: NewStudent
  reason: string
  rule: DuplicateRuleType
}

export type CsvDuplicateReport = {
  validRows: NewStudent[]
  skippedRows: CsvSkippedRow[]
}

/**
 * Evaluates duplicate students within an uploaded CSV:
 * - Checks against existing students (active and trashed in the school).
 * - Checks intra-CSV duplicates against previously evaluated rows in the file.
 * - Skips duplicate rows and returns detailed reasons for each skipped row.
 */
export function evaluateCsvDuplicates(
  rows: readonly NewStudent[],
  existingStudents: readonly StudentCandidate[],
): CsvDuplicateReport {
  const validRows: NewStudent[] = []
  const skippedRows: CsvSkippedRow[] = []

  // Cumulative pool of students starting with existing students
  const candidatePool: StudentCandidate[] = [...existingStudents]

  rows.forEach((student, index) => {
    const rowNumber = index + 2 // 1-based index (header is row 1)
    const candidate: StudentCandidate = {
      studentId: student.studentId,
      firstName: student.firstName,
      lastName: student.lastName,
      className: student.className,
      section: student.section,
      rollNumber: student.rollNumber,
      dateOfBirth: student.dateOfBirth,
    }

    const match = checkStudentDuplicate(candidate, candidatePool)
    if (match.isDuplicate && match.message && match.rule) {
      skippedRows.push({
        rowNumber,
        student,
        reason: match.message,
        rule: match.rule,
      })
    } else {
      validRows.push(student)
      candidatePool.push(candidate)
    }
  })

  return { validRows, skippedRows }
}

/**
 * Converts a Student domain object into a StudentCandidate for duplicate comparison.
 */
export function studentToCandidate(student: Student): StudentCandidate {
  return {
    id: student.id,
    studentId: student.studentId,
    firstName: student.firstName,
    lastName: student.lastName,
    className: student.className,
    section: student.section,
    rollNumber: student.rollNumber,
    dateOfBirth: student.dateOfBirth,
  }
}

