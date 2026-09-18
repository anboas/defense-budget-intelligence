import ProductMark from "./ProductMark.jsx";

export default function WorkspaceMark({ workspace, className = "", eager = false }) {
  const icon = workspace?.iconDataUrl || "";
  const label = workspace?.name || workspace?.displayTitle || "Workspace";
  return icon
    ? <img className={className} src={icon} alt="" aria-hidden="true" title={label} />
    : <ProductMark className={className} eager={eager} title={label} />;
}
