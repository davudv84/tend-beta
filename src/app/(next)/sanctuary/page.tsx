import { pageTitle } from "@/i18n/server";
import { Gate } from "@/components/kit";
import View from "./view";

export const generateMetadata = pageTitle("sanctuary");

export default function Page() {
  return (
    <Gate bleed>
      <View />
    </Gate>
  );
}
