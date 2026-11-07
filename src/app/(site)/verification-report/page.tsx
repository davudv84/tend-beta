import type { Metadata } from "next";
import { VerificationReportPage } from "@/components/marketing/pages/verification-report";
import { getT } from "@/i18n/server";
import { config } from "@/server/config";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t.front.pages.report.meta };
}

export default function Page() {
  return <VerificationReportPage accounts={config.accounts} />;
}
