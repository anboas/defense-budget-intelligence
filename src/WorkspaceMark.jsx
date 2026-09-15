import ProductMark from "./ProductMark.jsx";

export default function WorkspaceMark({ workspace, className = "", eager = false }) {
  const icon = workspace?.iconDataUrl || "";
  return icon
    ? <img className={className} src={icon} alt="" aria-hidden="true" />
    : <ProductMark className={className} eager={eager} />;
}
