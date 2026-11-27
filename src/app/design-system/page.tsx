import { cookies } from "next/headers";
import { DesignSystem } from "@/design-system/showcase";
import { parseThemePref, THEME_COOKIE } from "@/design-system/theme";

export default async function Page() {
  const initialTheme = parseThemePref((await cookies()).get(THEME_COOKIE)?.value);
  return <DesignSystem initialTheme={initialTheme} />;
}
