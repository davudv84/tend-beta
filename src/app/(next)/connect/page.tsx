import { Suspense } from "react";
import { pageTitle } from "@/i18n/server";
import View from "./view";

export const generateMetadata = pageTitle("connect");

export default function Page() {
  return (
    <Suspense>
      <View />
    </Suspense>
  );
}
