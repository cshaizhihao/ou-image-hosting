export default function Loading() {
  return (
    <div className="page-loading page-loading--shell" aria-label="正在加载">
      <aside className="page-loading__sidebar" aria-hidden="true">
        <div className="page-loading__brand" />
        {Array.from({ length: 9 }).map((_, index) => (
          <div className="page-loading__nav" key={index} />
        ))}
      </aside>
      <main className="page-loading__main" role="status" aria-live="polite">
        <div className="page-loading__ring" aria-hidden="true" />
        <strong>正在切换页面</strong>
        <span>左侧菜单会保持可见，页面约 1 秒后完成刷新。</span>
        <div className="page-loading__fake-progress" aria-hidden="true">
          <i />
        </div>
      </main>
    </div>
  );
}
