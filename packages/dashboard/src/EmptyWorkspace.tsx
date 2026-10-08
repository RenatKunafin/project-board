export function EmptyWorkspace() {
  return (
    <div className="empty-workspace" role="status">
      <p className="empty-workspace__title">Пространство пусто</p>
      <p className="empty-workspace__hint">
        Добавьте виджет из каталога — каталог появится в следующем обновлении.
      </p>
    </div>
  );
}
