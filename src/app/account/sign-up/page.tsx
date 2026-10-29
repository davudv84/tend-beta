import { pageTitle } from "@/i18n/server";
import { SignUp } from "../forms";

export const generateMetadata = pageTitle("account");

export default function Page() {
  return <SignUp />;
}
