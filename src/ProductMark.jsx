export const PRODUCT_ICON_URL = `${import.meta.env.BASE_URL}icon-192.png`;

export default function ProductMark({ className = "", eager = false }) {
  return (
    <img
      className={className}
      src={PRODUCT_ICON_URL}
      alt=""
      aria-hidden="true"
      width="192"
      height="192"
      decoding="async"
      loading={eager ? "eager" : "lazy"}
    />
  );
}
