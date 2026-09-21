// Accounts can be created with just an email + password; the display name then
// comes from the part before the "@" ("juan.delacruz@x.com" → "Juan Delacruz")
// and the user can change it themselves on their Profile page.
export function nameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const words = local
    .split(/[._+\-\s]+/)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase());
  const name = words.join(" ").slice(0, 120);
  return name.length >= 2 ? name : "New User";
}
