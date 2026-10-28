import { pageTitle } from "@/i18n/server";
import { CONTAINER } from "@/lib/utils";
import View from "./view";

export const generateMetadata = pageTitle("developers");

export default function Page() {
  return (
    <div className={CONTAINER}>
      <View />
    </div>
  );
}
