import { pageTitle } from "@/i18n/server";
import { Reset } from "../forms";

export const generateMetadata = pageTitle("account");

/** The link in an invitation mail: choose a password, and the account is created in the inviting workspace. */
export default function Page() {
  return <Reset invitation />;
}
