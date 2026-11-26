export const nicError = 'Enter 9 digits followed by V or X, or 12 digits, with a valid birth date.'

export function normalizeNic(value: string) {
  return value.trim().replaceAll(' ', '').toUpperCase()
}

export function decodeNic(nic: string) {
  if (!/^(?:[0-9]{9}[VX]|[0-9]{12})$/.test(nic)) return null

  const yearLength = nic.length === 10 ? 2 : 4
  const year = Number(nic.slice(0, yearLength)) + (yearLength === 2 ? 1900 : 0)
  const code = Number(nic.slice(yearLength, yearLength + 3))
  const gender = code > 500 ? 'female' : 'male'
  const day = code - (gender === 'female' ? 500 : 0)
  if (year === 0 || day < 1 || day > 366) return null

  // NIC day codes reserve a slot for 29 February every year.
  const calendar = new Date(Date.UTC(2000, 0, day))
  const birth = new Date(0)
  birth.setFullYear(year, calendar.getUTCMonth(), calendar.getUTCDate())
  birth.setHours(0, 0, 0, 0)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  if (birth.getMonth() !== calendar.getUTCMonth() || birth >= today) return null

  const date_of_birth = `${String(year).padStart(4, '0')}${calendar.toISOString().slice(4, 10)}`
  return { date_of_birth, gender }
}
