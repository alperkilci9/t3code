import type { ComponentProps } from "react";
import markUrl from "../../../../assets/studyworkspace/mark.svg";

export function StudyWorkspaceMark(props: Omit<ComponentProps<"img">, "src" | "alt">) {
  return <img {...props} src={markUrl} alt="" />;
}
