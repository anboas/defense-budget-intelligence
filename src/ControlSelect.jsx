import { ControlPicker } from "control-surface-ui/react";

export default function ControlSelect({ ariaLabel, ...props }) {
  return <ControlPicker label={ariaLabel || "Select"} {...props} />;
}
