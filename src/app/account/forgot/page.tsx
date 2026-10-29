import { pageTitle } from "@/i18n/server";
import { Forgot } from "../forms";

export const generateMetadata = pageTitle("account");

export default function Page() {
  return <Forgot />;
}
