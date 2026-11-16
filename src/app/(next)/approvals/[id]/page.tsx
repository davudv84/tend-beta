import { pageTitle } from "@/i18n/server";
import { Gate } from "@/components/kit";
import View from "./view";

export const generateMetadata = pageTitle("approval");

/** One approval: where a notification (browser, Telegram) leads, and where a high-risk approval is confirmed while signed in. */
export default function Page() {
  return (
    <Gate>
      <View />
    </Gate>
  );
}
