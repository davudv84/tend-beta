import { pageTitle } from "@/i18n/server";
import View from "./view";

export const generateMetadata = pageTitle("verification");

export default function Page() {
  return <View />;
}
