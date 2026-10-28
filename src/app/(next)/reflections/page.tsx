import { pageTitle } from "@/i18n/server";
import { Gate } from "@/components/kit";
import { LabsBack } from "@/ui/labs-back";
import View from "./view";

export const generateMetadata = pageTitle("reflections");

export default function Page() {
  return (
    <Gate>
      <LabsBack />
      <View />
    </Gate>
  );
}
