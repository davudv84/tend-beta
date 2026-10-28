import { pageTitle } from "@/i18n/server";
import View from "./view";

export const generateMetadata = pageTitle("home");

export default function Page() {
  return <View />;
}
