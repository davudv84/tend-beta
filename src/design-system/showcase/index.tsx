"use client";

import { Brand, Colors, Overview, Typography } from "./chapters-a";
import { Buttons, Forms, Spacing, Surfaces } from "./chapters-b";
import { Data, Navigation, Tend } from "./chapters-c";
import { Compositions, Motion, Themes } from "./chapters-d";
import { Shell } from "./shell";

export function DesignSystem() {
  return (
    <Shell>
      <Overview />
      <Brand />
      <Colors />
      <Typography />
      <Spacing />
      <Surfaces />
      <Buttons />
      <Forms />
      <Navigation />
      <Data />
      <Tend />
      <Motion />
      <Themes />
      <Compositions />
    </Shell>
  );
}
