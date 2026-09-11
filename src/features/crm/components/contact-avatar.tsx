import { AppAvatar } from "@/components/ui/app-avatar";
import { contactAvatarSeed } from "@/features/crm/normalize";

/**
 * Initials avatar for a contact. It is marked decorative because every place
 * it appears also renders the contact's name next to it - announcing the
 * initials again would only add noise for screen reader users.
 */
export function ContactAvatar({
  contact,
  size = "sm",
}: {
  contact: { name?: string | null; email?: string | null };
  size?: "xs" | "sm" | "md" | "lg" | "xl";
}) {
  return <AppAvatar name={contactAvatarSeed(contact)} size={size} aria-hidden />;
}
