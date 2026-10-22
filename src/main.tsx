import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "./shell/AppShell";
import { Inloggningsgrind } from "./shell/Inloggning";
import { RamFönster } from "./tools/ramar/RamFonster";
import { ärVisningsfönster } from "./tools/ramar/visning";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* Ramarnas bild i ett eget fönster (andra skärmen) – se tools/ramar/visning.ts. */}
    <Inloggningsgrind>{ärVisningsfönster() ? <RamFönster /> : <AppShell />}</Inloggningsgrind>
  </StrictMode>,
);
