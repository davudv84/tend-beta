import { pageTitle } from "@/i18n/server";
import { SignIn } from "../forms";

export const generateMetadata = pageTitle("account");

export default function Page() {
  return <SignIn />;
}
