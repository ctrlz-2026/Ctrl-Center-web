export function entryAllowed(verifiedPerson: boolean, verifiedCount: number, required: number) {
  return verifiedPerson && Number.isFinite(required) && required >= 1 && verifiedCount >= required;
}
