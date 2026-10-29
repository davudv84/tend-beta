import { pageTitle } from "@/i18n/server";
import View from "./view";

export const generateMetadata = pageTitle("admin");

export default function Page() {
  return <View />;
}
