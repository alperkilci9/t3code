import { useChatLayoutStore } from "../../../chatLayoutStore";
import { Toggle, ToggleGroup } from "../../ui/toggle-group";

export function ChatViewModeControl() {
  const mode = useChatLayoutStore((state) => state.layout.mode);
  return (
    <ToggleGroup
      aria-label="Chat view mode"
      value={[mode]}
      onValueChange={(values) => {
        const next = values[0];
        if (next === "single" || next === "grid" || next === "columns")
          useChatLayoutStore.getState().dispatch({ type: "set-mode", mode: next });
      }}
    >
      {(["single", "grid", "columns"] as const).map((value) => (
        <Toggle
          key={value}
          value={value}
          aria-label={value.charAt(0).toUpperCase() + value.slice(1)}
        >
          {value.charAt(0).toUpperCase() + value.slice(1)}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
