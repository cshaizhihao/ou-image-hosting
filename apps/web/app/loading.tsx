export default function Loading() {
  return (
    <div className="page-loading" aria-label="正在加载">
      <div className="page-loading__line" />
      <div className="page-loading__grid">
        {Array.from({ length: 6 }).map((_, index) => (
          <div className="page-loading__tile" key={index} />
        ))}
      </div>
    </div>
  );
}
