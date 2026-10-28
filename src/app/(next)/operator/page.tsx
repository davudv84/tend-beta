import { pageTitle } from "@/i18n/server";
import View from "./view";

export const generateMetadata = pageTitle("operator");

export default function Page() {
  return <View />;
}
