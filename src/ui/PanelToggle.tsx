import { useOverlays, type PanelSide } from './overlays';

/** Chevron that hides or shows a side panel; it points the way the panel will move. */
export function PanelToggle({ side, label }: { side: PanelSide; label: string }) {
  const open = useOverlays((s) => s.panels[side]);
  const title = `${open ? 'Hide' : 'Show'} ${label}`;
  return (
    <button
      className="panel-toggle"
      onClick={() => useOverlays.getState().togglePanel(side)}
      title={title}
      aria-label={title}
      aria-expanded={open}
    >
      {(side === 'left') === open ? '‹' : '›'}
    </button>
  );
}
