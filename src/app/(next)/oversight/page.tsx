import { Suspense } from "react";
import { pageTitle } from "@/i18n/server";
import { Gate } from "@/components/kit";
import View from "./view";

export const generateMetadata = pageTitle("oversight");

export default function Page() {
  return (
    <Gate>
      <Suspense>
        <View />
      </Suspense>
    </Gate>
  );
}
