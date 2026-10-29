import { pageTitle } from "@/i18n/server";
import { Reset } from "../forms";

export const generateMetadata = pageTitle("account");

export default function Page() {
  return <Reset />;
}
