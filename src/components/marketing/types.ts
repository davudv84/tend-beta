// Types shared by the server page and the client sections, kept apart from images.ts (which reads the file system).
export type HomeImageKey = "hero" | "heroForeground" | "integrations" | "footer";
export type HomeImages = Partial<Record<HomeImageKey, string>>;
