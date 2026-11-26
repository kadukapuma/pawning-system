const mobile = /^07[0-9]{8}$/
// Sri Lankan geographic area codes and the 07 mobile range.
const phone = /^0(?:11|2[134567]|3[1-8]|4[157]|5[12457]|6[3567]|7[0-9]|81|91)[0-9]{7}$/

export function stripPhoneFormatting(value: string) {
  return value.replace(/[\s()-]+/g, '')
}

function normalizePhone(value: string) {
  const number = stripPhoneFormatting(value)
  return /^\+94[1-9][0-9]{8}$/.test(number) ? `0${number.slice(3)}` : number
}

export function mobileError(value: string) {
  if (!value.trim()) return 'Enter the customer’s mobile number.'
  if (!mobile.test(normalizePhone(value))) {
    return 'Enter a Sri Lankan mobile number, such as 077 123 4567 or +94 77 123 4567.'
  }
}

export function otherPhoneError(value: string) {
  if (value.trim() && !phone.test(normalizePhone(value))) {
    return 'Enter a Sri Lankan mobile or landline number.'
  }
}
