import type { ReactNode } from "react";
import { useStore, type ShowTab } from "../../state/store";
import { ColorwayMatrix, ColorwayPanel } from "./Colorways";
import { SocialPanel, SocialView } from "./Social";
import { Viewer3DPanel, Viewer3DView } from "./Viewer3D";
import { PhotoPanel, PhotoView } from "./PhotoMockups";
import { LineSheetPanel, LineSheetView } from "./LineSheet";
import { AiPanel, AiView } from "./AiRender";

interface Tool { id: ShowTab; label: string; view: () => ReactNode; panel: () => ReactNode }

export const SHOW_TOOLS: Tool[] = [
  { id: "colorways", label: "Colorways", view: () => <ColorwayMatrix />, panel: () => <ColorwayPanel /> },
  { id: "3d", label: "3D", view: () => <Viewer3DView />, panel: () => <Viewer3DPanel /> },
  { id: "photo", label: "Photo mockups", view: () => <PhotoView />, panel: () => <PhotoPanel /> },
  { id: "ai", label: "On-model render", view: () => <AiView />, panel: () => <AiPanel /> },
  { id: "social", label: "Social", view: () => <SocialView />, panel: () => <SocialPanel /> },
  { id: "linesheet", label: "Line sheet", view: () => <LineSheetView />, panel: () => <LineSheetPanel /> },
];

const toolFor = (t: ShowTab) => SHOW_TOOLS.find((x) => x.id === t) ?? SHOW_TOOLS[0];

/** Main area of Showcase mode: sits over the stage (which stays mounted for exports). */
export function ShowcaseView() {
  const tab = useStore((s) => s.showTab);
  const set = useStore((s) => s.set);
  const t = toolFor(tab);
  return (
    <section className="showcase" data-testid="showcase">
      <div className="sc-tabs" role="tablist">
        {SHOW_TOOLS.map((x) => (
          <button key={x.id} role="tab" aria-selected={x.id === t.id} className={`sc-tab${x.id === t.id ? " on" : ""}`} onClick={() => set({ showTab: x.id })}>{x.label}</button>
        ))}
        <div className="spacer" />
        <button className="btn sm primary present-btn" onClick={() => set({ presenting: true })} data-testid="present-btn">Present</button>
      </div>
      {t.view()}
    </section>
  );
}

export function ShowcasePanel() {
  const tab = useStore((s) => s.showTab);
  return <>{toolFor(tab).panel()}</>;
}
